import { defineEvent, Match, r } from "../../..";
import { DurableService } from "../../durable/core/DurableService";
import { signalSetup, Paid } from "./DurableService.signal.test.helpers";
import {
  createBareStore,
  createTaskExecutor,
  SpyQueue,
  sleepingExecution,
} from "./DurableService.unit.helpers";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { durableWorkflowTag } from "../../durable/tags/durableWorkflow.tag";
import { createSignalWaiterSortKey } from "../../durable/core/signalWaiters";

const Other = defineEvent<{ ok: true }>({ id: "other" });
const StrictPaid = defineEvent({
  id: "strict-paid",
  payloadSchema: Match.compile({ paidAt: Number }),
});
const WeirdPaid = defineEvent({
  id: "weird-paid",
  payloadSchema: {
    parse: () => {
      throw "boom";
    },
  },
});
const ErrorPaid = defineEvent({
  id: "error-paid",
  payloadSchema: {
    parse: () => {
      throw new Error("kaboom");
    },
  },
});

describe("durable: DurableService - signals invalid state and direct resume", () => {
  it("throws when signal() cannot acquire the signal lock", async () => {
    const base = new MemoryStore();

    const service = new DurableService({
      store: createBareStore(base, {
        listStepResults: base.listStepResults.bind(base),
        acquireLock: async () => null,
        releaseLock: async () => {},
      }),
      tasks: [],
    });

    await expect(service.signal("e1", Paid, { paidAt: 1 })).rejects.toThrow(
      "signal lock",
    );
  });

  it("processes executions directly when no queue is configured (signal resume)", async () => {
    const store = new MemoryStore();
    const task = r
      .task("t-signal-process")
      .run(async () => "ok")
      .build();

    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({ [task.id]: async () => "ok" }),
      tasks: [task],
      execution: { maxAttempts: 1 },
    });

    await store.saveExecution(sleepingExecution({ taskId: task.id }));
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

    await service.signal("e1", Paid, { paidAt: 8 });
    expect((await store.getExecution("e1"))?.status).toBe("completed");
  });

  it("throws when signal() uses an undeclared workflow signal", async () => {
    const task = r
      .task("t-signal-declared-only")
      .tags([durableWorkflowTag.with({ category: "orders", signals: [Paid] })])
      .run(async () => "ok")
      .build();

    const store = new MemoryStore();
    const service = new DurableService({
      store,
      taskExecutor: createTaskExecutor({ [task.id]: async () => "ok" }),
      tasks: [task],
      execution: { maxAttempts: 1 },
    });

    await store.saveExecution(sleepingExecution({ taskId: task.id }));

    await expect(service.signal("e1", Other, { ok: true })).rejects.toThrow(
      "not declared in durableWorkflow.signals",
    );
  });

  it("throws when signal() finds a waiter but the waiting step disappeared", async () => {
    const { store, service } = await signalSetup();

    await store.upsertSignalWaiter?.({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    });

    await expect(service.signal("e1", Paid, { paidAt: 1 })).rejects.toThrow(
      "Invalid signal step state",
    );
  });

  it("throws when signal() finds a waiter whose state points at a different signal", async () => {
    const { store, service } = await signalSetup();

    await store.upsertSignalWaiter?.({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting", signalId: "other" },
      completedAt: new Date(),
    });

    await expect(service.signal("e1", Paid, { paidAt: 1 })).rejects.toThrow(
      "Invalid signal step state",
    );
  });

  it("buffers signals for waiting steps that were persisted without a waiter index", async () => {
    const { store, service } = await signalSetup();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting", signalId: "other" },
      completedAt: new Date(),
    });

    await expect(
      service.signal("e1", Paid, { paidAt: 1 }),
    ).resolves.toBeUndefined();
    await expect(store.getSignalState("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      queued: [expect.objectContaining({ payload: { paidAt: 1 } })],
      history: [expect.objectContaining({ payload: { paidAt: 1 } })],
    });
  });

  it("throws when signal() finds an indexed waiter with a non-waiting step state", async () => {
    const { store, service } = await signalSetup();

    await store.upsertSignalWaiter?.({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "completed" },
      completedAt: new Date(),
    });

    await expect(service.signal("e1", Paid, { paidAt: 2 })).rejects.toThrow(
      "Invalid signal waiter state",
    );
  });

  it("throws when signal() finds an indexed waiter with an unparseable step state", async () => {
    const { store, service } = await signalSetup();

    await store.upsertSignalWaiter?.({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: 123,
      completedAt: new Date(),
    });

    await expect(service.signal("e1", Paid, { paidAt: 3 })).rejects.toThrow(
      "Invalid signal step state",
    );
  });

  it("throws when signal() payload does not satisfy payloadSchema", async () => {
    const { store, service } = await signalSetup({ queue: false });

    await expect(
      service.signal("e1", StrictPaid, { paidAt: "nope" } as never),
    ).rejects.toThrow();
    expect(await store.getSignalState!("e1", "strict-paid")).toBeNull();
  });

  it("wraps non-Error payloadSchema failures during signal() validation", async () => {
    const { store, service } = await signalSetup({ queue: false });

    await expect(
      service.signal("e1", WeirdPaid, undefined as never),
    ).rejects.toThrow("Signal payload validation failed for weird-paid: boom");
    expect(await store.getSignalState!("e1", "weird-paid")).toBeNull();
  });

  it("wraps Error payloadSchema failures during signal() validation", async () => {
    const { store, service } = await signalSetup({ queue: false });

    await expect(
      service.signal("e1", ErrorPaid, undefined as never),
    ).rejects.toThrow(
      "Signal payload validation failed for error-paid: kaboom",
    );
    expect(await store.getSignalState!("e1", "error-paid")).toBeNull();
  });

  it("signals still work when timer claiming is unavailable", async () => {
    const { base, queue, service } = await signalSetup({
      storeOverrides: {
        claimTimer: undefined,
      },
    });

    await base.saveExecution(sleepingExecution());
    await base.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });
    await base.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    });

    await service.signal("e1", Paid, { paidAt: 5 });

    expect((await base.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 5 },
    });
    expect(queue!.enqueued).toEqual([
      { type: "resume", payload: { executionId: "e1" } },
    ]);
  });

  it("cleans up base signal timeout timers", async () => {
    const base = new MemoryStore();
    const queue = new SpyQueue();
    const service = new DurableService({
      store: createBareStore(base, {
        claimTimer: base.claimTimer.bind(base),
      }),
      queue,
      tasks: [],
    });

    await base.saveExecution(sleepingExecution());
    await base.createTimer({
      id: "signal_timeout:e1:__signal:paid",
      executionId: "e1",
      stepId: "__signal:paid",
      type: "signal_timeout",
      fireAt: new Date(0),
      status: "pending",
    });
    await base.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: {
        state: "waiting",
        timerId: "signal_timeout:e1:__signal:paid",
      },
      completedAt: new Date(),
    });
    await base.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
      timerId: "signal_timeout:e1:__signal:paid",
    });

    await service.signal("e1", Paid, { paidAt: 3 });

    const timers = await base.getReadyTimers(new Date(0));
    expect(timers.some((t) => t.id === "signal_timeout:e1:__signal:paid")).toBe(
      false,
    );
  });

  it("signal throws on invalid signal step state payloads", async () => {
    const { store, queue, service } = await signalSetup();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "completed", payload: { paidAt: 1 } },
      completedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:1",
      result: { state: "unknown" },
      completedAt: new Date(),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid:1",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid:1"),
    });

    await expect(service.signal("e1", Paid, { paidAt: 2 })).rejects.toThrow(
      "Invalid signal step state",
    );
    expect(queue!.enqueued).toEqual([]);
  });

  it("signal throws when a matching waiting signal step carries a different signalId", async () => {
    const { store, service } = await signalSetup();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:1",
      result: { state: "waiting", signalId: "other" },
      completedAt: new Date(),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid:1",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid:1"),
    });

    await expect(service.signal("e1", Paid, { paidAt: 2 })).rejects.toThrow(
      "Invalid signal step state",
    );
  });

  it("signal throws on invalid base signal payloads", async () => {
    const { store, queue, service } = await signalSetup();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { paidAt: 1 },
      completedAt: new Date(),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:1",
      result: { state: "waiting" },
      completedAt: new Date(),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid:1",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid:1"),
    });

    await expect(service.signal("e1", Paid, { paidAt: 2 })).rejects.toThrow(
      "Invalid signal step state",
    );
    expect(queue!.enqueued).toEqual([]);
  });

  it("signal throws on invalid base signal primitive payloads", async () => {
    const { store, queue, service } = await signalSetup();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: 123,
      completedAt: new Date(),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:1",
      result: { state: "waiting" },
      completedAt: new Date(),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid:1",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid:1"),
    });

    await expect(service.signal("e1", Paid, { paidAt: 456 })).rejects.toThrow(
      "Invalid signal step state",
    );
    expect(queue!.enqueued).toEqual([]);
  });

  it("buffers when invalid base signal payloads were persisted without a waiter index", async () => {
    const base = new MemoryStore();
    const service = new DurableService({
      store: createBareStore(base, {
        claimTimer: base.claimTimer.bind(base),
      }),
      tasks: [],
    });

    await base.saveExecution(sleepingExecution());
    await base.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: 123,
      completedAt: new Date(),
    });

    await expect(
      service.signal("e1", Paid, { paidAt: 1 }),
    ).resolves.toBeUndefined();
    await expect(base.getSignalState("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      queued: [expect.objectContaining({ payload: { paidAt: 1 } })],
      history: [expect.objectContaining({ payload: { paidAt: 1 } })],
    });
  });

  it("signal buffers indexed payloads when no waiter index exists", async () => {
    const base = new MemoryStore();
    const service = new DurableService({
      store: createBareStore(base, {
        claimTimer: base.claimTimer.bind(base),
      }),
      tasks: [],
    });

    await base.saveExecution(sleepingExecution());
    await base.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "completed", payload: { paidAt: 1 } },
      completedAt: new Date(),
    });
    await base.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:1",
      result: { state: "unknown" },
      completedAt: new Date(),
    });

    await expect(
      service.signal("e1", Paid, { paidAt: 2 }),
    ).resolves.toBeUndefined();
    await expect(base.getSignalState("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      queued: [expect.objectContaining({ payload: { paidAt: 2 } })],
      history: [expect.objectContaining({ payload: { paidAt: 2 } })],
    });
  });

  it("queues signals when no waiter exists and legacy waiter scanning finds nothing", async () => {
    const base = new MemoryStore();
    const queue = new SpyQueue();
    const service = new DurableService({
      store: createBareStore(base, {
        claimTimer: base.claimTimer.bind(base),
      }),
      queue,
      tasks: [],
    });

    await base.saveExecution(sleepingExecution());
    await service.signal("e1", Paid, { paidAt: 9 });

    expect(await base.getSignalState!("e1", "paid")).toEqual(
      expect.objectContaining({
        executionId: "e1",
        signalId: "paid",
        history: [
          expect.objectContaining({
            payload: { paidAt: 9 },
            receivedAt: expect.any(Date),
          }),
        ],
        queued: [
          expect.objectContaining({
            payload: { paidAt: 9 },
          }),
        ],
      }),
    );
    expect(queue.enqueued).toEqual([]);
  });

  it("does not try to delete timeout timers when the matched waiter has no timer id", async () => {
    const store = new MemoryStore();
    const queue = new SpyQueue();
    const deleteTimerSpy = jest.spyOn(store, "deleteTimer");
    const service = new DurableService({
      store,
      queue,
      tasks: [],
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

    await service.signal("e1", Paid, { paidAt: 11 });

    expect(deleteTimerSpy).not.toHaveBeenCalled();
    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 11 },
    });
  });
});
