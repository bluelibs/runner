import type { IDurableStore } from "../interfaces/store";
import type { Timer, Execution } from "../types";
import { ExecutionStatus, TimerType } from "../types";
import { DurableAuditEntryKind } from "../audit";
import { clearExecutionCurrentIfSuspendedOnStep } from "../current";
import type { AuditLogger } from "./AuditLogger";
import type { TaskRegistry } from "./TaskRegistry";
import type { ScheduleManager } from "./ScheduleManager";
import {
  parseExecutionWaitState,
  parseSignalState,
  parseSleepState,
} from "../utils";
import { withExecutionWaitLock } from "../executionWaiters";
import {
  deleteSignalWaiter,
  getSignalIdFromStepId,
  withSignalLock,
} from "../signalWaiters";
import { Logger } from "../../../../models/Logger";
import { durableExecutionInvariantError } from "../../../../errors";

export async function handleSleepTimer(params: {
  store: IDurableStore;
  auditLogger: AuditLogger;
  timer: Timer;
}): Promise<boolean> {
  if (
    params.timer.type !== TimerType.Sleep ||
    !params.timer.executionId ||
    !params.timer.stepId
  ) {
    return false;
  }

  const existing = await params.store.getStepResult(
    params.timer.executionId,
    params.timer.stepId,
  );
  const state = parseSleepState(existing?.result);
  if (state?.state !== "sleeping" || state.timerId !== params.timer.id) {
    return false;
  }

  await params.store.saveStepResult({
    executionId: params.timer.executionId,
    stepId: params.timer.stepId,
    result: { state: "completed" },
    completedAt: new Date(),
  });
  await clearExecutionCurrentIfSuspendedOnStep(
    params.store,
    params.timer.executionId,
    {
      stepId: params.timer.stepId,
      kinds: ["sleep"],
    },
  );

  const execution = await params.store.getExecution(params.timer.executionId);
  await params.auditLogger.log({
    kind: DurableAuditEntryKind.SleepCompleted,
    executionId: params.timer.executionId,
    workflowKey: execution?.workflowKey,
    attempt: execution ? execution.attempt : 0,
    stepId: params.timer.stepId,
    timerId: params.timer.id,
  });

  return true;
}

export async function handleSignalTimeoutTimer(params: {
  store: IDurableStore;
  logger: Logger;
  timer: Timer;
}): Promise<string | null> {
  if (
    params.timer.type !== TimerType.SignalTimeout ||
    !params.timer.executionId ||
    !params.timer.stepId
  ) {
    return null;
  }

  const fallbackSignalId = params.timer.stepId.startsWith("__signal:")
    ? getSignalIdFromStepId(params.timer.stepId)
    : params.timer.stepId.split(":")[0];
  const currentSignalStep = await params.store.getStepResult(
    params.timer.executionId,
    params.timer.stepId,
  );
  const currentSignalState = parseSignalState(currentSignalStep?.result);
  const signalIdForLock = currentSignalState?.signalId ?? fallbackSignalId;
  const lockSignalId = signalIdForLock ?? "__unknown_signal_timeout__";

  if (!signalIdForLock) {
    try {
      await params.logger.warn(
        "Durable signal-timeout handler fell back to an unknown signal id.",
        {
          data: {
            timerId: params.timer.id,
            executionId: params.timer.executionId,
            stepId: params.timer.stepId,
            fallbackSignalId: lockSignalId,
            timerType: params.timer.type,
          },
        },
      );
    } catch {
      // Logging must not crash durable timer handling.
    }
  }

  let signalIdForActiveLock = lockSignalId;

  while (true) {
    const locked = await withSignalLock<
      | {
          kind: "done";
          signalId: string;
        }
      | {
          kind: "retry";
          retryWithSignalId: string;
        }
      | null
    >({
      store: params.store,
      executionId: params.timer.executionId,
      signalId: signalIdForActiveLock,
      fn: async () => {
        const existing = await params.store.getStepResult(
          params.timer.executionId!,
          params.timer.stepId!,
        );
        const state = parseSignalState(existing?.result);
        if (state?.state !== "waiting") {
          return null;
        }
        if (state.timerId !== undefined && state.timerId !== params.timer.id) {
          return null;
        }
        if (state.signalId && state.signalId !== signalIdForActiveLock) {
          return {
            kind: "retry" as const,
            retryWithSignalId: state.signalId,
          };
        }

        const signalId = state.signalId ?? fallbackSignalId;
        if (!signalId) {
          return durableExecutionInvariantError.throw({
            message: `Invalid signal timeout step id '${params.timer.stepId}' for timer '${params.timer.id}'`,
          });
        }

        await deleteSignalWaiter({
          store: params.store,
          executionId: params.timer.executionId!,
          signalId,
          stepId: params.timer.stepId!,
        });

        const timedOutState =
          state.signalId !== undefined
            ? { state: "timed_out" as const, signalId: state.signalId }
            : { state: "timed_out" as const };
        await params.store.saveStepResult({
          executionId: params.timer.executionId!,
          stepId: params.timer.stepId!,
          result: timedOutState,
          completedAt: new Date(),
        });
        await clearExecutionCurrentIfSuspendedOnStep(
          params.store,
          params.timer.executionId!,
          {
            stepId: params.timer.stepId!,
            kinds: ["waitForSignal"],
          },
        );

        return { kind: "done" as const, signalId };
      },
    });

    if (locked === null) {
      return null;
    }
    if (locked.kind === "retry") {
      signalIdForActiveLock = locked.retryWithSignalId;
      continue;
    }
    return locked.signalId;
  }
}

