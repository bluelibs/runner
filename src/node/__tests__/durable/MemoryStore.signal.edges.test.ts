import { MemoryStore } from "../../durable/store/MemoryStore";
import { createSignalWaiterSortKey } from "../../durable/core/signalWaiters";

interface MockSignalStore {
  signalWaiters: { get: jest.Mock };
  takeNextSignalWaiter(executionId: string, signalId: string): Promise<unknown>;
}

describe("durable: MemoryStore signal edges", () => {
  it("returns null when consuming from an already-drained queued signal bucket", async () => {
    const store = new MemoryStore();
    const record = {
      id: "sig-1",
      payload: { paidAt: 1 },
      receivedAt: new Date(),
    };

    await store.enqueueQueuedSignalRecord("e1", "paid", record);

    await expect(
      store.consumeQueuedSignalRecord("e1", "paid"),
    ).resolves.toEqual(record);
    await expect(
      store.consumeQueuedSignalRecord("e1", "paid"),
    ).resolves.toBeNull();
  });

  it("throws when buffered step completion cannot resolve a signal id", async () => {
    const store = new MemoryStore();

    await expect(
      store.consumeBufferedSignalForStep({
        executionId: "e1",
        stepId: "manual-step",
        result: { state: "completed" },
        completedAt: new Date(),
      }),
    ).rejects.toThrow("Unable to resolve signal id");
  });

  it("preserves non-object step results when consuming buffered signals directly", async () => {
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
        result: "completed",
        completedAt: new Date(),
      }),
    ).resolves.toEqual(record);
    await expect(store.getStepResult("e1", "__signal:paid")).resolves.toEqual(
      expect.objectContaining({
        result: "completed",
      }),
    );
  });

  it("returns null when waiter lookup changes between peek and delete phases", async () => {
    const store = new MemoryStore() as unknown as MockSignalStore;
    const waiter = {
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    };
    const signalWaiters = new Map([[waiter.stepId, waiter]]);
    const executionWaiters = {
      get: jest
        .fn()
        .mockReturnValueOnce(signalWaiters)
        .mockReturnValueOnce(undefined),
    };

    store.signalWaiters = {
      get: jest.fn(() => executionWaiters),
    };

    await expect(store.takeNextSignalWaiter("e1", "paid")).resolves.toBeNull();
  });
});
