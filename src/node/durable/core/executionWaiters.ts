import type { IDurableStore } from "./interfaces/store";
import { durableExecutionInvariantError } from "../../../errors";
import { withStoreLock } from "./locking";
import { sleepMs } from "./utils";

function buildExecutionWaiterKey(executionId: string, stepId: string): string {
  return `${executionId}:${stepId}`;
}

export function getExecutionWaitLockResource(
  targetExecutionId: string,
): string {
  return `execution_wait:${targetExecutionId}`;
}

export function getExecutionWaiterKey(waiter: {
  executionId: string;
  stepId: string;
}): string {
  return buildExecutionWaiterKey(waiter.executionId, waiter.stepId);
}

export async function withExecutionWaitLock<T>(params: {
  store: IDurableStore;
  targetExecutionId: string;
  fn: () => Promise<T>;
}): Promise<T> {
  return await withStoreLock({
    store: params.store,
    resource: getExecutionWaitLockResource(params.targetExecutionId),
    ttlMs: 10_000,
    maxAttempts: 20,
    retryDelayMs: 5,
    sleep: sleepMs,
    onLockUnavailable: () =>
      durableExecutionInvariantError.throw({
        message: `Failed to acquire execution wait lock for '${params.targetExecutionId}'.`,
      }),
    fn: params.fn,
  });
}
