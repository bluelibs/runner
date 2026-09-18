import type { IDurableStore } from "../interfaces/store";
import type { RestartExecutionOptions } from "../interfaces/service";
import type { ITask } from "../../../../types/task";
import { ExecutionStatus, isExecutionTerminal, type Execution } from "../types";
import { createExecutionId } from "../utils";
import { durableRestartRejectedError } from "../../../../errors";
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

async function linkRestartedAs(
  store: IDurableStore,
  sourceId: string,
  restartedId: string,
): Promise<void> {
  await store.updateExecution(sourceId, {
    restartedAsExecutionId: restartedId,
    updatedAt: new Date(),
  });
}

/**
 * Restarts a terminal or paused execution as a fresh run and returns the new
 * execution id. The new run reuses the source input unless overridden, starts
 * from attempt 1 with fresh steps, and never carries workflow state (use
 * continue-as-new to carry state). A paused source stays paused; lineage is
 * recorded both ways (`restartedFromExecutionId` / `restartedAsExecutionId`,
 * the latter last-writer-wins). Rejected for active executions: pause or
 * cancel them first. An idempotency key dedupes repeated restart calls to one
 * new execution.
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
  if (
    !isExecutionTerminal(source.status) &&
    source.status !== ExecutionStatus.Paused
  ) {
    return durableRestartRejectedError.throw({
      executionId,
      status: source.status,
    });
  }

  const input = options?.input ?? source.input;
  if (options?.input !== undefined) {
    // Reused input was validated at the original start; overrides are
    // validated when the task is registered in this runtime. Operator-only
    // runtimes (whose tasks live on workers) skip validation rather than
    // refuse the restart.
    ValidationHelper.validateInput(
      input,
      deps.resolveTask(source.workflowKey)?.inputSchema,
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
    await linkRestartedAs(store, source.id, created.executionId);
    if (!created.created) {
      const existing = await store.getExecution(created.executionId);
      if (
        existing &&
        shouldKickoffExistingIdempotentExecution(existing.status)
      ) {
        await kickoffWithFailsafe(deps.persistence, created.executionId);
      }
      return created.executionId;
    }

    await logCreatedExecution(deps.persistence.auditLogger, restarted);
    await kickoffWithFailsafe(deps.persistence, restarted.id);
    return restarted.id;
  }

  await store.saveExecution(restarted);
  await logCreatedExecution(deps.persistence.auditLogger, restarted);
  await linkRestartedAs(store, source.id, restarted.id);
  await kickoffWithFailsafe(deps.persistence, restarted.id);
  return restarted.id;
}
