import type {
  DurableSignalRecord,
  DurableSignalWaiter,
  StepResult,
} from "../../core/types";
import { parseSignalState } from "../../core/utils";
import { cloneSignalRecord, cloneSignalWaiter } from "./shared";
import type { MemoryStoreRuntime } from "./runtime";
import { setStepResult } from "./executionViews";
import { getOrCreateSignalState } from "./signalState";

function getOrCreateSignalWaiters(
  runtime: MemoryStoreRuntime,
  executionId: string,
  signalId: string,
): Map<string, DurableSignalWaiter> {
  let executionWaiters = runtime.signalWaiters.get(executionId);
  if (!executionWaiters) {
    executionWaiters = new Map<string, Map<string, DurableSignalWaiter>>();
    runtime.signalWaiters.set(executionId, executionWaiters);
  }

  let signalWaiters = executionWaiters.get(signalId);
  if (!signalWaiters) {
    signalWaiters = new Map<string, DurableSignalWaiter>();
    executionWaiters.set(signalId, signalWaiters);
  }

  return signalWaiters;
}

function pruneEmptySignalWaiterBuckets(
  runtime: MemoryStoreRuntime,
  executionId: string,
  signalId: string,
): void {
  const executionWaiters = runtime.signalWaiters.get(executionId)!;

  const signalWaiters = executionWaiters.get(signalId);
  if (signalWaiters && signalWaiters.size === 0) {
    executionWaiters.delete(signalId);
  }

  if (executionWaiters.size === 0) {
    runtime.signalWaiters.delete(executionId);
  }
}

function deleteSignalWaiterUnsafe(
  runtime: MemoryStoreRuntime,
  executionId: string,
  signalId: string,
  stepId: string,
): boolean {
  const signalWaiters = runtime.signalWaiters.get(executionId)?.get(signalId);
  if (!signalWaiters) {
    return false;
  }

  const changed = signalWaiters.delete(stepId);
  if (!changed) {
    return false;
  }

  pruneEmptySignalWaiterBuckets(runtime, executionId, signalId);
  return true;
}

function peekNextSignalWaiterUnsafe(
  runtime: MemoryStoreRuntime,
  executionId: string,
  signalId: string,
): DurableSignalWaiter | null {
  const signalWaiters = runtime.signalWaiters.get(executionId)?.get(signalId);
  if (!signalWaiters || signalWaiters.size === 0) {
    return null;
  }

  let nextWaiter: DurableSignalWaiter | null = null;
  for (const waiter of signalWaiters.values()) {
    if (
      nextWaiter === null ||
      waiter.sortKey.localeCompare(nextWaiter.sortKey) < 0
    ) {
      nextWaiter = waiter;
    }
  }

  return nextWaiter ? cloneSignalWaiter(nextWaiter) : null;
}

export async function upsertSignalWaiter(
  runtime: MemoryStoreRuntime,
  waiter: DurableSignalWaiter,
): Promise<void> {
  await runtime.withSignalStateMutation(() => {
    getOrCreateSignalWaiters(runtime, waiter.executionId, waiter.signalId).set(
      waiter.stepId,
      cloneSignalWaiter(waiter),
    );
    return { result: undefined, changed: true };
  });
}

export async function peekNextSignalWaiter(
  runtime: MemoryStoreRuntime,
  executionId: string,
  signalId: string,
): Promise<DurableSignalWaiter | null> {
  return runtime.withSignalStatePermit(() =>
    peekNextSignalWaiterUnsafe(runtime, executionId, signalId),
  );
}

export async function commitSignalDelivery(
  runtime: MemoryStoreRuntime,
  params: {
    executionId: string;
    signalId: string;
    stepId: string;
    stepResult: StepResult;
    signalRecord: DurableSignalRecord;
    timerId?: string;
  },
): Promise<boolean> {
  return await runtime.withSignalStateMutation(() => {
    const currentStep = runtime.stepResults
      .get(params.executionId)
      ?.get(params.stepId);
    if (!currentStep) {
      return { result: false, changed: false };
    }

    const signalState = parseSignalState(currentStep.result);
    if (
      signalState?.state !== "waiting" ||
      (signalState.signalId !== undefined &&
        signalState.signalId !== params.signalId)
    ) {
      return { result: false, changed: false };
    }

    const signalWaiters = runtime.signalWaiters
      .get(params.executionId)
      ?.get(params.signalId);
    if (!signalWaiters?.has(params.stepId)) {
      return { result: false, changed: false };
    }

    setStepResult(runtime, params.stepResult);
    getOrCreateSignalState(
      runtime,
      params.executionId,
      params.signalId,
    ).history.push(cloneSignalRecord(params.signalRecord));
    deleteSignalWaiterUnsafe(
      runtime,
      params.executionId,
      params.signalId,
      params.stepId,
    );

    if (params.timerId) {
      runtime.timers.delete(params.timerId);
    }

    return { result: true, changed: true };
  });
}

export async function takeNextSignalWaiter(
  runtime: MemoryStoreRuntime,
  executionId: string,
  signalId: string,
): Promise<DurableSignalWaiter | null> {
  return await runtime.withSignalStateMutation(() => {
    const nextWaiter = peekNextSignalWaiterUnsafe(
      runtime,
      executionId,
      signalId,
    );
    if (!nextWaiter) {
      return { result: null, changed: false };
    }

    const signalWaiters = runtime.signalWaiters.get(executionId)?.get(signalId);
    if (!signalWaiters) {
      return { result: null, changed: false };
    }

    deleteSignalWaiterUnsafe(runtime, executionId, signalId, nextWaiter.stepId);
    return {
      result: cloneSignalWaiter(nextWaiter),
      changed: true,
    };
  });
}

export async function deleteSignalWaiter(
  runtime: MemoryStoreRuntime,
  executionId: string,
  signalId: string,
  stepId: string,
): Promise<void> {
  await runtime.withSignalStateMutation(() => {
    const changed = deleteSignalWaiterUnsafe(
      runtime,
      executionId,
      signalId,
      stepId,
    );
    return { result: undefined, changed };
  });
}
