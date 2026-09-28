import type { IDurableStore } from "../interfaces/store";
import type { Execution } from "../types";
import { ExecutionStatus, TimerStatus, TimerType } from "../types";
import type { Logger } from "../../../../models/Logger";
import { clearExecutionCurrentIfSuspendedOnStep } from "../current";
import { withExecutionWaitLock } from "../executionWaiters";
import {
  createExecutionWaitCompletionState,
  createExecutionWaitContinuedState,
} from "../executionWaitState";
import { parseExecutionWaitState } from "../utils";
import { commitDurableWaitCompletion } from "../waiterCore";

export type ResolvedExecutionWaiter = {
  executionId: string;
  stepId: string;
};

/**
 * Builds the follow marker for one waiter of a continued-as-new run. The
 * waited-on root and the timeout triple are read back from the waiting step
 * so the deadline survives the hop; when the step is missing or unreadable
 * the marker degrades to the current hop and replay validation reports the
 * corruption at the authoritative reader instead of here.
 */
function createContinuedWaitMarker(params: {
  execution: Execution;
  waitingState: ReturnType<typeof parseExecutionWaitState>;
}): ReturnType<typeof createExecutionWaitContinuedState> {
  const timeout =
    params.waitingState?.state === "waiting" ||
    params.waitingState?.state === "continued"
      ? params.waitingState
      : undefined;

  return createExecutionWaitContinuedState({
    continuedExecution: params.execution,
    targetExecutionId:
      params.waitingState?.targetExecutionId ?? params.execution.id,
    timeoutMs: timeout?.timeoutMs,
    timeoutAtMs: timeout?.timeoutAtMs,
    timerId: timeout?.timerId,
  });
}

export async function resolveExecutionWaiters(params: {
  store: IDurableStore;
  execution: Execution;
  kickoffExecution: (executionId: string) => Promise<void>;
  logger: Logger;
}): Promise<void> {
  const resolvedWaiters = await withExecutionWaitLock<
    ResolvedExecutionWaiter[]
  >({
    store: params.store,
    targetExecutionId: params.execution.id,
    fn: async () => {
      const resolvedWaiters: ResolvedExecutionWaiter[] = [];
      const waiters = await params.store.listExecutionWaiters(
        params.execution.id,
      );

      for (const waiter of waiters) {
        // Read under the same wait lock the commit takes, so the accepted
        // step target cannot change between this read and the atomic commit.
        // Followed waits keep the waited-on root in the step while the waiter
        // is registered on the tip, hence the separate accepted target.
        const waitingStep = await params.store.getStepResult(
          waiter.executionId,
          waiter.stepId,
        );
        const waitingState = parseExecutionWaitState(waitingStep?.result);
        const stepResult = {
          executionId: waiter.executionId,
          stepId: waiter.stepId,
          result:
            params.execution.status === ExecutionStatus.ContinuedAsNew
              ? createContinuedWaitMarker({
                  execution: params.execution,
                  waitingState,
                })
              : createExecutionWaitCompletionState(
                  params.execution,
                  waitingState?.targetExecutionId ?? params.execution.id,
                ),
          completedAt: new Date(),
        };

        const completed = await commitDurableWaitCompletion({
          store: params.store,
          stepResult,
          timerId: waiter.timerId,
          commitAtomically: params.store.commitExecutionWaiterCompletion
            ? async () =>
                await params.store.commitExecutionWaiterCompletion!({
                  targetExecutionId: params.execution.id,
                  executionId: waiter.executionId,
                  stepId: waiter.stepId,
                  stepResult,
                  timerId: waiter.timerId,
                  waitTargetExecutionId: waitingState?.targetExecutionId,
                })
            : undefined,
          onFallbackCommitted: async () => {
            await params.store.deleteExecutionWaiter(
              params.execution.id,
              waiter.executionId,
              waiter.stepId,
            );
          },
        });

        if (!completed) {
          continue;
        }

        resolvedWaiters.push({
          executionId: waiter.executionId,
          stepId: waiter.stepId,
        });
      }

      return resolvedWaiters;
    },
  });

  for (const waiter of resolvedWaiters) {
    await clearExecutionWaitCurrentBestEffort({
      store: params.store,
      logger: params.logger,
      executionId: waiter.executionId,
      stepId: waiter.stepId,
      targetExecutionId: params.execution.id,
    });

    await resumeExecutionWaitParentBestEffort({
      store: params.store,
      logger: params.logger,
      executionId: waiter.executionId,
      stepId: waiter.stepId,
      targetExecutionId: params.execution.id,
      kickoffExecution: params.kickoffExecution,
    });
  }
}

export async function resumeExecutionWaitParentBestEffort(params: {
  store: IDurableStore;
  logger: Logger;
  executionId: string;
  stepId: string;
  targetExecutionId: string;
  kickoffExecution: (executionId: string) => Promise<void>;
}): Promise<void> {
  const timerId = `wait_execution_resume:${params.executionId}:${params.stepId}`;
  let retryTimerArmed = false;
  let retryTimerError: unknown;

  try {
    await params.store.createTimer({
      id: timerId,
      executionId: params.executionId,
      type: TimerType.Retry,
      fireAt: new Date(),
      status: TimerStatus.Pending,
    });
    retryTimerArmed = true;
  } catch (error) {
    retryTimerError = error;
  }

  try {
    await params.kickoffExecution(params.executionId);
  } catch (error) {
    if (!retryTimerArmed) {
      try {
        await params.store.createTimer({
          id: timerId,
          executionId: params.executionId,
          type: TimerType.Retry,
          fireAt: new Date(),
          status: TimerStatus.Pending,
        });
        retryTimerArmed = true;
        retryTimerError = undefined;
      } catch (timerError) {
        retryTimerError = retryTimerError ?? timerError;
      }
    }

    try {
      await params.logger.warn(
        "Durable waitForExecution parent kickoff failed; relying on retry handling instead.",
        {
          executionId: params.executionId,
          stepId: params.stepId,
          targetExecutionId: params.targetExecutionId,
          retryTimerArmed,
          retryTimerError,
          error,
        },
      );
    } catch {
      // Logging must stay best-effort after the wait completion is durable.
    }
    return;
  }

  if (retryTimerArmed) {
    try {
      await params.store.deleteTimer(timerId);
    } catch {
      // Best-effort timer cleanup; duplicate resumes stay replay-safe.
    }
  }
}

/**
 * The durable completion is already persisted before this cleanup runs.
 * If clearing `execution.current` fails, we still need to kick the parent so
 * replay can observe the completed wait state and continue.
 */
export async function clearExecutionWaitCurrentBestEffort(params: {
  store: IDurableStore;
  logger: Logger;
  executionId: string;
  stepId: string;
  targetExecutionId: string;
}): Promise<void> {
  try {
    await clearExecutionCurrentIfSuspendedOnStep(
      params.store,
      params.executionId,
      {
        stepId: params.stepId,
        kinds: ["waitForExecution"],
      },
    );
  } catch (error) {
    try {
      await params.logger.warn(
        "Durable waitForExecution current cleanup failed; resuming parent execution anyway.",
        {
          executionId: params.executionId,
          stepId: params.stepId,
          targetExecutionId: params.targetExecutionId,
          error,
        },
      );
    } catch {
      // Logging must not block wait completion recovery.
    }
  }
}
