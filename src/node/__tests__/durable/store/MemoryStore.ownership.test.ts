import { MemoryStore } from "../../../durable/store/MemoryStore";
import { pendingExecution } from "../helpers/DurableService.unit.helpers";
import type { IDurableStore } from "../../../durable/core/interfaces/store";
import { IndexedTimers } from "../../../durable/store/memory-store/IndexedTimers";

describe("MemoryStore atomic execution ownership", () => {
  const now = new Date();
  function onLost(): never {
    throw new Error("ownership lost");
  }

  it("preserves non-method facade access and clears derived timer membership", () => {
    class NamedStore extends MemoryStore {
      readonly name = "store";
    }
    const store = new NamedStore();
    const owned = store.withExecutionOwnership({
      executionId: "one",
      lockId: "missing",
      onLost,
    });
    expect(Reflect.get(owned, "name")).toBe("store");
    const timers = new IndexedTimers();
    timers.set("one", {
      id: "one",
      executionId: "execution",
      type: "sleep",
      status: "pending",
      fireAt: now,
    });
    timers.clear();
    expect(timers.size).toBe(0);
    expect(timers.forExecution("execution")).toEqual([]);
  });

  it("accepts only the current lease and keeps independent callers isolated", async () => {
    const store = new MemoryStore();
    await store.saveExecution(pendingExecution({ id: "one" }));
    const token = (await store.acquireLock("execution:one", 10_000))!;
    const owned = store.withExecutionOwnership({
      executionId: "one",
      lockId: token,
      onLost,
    });
    await owned.saveStepResult({
      executionId: "one",
      stepId: "first",
      result: true,
      completedAt: now,
    });
    expect(await store.hasExecutionLease("one")).toBe(true);
    await store.releaseLock("execution:one", token);
    expect(await store.hasExecutionLease("one")).toBe(false);
    const next = (await store.acquireLock("execution:one", 10_000))!;
    const replacement = store.withExecutionOwnership({
      executionId: "one",
      lockId: next,
      onLost,
    });
    await expect(
      owned.updateExecution("one", { result: "stale" }),
    ).rejects.toThrow("ownership lost");
    await Promise.all([
      replacement.updateExecution("one", { result: "winner" }),
      store.bufferSignalRecord("one", "signal", {
        id: "external",
        payload: true,
        receivedAt: now,
      }),
    ]);
    expect((await store.getExecution("one"))?.result).toBe("winner");
    expect((await store.getSignalState("one", "signal"))?.queued).toHaveLength(
      1,
    );
    expect((await store.getStepResult("one", "first"))?.result).toBe(true);
  });

  it("rejects stale writes across execution, state, timer and waiter commits", async () => {
    const store = new MemoryStore();
    const owned = store.withExecutionOwnership({
      executionId: "one",
      lockId: "missing",
      onLost,
    });
    const execution = pendingExecution({ id: "one" });
    const step = {
      executionId: "one",
      stepId: "first",
      result: true,
      completedAt: now,
    };
    const operations: Array<(store: IDurableStore) => Promise<unknown>> = [
      (s) => s.saveExecution(execution),
      (s) => s.saveExecutionIfStatus(execution, ["pending"]),
      (s) => s.saveStepResult(step),
      (s) =>
        s.saveWorkflowState!({ executionId: "one", state: 1, updatedAt: now }),
      (s) =>
        s.createTimer({
          id: "timer",
          executionId: "one",
          type: "sleep",
          status: "pending",
          fireAt: now,
        }),
      (s) => s.deleteTimer("timer"),
      (s) => s.markTimerFired("timer"),
      (s) => s.claimTimer!("timer", "worker", 100),
      (s) => s.renewTimerClaim!("timer", "worker", 100),
      (s) => s.releaseTimerClaim!("timer", "worker"),
      (s) => s.finalizeClaimedTimer!("timer", "worker"),
      (s) =>
        s.bufferSignalRecord("one", "signal", {
          id: "record",
          payload: 1,
          receivedAt: now,
        }),
      (s) =>
        s.upsertSignalWaiter({
          executionId: "one",
          signalId: "signal",
          stepId: "first",
          sortKey: "first",
        }),
      (s) =>
        s.upsertExecutionWaiter!({
          executionId: "one",
          targetExecutionId: "child",
          stepId: "first",
        }),
      (s) => s.collectCompletedHistory!(now, 10),
    ];
    for (const operation of operations)
      await expect(operation(owned)).rejects.toThrow("ownership lost");
    expect(await store.getExecution("one")).toBeNull();
    expect(await store.getStepResult("one", "first")).toBeNull();
    expect(await store.getExecutionTimers("one")).toEqual([]);
  });

  it("treats expiry as loss and rebuilds timer indexes through restore", async () => {
    jest.useFakeTimers();
    try {
      const store = new MemoryStore();
      const token = (await store.acquireLock("execution:one", 10))!;
      const owned = store.withExecutionOwnership({
        executionId: "one",
        lockId: token,
        onLost,
      });
      jest.advanceTimersByTime(11);
      expect(await store.hasExecutionLease("one")).toBe(false);
      await expect(
        owned.updateExecution("one", { result: "late" }),
      ).rejects.toThrow("ownership lost");
      await store.createTimer({
        id: "timer",
        executionId: "one",
        type: "sleep",
        status: "pending",
        fireAt: now,
      });
      expect(await store.getExecutionTimers("one")).toHaveLength(1);
      const restored = new MemoryStore();
      restored.restoreSnapshot(store.exportSnapshot());
      expect(await restored.getExecutionTimers("one")).toHaveLength(1);
      await restored.createTimer({
        id: "timer",
        executionId: "two",
        type: "sleep",
        status: "pending",
        fireAt: now,
      });
      expect(await restored.getExecutionTimers("one")).toEqual([]);
      await restored.markTimerFired("timer");
      expect(await restored.getExecutionTimers("two")).toEqual([]);
      await restored.deleteTimer("timer");
    } finally {
      jest.useRealTimers();
    }
  });
});
