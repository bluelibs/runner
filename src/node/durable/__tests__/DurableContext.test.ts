import { event } from "../../..";
import { MemoryEventBus } from "../bus/MemoryEventBus";
import { DurableContext } from "../core/DurableContext";
import type { DurableAuditEmitter } from "../core/audit";
import { createDurableStepId } from "../core/ids";
import { SuspensionSignal } from "../core/interfaces/context";
import type { IDurableStore } from "../core/interfaces/store";
import { MemoryStore } from "../store/MemoryStore";

describe("durable: DurableContext", () => {
  const Paid = event<{ paidAt: number }>({ id: "durable.tests.paid" });
  const createContext = (
    executionId = "e1",
    attempt = 1,
    store: IDurableStore = new MemoryStore(),
    options: {
      auditEnabled?: boolean;
      auditEmitter?: DurableAuditEmitter;
      implicitInternalStepIds?: "allow" | "warn" | "error";
    } = {},
  ) => {
    const bus = new MemoryEventBus();
    const ctx = new DurableContext(store, bus, executionId, attempt, options);
    return { store, bus, ctx };
  };

  it("supports explicit compensation via rollback()", async () => {
    const { ctx } = createContext();

    const actions: string[] = [];

    await ctx
      .step<string>("create")
      .up(async () => {
        actions.push("up");
        return "ok";
      })
      .down(async () => {
        actions.push("down");
      });

    await ctx.rollback();

    expect(actions).toEqual(["up", "down"]);
  });

  it("rethrows SuspensionSignal from rollback()", async () => {
    const { ctx } = createContext();

    await ctx
      .step<string>("create")
      .up(async () => "ok")
      .down(async () => {
        throw new SuspensionSignal("yield");
      });

    await expect(ctx.rollback()).rejects.toBeInstanceOf(SuspensionSignal);
  });

  it("marks compensation_failed even when a non-Error is thrown", async () => {
    const { store, ctx } = createContext();

    await store.saveExecution({
      id: "e1",
      taskId: "t",
      input: undefined,
      status: "running",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await ctx
      .step<string>("create")
      .up(async () => "ok")
      .down(async () => {
        throw "boom";
      });

    await expect(ctx.rollback()).rejects.toThrow("Compensation failed");
    expect((await store.getExecution("e1"))?.status).toBe(
      "compensation_failed",
    );
    expect((await store.getExecution("e1"))?.error?.stack).toBeUndefined();
  });

  it("creates a deterministic sleep step and suspends", async () => {
    const { store, ctx } = createContext();

    await expect(ctx.sleep(1)).rejects.toBeInstanceOf(SuspensionSignal);

    const step = await store.getStepResult("e1", "__sleep:0");
    expect(step?.result).toEqual(
      expect.objectContaining({ state: "sleeping" }),
    );

    expect((await store.getReadyTimers(new Date(Date.now() + 10))).length).toBe(
      1,
    );
  });

  it("can enforce explicit step ids for internal steps (sleep)", async () => {
    const { ctx } = createContext("e1", 1, new MemoryStore(), {
      implicitInternalStepIds: "error",
    });

    await expect(ctx.sleep(1)).rejects.toThrow("implicit step id");
  });

  it("can warn once per kind when using implicit internal step ids", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { ctx } = createContext("e1", 1, new MemoryStore(), {
        implicitInternalStepIds: "warn",
      });

      await expect(ctx.sleep(1)).rejects.toBeInstanceOf(SuspensionSignal);
      await expect(ctx.sleep(1)).rejects.toBeInstanceOf(SuspensionSignal);

      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("replays sleep when already sleeping (re-creates timer and suspends again)", async () => {
    const { store, bus } = createContext();
    const ctx1 = new DurableContext(store, bus, "e1", 1);
    await expect(ctx1.sleep(1)).rejects.toBeInstanceOf(SuspensionSignal);

    const ctx2 = new DurableContext(store, bus, "e1", 1);
    await expect(ctx2.sleep(1)).rejects.toBeInstanceOf(SuspensionSignal);
  });

  it("returns immediately if sleep is already completed", async () => {
    const { store, ctx } = createContext();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__sleep:0",
      result: { state: "completed" },
      completedAt: new Date(),
    });

    await expect(ctx.sleep(1)).resolves.toBeUndefined();
  });

  it("memoizes steps, supports retries and timeouts", async () => {
    const { store, bus } = createContext();
    const ctx1 = new DurableContext(store, bus, "e1", 1);

    let count = 0;
    const v1 = await ctx1.step("cached", async () => {
      count += 1;
      return "ok";
    });

    // Simulate replay: new context, same execution ID
    const ctx2 = new DurableContext(store, bus, "e1", 1);
    const v2 = await ctx2.step("cached", async () => {
      count += 1;
      return "nope";
    });

    expect(v1).toBe("ok");
    expect(v2).toBe("ok");
    expect(count).toBe(1); // Ran once, second time was cached

    let attempts = 0;
    const retried = await ctx1.step("retry", { retries: 1 }, async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("fail-once");
      return "recovered";
    });
    expect(retried).toBe("recovered");

    await expect(
      ctx1.step(
        "timeout",
        { timeout: 1 },
        async () =>
          await new Promise<string>((resolve) =>
            setTimeout(() => resolve("late"), 25),
          ),
      ),
    ).rejects.toThrow("timed out");
  });

  it("clears timeout timers when a step resolves or rejects quickly", async () => {
    const { ctx } = createContext();

    await expect(
      ctx.step("timeout-fast-resolve", { timeout: 50 }, async () => "ok"),
    ).resolves.toBe("ok");

    await expect(
      ctx.step("timeout-fast-reject", { timeout: 50 }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("registers compensation from cached step results", async () => {
    const { store, bus } = createContext();

    const actions: string[] = [];

    const ctx1 = new DurableContext(store, bus, "e1", 1);
    await ctx1
      .step("s1")
      .up(async () => "v")
      .down(async () => {
        actions.push("down");
      });

    const ctx2 = new DurableContext(store, bus, "e1", 1);
    await ctx2
      .step("s1")
      .up(async () => "ignored")
      .down(async () => {
        actions.push("down-cached");
      });

    await ctx2.rollback();
    expect(actions).toEqual(["down-cached"]);
  });

  it("supports strongly-typed step ids", async () => {
    const { store, bus } = createContext();
    const ctx1 = new DurableContext(store, bus, "e1", 1);

    const Create = createDurableStepId<string>("steps.create");

    let runs = 0;
    const v1 = await ctx1.step(Create, async () => {
      runs += 1;
      return "ok";
    });

    // Simulate replay
    const ctx2 = new DurableContext(store, bus, "e1", 1);
    const v2 = await ctx2.step(Create, async () => {
      runs += 1;
      return "nope";
    });

    expect(v1).toBe("ok");
    expect(v2).toBe("ok");
    expect(runs).toBe(1);
  });

  it("emits events using event definitions", async () => {
    const { bus, ctx } = createContext();

    const received: Array<{ type: string; payload: unknown }> = [];
    await bus.subscribe("durable:events", async (evt) => {
      received.push({ type: evt.type, payload: evt.payload });
    });

    const E1 = event<{ a: number }>({ id: "event.1" });
    const E2 = event<{ b: number }>({ id: "event.2" });
    const E3 = event<{ c: number }>({ id: "event.3" });

    await ctx.emit(E1, { a: 1 });
    await ctx.emit(E1, { a: 2 });
    await ctx.emit(E2, { b: 2 });
    await ctx.emit(E3, { c: 3 });

    expect(received).toEqual([
      { type: "event.1", payload: { a: 1 } },
      { type: "event.1", payload: { a: 2 } },
      { type: "event.2", payload: { b: 2 } },
      { type: "event.3", payload: { c: 3 } },
    ]);
  });

  it("prevents user steps from using internal reserved step ids", async () => {
    const { ctx } = createContext();

    expect(() => ctx.step("__sleep:0", async () => "x")).toThrow(
      "reserved for durable internals",
    );
    expect(() => ctx.step("rollback:s1", async () => "x")).toThrow(
      "reserved for durable internals",
    );
  });

  it("waits for a signal by persisting 'waiting' state and suspending", async () => {
    const { store, ctx } = createContext();

    await expect(ctx.waitForSignal(Paid)).rejects.toBeInstanceOf(
      SuspensionSignal,
    );
    expect(
      (await store.getStepResult("e1", "__signal:durable.tests.paid"))?.result,
    ).toEqual(expect.objectContaining({ state: "waiting", signalId: Paid.id }));
  });

  it("suspends again when signal is still waiting (replay branch)", async () => {
    const { store, ctx } = createContext();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:durable.tests.paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    await expect(ctx.waitForSignal(Paid)).rejects.toBeInstanceOf(
      SuspensionSignal,
    );
  });

  it("returns signal payload when completed and supports multiple waits", async () => {
    const { store, ctx } = createContext();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:durable.tests.paid",
      result: { state: "completed", payload: { paidAt: 1 } },
      completedAt: new Date(),
    });

    const paid = await ctx.waitForSignal(Paid);
    expect(paid.paidAt).toBe(1);

    await expect(ctx.waitForSignal(Paid)).rejects.toBeInstanceOf(
      SuspensionSignal,
    );
    expect(
      (await store.getStepResult("e1", "__signal:durable.tests.paid:1"))
        ?.result,
    ).toEqual(expect.objectContaining({ state: "waiting", signalId: Paid.id }));

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:raw",
      result: "hello",
      completedAt: new Date(),
    });

    const Raw = event<string>({ id: "raw" });
    await expect(ctx.waitForSignal(Raw)).rejects.toThrow(
      "Invalid signal step state",
    );
  });

  it("supports waitForSignal() using typed signal ids", async () => {
    const { store, ctx } = createContext();

    const PaidSignal = event<{ paidAt: number }>({ id: Paid.id });

    await store.saveStepResult({
      executionId: "e1",
      stepId: `__signal:${Paid.id}`,
      result: { state: "completed", payload: { paidAt: 123 } },
      completedAt: new Date(),
    });

    const paid = await ctx.waitForSignal(PaidSignal);
    expect(paid.paidAt).toBe(123);
  });

  it("supports signal timeout waits (and handles replay + timed_out)", async () => {
    const { store, bus, ctx } = createContext();

    await expect(
      ctx.waitForSignal(Paid, { timeoutMs: 10 }),
    ).rejects.toBeInstanceOf(SuspensionSignal);

    const waiting = await store.getStepResult(
      "e1",
      "__signal:durable.tests.paid",
    );
    expect(waiting?.result).toEqual(
      expect.objectContaining({
        state: "waiting",
        timeoutAtMs: expect.any(Number),
        timerId: expect.any(String),
      }),
    );

    const ctx2 = new DurableContext(store, bus, "e1", 1);
    await expect(
      ctx2.waitForSignal(Paid, { timeoutMs: 10 }),
    ).rejects.toBeInstanceOf(SuspensionSignal);

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:durable.tests.paid",
      result: { state: "timed_out" },
      completedAt: new Date(),
    });

    const ctx3 = new DurableContext(store, bus, "e1", 1);
    await expect(ctx3.waitForSignal(Paid, { timeoutMs: 10 })).resolves.toEqual({
      kind: "timeout",
    });
  });

  it("throws when signal is timed out and no timeout handler is used", async () => {
    const { store, ctx } = createContext();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:durable.tests.paid",
      result: { state: "timed_out" },
      completedAt: new Date(),
    });

    await expect(ctx.waitForSignal(Paid)).rejects.toThrow("timed out");
  });

  it("creates a timeout timer when replaying a plain waiting signal", async () => {
    const { store, bus } = createContext();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:durable.tests.paid",
      result: { state: "waiting" },
      completedAt: new Date(),
    });

    const ctx = new DurableContext(store, bus, "e1", 1);
    await expect(
      ctx.waitForSignal(Paid, { timeoutMs: 10 }),
    ).rejects.toBeInstanceOf(SuspensionSignal);

    const timers = await store.getReadyTimers(new Date(Date.now() + 60_000));
    expect(timers.some((t) => t.type === "signal_timeout")).toBe(true);
  });

  it("throws when a signal step result is an invalid primitive", async () => {
    const { store, ctx } = createContext();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:durable.tests.paid",
      result: 123,
      completedAt: new Date(),
    });

    await expect(ctx.waitForSignal(Paid)).rejects.toThrow(
      "Invalid signal step state",
    );
  });

  it("throws when a signal step result has an unknown state", async () => {
    const { store, ctx } = createContext();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:durable.tests.paid",
      result: { state: "something-else", payload: { paidAt: 1 } },
      completedAt: new Date(),
    });

    await expect(ctx.waitForSignal(Paid)).rejects.toThrow(
      "Invalid signal step state",
    );
  });

  it("throws when a waiting signal step has an invalid signalId type", async () => {
    const { store, ctx } = createContext();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:durable.tests.paid",
      result: { state: "waiting", signalId: 123 },
      completedAt: new Date(),
    });

    await expect(ctx.waitForSignal(Paid)).rejects.toThrow(
      "Invalid signal step state",
    );
  });

  it("throws when a waiting signal step has a mismatched signalId", async () => {
    const { store, ctx } = createContext();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:durable.tests.paid",
      result: { state: "waiting", signalId: "other-signal" },
      completedAt: new Date(),
    });

    await expect(ctx.waitForSignal(Paid)).rejects.toThrow(
      "Invalid signal step state",
    );
  });

  it("fails fast when waitForSignal() uses stepId but the store cannot list steps", async () => {
    const base = new MemoryStore();

    const storeNoList: IDurableStore = {
      saveExecution: base.saveExecution.bind(base),
      getExecution: base.getExecution.bind(base),
      updateExecution: base.updateExecution.bind(base),
      listIncompleteExecutions: base.listIncompleteExecutions.bind(base),
      getStepResult: base.getStepResult.bind(base),
      saveStepResult: base.saveStepResult.bind(base),
      createTimer: base.createTimer.bind(base),
      getReadyTimers: base.getReadyTimers.bind(base),
      markTimerFired: base.markTimerFired.bind(base),
      deleteTimer: base.deleteTimer.bind(base),
      createSchedule: base.createSchedule.bind(base),
      getSchedule: base.getSchedule.bind(base),
      updateSchedule: base.updateSchedule.bind(base),
      deleteSchedule: base.deleteSchedule.bind(base),
      listSchedules: base.listSchedules.bind(base),
      listActiveSchedules: base.listActiveSchedules.bind(base),
    };

    const { ctx } = createContext("e1", 1, storeNoList);

    await expect(
      ctx.waitForSignal(Paid, { stepId: "stable-paid" }),
    ).rejects.toThrow("listStepResults");
  });

  it("throws when waitForSignal() cannot acquire the signal lock", async () => {
    const base = new MemoryStore();

    const storeLocked: IDurableStore = {
      saveExecution: base.saveExecution.bind(base),
      getExecution: base.getExecution.bind(base),
      updateExecution: base.updateExecution.bind(base),
      listIncompleteExecutions: base.listIncompleteExecutions.bind(base),
      getStepResult: base.getStepResult.bind(base),
      saveStepResult: base.saveStepResult.bind(base),
      createTimer: base.createTimer.bind(base),
      getReadyTimers: base.getReadyTimers.bind(base),
      markTimerFired: base.markTimerFired.bind(base),
      deleteTimer: base.deleteTimer.bind(base),
      createSchedule: base.createSchedule.bind(base),
      getSchedule: base.getSchedule.bind(base),
      updateSchedule: base.updateSchedule.bind(base),
      deleteSchedule: base.deleteSchedule.bind(base),
      listSchedules: base.listSchedules.bind(base),
      listActiveSchedules: base.listActiveSchedules.bind(base),
      listStepResults: base.listStepResults.bind(base),
      acquireLock: async () => null,
      releaseLock: async () => {},
    };

    const { ctx } = createContext("e1", 1, storeLocked);

    await expect(ctx.waitForSignal(Paid)).rejects.toThrow("signal lock");
  });

  it("supports explicit step ids for sleep, signals, and emits", async () => {
    const { store, ctx } = createContext();

    await expect(
      ctx.sleep(1, { stepId: "stable-sleep" }),
    ).rejects.toBeInstanceOf(SuspensionSignal);
    expect(await store.getStepResult("e1", "__sleep:stable-sleep")).toEqual(
      expect.objectContaining({
        executionId: "e1",
        stepId: "__sleep:stable-sleep",
      }),
    );

    await expect(
      ctx.waitForSignal(Paid, { stepId: "stable-signal" }),
    ).rejects.toBeInstanceOf(SuspensionSignal);
    expect(await store.getStepResult("e1", "__signal:stable-signal")).toEqual(
      expect.objectContaining({
        executionId: "e1",
        stepId: "__signal:stable-signal",
      }),
    );

    const Stable = event<{ ok: boolean }>({ id: "event.stable" });
    await ctx.emit(Stable, { ok: true }, { stepId: "stable-emit" });
    expect(await store.getStepResult("e1", "__emit:stable-emit")).toEqual(
      expect.objectContaining({
        executionId: "e1",
        stepId: "__emit:stable-emit",
      }),
    );
  });

  it("returns a signal outcome when completed and timeout options are used", async () => {
    const { store, ctx } = createContext();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:stable-complete",
      result: { state: "completed", payload: { paidAt: 7 } },
      completedAt: new Date(),
    });

    await expect(
      ctx.waitForSignal(Paid, { timeoutMs: 10, stepId: "stable-complete" }),
    ).resolves.toEqual({ kind: "signal", payload: { paidAt: 7 } });
  });

  it("returns the payload when an explicit step id is used without a timeout", async () => {
    const { store, ctx } = createContext();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:stable-only",
      result: { state: "completed", payload: { paidAt: 9 } },
      completedAt: new Date(),
    });

    await expect(
      ctx.waitForSignal(Paid, { stepId: "stable-only" }),
    ).resolves.toEqual({ paidAt: 9 });
  });

  it("throws on timeout when an explicit step id is used without timeout options", async () => {
    const { store, ctx } = createContext();

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:stable-timeout",
      result: { state: "timed_out" },
      completedAt: new Date(),
    });

    await expect(
      ctx.waitForSignal(Paid, { stepId: "stable-timeout" }),
    ).rejects.toThrow("timed out");
  });

  it("ignores audit emitter failures", async () => {
    const { ctx } = createContext("e1", 1, new MemoryStore(), {
      auditEnabled: true,
      auditEmitter: {
        emit: async () => {
          throw new Error("boom");
        },
      },
    });

    await expect(ctx.step("audit-ok", async () => "ok")).resolves.toBe("ok");
  });

  it("ignores audit store failures", async () => {
    class ThrowingAuditStore extends MemoryStore {
      async appendAuditEntry(): Promise<void> {
        throw new Error("fail");
      }
    }

    const store = new ThrowingAuditStore();
    const { ctx } = createContext("e1", 1, store, { auditEnabled: true });

    await expect(ctx.step("audit-fail", async () => "ok")).resolves.toBe("ok");
  });

  it("throws when reusing the same step ID in a single execution path", async () => {
    const { ctx } = createContext();
    await ctx.step("A", async () => "ok");

    // step() throws synchronously for duplicate IDs because it checks before returning the promise/builder
    expect(() => ctx.step("A", async () => "fail")).toThrow(
      "Duplicate step ID detected",
    );
  });
});
