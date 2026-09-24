import type { RestartExecutionOptions } from "../interfaces/service";
import type { ITask } from "../../../../types/task";
import { ExecutionStatus, type Execution } from "../types";
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
import {
  cancelOrphanedRestart,
  findRestartBlocker,
  linkRestartedAs,
  requireRestartable,
  reviveOrphanedRestart,
} from "./ExecutionManager.restartGuards";

type AnyTask = ITask<any, Promise<any>, any, any, any, any>;

/**
 * Shared dependencies for the restart flow, which re-runs a terminal or
 * paused execution as a fresh run linked by restart lineage fields.
 */
export interface ExecutionRestartDeps {
  persistence: ExecutionPersistenceDeps;
  resolveTask: (workflowKey: string) => AnyTask | undefined;
}

/**
 * Picks the restart input and whether it still needs its boundary check.
 * Overrides and inputs the source itself never validated (a continuation
 * that failed `invalid_input`) are validated here when the task is
 * registered, failing fast before anything is persisted; operator-only
 * runtimes (whose tasks live on workers) flag them for worker-side
 * validation instead. Input the source already validated is reused as is.
 */
function resolveRestartInput(
  deps: ExecutionRestartDeps,
  source: Execution,
  options: RestartExecutionOptions | undefined,
): { input: unknown; inputNeedsValidation: true | undefined } {
  const overridden = options?.input !== undefined;
  const input = overridden ? options.input : source.input;
  if (!overridden && source.inputNeedsValidation !== true) {
    return { input, inputNeedsValidation: undefined };
  }

  const task = deps.resolveTask(source.workflowKey);
  if (!task) return { input, inputNeedsValidation: true };
  ValidationHelper.validateInput(
    input,
    task.inputSchema,
    source.workflowKey,
    "Task",
  );
  return { input, inputNeedsValidation: undefined };
}

function buildRestartedExecution(
  deps: ExecutionRestartDeps,
  source: Execution,
  options: RestartExecutionOptions | undefined,
): Execution {
  const now = new Date();
  return {
    id: createExecutionId(),
    workflowKey: source.workflowKey,
    parentExecutionId: source.parentExecutionId,
    ...resolveRestartInput(deps, source, options),
    status: ExecutionStatus.Pending,
    attempt: 1,
    maxAttempts: deps.persistence.maxAttempts,
    timeout: source.timeout,
    restartedFromExecutionId: source.id,
    createdAt: now,
    updatedAt: now,
  };
}

/** Links a freshly persisted successor, or cancels it if the link loses. */
async function commitRestart(
  deps: ExecutionRestartDeps,
  sourceId: string,
  restarted: Execution,
): Promise<string> {
  const store = deps.persistence.store;
  try {
    await linkRestartedAs(store, sourceId, restarted.id);
  } catch (error) {
    // The caller is told this restart failed, whatever broke the link, so
    // recovery must never run the orphan later. A failed cleanup must not
    // mask the cause.
    await cancelOrphanedRestart(store, sourceId, restarted.id).catch(
      () => undefined,
    );
    throw error;
  }
  await logCreatedExecution(deps.persistence.auditLogger, restarted);
  await kickoffWithFailsafe(deps.persistence, restarted.id);
  return restarted.id;
}

/**
 * Returns the successor a repeated key already maps to. It is (re)linked
 * unless the source already links to it, so a retry after the source was
 * resumed still returns the restart it reported before; an orphan left by a
 * lost race is revived once the source is restartable again.
 */
async function reuseExistingRestart(
  deps: ExecutionRestartDeps,
  sourceId: string,
  existingId: string,
): Promise<string> {
  const store = deps.persistence.store;
  const existing = await store.getExecution(existingId);
  if (!existing) {
    return durableExecutionInvariantError.throw({
      message: `Idempotency mapping for restart of execution "${sourceId}" points to missing execution "${existingId}".`,
    });
  }
  // Keys are caller-chosen and scoped by workflow, not by source: without
  // this check a key reused across sources would cross-link two lineages.
  if (existing.restartedFromExecutionId !== sourceId) {
    return durableRestartIdempotencyConflictError.throw({
      sourceExecutionId: sourceId,
      existingExecutionId: existingId,
    });
  }
  await linkRestartedAs(store, sourceId, existingId);
  const recovered = await reviveOrphanedRestart(store, existing);
  if (recovered.revived) {
    await logCreatedExecution(
      deps.persistence.auditLogger,
      recovered.execution,
    );
  }
  if (shouldKickoffExistingIdempotentExecution(recovered.execution.status)) {
    await kickoffWithFailsafe(deps.persistence, existingId);
  }
  return existingId;
}

async function restartWithIdempotencyKey(
  deps: ExecutionRestartDeps,
  source: Execution,
  restarted: Execution,
  idempotencyKey: string,
): Promise<string> {
  const created =
    await deps.persistence.store.createExecutionWithIdempotencyKey({
      execution: restarted,
      workflowKey: source.workflowKey,
      idempotencyKey,
    });
  if (!created.created) {
    return await reuseExistingRestart(deps, source.id, created.executionId);
  }
  return await commitRestart(deps, source.id, {
    ...restarted,
    id: created.executionId,
  });
}

/**
 * Restarts a terminal or paused execution as a fresh run and returns the new
 * execution id. The new run reuses the source input unless overridden, starts
 * from attempt 1 with fresh steps, and never carries workflow state (use
 * continue-as-new to carry state). A paused source stays paused; lineage is
 * recorded both ways (`restartedFromExecutionId` / `restartedAsExecutionId`,
 * the latter last-writer-wins). Rejected for active executions: pause or
 * cancel them first. A source that resumes concurrently is rejected as
 * active rather than restarted alongside the resumed run.
 *
 * A `continued_as_new` source restarts that run from its own input (use the
 * tip id to restart the latest chapter instead), and only once its chain tip
 * is terminal or paused, so a restart never runs beside a live chain.
 *
 * An idempotency key dedupes repeated restart calls to one new execution;
 * a retried key returns the restart it already produced even after the
 * source was resumed.
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
  // A blocked source may still own a restart this key produced earlier;
  // only then is the key looked up before rejecting.
  const blocker = await findRestartBlocker(store, source);
  const keyMayMapToPriorRestart =
    options?.idempotencyKey !== undefined &&
    source.restartedAsExecutionId !== undefined;
  if (blocker !== null && !keyMayMapToPriorRestart) {
    return durableRestartRejectedError.throw({
      executionId,
      status: blocker,
    });
  }

  const restarted = buildRestartedExecution(deps, source, options);
  if (options?.idempotencyKey) {
    return await restartWithIdempotencyKey(
      deps,
      source,
      restarted,
      options.idempotencyKey,
    );
  }

  // Recheck eligibility right before persisting so a resume that landed
  // after the initial guard rejects before an orphan is created. The link
  // still commits conditionally to close the remaining window.
  await requireRestartable(
    store,
    source.id,
    await store.getExecution(source.id),
  );
  await store.saveExecution(restarted);
  return await commitRestart(deps, source.id, restarted);
}
