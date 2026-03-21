import { DurableService } from "../../durable/core/DurableService";
import { createSignalWaiterSortKey } from "../../durable/core/signalWaiters";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { genericError } from "../../../errors";
import { Paid } from "./DurableService.signal.test.helpers";
import { sleepingExecution } from "./DurableService.unit.helpers";

describe("durable: SignalHandler error paths", () => {
  it("rethrows non-validation signal delivery failures", async () => {
    class ThrowingStore extends MemoryStore {
      override async saveStepResult(): Promise<void> {
        throw genericError.new({ message: "step-write-failed" });
      }
    }

    const store = new ThrowingStore();
    Object.defineProperty(store, "commitSignalDelivery", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const service = new DurableService({ store, tasks: [] });

    await store.saveExecution(sleepingExecution());
    await MemoryStore.prototype.saveStepResult.call(store, {
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    });

    await expect(service.signal("e1", Paid, { paidAt: 1 })).rejects.toThrow(
      "step-write-failed",
    );
  });

  it("keeps resuming after post-commit signal cleanup failures", async () => {
    class CleanupFailingStore extends MemoryStore {
      override async appendSignalRecord(): Promise<void> {
        throw genericError.new({ message: "append-failed" });
      }

      override async deleteSignalWaiter(): Promise<void> {
        throw genericError.new({ message: "waiter-delete-failed" });
      }

      override async deleteTimer(): Promise<void> {
        throw genericError.new({ message: "timer-delete-failed" });
      }
    }

    const queue = {
      enqueued: [] as Array<{ type: string; payload: { executionId: string } }>,
      enqueue: jest.fn(async (message) => {
        queue.enqueued.push({
          type: message.type,
          payload: message.payload as { executionId: string },
        });
        return "m1";
      }),
      consume: jest.fn(async () => {}),
      ack: jest.fn(async () => {}),
      nack: jest.fn(async () => {}),
    };
    const store = new CleanupFailingStore();
    const service = new DurableService({
      store,
      queue,
      tasks: [],
      polling: { enabled: false },
    });

    await store.saveExecution(sleepingExecution());
    await MemoryStore.prototype.saveStepResult.call(store, {
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting", timerId: "timeout:e1:paid" },
      completedAt: new Date(),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
      timerId: "timeout:e1:paid",
    });

    await expect(service.signal("e1", Paid, { paidAt: 2 })).resolves.toBe(
      undefined,
    );

    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 2 },
    });
    expect(queue.enqueued).toEqual([
      { type: "resume", payload: { executionId: "e1" } },
    ]);
  });

  it("uses atomic signal delivery when the store supports it", async () => {
    const commitSignalDelivery = jest.fn(async () => true);
    const store = new MemoryStore();
    const customStore = Object.create(store) as MemoryStore & {
      commitSignalDelivery: typeof commitSignalDelivery;
    };
    customStore.commitSignalDelivery = commitSignalDelivery;
    const service = new DurableService({
      store: customStore,
      tasks: [],
      polling: { enabled: false },
    });

    await store.saveExecution(sleepingExecution());
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    });

    await expect(service.signal("e1", Paid, { paidAt: 3 })).resolves.toBe(
      undefined,
    );

    expect(commitSignalDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: "e1",
        signalId: "paid",
        stepId: "__signal:paid",
      }),
    );
  });

  it("buffers the signal when atomic delivery reports a stale waiter race", async () => {
    const store = new MemoryStore();
    const customStore = Object.create(store) as MemoryStore & {
      commitSignalDelivery: jest.MockedFunction<
        NonNullable<MemoryStore["commitSignalDelivery"]>
      >;
    };
    customStore.commitSignalDelivery = jest.fn(async (_params) => {
      await store.saveStepResult({
        executionId: "e1",
        stepId: "__signal:paid",
        result: { state: "completed", payload: { paidAt: 4 } },
        completedAt: new Date(),
      });
      await store.deleteSignalWaiter("e1", "paid", "__signal:paid");
      return false;
    });

    const queue = {
      enqueued: [] as Array<{ type: string; payload: { executionId: string } }>,
      enqueue: jest.fn(async (message) => {
        queue.enqueued.push({
          type: message.type,
          payload: message.payload as { executionId: string },
        });
        return "m1";
      }),
      consume: jest.fn(async () => {}),
      ack: jest.fn(async () => {}),
      nack: jest.fn(async () => {}),
    };
    const service = new DurableService({
      store: customStore,
      queue,
      tasks: [],
      polling: { enabled: false },
    });

    await store.saveExecution(sleepingExecution());
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    });

    await expect(service.signal("e1", Paid, { paidAt: 4 })).resolves.toBe(
      undefined,
    );

    expect(customStore.commitSignalDelivery).toHaveBeenCalled();
    expect(queue.enqueued).toEqual([]);
    expect((await store.getSignalState("e1", "paid"))?.queued).toEqual([
      expect.objectContaining({
        payload: { paidAt: 4 },
      }),
    ]);
  });
});
