import type { IDurableStore } from "../interfaces/store";
import type { AuditLogger } from "./AuditLogger";
import { ExecutionStatus, isExecutionTerminal, type Execution } from "../types";
import { sleepMs } from "../utils";
import {
  durableExecutionInvariantError,
  durablePauseRejectedError,
  durableResumeRejectedError,
} from "../../../../errors";
import {
  EXECUTION_PAUSED_ABORT_REASON,
  getPauseState,
} from "./ExecutionManager.cancellation";
import type {
  AbortPausedAttempt,
  ExecutionPauseState,
} from "./ExecutionManager.pauseControl";
import { logExecutionStatusChange } from "./ExecutionManager.persistence";

/**
 * Shared dependencies for the pause/resume flows, which park a live execution
 * in `paused` and later restore it to its pre-pause status under a bounded
 * optimistic-concurrency retry loop.
 */
export interface ExecutionPauseDeps {
  store: IDurableStore;
  auditLogger: AuditLogger;
  abortPausedAttempt: AbortPausedAttempt;
  publishLivePauseRequested: (
    executionId: string,
    pause: ExecutionPauseState,
  ) => Promise<void>;
  /**
   * Failsafe kickoff (see `kickoffWithFailsafe`): resume must not depend on a
   * single enqueue landing. A kick that loses the lock race to a still-running
   * paused attempt is re-driven by that attempt once it releases the lock.
   */
  kickoffWithFailsafe: (executionId: string) => Promise<void>;
}

function isRestorableResumeStatus(status: ExecutionStatus): boolean {
  return (
    !isExecutionTerminal(status) &&
    status !== ExecutionStatus.Paused &&
    status !== ExecutionStatus.Cancelling
  );
}

/**
 * Aborts the live attempt locally and on peers, stamped with the pause so an
 * attempt that started after this pause was resumed is left alone.
 */
async function stopLiveAttemptForPause(
  deps: ExecutionPauseDeps,
  executionId: string,
  pausedAt: Date | undefined,
): Promise<void> {
  const pause = {
    reason: EXECUTION_PAUSED_ABORT_REASON,
    pausedAtMs: pausedAt?.getTime(),
  };
  deps.abortPausedAttempt(executionId, pause);
  await deps.publishLivePauseRequested(executionId, pause);
}

/**
 * Re-issues the live stop for an already-paused execution that was paused
 * out of `running`: a prior publish may have gone out before any worker
 * was listening (or been lost), and without a re-issue the live attempt
 * would only notice via the slower polling fallback. Other origins never
 * had a live attempt, so there is nothing to re-issue.
 *
 * The record is re-read right before aborting: the caller's snapshot may
 * predate a resume, and aborting then would hit the legitimately resumed
 * attempt instead of the paused one.
 */
async function reissueLivePauseIfRunningOrigin(
  deps: ExecutionPauseDeps,
  executionId: string,
): Promise<void> {
  const execution = await deps.store.getExecution(executionId);
  if (
    !getPauseState(execution) ||
    execution?.pausedFrom !== ExecutionStatus.Running
  ) {
    return;
  }
  await stopLiveAttemptForPause(deps, executionId, execution.pausedAt);
}

function inferResumeStatus(
  execution: Execution<unknown, unknown>,
): ExecutionStatus {
  const currentKind = execution.current?.kind;
  if (
    currentKind === "sleep" ||
    currentKind === "waitForSignal" ||
    currentKind === "waitForExecution"
  ) {
    return ExecutionStatus.Sleeping;
  }

  return ExecutionStatus.Pending;
}

/**
 * Pauses a non-terminal execution. The pre-pause status is stashed in
 * `pausedFrom` so resume can restore it; a live `Running` attempt is aborted
 * (locally and, when a live bus is configured, on peer workers) and its
 * outcome is dropped by the usual optimistic-concurrency guards. Pause is
 * wall-clock: timers keep their `fireAt` and may complete their step state
 * while paused; resume re-kicks and lets replay sort it out. Retries on
 * optimistic-concurrency conflicts and throws if it cannot converge.
 */
