import { event, r } from "../../..";
import { DurableService } from "../../durable/core/DurableService";
import { MemoryStore } from "../../durable/store/MemoryStore";
import {
  createTaskExecutor,
  createBareStore,
  SpyQueue,
  sleepingExecution,
} from "./DurableService.unit.helpers";

// Shared events used across signal tests
const Paid = event<{ paidAt: number }>({ id: "paid" });
const Timed = event<{ paidAt: number }>({ id: "timed" });
const X = event<any>({ id: "x" });

// ---------------------------------------------------------------------------
// Helper: create a signal-test service with a sleeping execution
// ---------------------------------------------------------------------------

async function signalSetup(opts?: {
  queue?: boolean;
  audit?: boolean;
  executionId?: string;
  executionOverrides?: Record<string, unknown>;
  storeOverrides?: Record<string, unknown>;
}) {
  const base = new MemoryStore();
  const queue = opts?.queue !== false ? new SpyQueue() : undefined;
  const store = opts?.storeOverrides
    ? createBareStore(base, opts.storeOverrides as any)
    : base;

  const service = new DurableService({
    store,
    queue,
    tasks: [],
    ...(opts?.audit ? { audit: { enabled: true } } : {}),
  });

  const execId = opts?.executionId ?? "e1";
  await base.saveExecution(
    sleepingExecution({ id: execId, ...opts?.executionOverrides } as any),
  );

  return { base, store, queue, service, execId };
}

