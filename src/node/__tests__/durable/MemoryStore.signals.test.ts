import { MemoryStore } from "../../durable/store/MemoryStore";
import { createSignalWaiterSortKey } from "../../durable/core/signalWaiters";

describe("durable: MemoryStore signals", () => {
  it("returns null when no signal waiter exists", async () => {
    const store = new MemoryStore();

    await expect(store.peekNextSignalWaiter("e1", "paid")).resolves.toBeNull();
    await expect(store.takeNextSignalWaiter("e1", "paid")).resolves.toBeNull();
  });

  it("returns null when a waiter bucket exists but no waiter can be selected", async () => {
    const store = new MemoryStore();
    const emptyBucket = {
      size: 1,
      values: function* () {},
      delete: jest.fn(),
    };

    (
      store as unknown as {
        signalWaiters: Map<string, Map<string, typeof emptyBucket>>;
      }
    ).signalWaiters = new Map([["e1", new Map([["paid", emptyBucket]])]]);

    await expect(store.peekNextSignalWaiter("e1", "paid")).resolves.toBeNull();
    await expect(store.takeNextSignalWaiter("e1", "paid")).resolves.toBeNull();
  });

  it("ignores deleteSignalWaiter() when no waiter bucket exists", async () => {
    const store = new MemoryStore();

    await expect(
      store.deleteSignalWaiter("e1", "paid", "__signal:paid"),
    ).resolves.toBeUndefined();
  });

  it("keeps other signal buckets when deleting the final waiter for one signal", async () => {
    const store = new MemoryStore();

    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "shipped",
      stepId: "__signal:shipped",
      sortKey: createSignalWaiterSortKey("shipped", "__signal:shipped"),
    });

    await store.deleteSignalWaiter("e1", "paid", "__signal:paid");

    await expect(store.takeNextSignalWaiter("e1", "paid")).resolves.toBeNull();
    await expect(store.takeNextSignalWaiter("e1", "shipped")).resolves.toEqual({
      executionId: "e1",
      signalId: "shipped",
      stepId: "__signal:shipped",
      sortKey: createSignalWaiterSortKey("shipped", "__signal:shipped"),
    });
  });

  it("removes the execution waiter bucket when deleting or taking the final waiter overall", async () => {
    const store = new MemoryStore();

    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    });
    await store.deleteSignalWaiter("e1", "paid", "__signal:paid");

    expect(
      (
        store as unknown as {
          signalWaiters: Map<string, Map<string, unknown>>;
        }
      ).signalWaiters.has("e1"),
    ).toBe(false);

    await store.upsertSignalWaiter({
      executionId: "e2",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    });

    await expect(store.takeNextSignalWaiter("e2", "paid")).resolves.toEqual({
      executionId: "e2",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    });
    expect(
      (
        store as unknown as {
          signalWaiters: Map<string, Map<string, unknown>>;
        }
      ).signalWaiters.has("e2"),
    ).toBe(false);
  });

  it("keeps the execution waiter bucket when taking the final waiter for one of multiple signals", async () => {
    const store = new MemoryStore();

    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "shipped",
      stepId: "__signal:shipped",
      sortKey: createSignalWaiterSortKey("shipped", "__signal:shipped"),
    });

    await expect(store.takeNextSignalWaiter("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    });
    expect(
      (
        store as unknown as {
          signalWaiters: Map<string, Map<string, unknown>>;
        }
      ).signalWaiters.has("e1"),
    ).toBe(true);
    await expect(store.takeNextSignalWaiter("e1", "shipped")).resolves.toEqual({
      executionId: "e1",
      signalId: "shipped",
      stepId: "__signal:shipped",
      sortKey: createSignalWaiterSortKey("shipped", "__signal:shipped"),
    });
  });

  it("stores signal history separately from the queued signal records", async () => {
    const store = new MemoryStore();
    const record = {
      id: "sig-1",
      payload: { paidAt: 1 },
      receivedAt: new Date(),
    };

    await expect(store.getSignalState("e1", "paid")).resolves.toBeNull();

    await store.appendSignalRecord("e1", "paid", record);
    await store.enqueueQueuedSignalRecord("e1", "paid", record);
    await expect(store.getSignalState("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      queued: [record],
      history: [record],
    });
  });

  it("buffers signal records atomically into history and queue", async () => {
    const store = new MemoryStore();
    const record = {
      id: "sig-1",
      payload: { paidAt: 1 },
      receivedAt: new Date(),
    };

    await store.bufferSignalRecord("e1", "paid", record);
    await expect(store.getSignalState("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      queued: [record],
      history: [record],
    });
  });

  it("consumes buffered signal records atomically with step completion", async () => {
    const store = new MemoryStore();
    const record = {
      id: "sig-1",
      payload: { paidAt: 1 },
      receivedAt: new Date(),
    };

    await store.bufferSignalRecord("e1", "paid", record);

    await expect(
      store.consumeBufferedSignalForStep({
        executionId: "e1",
        stepId: "__signal:paid",
        result: { state: "completed", payload: undefined },
        completedAt: new Date(),
      }),
    ).resolves.toEqual(record);
    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 1 },
    });
    expect((await store.getSignalState("e1", "paid"))?.queued).toEqual([]);
  });

  it("keeps duplicate queued signal records in FIFO order", async () => {
    const store = new MemoryStore();
    const queuedRecord = {
      id: "sig-1",
      payload: { paidAt: 1 },
      receivedAt: new Date(),
    };

    await store.enqueueQueuedSignalRecord("e1", "paid", queuedRecord);
    await store.enqueueQueuedSignalRecord("e1", "paid", {
      ...queuedRecord,
      id: "sig-2",
    });

    expect(await store.consumeQueuedSignalRecord("e1", "paid")).toEqual(
      expect.objectContaining({ id: "sig-1" }),
    );
    expect(await store.consumeQueuedSignalRecord("e1", "paid")).toEqual(
      expect.objectContaining({ id: "sig-2" }),
    );
  });

  it("peeks waiters without removing them and preserves sort order", async () => {
    const store = new MemoryStore();

    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:stable-paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:stable-paid"),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid:2",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid:2"),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
      timerId: "timer-1",
    });

    await store.deleteSignalWaiter("e1", "paid", "__signal:paid:2");

    await expect(store.peekNextSignalWaiter("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
      timerId: "timer-1",
    });
    await expect(store.takeNextSignalWaiter("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
      timerId: "timer-1",
    });
    await expect(store.takeNextSignalWaiter("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:stable-paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:stable-paid"),
    });
    await expect(store.takeNextSignalWaiter("e1", "paid")).resolves.toBeNull();
  });
});
