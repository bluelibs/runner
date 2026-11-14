import type { DurableHistoryUpdate } from "../../core/interfaces/history";
import type { MemoryStoreRuntime } from "./runtime";

/** Synchronous update can participate in a larger atomic memory commit. */
export function updateHistory(
  runtime: MemoryStoreRuntime,
  executionId: string,
  update: DurableHistoryUpdate,
): void {
  runtime.assertOwnership();
  const history = runtime.histories.get(executionId) ?? {
    sequence: 0,
    entries: [],
  };
  let entry = history.entries.find((entry) => entry.stepId === update.stepId);
  if (!entry) {
    const { phase: _phase, stateAfter: _state, ...identity } = update;
    entry = { ...identity, startedOrder: ++history.sequence };
    history.entries.push(entry);
  }
  if (update.phase === "completed" && entry.completedOrder === undefined) {
    entry.completedOrder = ++history.sequence;
    if ("stateAfter" in update)
      entry.stateAfter = structuredClone(update.stateAfter);
  }
  runtime.histories.set(executionId, history);
}
