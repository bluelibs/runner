import { MemoryStore } from "../../../durable/store/MemoryStore";
import {
  createSignalWaiterSortKey,
  deleteSignalWaiter,
  getSignalIdFromStepId,
  upsertSignalWaiter,
  withSignalLock,
} from "../../../durable/core/signalWaiters";
import { createBareStore } from "../helpers/DurableService.unit.helpers";

describe("durable: signalWaiters helpers", () => {
  it("writes and removes waiters", async () => {
    const store = new MemoryStore();

    await expect(
      upsertSignalWaiter({
        store,
        executionId: "e1",
        signalId: "paid",
        stepId: "__signal:paid",
      }),
    ).resolves.toBeUndefined();
    await expect(store.takeNextSignalWaiter("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: "0:__signal:paid",
      timerId: undefined,
    });

    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: "0:__signal:paid",
    });
    await expect(
      deleteSignalWaiter({
        store,
        executionId: "e1",
        signalId: "paid",
        stepId: "__signal:paid:missing",
      }),
    ).resolves.toBeUndefined();
    await expect(
      deleteSignalWaiter({
        store,
        executionId: "e1",
        signalId: "paid",
        stepId: "__signal:paid",
      }),
    ).resolves.toBeUndefined();
    await expect(store.takeNextSignalWaiter("e1", "paid")).resolves.toBeNull();
  });

  it("extracts signal ids only from namespaced step ids", () => {
    expect(getSignalIdFromStepId("paid")).toBeNull();
    expect(getSignalIdFromStepId("__signal:")).toBeNull();
    expect(getSignalIdFromStepId("__signal:paid")).toBe("paid");
    expect(getSignalIdFromStepId("__signal:paid:1")).toBe("paid");
    expect(getSignalIdFromStepId("__signal:order:paid")).toBe("order:paid");
    expect(getSignalIdFromStepId("__signal:order:paid:2")).toBe("order:paid");
  });

  it("ranks base, indexed, and custom waiter slots deterministically", () => {
    expect(createSignalWaiterSortKey("paid", "__signal:paid")).toBe(
      "0:__signal:paid",
    );
    expect(createSignalWaiterSortKey("paid", "__signal:paid:2")).toBe(
      "1:0000000000000002:__signal:paid:2",
    );
    expect(createSignalWaiterSortKey("paid", "__signal:paid:foo")).toBe(
      "2:__signal:paid:foo",
    );
  });

  it("runs the callback directly when lock support is absent", async () => {
    const base = new MemoryStore();
    const store = createBareStore(base);

    await expect(
      withSignalLock({
        store,
        executionId: "e1",
        signalId: "paid",
        fn: async () => "ok",
      }),
    ).resolves.toBe("ok");
  });

  it("fails fast when a signal lock cannot be acquired", async () => {
    const base = new MemoryStore();
    const store = createBareStore(base, {
      acquireLock: async () => null,
      releaseLock: async () => {},
    });

    await expect(
      withSignalLock({
        store,
        executionId: "e1",
        signalId: "paid",
        fn: async () => "ok",
      }),
    ).rejects.toThrow("Failed to acquire signal lock");
  });
});
