import {
  collectionDeadline,
  receiptExpiryDeadline,
} from "../../core/retention";
import type { Execution } from "../../core/types";
import type { MemoryStoreRuntime } from "./runtime";

function hasProtectedDependencies(
  runtime: MemoryStoreRuntime,
  execution: Execution,
  now: Date,
): boolean {
  // Child compensation can depend on its parent's later business outcome.
  if (execution.parentExecutionId) {
    const parent = runtime.executions.get(execution.parentExecutionId);
    if (!parent || parent.status !== "completed") return true;
  }
  return Boolean(
    runtime.executionWaiters.get(execution.id)?.size ||
    (runtime.locks.get(`execution:${execution.id}`)?.expires ?? 0) >
      now.getTime(),
  );
}

function clearExecutionHistoryData(
  runtime: MemoryStoreRuntime,
  id: string,
): void {
  runtime.stepResults.delete(id);
  runtime.histories.delete(id);
  runtime.signalStates.delete(id);
  runtime.signalWaiters.delete(id);
  runtime.workflowStates.delete(id);
  runtime.auditEntries.delete(id);
  for (const [timerId, timer] of runtime.timers) {
    if (timer.executionId === id) runtime.timers.delete(timerId);
  }
}

/** Collects success-only details without deleting results needed by late waiters. */
export async function collectCompletedHistory(
  runtime: MemoryStoreRuntime,
  now: Date,
  limit: number,
): Promise<number> {
  runtime.assertOwnership();
  let collected = 0;
  for (const [id, deadline] of runtime.historyDeadlines) {
    if (collected >= limit) break;
    if (deadline > now.getTime()) continue;
    const execution = runtime.executions.get(id)!;
    if (collectionDeadline(execution) === undefined) {
      runtime.historyDeadlines.delete(id);
      continue;
    }
    if (hasProtectedDependencies(runtime, execution, now)) continue;
    clearExecutionHistoryData(runtime, id);
    runtime.executions.set(id, {
      ...execution,
      input: undefined,
      historyCollectedAt: now,
    });
    runtime.historyDeadlines.delete(id);
    collected++;
  }
  if (collected) await runtime.persistDurableMutation();
  return collected;
}

/** Expires due completion receipts and dependent execution records. */
export async function collectExpiredReceipts(
  runtime: MemoryStoreRuntime,
  now: Date,
  limit: number,
): Promise<number> {
  runtime.assertOwnership();
  let collected = 0;
  for (const [id, deadline] of runtime.receiptExpiryDeadlines) {
    if (collected >= limit) break;
    if (deadline > now.getTime()) continue;
    const execution = runtime.executions.get(id)!;
    if (receiptExpiryDeadline(execution) === undefined) {
      runtime.receiptExpiryDeadlines.delete(id);
      continue;
    }
    if (
      hasProtectedDependencies(runtime, execution, now) ||
      runtime.commandQueues.get(id)?.length
    ) {
      continue;
    }
    clearExecutionHistoryData(runtime, id);
    runtime.commandQueues.delete(id);
    for (const [commandId, command] of runtime.commands) {
      if (command.executionId === id) runtime.commands.delete(commandId);
    }
    const idemKeys = runtime.idempotencyKeysByExecution.get(id);
    if (idemKeys) {
      for (const key of idemKeys) {
        if (runtime.executionIdByIdempotencyKey.get(key) === id) {
          runtime.executionIdByIdempotencyKey.delete(key);
        }
      }
      runtime.idempotencyKeysByExecution.delete(id);
    }
    runtime.executionWaiters.delete(id);
    runtime.historyDeadlines.delete(id);
    runtime.receiptExpiryDeadlines.delete(id);
    runtime.locks.delete(`execution:${id}`);
    runtime.executions.delete(id);
    collected++;
  }
  if (collected) await runtime.persistDurableMutation();
  return collected;
}
