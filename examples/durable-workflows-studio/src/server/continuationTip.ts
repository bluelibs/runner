import { errors } from "@bluelibs/runner";
import type { Execution } from "@bluelibs/runner/node";
import type { StudioExecutionStatus } from "../shared/types.js";
import type { StudioHandles } from "./studioApp.js";

/** Reads the current tip so Studio does not offer restart during an active continuation. */
export async function getContinuationTipStatus(
  handles: StudioHandles,
  source: Execution,
): Promise<StudioExecutionStatus> {
  const seen = new Set<string>();
  let current = source;
  while (current.status === "continued_as_new") {
    if (seen.has(current.id) || !current.continuedAsExecutionId) {
      return errors.durableExecutionInvariantError.throw({
        message: `Invalid continuation chain at execution '${current.id}'.`,
      });
    }
    seen.add(current.id);
    const next = await handles.store.getExecution(current.continuedAsExecutionId);
    if (!next) {
      return errors.durableExecutionInvariantError.throw({
        message: `Missing continuation '${current.continuedAsExecutionId}'.`,
      });
    }
    current = next;
  }
  return current.status;
}
