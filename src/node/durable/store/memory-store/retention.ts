import { collectionDeadline } from "../../core/retention";
import type { MemoryStoreRuntime } from "./runtime";

/** Collects success-only details without deleting results needed by late waiters. */
export async function collectCompletedHistory(
  runtime: MemoryStoreRuntime,
  now: Date,
  limit: number,
): Promise<number> {
  let collected = 0;
  for (const [id, deadline] of runtime.historyDeadlines) {
    if (collected >= limit) break;
    if (deadline > now.getTime()) continue;
    const execution = runtime.executions.get(id)!;
    if (collectionDeadline(execution) === undefined) {
      runtime.historyDeadlines.delete(id);
      continue;
    }
    // Child compensation can depend on its parent's later business outcome.
    if (execution.parentExecutionId) {
      const parent = runtime.executions.get(execution.parentExecutionId);
      if (!parent || parent.status !== "completed") continue;
    }
    if (
      runtime.executionWaiters.get(id)?.size ||
      (runtime.locks.get(`execution:${id}`)?.expires ?? 0) > now.getTime()
    )
      continue;
    runtime.stepResults.delete(id);
    runtime.signalStates.delete(id);
    runtime.signalWaiters.delete(id);
    runtime.workflowStates.delete(id);
    runtime.auditEntries.delete(id);
    for (const [timerId, timer] of runtime.timers) {
      if (timer.executionId === id) runtime.timers.delete(timerId);
    }
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