export async function pauseExecution(
  deps: ExecutionPauseDeps,
  executionId: string,
): Promise<void> {
  const maxAttempts = 10;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const execution = await deps.store.getExecution(executionId);
    if (!execution) {
      return durablePauseRejectedError.throw({
        executionId,
        status: "unknown",
      });
    }
    if (execution.status === ExecutionStatus.Paused) {
      await reissueLivePauseIfRunningOrigin(deps, executionId);
      return;
    }
    if (
      isExecutionTerminal(execution.status) ||
      execution.status === ExecutionStatus.Cancelling
    ) {
      return durablePauseRejectedError.throw({
        executionId,
        status: execution.status,
      });
    }

    const now = new Date();
    // The stamp identifies this pause to live attempts, so it must differ
    // from the previous one even when re-pausing within the same millisecond.
    const pausedAt = new Date(
      Math.max(now.getTime(), (execution.pausedAt?.getTime() ?? 0) + 1),
    );
    const pausedExecution: Execution = {
      ...execution,
      status: ExecutionStatus.Paused,
      pausedAt,
      pausedFrom: execution.status,
      updatedAt: now,
    };
    const saved = await deps.store.saveExecutionIfStatus(pausedExecution, [
      execution.status,
    ]);
    if (!saved) {
      if (attempt < maxAttempts) {
        await sleepMs(Math.min(2 ** (attempt - 1), 25));
      }
      continue;
    }

    if (execution.status === ExecutionStatus.Running) {
      await stopLiveAttemptForPause(deps, executionId, pausedAt);
    }

    await logExecutionStatusChange(deps.auditLogger, {
      execution,
      from: execution.status,
      to: ExecutionStatus.Paused,
      reason: "paused",
    });
    return;
  }

  const latestExecution = await deps.store.getExecution(executionId);
  if (!latestExecution) {
    return durablePauseRejectedError.throw({
      executionId,
      status: "unknown",
    });
  }
  if (getPauseState(latestExecution)) {
    await reissueLivePauseIfRunningOrigin(deps, executionId);
    return;
  }
  if (
    isExecutionTerminal(latestExecution.status) ||
    latestExecution.status === ExecutionStatus.Cancelling
  ) {
    return durablePauseRejectedError.throw({
      executionId,
      status: latestExecution.status,
    });
  }

  durableExecutionInvariantError.throw({
    message: `Failed to pause durable execution '${executionId}' after ${maxAttempts} attempts due to concurrent state changes.`,
  });
}

/**
 * Resumes a paused execution by restoring its pre-pause status and re-kicking
 * it; replay re-derives waits and picks up signals buffered while paused, so
 * no signal is lost. Rejected for executions that are not paused. Retries on
 * optimistic-concurrency conflicts and throws if it cannot converge.
 */
export async function resumeExecution(
  deps: ExecutionPauseDeps,
  executionId: string,
): Promise<void> {
  const maxAttempts = 10;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const execution = await deps.store.getExecution(executionId);
    if (!execution) {
      return durableResumeRejectedError.throw({
        executionId,
        status: "unknown",
      });
    }
    if (!getPauseState(execution)) {
      return durableResumeRejectedError.throw({
        executionId,
        status: execution.status,
      });
    }

    // Pause only ever stashes a live status, but a tampered or migrated
    // record could carry a terminal (or otherwise unrestorable) value;
    // fall back to inference rather than resurrecting or re-parking it.
    const stashedStatus = execution.pausedFrom ?? inferResumeStatus(execution);
    const restoredStatus = isRestorableResumeStatus(stashedStatus)
      ? stashedStatus
      : inferResumeStatus(execution);
    const now = new Date();
    const resumedExecution: Execution = {
      ...execution,
      status: restoredStatus,
      pausedFrom: undefined,
      updatedAt: now,
    };
    const saved = await deps.store.saveExecutionIfStatus(resumedExecution, [
      ExecutionStatus.Paused,
    ]);
    if (!saved) {
      if (attempt < maxAttempts) {
        await sleepMs(Math.min(2 ** (attempt - 1), 25));
      }
      continue;
    }

    await logExecutionStatusChange(deps.auditLogger, {
      execution,
      from: ExecutionStatus.Paused,
      to: restoredStatus,
      reason: "resumed",
    });
    await deps.kickoffWithFailsafe(executionId);
    return;
  }

  const latestExecution = await deps.store.getExecution(executionId);
  if (!latestExecution) {
    return durableResumeRejectedError.throw({
      executionId,
      status: "unknown",
    });
  }
  if (!getPauseState(latestExecution)) {
    return durableResumeRejectedError.throw({
      executionId,
      status: latestExecution.status,
    });
  }

  durableExecutionInvariantError.throw({
    message: `Failed to resume durable execution '${executionId}' after ${maxAttempts} attempts due to concurrent state changes.`,
  });
}
