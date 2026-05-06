import type { DurableAuditEntry } from "../../core/audit";
import type { ListExecutionsOptions } from "../../core/interfaces/store";
import type { Execution, StepResult } from "../../core/types";
import { cloneAuditEntry, cloneExecution, cloneStepResult } from "./shared";
import type { MemoryStoreRuntime } from "./runtime";

function getOrCreateExecutionStepResults(
  runtime: MemoryStoreRuntime,
  executionId: string,
): Map<string, StepResult> {
  const existing = runtime.stepResults.get(executionId);
  if (existing) {
    return existing;
  }

  const results = new Map<string, StepResult>();
  runtime.stepResults.set(executionId, results);
  return results;
}

export async function listExecutions(
  runtime: MemoryStoreRuntime,
  options?: ListExecutionsOptions,
): Promise<Execution[]> {
  let results = Array.from(runtime.executions.values());
  const statusFilter = options?.status;
  const workflowKey = options?.workflowKey;
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? 100;

  if (statusFilter && statusFilter.length > 0) {
    results = results.filter((execution) =>
      statusFilter.includes(execution.status),
    );
  }

  if (workflowKey) {
    results = results.filter(
      (execution) => execution.workflowKey === workflowKey,
    );
  }

  results.sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );

  return results.slice(offset, offset + limit).map(cloneExecution);
}

export async function listStepResults(
  runtime: MemoryStoreRuntime,
  executionId: string,
): Promise<StepResult[]> {
  const results = runtime.stepResults.get(executionId);
  if (!results) {
    return [];
  }

  return Array.from(results.values())
    .sort(
      (left, right) =>
        new Date(left.completedAt).getTime() -
        new Date(right.completedAt).getTime(),
    )
    .map(cloneStepResult);
}

export async function appendAuditEntry(
  runtime: MemoryStoreRuntime,
  entry: DurableAuditEntry,
): Promise<void> {
  const list = runtime.auditEntries.get(entry.executionId) ?? [];
  list.push(cloneAuditEntry(entry));
  runtime.auditEntries.set(entry.executionId, list);
  await runtime.persistDurableMutation();
}

export async function listAuditEntries(
  runtime: MemoryStoreRuntime,
  executionId: string,
  options?: { limit?: number; offset?: number },
): Promise<DurableAuditEntry[]> {
  const list = runtime.auditEntries.get(executionId) ?? [];
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? list.length;
  return list.slice(offset, offset + limit).map(cloneAuditEntry);
}

export async function getStepResult(
  runtime: MemoryStoreRuntime,
  executionId: string,
  stepId: string,
): Promise<StepResult | null> {
  const results = runtime.stepResults.get(executionId);
  if (!results) {
    return null;
  }

  const result = results.get(stepId);
  return result ? cloneStepResult(result) : null;
}

export function setStepResult(
  runtime: MemoryStoreRuntime,
  result: StepResult,
): void {
  getOrCreateExecutionStepResults(runtime, result.executionId).set(
    result.stepId,
    cloneStepResult(result),
  );
}

export async function saveStepResult(
  runtime: MemoryStoreRuntime,
  result: StepResult,
): Promise<void> {
  setStepResult(runtime, result);
  await runtime.persistDurableMutation();
}
