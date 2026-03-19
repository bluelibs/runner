import { r } from "../../..";
import { DurableService } from "../../durable/core/DurableService";
import { signalSetup, Paid } from "./DurableService.signal.test.helpers";
import {
  createBareStore,
  createTaskExecutor,
  SpyQueue,
  sleepingExecution,
} from "./DurableService.unit.helpers";
import { MemoryStore } from "../../durable/store/MemoryStore";

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

    await service.signal("e1", Paid, { paidAt: 8 });
    expect((await store.getExecution("e1"))?.status).toBe("completed");
  });

  it("signals still work when the store does not implement listStepResults()", async () => {
    const { base, queue, service } = await signalSetup({
      storeOverrides: {
        listStepResults: undefined,
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

    await service.signal("e1", Paid, { paidAt: 5 });

    expect((await base.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 5 },
    });
    expect(queue!.enqueued).toEqual([
      { type: "resume", payload: { executionId: "e1" } },
    ]);
  });

  it("cleans up base signal timeout timers without listStepResults() support", async () => {
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

    await expect(service.signal("e1", Paid, { paidAt: 2 })).rejects.toThrow(
      "Invalid signal step state",
    );
    expect(queue!.enqueued).toEqual([]);
  });

  it("signal throws on invalid base signal payloads", async () => {
    const { store, queue, service } = await signalSetup();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { paidAt: 1 },
      completedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:1",
      result: { state: "waiting" },
      completedAt: new Date(),
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
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:1",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await expect(service.signal("e1", Paid, { paidAt: 456 })).rejects.toThrow(
      "Invalid signal step state",
    );
    expect(queue!.enqueued).toEqual([]);
  });

  it("signal throws on invalid base signal payloads without listStepResults()", async () => {
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

    await expect(service.signal("e1", Paid, { paidAt: 1 })).rejects.toThrow(
      "Invalid signal step state",
    );
  });

  it("signal throws on invalid indexed signal payloads without listStepResults()", async () => {
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

    await expect(service.signal("e1", Paid, { paidAt: 2 })).rejects.toThrow(
      "Invalid signal step state",
    );
  });
});
