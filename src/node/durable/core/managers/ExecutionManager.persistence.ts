import type { IDurableStore } from "../interfaces/store";
import type { IDurableQueue } from "../interfaces/queue";
import type { ExecuteOptions } from "../interfaces/service";
import type { ITask } from "../../../../types/task";
import type { AuditLogger } from "./AuditLogger";
import { DurableAuditEntryKind } from "../audit";
import {
  ExecutionStatus,
  TimerStatus,
  TimerType,
  type Execution,
} from "../types";
import { createExecutionId } from "../utils";

type AnyTask = ITask<any, Promise<any>, any, any, any, any>;

/**
 * Dependencies needed to persist, audit and kick off durable executions.
 * Bundled so the persistence helpers stay free of `ExecutionManager` internals
 * while sharing a single source of store/queue/config wiring.
 */
export interface ExecutionPersistenceDeps {
  store: IDurableStore;
  queue?: IDurableQueue;
  auditLogger: AuditLogger;
  getTaskWorkflowKey: (task: AnyTask) => string;
  maxAttempts: number;
  defaultTimeout?: number;
  kickoffFailsafeDelayMs: number;
  kickoffExecution: (executionId: string) => Promise<void>;
}

/** Builds a fresh `Pending` execution record from a task and start options. */
export function createPendingExecution(
  deps: ExecutionPersistenceDeps,
  task: AnyTask,
  input: unknown | undefined,
  options: ExecuteOptions | undefined,
  executionId?: string,
): Execution<unknown, unknown> {
  const now = new Date();
  return {
    id: executionId ?? createExecutionId(),
    workflowKey: deps.getTaskWorkflowKey(task),
    parentExecutionId: options?.parentExecutionId,
    input,
    status: ExecutionStatus.Pending,
    attempt: 1,
    maxAttempts: deps.maxAttempts,
    timeout: options?.timeout ?? deps.defaultTimeout,
    createdAt: now,
    updatedAt: now,
  };
}

/** Records the audit entry for a newly created (`Pending`) execution. */
export async function logCreatedExecution(
  auditLogger: AuditLogger,
  execution: Execution,
): Promise<void> {
  await auditLogger.log({
    kind: DurableAuditEntryKind.ExecutionStatusChanged,
    executionId: execution.id,
    workflowKey: execution.workflowKey,
    attempt: execution.attempt,
    from: null,
    to: ExecutionStatus.Pending,
    reason: "created",
  });
}

/** Records an audit entry for an execution status transition. */
export async function logExecutionStatusChange(
  auditLogger: AuditLogger,
  params: {
    execution: Execution<unknown, unknown>;
    from: ExecutionStatus | null;
    to: ExecutionStatus;
    reason: string;
  },
): Promise<void> {
  await auditLogger.log({
    kind: DurableAuditEntryKind.ExecutionStatusChanged,
    executionId: params.execution.id,
    workflowKey: params.execution.workflowKey,
    attempt: params.execution.attempt,
    from: params.from,
    to: params.to,
    reason: params.reason,
  });
}

/** Persists a brand new execution and emits its `created` audit entry. */
export async function persistNewExecution(
  deps: ExecutionPersistenceDeps,
  task: AnyTask,
  input: unknown | undefined,
  options: ExecuteOptions | undefined,
  executionId?: string,
): Promise<string> {
  const execution = createPendingExecution(
    deps,
    task,
    input,
    options,
    executionId,
  );
  await deps.store.saveExecution(execution);
  await logCreatedExecution(deps.auditLogger, execution);
  return execution.id;
}

/**
 * Only re-kick executions that are genuinely waiting for a worker. Parking
 * states (Sleeping/Cancelling/...) must not be nudged on idempotent retries,
 * otherwise a deterministic replay would be triggered for no reason.
 */
export function shouldKickoffExistingIdempotentExecution(
  status: ExecutionStatus,
): boolean {
  return (
    status === ExecutionStatus.Pending || status === ExecutionStatus.Retrying
  );
}

/**
 * Kicks off an execution, optionally arming a short-lived failsafe retry timer
 * in queue mode so a dropped enqueue still gets picked up by the poller.
 */
export async function kickoffWithFailsafe(
  deps: ExecutionPersistenceDeps,
  executionId: string,
): Promise<void> {
  const shouldArmFailsafe =
    Boolean(deps.queue) && deps.kickoffFailsafeDelayMs > 0;

  if (!shouldArmFailsafe) {
    await deps.kickoffExecution(executionId);
    return;
  }

  const timerId = `kickoff:${executionId}`;
  await deps.store.createTimer({
    id: timerId,
    executionId,
    type: TimerType.Retry,
    fireAt: new Date(Date.now() + deps.kickoffFailsafeDelayMs),
    status: TimerStatus.Pending,
  });

  await deps.kickoffExecution(executionId);

  try {
    await deps.store.deleteTimer(timerId);
  } catch {
    // Best-effort timer cleanup; ignore.
  }
}

/**
 * Starts an execution under an idempotency key. If the key already maps to an
 * execution, returns the existing id and only re-kicks it when it is waiting
 * for a worker (see {@link shouldKickoffExistingIdempotentExecution}).
 */
export async function startWithIdempotencyKey(
  deps: ExecutionPersistenceDeps,
  task: AnyTask,
  input: unknown | undefined,
  idempotencyKey: string,
  options: ExecuteOptions | undefined,
): Promise<string> {
  const execution = createPendingExecution(deps, task, input, options);
  const created = await deps.store.createExecutionWithIdempotencyKey({
    execution,
    workflowKey: deps.getTaskWorkflowKey(task),
    idempotencyKey,
  });

  if (!created.created) {
    const existing = await deps.store.getExecution(created.executionId);
    if (existing && shouldKickoffExistingIdempotentExecution(existing.status)) {
      await kickoffWithFailsafe(deps, created.executionId);
    }
    return created.executionId;
  }

  await logCreatedExecution(deps.auditLogger, execution);
  await kickoffWithFailsafe(deps, execution.id);
  return execution.id;
}
