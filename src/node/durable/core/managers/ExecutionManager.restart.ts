import type {
  ExpectedExecutionStatuses,
  IDurableStore,
} from "../interfaces/store";
import type { RestartExecutionOptions } from "../interfaces/service";
import type { ITask } from "../../../../types/task";
import { ExecutionStatus, isExecutionTerminal, type Execution } from "../types";
import { createExecutionId } from "../utils";
import {
  durableExecutionInvariantError,
  durableRestartIdempotencyConflictError,
  durableRestartRejectedError,
} from "../../../../errors";
import { ValidationHelper } from "../../../../models/middleware/ValidationHelper";
import {
  kickoffWithFailsafe,
  logCreatedExecution,
  shouldKickoffExistingIdempotentExecution,
  type ExecutionPersistenceDeps,
} from "./ExecutionManager.persistence";

type AnyTask = ITask<any, Promise<any>, any, any, any, any>;

/**
 * Shared dependencies for the restart flow, which re-runs a terminal or
 * paused execution as a fresh run linked by restart lineage fields.
 */
export interface ExecutionRestartDeps {
  persistence: ExecutionPersistenceDeps;
  resolveTask: (workflowKey: string) => AnyTask | undefined;
}

const RESTARTABLE_STATUSES: ExpectedExecutionStatuses = [
  ExecutionStatus.Paused,
  ExecutionStatus.Completed,
  ExecutionStatus.Failed,
  ExecutionStatus.CompensationFailed,
  ExecutionStatus.Cancelled,
  ExecutionStatus.ContinuedAsNew,
];

const ORPHANED_RESTART_ERROR_MESSAGE =
  "Restart rejected: source resumed concurrently.";

function isRestartableStatus(status: ExecutionStatus): boolean {
  return isExecutionTerminal(status) || status === ExecutionStatus.Paused;
}

/**
 * Links the source to its restart successor, but only while the source is
 * still restartable. A concurrent resume (paused -> active) between the
 * initial guard and this commit rejects the restart instead of silently
 * producing two live runs, and the compare-and-set write never regresses
 * the winner's status the way a blind update would.
 */
async function linkRestartedAs(
  store: IDurableStore,
  sourceId: string,
  restartedId: string,
): Promise<void> {
  const fresh = await store.getExecution(sourceId);
  if (!fresh) {
    return durableRestartRejectedError.throw({
      executionId: sourceId,
      status: "unknown",
    });
  }
  if (!isRestartableStatus(fresh.status)) {
    return durableRestartRejectedError.throw({
      executionId: sourceId,
      status: fresh.status,
    });
  }
  const linked = await store.saveExecutionIfStatus(
    {
      ...fresh,
      restartedAsExecutionId: restartedId,
      updatedAt: new Date(),
    },
    RESTARTABLE_STATUSES,
  );
  if (!linked) {
    const latest = await store.getExecution(sourceId);
    return durableRestartRejectedError.throw({
      executionId: sourceId,
      status: latest?.status ?? fresh.status,
    });
  }
}

/**
 * Best-effort cancellation of a successor that was persisted but must not
 * run because the source link lost its race (e.g. the source resumed
 * first). Without this the orphan would stay `pending` and recovery would
 * run an execution the caller was told was rejected.
 */
