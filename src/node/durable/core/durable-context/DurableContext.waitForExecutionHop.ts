import type { WaitForExecutionOptions } from "../interfaces/context";
import type { IDurableStore } from "../interfaces/store";
import { parseExecutionWaitState } from "../utils";
import { ExecutionStatus, TimerType } from "../types";
import {
  createTimedWaitState,
  ensureDurableWaitTimer,
  suspendDurableWait,
} from "../waiterCore";
import { durableExecutionInvariantError } from "../../../../errors";
import {
  assertExpectedWorkflowKey,
  createExecutionWaitingState,
  getReplayedExecutionTimeoutState,
  resolveReplayedTerminalWait,
  resolveTerminalTip,
} from "./DurableContext.waitForExecutionState";
import type {
  ExecutionWaitHopOutcome,
  WriteExecutionWaitCurrent,
} from "./DurableContext.waitForExecutionTypes";

export type AttemptExecutionWaitHopParams = {
  store: IDurableStore;
  executionId: string;
  /** Waited-on root; stays fixed across continuation hops. */
  targetExecutionId: string;
  /** Chain tip this hop registers on or resolves against. */
  tipExecutionId: string;
  expectedWorkflowKey: string;
  stepId: string;
  hasTimeout: boolean;
  options?: WaitForExecutionOptions;
  writeExecutionWaitCurrent: WriteExecutionWaitCurrent;
};

/**
 * Registers the caller's waiter on the tip (or resolves immediately when the
 * tip is already wait-terminal). After registering, the tip is re-read under
 * the same wait lock: a tip that continued concurrently is followed instead
 * of suspending, so no waiter is ever orphaned on a finished run.
 */
async function suspendOnTipOrFollow(params: {
  store: IDurableStore;
  executionId: string;
  tipExecutionId: string;
  stepId: string;
  timerId?: string;
  recordedAt?: Date;
  waitingState?: unknown;
}): Promise<ExecutionWaitHopOutcome<never>> {
  await params.store.upsertExecutionWaiter({
    executionId: params.executionId,
    targetExecutionId: params.tipExecutionId,
    stepId: params.stepId,
    timerId: params.timerId,
  });

  const recheckedTip = await params.store.getExecution(params.tipExecutionId);
  if (recheckedTip?.status === ExecutionStatus.ContinuedAsNew) {
    if (!recheckedTip.continuedAsExecutionId) {
      return durableExecutionInvariantError.throw({
        message: `Continuation chain for execution '${params.tipExecutionId}' is broken: status is continued_as_new without a successor link.`,
      });
    }
    await params.store.deleteExecutionWaiter(
      params.tipExecutionId,
      params.executionId,
      params.stepId,
    );
    return { kind: "follow", follow: recheckedTip.continuedAsExecutionId };
  }

  return await suspendDurableWait({
    store: params.store,
    executionId: params.executionId,
    stepId: params.stepId,
    recordedAt: params.recordedAt,
    waitingState: params.waitingState,
    registerWaiter: async () => {},
  });
}

