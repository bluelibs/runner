import type { IDurableStore } from "../interfaces/store";
import { ExecutionStatus, isExecutionTerminal, type Execution } from "../types";
import type { ExecutionLockState } from "./ExecutionManager.locking";

/**
 * Decides whether a worker that just released an execution lock must re-drive
 * the execution itself. Resume restores the status and kicks right away, but
 * while a paused attempt is still winding down that kick loses the lock race
 * and returns silently; the lock holder is the only party left that can
 * notice the resume, so it re-kicks once its lock is gone.
 *
 * `lockedSnapshot` is the record read right after acquiring the lock and
 * `latest` is read after releasing it. A pause "landed during the tenure" when
 * the holder either saw the execution paused or the pause stamp changed.
 */
export function shouldRedriveAfterLockRelease(params: {
  lockedSnapshot: Execution<unknown, unknown>;
  latest: Execution<unknown, unknown> | null;
}): boolean {
  const { lockedSnapshot, latest } = params;
  if (
    !latest ||
    isExecutionTerminal(latest.status) ||
    latest.status === ExecutionStatus.Paused
  ) {
    return false;
  }

  return (
    lockedSnapshot.status === ExecutionStatus.Paused ||
    latest.pausedAt?.getTime() !== lockedSnapshot.pausedAt?.getTime()
  );
}

/**
 * Runs after the execution lock is released and re-kicks the execution when
 * {@link shouldRedriveAfterLockRelease} says a resume was lost to the lock.
 */
export async function redriveIfResumedDuringLock(params: {
  store: IDurableStore;
  lockedSnapshot: Execution<unknown, unknown> | null;
  lockState: ExecutionLockState;
  shutdownInterruptionReason: string | null;
  kickoffExecution: (executionId: string) => Promise<void>;
}): Promise<void> {
  const { lockedSnapshot } = params;
  // Lost locks belong to another worker, and shutdown deliberately leaves
  // work for the next runtime; neither must be re-driven from here.
  if (
    !lockedSnapshot ||
    params.lockState.lost ||
    params.shutdownInterruptionReason !== null
  ) {
    return;
  }

  const latest = await params.store.getExecution(lockedSnapshot.id);
  if (shouldRedriveAfterLockRelease({ lockedSnapshot, latest })) {
    await params.kickoffExecution(lockedSnapshot.id);
  }
}
