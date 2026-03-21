import {
  signalSetup,
  Paid,
  Timed,
  X,
} from "./DurableService.signal.test.helpers";
import { DurableService } from "../../durable/core/DurableService";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { ExecutionStatus } from "../../durable/core/types";
import { SpyQueue, sleepingExecution } from "./DurableService.unit.helpers";
import { createSignalWaiterSortKey } from "../../durable/core/signalWaiters";

describe("durable: DurableService - signals buffering and audit", () => {
  it("signal retains the first payload in history and the queued signal list before the workflow waits", async () => {
    const { store, queue, service } = await signalSetup();

    await service.signal("e1", Paid, { paidAt: 1 });

    expect(await store.getStepResult("e1", "__signal:paid")).toBeNull();
    await expect(store.getSignalState!("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      queued: [
        expect.objectContaining({
          payload: { paidAt: 1 },
        }),
      ],
      history: [expect.objectContaining({ payload: { paidAt: 1 } })],
    });
    expect(queue!.enqueued).toEqual([]);
  });

  it("signal ignores missing and terminal executions", async () => {
    const { store, queue, service } = await signalSetup();

    await expect(service.signal("missing", X, 1)).resolves.toBeUndefined();
    expect(await store.getStepResult("missing", "__signal:x")).toBeNull();
    await expect(store.getSignalState!("missing", "x")).resolves.toBeNull();
    expect(queue!.enqueued.length).toBe(0);

    await store.saveExecution({
      id: "done",
      taskId: "t",
      input: undefined,
      status: "completed",
      result: "ok",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "done",
      stepId: "__signal:x",
      result: { state: "waiting" },
      completedAt: new Date(),
    });
    await service.signal("done", X, 1);
    expect((await store.getStepResult("done", "__signal:x"))?.result).toEqual({
      state: "waiting",
    });
    await expect(store.getSignalState!("done", "x")).resolves.toBeNull();

    await store.saveExecution({
      id: "failed",
      taskId: "t",
      input: undefined,
      status: "failed",
      error: { message: "err" },
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "failed",
      stepId: "__signal:x",
      result: { state: "waiting" },
      completedAt: new Date(),
    });
    await service.signal("failed", X, 1);
    expect((await store.getStepResult("failed", "__signal:x"))?.result).toEqual(
      { state: "waiting" },
    );
    await expect(store.getSignalState!("failed", "x")).resolves.toBeNull();

    expect(queue!.enqueued.length).toBe(0);
  });

  it("signal retains duplicate arrivals in history and queues each copy", async () => {
    const { store, queue, service } = await signalSetup();

    await service.signal("e1", Paid, { paidAt: 2 });
    await service.signal("e1", Paid, { paidAt: 2 });

    expect(await store.getStepResult("e1", "__signal:paid")).toBeNull();
    expect(await store.getStepResult("e1", "__signal:paid:1")).toBeNull();
    await expect(store.getSignalState!("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      queued: [
        expect.objectContaining({
          payload: { paidAt: 2 },
        }),
        expect.objectContaining({
          payload: { paidAt: 2 },
        }),
      ],
      history: [
        expect.objectContaining({ payload: { paidAt: 2 } }),
        expect.objectContaining({ payload: { paidAt: 2 } }),
      ],
    });

    expect(await store.consumeQueuedSignalRecord("e1", "paid")).toEqual(
      expect.objectContaining({ payload: { paidAt: 2 } }),
    );
    expect(await store.consumeQueuedSignalRecord("e1", "paid")).toEqual(
      expect.objectContaining({ payload: { paidAt: 2 } }),
    );
    expect(queue!.enqueued.length).toBe(0);
  });

  it("signal does not overwrite completed or timed out signal steps", async () => {
    const { store, service } = await signalSetup({ queue: false });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "completed" },
      completedAt: new Date(),
    });
    await service.signal("e1", Paid, { paidAt: 123 });
    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
    });
    await expect(store.getSignalState!("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      queued: [
        expect.objectContaining({
          payload: { paidAt: 123 },
        }),
      ],
      history: [expect.objectContaining({ payload: { paidAt: 123 } })],
    });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:timed",
      result: { state: "timed_out" },
      completedAt: new Date(),
    });
    await service.signal("e1", Timed, { paidAt: 123 });
    expect((await store.getStepResult("e1", "__signal:timed"))?.result).toEqual(
      { state: "timed_out" },
    );
    await expect(store.getSignalState!("e1", "timed")).resolves.toEqual({
      executionId: "e1",
      signalId: "timed",
      queued: [
        expect.objectContaining({
          payload: { paidAt: 123 },
        }),
      ],
      history: [expect.objectContaining({ payload: { paidAt: 123 } })],
    });
  });

  it("signal completes indexed waits and deletes any timeout timer", async () => {
    const { store, queue, service } = await signalSetup();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "completed", payload: { paidAt: 1 } },
      completedAt: new Date(),
    });

    await store.createTimer({
      id: "t1",
      executionId: "e1",
      stepId: "__signal:paid:1",
      type: "signal_timeout",
      fireAt: new Date(Date.now() + 1000),
      status: "pending",
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:1",
      result: { state: "waiting", timerId: "t1" },
      completedAt: new Date(),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid:1",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid:1"),
      timerId: "t1",
    });

    await service.signal("e1", Paid, { paidAt: 2 });

    expect(
      (await store.getStepResult("e1", "__signal:paid:1"))?.result,
    ).toEqual({ state: "completed", payload: { paidAt: 2 } });
    const timers = await store.getReadyTimers(new Date(Date.now() + 60_000));
    expect(timers.some((t) => t.id === "t1")).toBe(false);
    expect(queue!.enqueued).toEqual([
      { type: "resume", payload: { executionId: "e1" } },
    ]);
  });

  it("signal buffers indexed waits without a timeout timer when no waiter index exists", async () => {
    const { base, queue, service } = await signalSetup({
      storeOverrides: {
        claimTimer: undefined,
      },
    });

    await base.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "completed", payload: { paidAt: 1 } },
      completedAt: new Date(),
    });
    await base.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:1",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 2 });

    expect((await base.getStepResult("e1", "__signal:paid:1"))?.result).toEqual(
      { state: "waiting" },
    );
    expect(queue!.enqueued).toEqual([]);
    await expect(base.getSignalState("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      queued: [expect.objectContaining({ payload: { paidAt: 2 } })],
      history: [expect.objectContaining({ payload: { paidAt: 2 } })],
    });
  });

  it("signal journals payloads when indexed signal slots are already consumed without a waiter", async () => {
    class InfiniteSignalStore extends MemoryStore {
      override async getStepResult(executionId: string, stepId: string) {
        if (stepId.startsWith("__signal:paid:")) {
          return {
            executionId,
            stepId,
            result: { state: "completed" },
            completedAt: new Date(),
          };
        }
        return await super.getStepResult(executionId, stepId);
      }
    }

    const store = new InfiniteSignalStore();
    const service = new DurableService({ store, tasks: [] });

    await store.saveExecution(sleepingExecution());
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "completed" },
      completedAt: new Date(),
    });

    await expect(
      service.signal("e1", Paid, { paidAt: 1 }),
    ).resolves.toBeUndefined();
    await expect(store.getSignalState!("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      queued: [
        expect.objectContaining({
          payload: { paidAt: 1 },
        }),
      ],
      history: [expect.objectContaining({ payload: { paidAt: 1 } })],
    });
  });

  it("signal does not resume when the execution becomes terminal after delivery", async () => {
    class TerminalAfterDeliveryStore extends MemoryStore {
      private reads = 0;

      override async getExecution(executionId: string) {
        const execution = await super.getExecution(executionId);
        if (!execution) return null;

        this.reads += 1;
        if (this.reads === 1) return execution;

        return {
          ...execution,
          status: ExecutionStatus.Completed,
          completedAt: new Date(),
        };
      }
    }

    const store = new TerminalAfterDeliveryStore();
    const queue = new SpyQueue();
    const service = new DurableService({ store, queue, tasks: [] });

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

    await service.signal("e1", Paid, { paidAt: 1 });

    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 1 },
    });
    expect(queue.enqueued).toEqual([]);
  });

  it("signal does not resume when the execution disappears after delivery", async () => {
    class MissingAfterDeliveryStore extends MemoryStore {
      private reads = 0;

      override async getExecution(executionId: string) {
        const execution = await super.getExecution(executionId);
        if (!execution) return null;

        this.reads += 1;
        if (this.reads === 1) return execution;
        return null;
      }
    }

    const store = new MissingAfterDeliveryStore();
    const queue = new SpyQueue();
    const service = new DurableService({ store, queue, tasks: [] });

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

    await service.signal("e1", Paid, { paidAt: 2 });

    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 2 },
    });
    expect(queue.enqueued).toEqual([]);
  });
});
