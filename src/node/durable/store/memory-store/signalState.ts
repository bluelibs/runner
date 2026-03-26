import type {
  DurableQueuedSignalRecord,
  DurableSignalRecord,
  DurableSignalState,
  StepResult,
} from "../../core/types";
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

export async function appendSignalRecord(
  runtime: MemoryStoreRuntime,
  executionId: string,
  signalId: string,
  record: DurableSignalRecord,
): Promise<void> {
  await runtime.withSignalStateMutation(() => {
    getOrCreateSignalState(runtime, executionId, signalId).history.push(
      cloneSignalRecord(record),
    );
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
    signalState.history.push(cloneSignalRecord(record));
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
    getOrCreateSignalState(runtime, executionId, signalId).queued.push(
      cloneQueuedSignalRecord(record),
    );
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