export async function handleExecutionWaitTimeoutTimer(params: {
  store: IDurableStore;
  timer: Timer;
}): Promise<boolean> {
  if (
    params.timer.type !== TimerType.Timeout ||
    !params.timer.executionId ||
    !params.timer.stepId
  ) {
    return false;
  }

  const currentWaitStep = await params.store.getStepResult(
    params.timer.executionId,
    params.timer.stepId,
  );
  const currentWaitState = parseExecutionWaitState(currentWaitStep?.result);
  if (
    currentWaitState?.state !== "waiting" ||
    !currentWaitState.targetExecutionId
  ) {
    return false;
  }

  return await withExecutionWaitLock({
    store: params.store,
    targetExecutionId: currentWaitState.targetExecutionId,
    fn: async () => {
      const existing = await params.store.getStepResult(
        params.timer.executionId!,
        params.timer.stepId!,
      );
      const state = parseExecutionWaitState(existing?.result);
      if (state?.state !== "waiting") {
        return false;
      }
      if (state.timerId !== undefined && state.timerId !== params.timer.id) {
        return false;
      }

      await params.store.deleteExecutionWaiter(
        state.targetExecutionId,
        params.timer.executionId!,
        params.timer.stepId!,
      );

      await params.store.saveStepResult({
        executionId: params.timer.executionId!,
        stepId: params.timer.stepId!,
        result: {
          state: "timed_out" as const,
          targetExecutionId: state.targetExecutionId,
        },
        completedAt: new Date(),
      });
      await clearExecutionCurrentIfSuspendedOnStep(
        params.store,
        params.timer.executionId!,
        {
          stepId: params.timer.stepId!,
          kinds: ["waitForExecution"],
        },
      );

      return true;
    },
  });
}

