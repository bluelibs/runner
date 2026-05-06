import type { DurableExecutionWaiter, StepResult } from "../../core/types";
import { parseExecutionWaitState } from "../../core/utils";
import { cloneExecutionWaiter } from "./shared";
import type { MemoryStoreRuntime } from "./runtime";
import { setStepResult } from "./executionViews";

function getExecutionWaiterKey(executionId: string, stepId: string): string {
  return `${executionId}:${stepId}`;
}

function deleteExecutionWaiterUnsafe(
  runtime: MemoryStoreRuntime,
  targetExecutionId: string,
  executionId: string,
  stepId: string,
): boolean {
  const waiters = runtime.executionWaiters.get(targetExecutionId);
  if (!waiters) {
    return false;
  }

  const changed = waiters.delete(getExecutionWaiterKey(executionId, stepId));
  if (!changed) {
    return false;
  }

  if (waiters.size === 0) {
    runtime.executionWaiters.delete(targetExecutionId);
  }

  return true;
}

export async function upsertExecutionWaiter(
  runtime: MemoryStoreRuntime,
  waiter: DurableExecutionWaiter,
): Promise<void> {
  await runtime.withExecutionWaiterMutation(() => {
    const executionWaiters =
      runtime.executionWaiters.get(waiter.targetExecutionId) ?? new Map();
    executionWaiters.set(
      getExecutionWaiterKey(waiter.executionId, waiter.stepId),
      cloneExecutionWaiter(waiter),
    );
    runtime.executionWaiters.set(waiter.targetExecutionId, executionWaiters);
    return { result: undefined, changed: true };
  });
}

export async function listExecutionWaiters(
  runtime: MemoryStoreRuntime,
  targetExecutionId: string,
): Promise<DurableExecutionWaiter[]> {
  return await runtime.withExecutionWaiterPermit(() => {
    const waiters = runtime.executionWaiters.get(targetExecutionId);
    if (!waiters) {
      return [];
    }

    return Array.from(waiters.values()).map(cloneExecutionWaiter);
  });
}

export async function commitExecutionWaiterCompletion(
  runtime: MemoryStoreRuntime,
  params: {
    targetExecutionId: string;
    executionId: string;
    stepId: string;
    stepResult: StepResult;
    timerId?: string;
  },
): Promise<boolean> {
  return await runtime.withExecutionWaiterMutation(() => {
    const waiterKey = getExecutionWaiterKey(params.executionId, params.stepId);
    const waiters = runtime.executionWaiters.get(params.targetExecutionId);
    if (!waiters?.has(waiterKey)) {
      return { result: false, changed: false };
    }

    const currentStep = runtime.stepResults
      .get(params.executionId)
      ?.get(params.stepId);
    if (!currentStep) {
      return { result: false, changed: false };
    }

    const waitState = parseExecutionWaitState(currentStep.result);
    if (
      waitState?.state !== "waiting" ||
      waitState.targetExecutionId !== params.targetExecutionId
    ) {
      return { result: false, changed: false };
    }

    setStepResult(runtime, params.stepResult);
    waiters.delete(waiterKey);
    if (waiters.size === 0) {
      runtime.executionWaiters.delete(params.targetExecutionId);
    }

    if (params.timerId) {
      runtime.timers.delete(params.timerId);
    }

    return { result: true, changed: true };
  });
}

export async function deleteExecutionWaiter(
  runtime: MemoryStoreRuntime,
  targetExecutionId: string,
  executionId: string,
  stepId: string,
): Promise<void> {
  await runtime.withExecutionWaiterMutation(() => {
    const changed = deleteExecutionWaiterUnsafe(
      runtime,
      targetExecutionId,
      executionId,
      stepId,
    );
    return { result: undefined, changed };
  });
}