async function cancelOrphanedRestart(
  store: IDurableStore,
  successor: Execution,
): Promise<void> {
  const current = await store.getExecution(successor.id);
  if (!current || current.status !== ExecutionStatus.Pending) {
    return;
  }
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
async function reviveOrphanedRestart(
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

/**
 * Restarts a terminal or paused execution as a fresh run and returns the new
 * execution id. The new run reuses the source input unless overridden, starts
 * from attempt 1 with fresh steps, and never carries workflow state (use
 * continue-as-new to carry state). A paused source stays paused; lineage is
 * recorded both ways (`restartedFromExecutionId` / `restartedAsExecutionId`,
 * the latter last-writer-wins). Rejected for active executions: pause or
 * cancel them first. A source that resumes concurrently is rejected as
 * active rather than restarted alongside the resumed run. An idempotency
 * key dedupes repeated restart calls to one new execution.
 */
export async function restartExecution(
  deps: ExecutionRestartDeps,
  executionId: string,
  options?: RestartExecutionOptions,
): Promise<string> {
  const store = deps.persistence.store;
  const source = await store.getExecution(executionId);
  if (!source) {
    return durableRestartRejectedError.throw({
      executionId,
      status: "unknown",
    });
  }
  if (!isRestartableStatus(source.status)) {
    return durableRestartRejectedError.throw({
      executionId,
      status: source.status,
    });
  }

  const input = options?.input !== undefined ? options.input : source.input;
  // Reused input was validated at the original start; overrides are
  // validated when the task is registered in this runtime. Operator-only
  // runtimes (whose tasks live on workers) flag the override for
  // worker-side validation rather than refuse the restart.
  const overrideTask =
    options?.input === undefined
      ? undefined
      : deps.resolveTask(source.workflowKey);
  if (overrideTask) {
    ValidationHelper.validateInput(
      input,
      overrideTask.inputSchema,
      source.workflowKey,
      "Task",
    );
  }

  const now = new Date();
  const restarted: Execution = {
    id: createExecutionId(),
    workflowKey: source.workflowKey,
    parentExecutionId: source.parentExecutionId,
    input,
    inputNeedsValidation:
      options?.input !== undefined && overrideTask === undefined
        ? true
        : undefined,
    status: ExecutionStatus.Pending,
    attempt: 1,
    maxAttempts: deps.persistence.maxAttempts,
    timeout: source.timeout,
    restartedFromExecutionId: source.id,
    createdAt: now,
    updatedAt: now,
  };

  if (options?.idempotencyKey) {
    const created = await store.createExecutionWithIdempotencyKey({
      execution: restarted,
      workflowKey: source.workflowKey,
      idempotencyKey: options.idempotencyKey,
    });
    const effectiveId = created.executionId;
    const effectiveRestarted =
      effectiveId === restarted.id
        ? restarted
        : { ...restarted, id: effectiveId };
    if (!created.created) {
      const existing = await store.getExecution(effectiveId);
      if (!existing) {
        return durableExecutionInvariantError.throw({
          message: `Idempotency mapping for restart of execution "${source.id}" points to missing execution "${effectiveId}".`,
        });
      }
      // Keys are caller-chosen and scoped by workflow, not by source: without
      // this check a key reused across sources would cross-link two lineages.
      if (existing.restartedFromExecutionId !== source.id) {
        return durableRestartIdempotencyConflictError.throw({
          sourceExecutionId: source.id,
          existingExecutionId: effectiveId,
        });
      }
      await linkRestartedAs(store, source.id, effectiveId);
      const recovered = await reviveOrphanedRestart(store, existing);
      if (recovered.revived) {
        await logCreatedExecution(
          deps.persistence.auditLogger,
          recovered.execution,
        );
      }
      if (
        shouldKickoffExistingIdempotentExecution(recovered.execution.status)
      ) {
        await kickoffWithFailsafe(deps.persistence, effectiveId);
      }
      return effectiveId;
    }
    try {
      await linkRestartedAs(store, source.id, effectiveId);
    } catch (error) {
      if (durableRestartRejectedError.is(error)) {
        await cancelOrphanedRestart(store, effectiveRestarted);
      }
      throw error;
    }

    await logCreatedExecution(deps.persistence.auditLogger, effectiveRestarted);
    await kickoffWithFailsafe(deps.persistence, effectiveId);
    return effectiveId;
  }

  // Recheck eligibility right before persisting so a resume that landed
  // after the initial guard rejects before an orphan is created. The link
  // below still commits conditionally to close the remaining window.
  const preSave = await store.getExecution(source.id);
  if (!preSave) {
    return durableRestartRejectedError.throw({
      executionId: source.id,
      status: "unknown",
    });
  }
  if (!isRestartableStatus(preSave.status)) {
    return durableRestartRejectedError.throw({
      executionId: source.id,
      status: preSave.status,
    });
  }

  await store.saveExecution(restarted);
  try {
    await linkRestartedAs(store, source.id, restarted.id);
  } catch (error) {
    if (durableRestartRejectedError.is(error)) {
      await cancelOrphanedRestart(store, restarted);
    }
    throw error;
  }
  await logCreatedExecution(deps.persistence.auditLogger, restarted);
  await kickoffWithFailsafe(deps.persistence, restarted.id);
  return restarted.id;
}
