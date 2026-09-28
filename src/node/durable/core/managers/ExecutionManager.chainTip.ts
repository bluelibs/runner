import type { IDurableStore } from "../interfaces/store";
import { ExecutionStatus } from "../types";
import { followContinuedExecutionChain } from "../continuedChain";
import {
  durablePauseRejectedError,
  durableResumeRejectedError,
} from "../../../../errors";

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
      return await operation(targetExecutionId);
    } catch (error) {
      // Only a rejection can mean "this run continued"; anything else (a
      // store outage) must surface rather than be retried on another chapter.
      const rejected =
        durablePauseRejectedError.is(error) ||
        durableResumeRejectedError.is(error);
      const latest = rejected
        ? await store.getExecution(targetExecutionId)
        : null;
      // Without a forward link the original rejection is the right answer.
      if (
        latest?.status !== ExecutionStatus.ContinuedAsNew ||
        !latest.continuedAsExecutionId
      ) {
        throw error;
      }
      targetExecutionId = (await followContinuedExecutionChain(store, latest))
        .id;
    }
  }
}