describe("durable: DurableService — signals (unit)", () => {
  it("signals enqueue resume messages when a queue is configured", async () => {
    const { store, queue, service } = await signalSetup();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 1 });
    expect(queue!.enqueued).toEqual([
      { type: "resume", payload: { executionId: "e1" } },
    ]);
    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 1 },
    });
  });

  it("signals work without listStepResults() support (fallback scan path)", async () => {
    const base = new MemoryStore();
    const queue = new SpyQueue();

    const service = new DurableService({
      store: createBareStore(base),
      queue,
      tasks: [],
    });

    await base.saveExecution(sleepingExecution());
    await base.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 42 });

    expect((await base.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 42 },
    });
    expect(queue.enqueued).toEqual([
      { type: "resume", payload: { executionId: "e1" } },
    ]);
  });

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

  it("accepts typed signal ids in signal()", async () => {
    const { store, service } = await signalSetup({ queue: false });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 1 });

    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 1 },
    });
  });

  it("delivers signals to waiting steps created with explicit step ids", async () => {
    const { store, queue, service } = await signalSetup();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:stable-paid",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 123 });

    expect(
      (await store.getStepResult("e1", "__signal:stable-paid"))?.result,
    ).toEqual({ state: "completed", payload: { paidAt: 123 } });
    expect(await store.getStepResult("e1", "__signal:paid")).toBeNull();
    expect(queue!.enqueued).toEqual([
      { type: "resume", payload: { executionId: "e1" } },
    ]);
  });

  it("prefers the base signal slot over custom step id waiters", async () => {
    const { store, service } = await signalSetup();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:stable-paid",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 1 });

    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 1 },
    });
    expect(
      (await store.getStepResult("e1", "__signal:stable-paid"))?.result,
    ).toEqual(expect.objectContaining({ state: "waiting" }));
  });

  it("prefers numeric slots over custom step id waiters when no base slot is waiting", async () => {
    const { store, service } = await signalSetup();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:2",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:stable-paid",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 2 });

    expect(
      (await store.getStepResult("e1", "__signal:paid:2"))?.result,
    ).toEqual({ state: "completed", payload: { paidAt: 2 } });
    expect(
      (await store.getStepResult("e1", "__signal:stable-paid"))?.result,
    ).toEqual(expect.objectContaining({ state: "waiting" }));
  });

  it("orders numeric signal slots by ascending index", async () => {
    const { store, service } = await signalSetup();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:10",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:2",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 2 });

    expect(
      (await store.getStepResult("e1", "__signal:paid:2"))?.result,
    ).toEqual({ state: "completed", payload: { paidAt: 2 } });
    expect(
      (await store.getStepResult("e1", "__signal:paid:10"))?.result,
    ).toEqual(expect.objectContaining({ state: "waiting" }));
  });

  it("keeps the current best waiter when later numeric slots are worse", async () => {
    const { store, service } = await signalSetup();

    await store.createTimer({
      id: "signal_timeout:e1:__signal:paid:1",
      executionId: "e1",
      stepId: "__signal:paid:1",
      type: "signal_timeout",
      fireAt: new Date(0),
      status: "pending",
    });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:1",
      result: {
        state: "waiting",
        signalId: "paid",
        timerId: "signal_timeout:e1:__signal:paid:1",
      },
      completedAt: new Date(1),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid:10",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(2),
    });

    await service.signal("e1", Paid, { paidAt: 101 });

    expect(
      (await store.getStepResult("e1", "__signal:paid:1"))?.result,
    ).toEqual({ state: "completed", payload: { paidAt: 101 } });
    expect(
      (await store.getStepResult("e1", "__signal:paid:10"))?.result,
    ).toEqual(expect.objectContaining({ state: "waiting" }));
  });

  it("orders custom signal slots deterministically when no numeric slots exist", async () => {
    const { store, service } = await signalSetup();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:bbb",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:aaa",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 6 });

    expect((await store.getStepResult("e1", "__signal:aaa"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 6 },
    });
    expect((await store.getStepResult("e1", "__signal:bbb"))?.result).toEqual(
      expect.objectContaining({ state: "waiting" }),
    );
  });

  it("cleans up signal timeout timers when delivering a waiting signal", async () => {
    const { store, service } = await signalSetup();

    await store.createTimer({
      id: "signal_timeout:e1:__signal:paid",
      executionId: "e1",
      stepId: "__signal:paid",
      type: "signal_timeout",
      fireAt: new Date(0),
      status: "pending",
    });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: {
        state: "waiting",
        signalId: "paid",
        timerId: "signal_timeout:e1:__signal:paid",
      },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 3 });

    const timers = await store.getReadyTimers(new Date(0));
    expect(timers.some((t) => t.id === "signal_timeout:e1:__signal:paid")).toBe(
      false,
    );
  });

  it("ignores waiting signal steps with invalid timerId types", async () => {
    const { store, service } = await signalSetup();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:stable-paid",
      result: { state: "waiting", signalId: "paid", timerId: 123 },
      completedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await service.signal("e1", Paid, { paidAt: 9 });

    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 9 },
    });
  });

  it("records signal delivery but does not resume when the execution is missing", async () => {
    const store = new MemoryStore();
    const queue = new SpyQueue();
    const service = new DurableService({
      store,
      queue,
      audit: { enabled: true },
      tasks: [],
    });

    await store.saveStepResult({
      executionId: "missing",
      stepId: "__signal:stable-paid",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });

    await service.signal("missing", Paid, { paidAt: 4 });

    expect(
      (await store.getStepResult("missing", "__signal:stable-paid"))?.result,
    ).toEqual({ state: "completed", payload: { paidAt: 4 } });
    expect(queue.enqueued.length).toBe(0);
  });

  it("does not resume terminal executions when delivering via listStepResults()", async () => {
    const store = new MemoryStore();
    const queue = new SpyQueue();
    const service = new DurableService({
      store,
      queue,
      audit: { enabled: true },
      tasks: [],
    });

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
      stepId: "__signal:stable-paid",
      result: { state: "waiting", signalId: "paid" },
      completedAt: new Date(),
    });

    await service.signal("done", Paid, { paidAt: 7 });

    expect(queue.enqueued.length).toBe(0);
    expect(
      (await store.getStepResult("done", "__signal:stable-paid"))?.result,
    ).toEqual({ state: "completed", payload: { paidAt: 7 } });
  });

  it("processes executions directly when no queue is configured (signal resume)", async () => {
    const store = new MemoryStore();
    const task = r
      .task("t.signal.process")
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
    expect(queue.enqueued).toEqual([
      { type: "resume", payload: { executionId: "e1" } },
    ]);
  });

  it("signal returns early for missing executions and terminal states", async () => {
    const store = new MemoryStore();
    const queue = new SpyQueue();
    const service = new DurableService({ store, queue, tasks: [] });

    // missing execution — still delivers step result
    await store.saveStepResult({
      executionId: "missing",
      stepId: "__signal:x",
      result: { state: "waiting" },
      completedAt: new Date(),
    });
    await expect(service.signal("missing", X, 1)).resolves.toBeUndefined();
    expect(queue.enqueued.length).toBe(0);
    expect(
      (await store.getStepResult("missing", "__signal:x"))?.result,
    ).toEqual({ state: "completed", payload: 1 });

    // completed execution — no resume
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

    // failed execution — no resume
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

    expect(queue.enqueued.length).toBe(0);
  });

  it("signal records audit entries when audit is enabled", async () => {
    const { store, service } = await signalSetup({
      queue: false,
      audit: true,
    });

    await service.signal("e1", Paid, { paidAt: 1 });

    const entries = await (store as MemoryStore).listAuditEntries("e1");
    expect(entries.some((entry) => entry.kind === "signal_delivered")).toBe(
      true,
    );
  });

  it("signal audits missing executions with a default attempt", async () => {
    const store = new MemoryStore();
    const service = new DurableService({
      store,
      tasks: [],
      audit: { enabled: true },
    });

    await store.saveStepResult({
      executionId: "missing",
      stepId: "__signal:x",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await service.signal("missing", X, { ok: true });

    const entries = await store.listAuditEntries("missing");
    expect(entries[0]?.attempt).toBe(0);
    expect(entries[0]?.taskId).toBeUndefined();
  });

  it("signal buffers payload into the next slot when the base signal is already completed or timed out", async () => {
    const { store, queue, service } = await signalSetup();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:paid",
      result: { state: "completed", payload: { paidAt: 1 } },
      completedAt: new Date(),
    });
    await service.signal("e1", Paid, { paidAt: 2 });

    expect((await store.getStepResult("e1", "__signal:paid"))?.result).toEqual({
      state: "completed",
      payload: { paidAt: 1 },
    });
    expect(
      (await store.getStepResult("e1", "__signal:paid:1"))?.result,
    ).toEqual({ state: "completed", payload: { paidAt: 2 } });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:timed",
      result: { state: "timed_out" },
      completedAt: new Date(),
    });
    await service.signal("e1", Timed, { paidAt: 2 });
    expect((await store.getStepResult("e1", "__signal:timed"))?.result).toEqual(
      { state: "timed_out" },
    );
    expect(
      (await store.getStepResult("e1", "__signal:timed:1"))?.result,
    ).toEqual({ state: "completed", payload: { paidAt: 2 } });

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

  it("signal throws if too many indexed signal slots exist", async () => {
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

    await expect(service.signal("e1", Paid, { paidAt: 1 })).rejects.toThrow(
      "Too many signal slots",
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
});
