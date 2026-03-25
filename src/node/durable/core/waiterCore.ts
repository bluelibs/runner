import { SuspensionSignal } from "./interfaces/context";
import type { IDurableStore } from "./interfaces/store";
import { TimerStatus, type StepResult, type TimerType } from "./types";

export function createTimedWaitState<TState extends Record<string, unknown>>(
  state: TState,
  timeoutAtMs?: number,
  timerId?: string,
): TState | (TState & { timeoutAtMs: number; timerId: string }) {
  if (timeoutAtMs !== undefined && timerId !== undefined) {
    return {
      ...state,
      timeoutAtMs,
      timerId,
    };
  }

  return state;
}

export async function runBestEffortCleanup(
  cleanupTask: () => Promise<void>,
): Promise<void> {
  try {
    await cleanupTask();
  } catch {
    // The durable write already happened; cleanup must stay best-effort.
  }
}

export async function deleteWaitTimerBestEffort(
  store: IDurableStore,
  timerId?: string,
): Promise<void> {
  if (!timerId) {
    return;
  }

  await runBestEffortCleanup(() => store.deleteTimer(timerId));
}

export async function commitDurableWaitCompletion(params: {
  store: IDurableStore;
  stepResult: StepResult;
  commitAtomically?: () => Promise<boolean>;
  onFallbackCommitted?: () => Promise<void>;
  timerId?: string;
}): Promise<boolean> {
  if (params.commitAtomically) {
    return await params.commitAtomically();
  }

  await params.store.saveStepResult(params.stepResult);

  if (params.onFallbackCommitted) {
    await runBestEffortCleanup(params.onFallbackCommitted);
  }

  await deleteWaitTimerBestEffort(params.store, params.timerId);
  return true;
}

export async function ensureDurableWaitTimer(params: {
  store: IDurableStore;
  executionId: string;
  stepId: string;
  timerType: TimerType;
  timeoutMs?: number;
  existing?: {
    timeoutAtMs?: number;
    timerId?: string;
  };
  createTimerId: () => string;
  persistWaitingState: (timeoutAtMs: number, timerId: string) => Promise<void>;
  onTimerCreated?: (timeoutAtMs: number, timerId: string) => Promise<void>;
}): Promise<{
  timerId?: string;
  timeoutAtMs?: number;
  persistedWaitingState: boolean;
}> {
  if (params.timeoutMs === undefined) {
    return {
      timerId: params.existing?.timerId,
      timeoutAtMs: params.existing?.timeoutAtMs,
      persistedWaitingState: false,
    };
  }

  if (
    params.existing?.timeoutAtMs !== undefined &&
    params.existing.timerId !== undefined
  ) {
    await params.store.createTimer({
      id: params.existing.timerId,
      executionId: params.executionId,
      stepId: params.stepId,
      type: params.timerType,
      fireAt: new Date(params.existing.timeoutAtMs),
      status: TimerStatus.Pending,
    });

    return {
      timerId: params.existing.timerId,
      timeoutAtMs: params.existing.timeoutAtMs,
      persistedWaitingState: false,
    };
  }

  const timerId = params.createTimerId();
  const timeoutAtMs = Date.now() + params.timeoutMs;

  await params.store.createTimer({
    id: timerId,
    executionId: params.executionId,
    stepId: params.stepId,
    type: params.timerType,
    fireAt: new Date(timeoutAtMs),
    status: TimerStatus.Pending,
  });

  try {
    await params.persistWaitingState(timeoutAtMs, timerId);

    if (params.onTimerCreated) {
      await params.onTimerCreated(timeoutAtMs, timerId);
    }
  } catch (error) {
    await deleteWaitTimerBestEffort(params.store, timerId);
    throw error;
  }

  return {
    timerId,
    timeoutAtMs,
    persistedWaitingState: true,
  };
}

export async function suspendDurableWait(params: {
  store: IDurableStore;
  executionId: string;
  stepId: string;
  waitingState?: unknown;
  recordedAt?: Date;
  registerWaiter: () => Promise<void>;
}): Promise<never> {
  if (params.waitingState !== undefined) {
    await params.store.saveStepResult({
      executionId: params.executionId,
      stepId: params.stepId,
      result: params.waitingState,
      completedAt: params.recordedAt ?? new Date(),
    });
  }

  await params.registerWaiter();
  throw new SuspensionSignal("yield");
}
