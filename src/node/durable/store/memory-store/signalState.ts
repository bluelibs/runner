import {
  MAX_QUEUED_SIGNALS_PER_KEY,
  MAX_SIGNAL_HISTORY_PER_KEY,
  type DurableQueuedSignalRecord,
  type DurableSignalRecord,
  type DurableSignalState,
  type StepResult,
} from "../../core/types";
import { durableSignalBacklogExceededError } from "../../../../errors";
import {
  cloneQueuedSignalRecord,
  cloneSignalPayload,
  cloneSignalRecord,
  cloneSignalState,
  createEmptySignalState,
  getSignalIdFromStepResult,
} from "./shared";
import type { MemoryStoreRuntime } from "./runtime";
import { setStepResult } from "./executionViews";

export function getOrCreateSignalState(
  runtime: MemoryStoreRuntime,
  executionId: string,
  signalId: string,
): DurableSignalState {
  let executionSignals = runtime.signalStates.get(executionId);
  if (!executionSignals) {
    executionSignals = new Map<string, DurableSignalState>();
    runtime.signalStates.set(executionId, executionSignals);
  }

  let signalState = executionSignals.get(signalId);
  if (!signalState) {
    signalState = createEmptySignalState(executionId, signalId);
    executionSignals.set(signalId, signalState);
  }

  return signalState;
}

export async function getSignalState(
  runtime: MemoryStoreRuntime,
  executionId: string,
  signalId: string,
): Promise<DurableSignalState | null> {
  return runtime.withSignalStatePermit(() => {
    const signalState = runtime.signalStates.get(executionId)?.get(signalId);
    return signalState ? cloneSignalState(signalState) : null;
  });
}

export async function listSignalStates(
  runtime: MemoryStoreRuntime,
  executionId: string,
): Promise<DurableSignalState[]> {
  return runtime.withSignalStatePermit(() =>
    Array.from(runtime.signalStates.get(executionId)?.values() ?? [])
      .sort((left, right) => left.signalId.localeCompare(right.signalId))
      .map(cloneSignalState),
  );
}

function assertSignalQueueCapacity(
  executionId: string,
  signalId: string,
  queuedLength: number,
): void {
  if (queuedLength >= MAX_QUEUED_SIGNALS_PER_KEY) {
    return durableSignalBacklogExceededError.throw({
      executionId,
      signalId,
      limit: MAX_QUEUED_SIGNALS_PER_KEY,
    });
  }
}

function trimSignalHistory(history: DurableSignalRecord[]): void {
  if (history.length > MAX_SIGNAL_HISTORY_PER_KEY) {
    history.splice(0, history.length - MAX_SIGNAL_HISTORY_PER_KEY);
  }
}

export async function appendSignalRecord(
  runtime: MemoryStoreRuntime,
  executionId: string,
  signalId: string,
  record: DurableSignalRecord,
): Promise<void> {
  await runtime.withSignalStateMutation(() => {
    const history = getOrCreateSignalState(
      runtime,
      executionId,
      signalId,
    ).history;
    history.push(cloneSignalRecord(record));
    trimSignalHistory(history);
    return { result: undefined, changed: true };
  });
}

export async function bufferSignalRecord(
  runtime: MemoryStoreRuntime,
  executionId: string,
  signalId: string,
  record: DurableQueuedSignalRecord,
): Promise<void> {
  await runtime.withSignalStateMutation(() => {
    const signalState = getOrCreateSignalState(runtime, executionId, signalId);
    assertSignalQueueCapacity(executionId, signalId, signalState.queued.length);
    signalState.history.push(cloneSignalRecord(record));
    trimSignalHistory(signalState.history);
    signalState.queued.push(cloneQueuedSignalRecord(record));
    return { result: undefined, changed: true };
  });
}

export async function enqueueQueuedSignalRecord(
  runtime: MemoryStoreRuntime,
  executionId: string,
  signalId: string,
  record: DurableQueuedSignalRecord,
): Promise<void> {
  await runtime.withSignalStateMutation(() => {
    const signalState = getOrCreateSignalState(runtime, executionId, signalId);
    assertSignalQueueCapacity(executionId, signalId, signalState.queued.length);
    signalState.queued.push(cloneQueuedSignalRecord(record));
    return { result: undefined, changed: true };
  });
}

export async function consumeQueuedSignalRecord(
  runtime: MemoryStoreRuntime,
  executionId: string,
  signalId: string,
): Promise<DurableSignalRecord | null> {
  return await runtime.withSignalStateMutation(() => {
    const record = runtime.signalStates
      .get(executionId)
      ?.get(signalId)
      ?.queued.shift();
    if (!record) {
      return { result: null, changed: false };
    }

    return {
      result: cloneSignalRecord(record),
      changed: true,
    };
  });
}

export async function consumeBufferedSignalForStep(
  runtime: MemoryStoreRuntime,
  stepResult: StepResult,
): Promise<DurableSignalRecord | null> {
  return await runtime.withSignalStateMutation(() => {
    const signalId = getSignalIdFromStepResult(stepResult);
    const record = runtime.signalStates
      .get(stepResult.executionId)
      ?.get(signalId)
      ?.queued.shift();
    if (!record) {
      return { result: null, changed: false };
    }

    const nextResult =
      typeof stepResult.result === "object" && stepResult.result !== null
        ? {
            ...stepResult.result,
            payload: cloneSignalPayload(record.payload),
          }
        : stepResult.result;
    setStepResult(runtime, {
      ...stepResult,
      result: nextResult,
    });

    return {
      result: cloneSignalRecord(record),
      changed: true,
    };
  });
}
