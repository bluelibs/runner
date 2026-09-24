import type { IDurableStore } from "../interfaces/store";
import { ExecutionStatus, isExecutionTerminal, type Execution } from "../types";
import { followContinuedExecutionChain } from "../continuedChain";
import {
  durableExecutionInvariantError,
  durableRestartRejectedError,
} from "../../../../errors";

const ORPHANED_RESTART_ERROR_MESSAGE =
  "Restart rejected: linking it to its source failed.";
// Each retry means the source status changed between read and write while
// staying restartable (e.g. paused -> cancelled); a few rounds converge.
const MAX_LINK_ATTEMPTS = 5;

function isRestartableStatus(status: ExecutionStatus): boolean {
  return isExecutionTerminal(status) || status === ExecutionStatus.Paused;
}

/**
 * Explains why `source` cannot be restarted right now, or resolves null when
 * it can. A continued run is only as settled as its chain tip: restarting it
 * while the tip is still active would start a second live lineage.
 */
export async function findRestartBlocker(
  store: IDurableStore,
  source: Execution,
): Promise<string | null> {
  if (!isRestartableStatus(source.status)) return source.status;
  if (source.status !== ExecutionStatus.ContinuedAsNew) return null;

  const tip = await followContinuedExecutionChain(store, source);
  return isRestartableStatus(tip.status)
    ? null
    : `${source.status} (chain tip ${tip.id} is ${tip.status})`;
}

/** Throws the restart rejection when `source` is missing or blocked. */
export async function requireRestartable(
  store: IDurableStore,
  sourceId: string,
  source: Execution | null,
): Promise<Execution> {
  if (!source) {
    return durableRestartRejectedError.throw({
      executionId: sourceId,
      status: "unknown",
    });
  }
  const blocker = await findRestartBlocker(store, source);
  if (blocker !== null) {
    return durableRestartRejectedError.throw({
      executionId: sourceId,
      status: blocker,
    });
  }
  return source;
}

/**
 * Links the source to its restart successor, but only while the source is
 * still restartable. A successor already linked by a same-key caller counts
 * as linked, so that caller's success is never undone. The write is pinned to
 * the status just read: a cancel or resume landing in between fails the
 * compare-and-set and is re-evaluated instead of being overwritten by the
 * stale snapshot.
 */
export async function linkRestartedAs(
  store: IDurableStore,
  sourceId: string,
  restartedId: string,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_LINK_ATTEMPTS; attempt += 1) {
    const current = await store.getExecution(sourceId);
    if (current?.restartedAsExecutionId === restartedId) return;

    const fresh = await requireRestartable(store, sourceId, current);
    const linked = await store.saveExecutionIfStatus(
      { ...fresh, restartedAsExecutionId: restartedId, updatedAt: new Date() },
      [fresh.status],
    );
    if (linked) return;
  }

  return durableExecutionInvariantError.throw({
    message: `Failed to link restart "${restartedId}" to execution "${sourceId}" after ${MAX_LINK_ATTEMPTS} attempts due to concurrent state changes.`,
  });
}

/**
 * Cancels a successor that was persisted but must not run because linking it
 * to its source failed (lost a race, or the write itself failed). Without
 * this the orphan would stay `pending` and recovery would run an execution
 * the caller was told failed. A successor the source already links to was
 * handed out by another caller and is left alone.
 */
export async function cancelOrphanedRestart(
  store: IDurableStore,
  sourceId: string,
  successorId: string,
): Promise<void> {
  const source = await store.getExecution(sourceId);
  if (source?.restartedAsExecutionId === successorId) return;

  const current = await store.getExecution(successorId);
  if (current?.status !== ExecutionStatus.Pending) return;

  await store.saveExecutionIfStatus(
    {
      ...current,
      status: ExecutionStatus.Cancelled,
      error: { message: ORPHANED_RESTART_ERROR_MESSAGE },
      completedAt: new Date(),
      updatedAt: new Date(),
    },
    [ExecutionStatus.Pending],
  );
}

/** Restores the never-started successor retained by its idempotency mapping. */
export async function reviveOrphanedRestart(
  store: IDurableStore,
  execution: Execution,
): Promise<{ execution: Execution; revived: boolean }> {
  if (
    execution.status !== ExecutionStatus.Cancelled ||
    execution.error?.message !== ORPHANED_RESTART_ERROR_MESSAGE ||
    execution.cancelRequestedAt !== undefined ||
    execution.cancelledAt !== undefined
  ) {
    return { execution, revived: false };
  }

  const pendingExecution: Execution = {
    ...execution,
    status: ExecutionStatus.Pending,
    current: undefined,
    result: undefined,
    error: undefined,
    completedAt: undefined,
    cancelledAt: undefined,
    cancelRequestedAt: undefined,
    updatedAt: new Date(),
  };
  const revived = await store.saveExecutionIfStatus(pendingExecution, [
    ExecutionStatus.Cancelled,
  ]);
  if (revived) {
    return { execution: pendingExecution, revived: true };
  }

  // A concurrent winner owns audit/kickoff for the shared id.
  return { execution, revived: false };
}