export async function persistTaskTimerExecution(params: {
  store: IDurableStore;
  timer: Timer;
  workflowKey: string;
  maxAttempts: number;
  defaultTimeout: number | undefined;
}): Promise<string> {
  const timerExecutionKey = getTaskTimerExecutionKey(params.timer);
  const executionId = `timer:${timerExecutionKey}`;
  const execution: Execution<unknown, unknown> = {
    id: executionId,
    workflowKey: params.workflowKey,
    input: params.timer.input,
    status: ExecutionStatus.Pending,
    attempt: 1,
    maxAttempts: params.maxAttempts,
    timeout: params.defaultTimeout,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const created = await params.store.createExecutionWithIdempotencyKey({
    execution,
    workflowKey: params.workflowKey,
    idempotencyKey: `timer:${timerExecutionKey}`,
  });
  return created.executionId;
}

function getTaskTimerExecutionKey(timer: Timer): string {
  if (!timer.scheduleId) {
    return timer.id;
  }

  // Retries for the same fired occurrence must dedupe, while later ticks of the
  // recurring schedule need fresh execution identities.
  return `${timer.id}:${timer.fireAt.getTime()}`;
}

export async function handleExecutionTimer(params: {
  timer: Timer;
  queue:
    | {
        enqueue: (message: {
          type: "resume";
          payload: { executionId: string };
          maxAttempts: number;
        }) => Promise<unknown>;
      }
    | undefined;
  maxAttempts: number;
  processExecution: (executionId: string) => Promise<void>;
  onSafeToFinalizeCurrentTimer?: () => void;
}): Promise<boolean> {
  if (!params.timer.executionId) {
    return false;
  }

  if (params.queue) {
    await params.queue.enqueue({
      type: "resume",
      payload: { executionId: params.timer.executionId },
      maxAttempts: params.maxAttempts,
    });
  } else {
    await params.processExecution(params.timer.executionId);
  }

  params.onSafeToFinalizeCurrentTimer?.();
  return true;
}

export interface ScheduledTimerHandleResult {
  handled: boolean;
  finalizeCurrentTimer: boolean;
  releaseCurrentTimerClaim: boolean;
}

export async function handleScheduledTaskTimer(params: {
  store: IDurableStore;
  timer: Timer;
  taskRegistry: TaskRegistry;
  scheduleManager: ScheduleManager;
  kickoffExecution: (executionId: string) => Promise<void>;
  persistTaskTimerExecution: (params: {
    timer: Timer;
    workflowKey: string;
  }) => Promise<string>;
  assertTimerClaimIsStillOwned: () => void;
  onSafeToFinalizeCurrentTimer?: () => void;
}): Promise<ScheduledTimerHandleResult> {
  if (!params.timer.workflowKey) {
    return {
      handled: false,
      finalizeCurrentTimer: false,
      releaseCurrentTimerClaim: false,
    };
  }

  if (params.timer.scheduleId) {
    const schedule = await params.store.getSchedule(params.timer.scheduleId);
    params.assertTimerClaimIsStillOwned();
    if (!schedule || schedule.status !== "active") {
      return {
        handled: false,
        finalizeCurrentTimer: true,
        releaseCurrentTimerClaim: false,
      };
    }
    if (
      schedule.nextRun &&
      params.timer.fireAt.getTime() !== schedule.nextRun.getTime()
    ) {
      return {
        handled: false,
        finalizeCurrentTimer: true,
        releaseCurrentTimerClaim: false,
      };
    }
  }

  const task = params.taskRegistry.find(params.timer.workflowKey);
  if (!task) {
    return {
      handled: false,
      finalizeCurrentTimer: false,
      releaseCurrentTimerClaim: false,
    };
  }

  const executionId = await params.persistTaskTimerExecution({
    timer: params.timer,
    workflowKey: params.taskRegistry.getWorkflowKey(task),
  });
  params.assertTimerClaimIsStillOwned();
  if (!params.timer.scheduleId) {
    params.onSafeToFinalizeCurrentTimer?.();
  }
  await params.kickoffExecution(executionId);
  params.assertTimerClaimIsStillOwned();

  if (params.timer.scheduleId) {
    const schedule = await params.store.getSchedule(params.timer.scheduleId);
    params.assertTimerClaimIsStillOwned();
    if (schedule && schedule.status === "active") {
      await params.scheduleManager.reschedule(schedule, {
        lastRunAt: new Date(),
      });
      params.assertTimerClaimIsStillOwned();
      return {
        handled: true,
        finalizeCurrentTimer: false,
        releaseCurrentTimerClaim: true,
      };
    }

    return {
      handled: true,
      finalizeCurrentTimer: true,
      releaseCurrentTimerClaim: false,
    };
  }

  return {
    handled: true,
    finalizeCurrentTimer: true,
    releaseCurrentTimerClaim: false,
  };
}
