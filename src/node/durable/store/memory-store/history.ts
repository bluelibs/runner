import type { DurableHistoryUpdate } from "../../core/interfaces/history";
import type { MemoryStoreRuntime } from "./runtime";

/** Synchronous update can participate in a larger atomic memory commit. */
export function updateHistory(
  runtime: MemoryStoreRuntime,
  executionId: string,
  update: DurableHistoryUpdate,
): boolean {
  runtime.assertOwnership();
  const history = runtime.histories.get(executionId) ?? {
    sequence: 0,
    entries: new Map(),
  };
  let entry = history.entries.get(update.stepId);
  if (
    entry &&
    (update.phase === "started" || entry.completedOrder !== undefined)
  )
    return false;
  if (!entry) {
    const { phase: _phase, stateAfter: _state, ...identity } = update;
    entry = { ...identity, startedOrder: ++history.sequence };
    history.entries.set(update.stepId, entry);
  }
  if (update.phase === "completed" && entry.completedOrder === undefined) {
    entry.completedOrder = ++history.sequence;
    if ("stateAfter" in update)
      entry.stateAfter = structuredClone(update.stateAfter);
  }
  runtime.histories.set(executionId, history);
  return true;
}
