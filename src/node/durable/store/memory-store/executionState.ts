import type { ExpectedExecutionStatuses } from "../../core/interfaces/store";
import { ExecutionStatus, type Execution } from "../../core/types";
import { cloneExecution } from "./shared";
import type { MemoryStoreRuntime } from "./runtime";

function getIdempotencyMapKey(
  workflowKey: string,
  idempotencyKey: string,
): string {
  return `${workflowKey}::${idempotencyKey}`;
}

export async function createExecutionWithIdempotencyKey(
  runtime: MemoryStoreRuntime,
  params: {
    execution: Execution;
    workflowKey: string;
    idempotencyKey: string;
  },
): Promise<
  | { created: true; executionId: string }
  | { created: false; executionId: string }
> {
  const key = getIdempotencyMapKey(params.workflowKey, params.idempotencyKey);
  const existingExecutionId = runtime.executionIdByIdempotencyKey.get(key);
  if (existingExecutionId) {
    return { created: false, executionId: existingExecutionId };
  }

  runtime.executionIdByIdempotencyKey.set(key, params.execution.id);
  runtime.executions.set(params.execution.id, cloneExecution(params.execution));
  await runtime.persistDurableMutation();
  return { created: true, executionId: params.execution.id };
}

export async function saveExecution(
  runtime: MemoryStoreRuntime,
  execution: Execution,
): Promise<void> {
  runtime.executions.set(execution.id, cloneExecution(execution));
  await runtime.persistDurableMutation();
}

export async function saveExecutionIfStatus(
  runtime: MemoryStoreRuntime,
  execution: Execution,
  expectedStatuses: ExpectedExecutionStatuses,
): Promise<boolean> {
  const current = runtime.executions.get(execution.id);
  if (!current) {
    return false;
  }
  if (!expectedStatuses.includes(current.status)) {
    return false;
  }

  runtime.executions.set(execution.id, cloneExecution(execution));
  await runtime.persistDurableMutation();
  return true;
}

export async function getExecution(
  runtime: MemoryStoreRuntime,
  id: string,
): Promise<Execution | null> {
  const execution = runtime.executions.get(id);
  return execution ? cloneExecution(execution) : null;
}

export async function updateExecution(
  runtime: MemoryStoreRuntime,
  id: string,
  updates: Partial<Execution>,
): Promise<void> {
  const execution = runtime.executions.get(id);
  if (!execution) {
    return;
  }

  runtime.executions.set(
    id,
    cloneExecution({ ...execution, ...updates, updatedAt: new Date() }),
  );
  await runtime.persistDurableMutation();
}

export async function listIncompleteExecutions(
  runtime: MemoryStoreRuntime,
): Promise<Execution[]> {
  return Array.from(runtime.executions.values())
    .filter(
      (execution) =>
        execution.status !== ExecutionStatus.Completed &&
        execution.status !== ExecutionStatus.Failed &&
        execution.status !== ExecutionStatus.CompensationFailed &&
        execution.status !== ExecutionStatus.Cancelled,
    )
    .map(cloneExecution);
}

export async function listStuckExecutions(
  runtime: MemoryStoreRuntime,
): Promise<Execution[]> {
  return Array.from(runtime.executions.values())
    .filter(
      (execution) => execution.status === ExecutionStatus.CompensationFailed,
    )
    .map(cloneExecution);
}

export async function retryRollback(
  runtime: MemoryStoreRuntime,
  executionId: string,
): Promise<void> {
  const execution = runtime.executions.get(executionId);
  if (!execution) {
    return;
  }

  runtime.executions.set(executionId, {
    ...execution,
    status: ExecutionStatus.Pending,
    error: undefined,
    updatedAt: new Date(),
  });
  await runtime.persistDurableMutation();
}

export async function forceFail(
  runtime: MemoryStoreRuntime,
  executionId: string,
  error: { message: string; stack?: string },
): Promise<void> {
  const execution = runtime.executions.get(executionId);
  if (!execution) {
    return;
  }

  runtime.executions.set(executionId, {
    ...execution,
    status: ExecutionStatus.Failed,
    error,
    updatedAt: new Date(),
  });
  await runtime.persistDurableMutation();
}