async function resolveReplayedWait<TResult>(
  params: AttemptExecutionWaitHopParams,
): Promise<ExecutionWaitHopOutcome<TResult> | null> {
  const existing = await params.store.getStepResult(
    params.executionId,
    params.stepId,
  );
  if (!existing) {
    return null;
  }

  const state = parseExecutionWaitState(existing.result);
  if (!state || state.targetExecutionId !== params.targetExecutionId) {
    return durableExecutionInvariantError.throw({
      message: `Invalid execution wait state for '${params.targetExecutionId}' at '${params.stepId}'.`,
    });
  }

  const terminal = await resolveReplayedTerminalWait<TResult>({
    store: params.store,
    executionId: params.executionId,
    state,
    hasTimeout: params.hasTimeout,
    expectedWorkflowKey: params.expectedWorkflowKey,
  });
  if (terminal) {
    return terminal;
  }

  // Terminal states returned above; what remains waits or follows.
  const waitingState = state as Extract<
    typeof state,
    { state: "waiting" | "continued" }
  >;

  if (waitingState.state === "continued") {
    assertExpectedWorkflowKey({
      expectedWorkflowKey: params.expectedWorkflowKey,
      actualWorkflowKey: waitingState.workflowKey,
      targetExecutionId: params.tipExecutionId,
    });
    if (waitingState.continuedAsExecutionId !== params.tipExecutionId) {
      return { kind: "follow", follow: waitingState.continuedAsExecutionId };
    }
    // Marker for this tip: re-register below, preserving the deadline.
  }

  const settled = await resolveTerminalTip<TResult>({
    store: params.store,
    executionId: params.executionId,
    targetExecutionId: params.targetExecutionId,
    tipExecutionId: params.tipExecutionId,
    expectedWorkflowKey: params.expectedWorkflowKey,
    stepId: params.stepId,
    hasTimeout: params.hasTimeout,
    timerId: waitingState.timerId,
  });
  if (settled) {
    return settled;
  }

  let waitingRecordedAt: Date | undefined;
  const replayedTimeout = getReplayedExecutionTimeoutState({
    executionId: params.executionId,
    completedAt: existing.completedAt,
    stepId: params.stepId,
    state: waitingState,
  });
  const timeout = await ensureDurableWaitTimer({
    store: params.store,
    executionId: params.executionId,
    stepId: params.stepId,
    timerType: TimerType.Timeout,
    timeoutMs: params.options?.timeoutMs,
    existing: replayedTimeout,
    createTimerId: () =>
      `execution_timeout:${params.executionId}:${params.stepId}`,
    persistWaitingState: async (timeoutAtMs, timerId) => {
      waitingRecordedAt = new Date();
      await params.store.saveStepResult({
        executionId: params.executionId,
        stepId: params.stepId,
        result: createTimedWaitState(
          createExecutionWaitingState(
            params.targetExecutionId,
            params.options?.timeoutMs,
          ),
          timeoutAtMs,
          timerId,
        ),
        completedAt: waitingRecordedAt,
      });
    },
  });

  await params.writeExecutionWaitCurrent({
    timeoutMs: timeout.persistedWaitingState
      ? params.options?.timeoutMs
      : waitingState.timeoutMs,
    timeoutAtMs: timeout.timeoutAtMs,
    timerId: timeout.timerId,
    startedAt: waitingRecordedAt ?? existing.completedAt,
  });

  return await suspendOnTipOrFollow({
    store: params.store,
    executionId: params.executionId,
    tipExecutionId: params.tipExecutionId,
    stepId: params.stepId,
    timerId: timeout.timerId,
  });
}

export async function attemptExecutionWaitHop<TResult>(
  params: AttemptExecutionWaitHopParams,
): Promise<ExecutionWaitHopOutcome<TResult>> {
  const replayed = await resolveReplayedWait<TResult>(params);
  if (replayed) {
    return replayed;
  }

  const settled = await resolveTerminalTip<TResult>({
    store: params.store,
    executionId: params.executionId,
    targetExecutionId: params.targetExecutionId,
    tipExecutionId: params.tipExecutionId,
    expectedWorkflowKey: params.expectedWorkflowKey,
    stepId: params.stepId,
    hasTimeout: params.hasTimeout,
  });
  if (settled) {
    return settled;
  }

  let waitingRecordedAt: Date | undefined =
    params.options?.timeoutMs === undefined ? new Date() : undefined;
  const timeout = await ensureDurableWaitTimer({
    store: params.store,
    executionId: params.executionId,
    stepId: params.stepId,
    timerType: TimerType.Timeout,
    timeoutMs: params.options?.timeoutMs,
    createTimerId: () =>
      `execution_timeout:${params.executionId}:${params.stepId}`,
    persistWaitingState: async (timeoutAtMs, timerId) => {
      waitingRecordedAt = new Date();
      await params.store.saveStepResult({
        executionId: params.executionId,
        stepId: params.stepId,
        result: createTimedWaitState(
          createExecutionWaitingState(
            params.targetExecutionId,
            params.options?.timeoutMs,
          ),
          timeoutAtMs,
          timerId,
        ),
        completedAt: waitingRecordedAt,
      });
    },
  });
  await params.writeExecutionWaitCurrent({
    timeoutMs: params.options?.timeoutMs,
    timeoutAtMs: timeout.timeoutAtMs,
    timerId: timeout.timerId,
    startedAt: waitingRecordedAt!,
  });

  return await suspendOnTipOrFollow({
    store: params.store,
    executionId: params.executionId,
    tipExecutionId: params.tipExecutionId,
    stepId: params.stepId,
    timerId: timeout.timerId,
    recordedAt: waitingRecordedAt!,
    waitingState: timeout.persistedWaitingState
      ? undefined
      : createTimedWaitState(
          createExecutionWaitingState(
            params.targetExecutionId,
            params.options?.timeoutMs,
          ),
          timeout.timeoutAtMs,
          timeout.timerId,
        ),
  });
}
