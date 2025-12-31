import { event } from "../../..";
import { MemoryEventBus } from "../bus/MemoryEventBus";
import { DurableContext } from "../core/DurableContext";
import { createDurableSignalId, createDurableStepId } from "../core/ids";
import { SuspensionSignal } from "../core/interfaces/context";
import { MemoryStore } from "../store/MemoryStore";

describe("durable: DurableContext", () => {
  const Paid = event<{ paidAt: number }>({ id: "durable.tests.paid" });

  it("supports explicit compensation via rollback()", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();
    const ctx = new DurableContext(store, bus, "e1", 1);

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
    const store = new MemoryStore();
    const bus = new MemoryEventBus();
    const ctx = new DurableContext(store, bus, "e1", 1);

    await ctx
      .step<string>("create")
      .up(async () => "ok")
      .down(async () => {
        throw new SuspensionSignal("yield");
      });

    await expect(ctx.rollback()).rejects.toBeInstanceOf(SuspensionSignal);
  });

  it("marks compensation_failed even when a non-Error is thrown", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();
    const ctx = new DurableContext(store, bus, "e1", 1);

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
    const store = new MemoryStore();
    const bus = new MemoryEventBus();
    const ctx = new DurableContext(store, bus, "e1", 1);

    await expect(ctx.sleep(1)).rejects.toBeInstanceOf(SuspensionSignal);

    const step = await store.getStepResult("e1", "__sleep:0");
    expect(step?.result).toEqual(
      expect.objectContaining({ state: "sleeping" }),
    );

    expect((await store.getReadyTimers(new Date(Date.now() + 10))).length).toBe(
      1,
    );
  });

  it("replays sleep when already sleeping (re-creates timer and suspends again)", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

    const ctx1 = new DurableContext(store, bus, "e1", 1);
    await expect(ctx1.sleep(1)).rejects.toBeInstanceOf(SuspensionSignal);

    const ctx2 = new DurableContext(store, bus, "e1", 1);
    await expect(ctx2.sleep(1)).rejects.toBeInstanceOf(SuspensionSignal);
  });

  it("returns immediately if sleep is already completed", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();
    const ctx = new DurableContext(store, bus, "e1", 1);

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__sleep:0",
      result: { state: "completed" },
      completedAt: new Date(),
    });

    await expect(ctx.sleep(1)).resolves.toBeUndefined();
  });

  it("memoizes steps, supports retries and timeouts", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();
    const ctx = new DurableContext(store, bus, "e1", 1);

    let count = 0;
    const v1 = await ctx.step("cached", async () => {
      count += 1;
      return "ok";
    });
    const v2 = await ctx.step("cached", async () => {
      count += 1;
      return "nope";
    });

    expect(v1).toBe("ok");
    expect(v2).toBe("ok");
    expect(count).toBe(1);

    let attempts = 0;
    const retried = await ctx.step("retry", { retries: 1 }, async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("fail-once");
      return "recovered";
    });
    expect(retried).toBe("recovered");

    await expect(
      ctx.step(
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
    const store = new MemoryStore();
    const bus = new MemoryEventBus();
    const ctx = new DurableContext(store, bus, "e1", 1);

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
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

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
    const store = new MemoryStore();
    const bus = new MemoryEventBus();
    const ctx = new DurableContext(store, bus, "e1", 1);

    const Create = createDurableStepId<string>("steps.create");

    let runs = 0;
    const v1 = await ctx.step(Create, async () => {
      runs += 1;
      return "ok";
    });
    const v2 = await ctx.step(Create, async () => {
      runs += 1;
      return "nope";
    });

    expect(v1).toBe("ok");
    expect(v2).toBe("ok");
    expect(runs).toBe(1);
  });

  it("emits events using string and object ids", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();
    const ctx = new DurableContext(store, bus, "e1", 1);

    const received: Array<{ type: string; payload: unknown }> = [];
    await bus.subscribe("durable:events", async (evt) => {
      received.push({ type: evt.type, payload: evt.payload });
    });

    await ctx.emit("event.1", { a: 1 });
    await ctx.emit("event.1", { a: 2 });
    await ctx.emit({ id: "event.2" }, { b: 2 });
    await ctx.emit(createDurableSignalId<{ c: number }>("event.3"), { c: 3 });

    expect(received).toEqual([
      { type: "event.1", payload: { a: 1 } },
      { type: "event.1", payload: { a: 2 } },
      { type: "event.2", payload: { b: 2 } },
      { type: "event.3", payload: { c: 3 } },
    ]);
  });

  it("migrates legacy emit step ids on first emit", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();
    const ctx = new DurableContext(store, bus, "e1", 1);

    await store.saveStepResult({
      executionId: "e1",
      stepId: "emit:event.legacy:e1",
      result: { migrated: true },
      completedAt: new Date(),
    });

    const received: string[] = [];
    await bus.subscribe("durable:events", async (evt) => {
      received.push(evt.type);
    });

    await ctx.emit("event.legacy", { a: 1 });

    expect(received).toEqual([]);
    expect(
      (await store.getStepResult("e1", "__emit:event.legacy:0"))?.result,
    ).toEqual({ migrated: true });
  });

  it("prevents user steps from using internal reserved step ids", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();
    const ctx = new DurableContext(store, bus, "e1", 1);

    expect(() => ctx.step("__sleep:0", async () => "x")).toThrow(
      "reserved for durable internals",
    );
    expect(() => ctx.step("rollback:s1", async () => "x")).toThrow(
      "reserved for durable internals",
    );
  });

  it("waits for a signal by persisting 'waiting' state and suspending", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();
    const ctx = new DurableContext(store, bus, "e1", 1);

    await expect(ctx.waitForSignal(Paid)).rejects.toBeInstanceOf(
      SuspensionSignal,
    );
    expect(
      (await store.getStepResult("e1", "__signal:durable.tests.paid"))?.result,
    ).toEqual({ state: "waiting" });
  });

  it("suspends again when signal is still waiting (replay branch)", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();
    const ctx = new DurableContext(store, bus, "e1", 1);

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

  it("returns signal payload when completed and returns raw values otherwise", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();
    const ctx = new DurableContext(store, bus, "e1", 1);

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
    ).toEqual({ state: "waiting" });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:raw",
      result: "hello",
      completedAt: new Date(),
    });

    await expect(ctx.waitForSignal<string>("raw")).resolves.toBe("hello");
  });

  it("supports waitForSignal() using typed signal ids", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();
    const ctx = new DurableContext(store, bus, "e1", 1);

    const PaidSignal = createDurableSignalId<{ paidAt: number }>(Paid.id);

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
    const store = new MemoryStore();
    const bus = new MemoryEventBus();
    const ctx = new DurableContext(store, bus, "e1", 1);

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
    const store = new MemoryStore();
    const bus = new MemoryEventBus();
    const ctx = new DurableContext(store, bus, "e1", 1);

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:durable.tests.paid",
      result: { state: "timed_out" },
      completedAt: new Date(),
    });

    await expect(ctx.waitForSignal(Paid)).rejects.toThrow("timed out");
  });

  it("creates a timeout timer when replaying a plain waiting signal", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

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

  it("treats non-object step results as legacy signal values", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();
    const ctx = new DurableContext(store, bus, "e1", 1);

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:durable.tests.paid",
      result: 123,
      completedAt: new Date(),
    });

    await expect(
      ctx.waitForSignal<number>("durable.tests.paid", { timeoutMs: 10 }),
    ).resolves.toEqual({
      kind: "signal",
      payload: 123,
    });
  });

  it("handles unexpected signal state shapes as legacy values", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();
    const ctx = new DurableContext(store, bus, "e1", 1);

    await store.saveStepResult({
      executionId: "e1",
      stepId: "__signal:durable.tests.paid",
      result: { state: "something-else", payload: { paidAt: 1 } },
      completedAt: new Date(),
    });

    await expect(ctx.waitForSignal(Paid, { timeoutMs: 10 })).resolves.toEqual({
      kind: "signal",
      payload: { state: "something-else", payload: { paidAt: 1 } },
    });
  });
});
