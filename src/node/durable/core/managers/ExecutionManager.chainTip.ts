import type { IDurableStore } from "../interfaces/store";
import { ExecutionStatus } from "../types";
import { followContinuedExecutionChain } from "../continuedChain";

/**
 * Resolves the live successor of a run that has continued, or null when the
 * run has not continued (or carries no forward link, in which case the
 * caller's original rejection is the right answer).
 */
async function findContinuedSuccessorId(
  store: IDurableStore,
  executionId: string,
): Promise<string | null> {
  const latest = await store.getExecution(executionId);
  if (
    latest?.status !== ExecutionStatus.ContinuedAsNew ||
    !latest.continuedAsExecutionId
  ) {
    return null;
  }
  return (await followContinuedExecutionChain(store, latest)).id;
}

/**
 * Applies pause/resume to the live tip of a continuation chain, so callers
 * can keep addressing the original execution id the way waits and signals
 * do. Both operations reject a continued run, so the chain is only consulted
 * after a rejection (keeping the common path free of extra reads), and a
 * successful operation is never repeated on a later chapter.
 */
export async function applyToContinuationTip(
  store: IDurableStore,
  executionId: string,
  operation: (tipExecutionId: string) => Promise<void>,
): Promise<void> {
  let targetExecutionId = executionId;
  for (;;) {
    try {
      await operation(targetExecutionId);
      return;
    } catch (error) {
      const successorId = await findContinuedSuccessorId(
        store,
        targetExecutionId,
      );
      if (successorId === null) throw error;
      targetExecutionId = successorId;
    }
  }
}
