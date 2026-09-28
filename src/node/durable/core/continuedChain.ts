import type { IDurableStore } from "./interfaces/store";
import { ExecutionStatus, type Execution } from "./types";
import { durableExecutionInvariantError } from "../../../errors";

/**
 * Follows `continuedAsExecutionId` links to the live chain tip. Waiters and
 * signals use this so continuations stay transparent: callers keep addressing
 * the original execution while work happens on the tip.
 *
 * Links are written once by the atomic continue-as-new commit and never change,
 * so chains only grow forward; a repeat or a missing link/hop therefore means
 * corrupt data rather than a race, and fails fast.
 */
export async function followContinuedExecutionChain(
  store: IDurableStore,
  execution: Execution<unknown, unknown>,
): Promise<Execution<unknown, unknown>> {
  let tip = execution;
  const visited = new Set<string>([execution.id]);

  while (tip.status === ExecutionStatus.ContinuedAsNew) {
    const nextId = tip.continuedAsExecutionId;
    if (!nextId) {
      return durableExecutionInvariantError.throw({
        message: `Continuation chain for execution '${tip.id}' is broken: status is continued_as_new without a successor link.`,
      });
    }
    if (visited.has(nextId)) {
      return durableExecutionInvariantError.throw({
        message: `Continuation chain for execution '${execution.id}' is cyclic at '${nextId}'.`,
      });
    }
    visited.add(nextId);

    const next = await store.getExecution(nextId);
    if (!next) {
      return durableExecutionInvariantError.throw({
        message: `Continuation chain for execution '${execution.id}' is broken: successor '${nextId}' does not exist.`,
      });
    }
    tip = next;
  }

  return tip;
}
