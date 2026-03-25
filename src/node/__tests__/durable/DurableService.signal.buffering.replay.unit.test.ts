import { DurableService } from "../../durable/core/DurableService";
import { waitForSignalDurably } from "../../durable/core/durable-context/DurableContext.waitForSignal";
import { ExecutionStatus } from "../../durable/core/types";
import { createSignalWaiterSortKey } from "../../durable/core/signalWaiters";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { Paid, signalSetup } from "./DurableService.signal.test.helpers";
import { SpyQueue, sleepingExecution } from "./DurableService.unit.helpers";

describe("durable: DurableService signal buffering replay", () => {
  it("replays buffered signals across service recreation and completes the waiting step", async () => {
    const { base, service } = await signalSetup({ queue: false });

    await service.signal("e1", Paid, { paidAt: 22 });
    expect(await base.getSignalState("e1", "paid")).toEqual({
      executionId: "e1",
      signalId: "paid",
      queued: [expect.objectContaining({ payload: { paidAt: 22 } })],
      history: [expect.objectContaining({ payload: { paidAt: 22 } })],
    });

    const replayedService = new DurableService({ store: base, tasks: [] });
    expect(replayedService).toBeInstanceOf(DurableService);

    await expect(
      waitForSignalDurably({
        store: base,
        executionId: "e1",
        assertCanContinue: async () => undefined,
        appendAuditEntry: async () => undefined,
        assertUniqueStepId: () => undefined,
        assertOrWarnImplicitInternalStepId: () => undefined,
        signalIndexes: new Map<string, number>(),
        signal: Paid,
      }),
    ).resolves.toEqual({ kind: "signal", payload: { paidAt: 22 } });

    expect((await base.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 22 },
    });
    expect((await base.getSignalState("e1", "paid"))?.queued).toEqual([]);
    expect((await base.getSignalState("e1", "paid"))?.history).toEqual([
      expect.objectContaining({ payload: { paidAt: 22 } }),
    ]);
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
      queued: [expect.objectContaining({ payload: { paidAt: 1 } })],
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
