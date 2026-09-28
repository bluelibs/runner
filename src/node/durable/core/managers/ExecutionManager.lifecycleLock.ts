import type { IDurableStore } from "../interfaces/store";
import { withStoreLock } from "../locking";
import { sleepMs } from "../utils";
import { durableExecutionInvariantError } from "../../../../errors";

/**
 * Coordinates resume with restart links on the same run or its continuation
 * tip. The lock only covers status checks and writes; kicking user code
 * happens after release.
 */
export async function withExecutionLifecycleLock<T>(
  store: IDurableStore,
  executionId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return await withStoreLock({
    store,
    resource: `execution_lifecycle:${executionId}`,
    ttlMs: 10_000,
    maxAttempts: 20,
    retryDelayMs: 5,
    sleep: sleepMs,
    onLockUnavailable: () =>
      durableExecutionInvariantError.throw({
        message: `Failed to acquire execution lifecycle lock for '${executionId}'.`,
      }),
    fn,
  });
}
