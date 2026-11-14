import { DurableContext } from "../../../durable/core/DurableContext";
import { NoopEventBus } from "../../../durable/bus/NoopEventBus";
import {
  MemoryStore,
  type MemoryStoreSnapshot,
} from "../../../durable/store/MemoryStore";
import { pendingExecution } from "../helpers/DurableService.unit.helpers";

class CountingStore extends MemoryStore {
  writes = 0;
  protected async afterDurableMutation(
    _snapshot: MemoryStoreSnapshot,
  ): Promise<void> {
    this.writes++;
  }
}

describe("indexed operation history", () => {
  it("does not persist history again when a completed step is replayed after snapshot restoration", async () => {
    const store = new MemoryStore();
    await store.saveExecution(
      pendingExecution({ id: "run", historyRecorded: true }),
    );
    const context = new DurableContext(store, new NoopEventBus(), "run", 1, {
      historyRecorded: true,
    });
    await context.step("effect", async () => 7);
    const snapshot = store.exportSnapshot();
    expect(Array.isArray(snapshot.histories![0].entries)).toBe(true);
    const restored = new CountingStore();
    restored.restoreSnapshot(snapshot);
    const effect = jest.fn(async () => 99);
    const resumed = new DurableContext(restored, new NoopEventBus(), "run", 1, {
      historyRecorded: true,
    });
    expect(await resumed.step("effect", effect)).toBe(7);
    expect(effect).not.toHaveBeenCalled();
    expect(restored.writes).toBe(0);
    expect(await restored.listExecutionHistory("run")).toEqual(
      snapshot.histories![0].entries,
    );
    expect(await restored.listExecutionHistory("missing")).toEqual([]);
  });

  it("persists only new phases, keeps the first completion state, and isolates returned snapshots", async () => {
    const store = new CountingStore();
    const operation = { kind: "state" as const, stepId: "change" };
    await store.recordExecutionHistory("run", {
      ...operation,
      phase: "started",
    });
    await store.recordExecutionHistory("run", {
      ...operation,
      phase: "started",
    });
    await store.recordExecutionHistory("run", {
      ...operation,
      phase: "completed",
      stateAfter: { value: 1n },
    });
    await store.recordExecutionHistory("run", {
      ...operation,
      phase: "completed",
      stateAfter: null,
    });
    expect(store.writes).toBe(2);
    const history = await store.listExecutionHistory("run");
    expect(history).toEqual([
      {
        ...operation,
        startedOrder: 1,
        completedOrder: 2,
        stateAfter: { value: 1n },
      },
    ]);
    history[0].stateAfter = null;
    const snapshot = store.exportSnapshot();
    snapshot.histories![0].entries[0].stateAfter = null;
    expect((await store.listExecutionHistory("run"))[0].stateAfter).toEqual({
      value: 1n,
    });
    await store.recordExecutionHistory("run", {
      kind: "step",
      stepId: "next",
      phase: "completed",
    });
    expect((await store.listExecutionHistory("run"))[1]).toMatchObject({
      startedOrder: 3,
      completedOrder: 4,
    });
  });

  it("still fences a stale owner when a history update would otherwise be a no-op", async () => {
    const store = new MemoryStore();
    const update = {
      kind: "step" as const,
      stepId: "effect",
      phase: "completed" as const,
    };
    await store.recordExecutionHistory("run", update);
    const owned = store.withExecutionOwnership({
      executionId: "run",
      lockId: "expired",
      onLost: () => {
        throw new Error("ownership lost");
      },
    });
    await expect(owned.recordExecutionHistory!("run", update)).rejects.toThrow(
      "ownership lost",
    );
  });
});
