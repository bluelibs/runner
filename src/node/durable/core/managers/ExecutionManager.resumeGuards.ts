import type { IDurableStore } from "../interfaces/store";
import type { Execution } from "../types";
import {
  durableExecutionInvariantError,
  durableResumeRejectedError,
} from "../../../../errors";

/** A tip must not resume after an earlier continuation chapter restarted. */
export async function requireUnrestartedLineage(
  store: IDurableStore,
  execution: Execution,
): Promise<void> {
  const seen = new Set<string>();
  let current = execution;
  while (current.continuedFromExecutionId) {
    if (seen.has(current.id)) {
      return durableExecutionInvariantError.throw({
        message: `Continuation ancestry contains a cycle at execution '${current.id}'.`,
      });
    }
    seen.add(current.id);
    const parent = await store.getExecution(current.continuedFromExecutionId);
    if (!parent) {
      return durableExecutionInvariantError.throw({
        message: `Continuation parent '${current.continuedFromExecutionId}' is missing for execution '${current.id}'.`,
      });
    }
    if (parent.restartedAsExecutionId) {
      return durableResumeRejectedError.throw({
        executionId: execution.id,
        status: `restarted lineage (${parent.id} -> ${parent.restartedAsExecutionId})`,
      });
    }
    current = parent;
  }
}
