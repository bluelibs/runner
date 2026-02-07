import { MemoryEventBus } from "../../durable/bus/MemoryEventBus";
import { DurableContext } from "../../durable/core/DurableContext";
import type { DurableAuditEmitter } from "../../durable/core/audit";
import { DurableAuditEntryKind } from "../../durable/core/audit";
import { ExecutionStatus } from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";
import type { IDurableStore } from "../../durable/core/interfaces/store";

describe("durable: DurableContext.switch", () => {
  const createContext = (
    executionId = "e1",
    attempt = 1,
    store: IDurableStore = new MemoryStore(),
    options: {
      auditEnabled?: boolean;
      auditEmitter?: DurableAuditEmitter;
    } = {},
  ) => {
    const bus = new MemoryEventBus();
    const ctx = new DurableContext(store, bus, executionId, attempt, options);
    return { store, bus, ctx };
  };

  it("selects the first matching branch and returns its result", async () => {
    const { ctx } = createContext();

    const result = await ctx.switch("route", "premium", [
      {
        id: "free",
        match: (v) => v === "free",
        run: async () => "free-path",
      },
      {
        id: "premium",
        match: (v) => v === "premium",
        run: async () => "premium-path",
      },
    ]);

    expect(result).toBe("premium-path");
  });

  it("persists the branch result in the store", async () => {
    const { store, ctx } = createContext();

    await ctx.switch("route", "a", [
      { id: "alpha", match: (v) => v === "a", run: async () => 42 },
    ]);

    const step = await store.getStepResult("e1", "route");
    expect(step).not.toBeNull();
    expect(step!.result).toEqual({ branchId: "alpha", result: 42 });
  });

  it("returns cached result on replay without re-running matchers", async () => {
    const store = new MemoryStore();
    const { ctx: ctx1 } = createContext("e1", 1, store);

    await ctx1.switch("route", "a", [
      { id: "alpha", match: (v) => v === "a", run: async () => "first" },
    ]);

    // Replay: create a new context with the same execution
    const { ctx: ctx2 } = createContext("e1", 1, store);

    let matcherCalled = false;
    const result = await ctx2.switch("route", "b", [
      {
        id: "beta",
        match: () => {
          matcherCalled = true;
          return true;
        },
        run: async () => "second",
      },
    ]);

    // Should return the cached "first" result, not "second"
    expect(result).toBe("first");
    expect(matcherCalled).toBe(false);
  });

  it("falls back to the default branch when no matcher hits", async () => {
    const { ctx } = createContext();

    const result = await ctx.switch(
      "route",
      "unknown",
      [
        { id: "a", match: (v) => v === "a", run: async () => "path-a" },
        { id: "b", match: (v) => v === "b", run: async () => "path-b" },
      ],
      { id: "fallback", run: async () => "default-path" },
    );

    expect(result).toBe("default-path");
  });

  it("throws when no branch matches and no default is provided", async () => {
    const { ctx } = createContext();

    await expect(
      ctx.switch("route", "unknown", [
        { id: "a", match: (v) => v === "a", run: async () => "x" },
      ]),
    ).rejects.toThrow("no branch matched and no default provided");
  });

  it("rejects reserved step ID prefixes (__)", async () => {
    const { ctx } = createContext();

    await expect(
      ctx.switch("__reserved", "x", [
        { id: "a", match: () => true, run: async () => 1 },
      ]),
    ).rejects.toThrow("reserved for durable internals");
  });

  it("rejects reserved step ID prefixes (rollback:)", async () => {
    const { ctx } = createContext();

    await expect(
      ctx.switch("rollback:foo", "x", [
        { id: "a", match: () => true, run: async () => 1 },
      ]),
    ).rejects.toThrow("reserved for durable internals");
  });

  it("rejects duplicate step IDs within the same execution", async () => {
    const { ctx } = createContext();

    await ctx.switch("route", "a", [
      { id: "alpha", match: () => true, run: async () => "ok" },
    ]);

    await expect(
      ctx.switch("route", "b", [
        { id: "beta", match: () => true, run: async () => "ok" },
      ]),
    ).rejects.toThrow("Duplicate step ID");
  });

  it("selects the first matching branch when multiple match", async () => {
    const { store, ctx } = createContext();

    const result = await ctx.switch("route", 10, [
      { id: "low", match: (v) => v < 100, run: async () => "low-path" },
      { id: "any", match: () => true, run: async () => "any-path" },
    ]);

    expect(result).toBe("low-path");

    const step = await store.getStepResult("e1", "route");
    expect(step!.result).toEqual({ branchId: "low", result: "low-path" });
  });

  it("fails fast when the execution is cancelled", async () => {
    const store = new MemoryStore();
    await store.saveExecution({
      id: "e1",
      taskId: "t",
      input: undefined,
      status: ExecutionStatus.Cancelled,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { ctx } = createContext("e1", 1, store);

    await expect(
      ctx.switch("route", "x", [
        { id: "a", match: () => true, run: async () => 1 },
      ]),
    ).rejects.toThrow("Execution cancelled");
  });

  it("emits a SwitchEvaluated audit entry when audit is enabled", async () => {
    const entries: unknown[] = [];
    const emitter: DurableAuditEmitter = {
      emit: async (entry) => {
        entries.push(entry);
      },
    };

    const { ctx } = createContext("e1", 1, new MemoryStore(), {
      auditEnabled: true,
      auditEmitter: emitter,
    });

    await ctx.switch("route", "go", [
      { id: "go", match: (v) => v === "go", run: async () => "gone" },
    ]);

    const switchEntry = entries.find(
      (e: any) => e.kind === DurableAuditEntryKind.SwitchEvaluated,
    ) as any;
    expect(switchEntry).toBeDefined();
    expect(switchEntry.stepId).toBe("route");
    expect(switchEntry.branchId).toBe("go");
    expect(typeof switchEntry.durationMs).toBe("number");
  });

  it("works with complex value types", async () => {
    type Order = { status: string; amount: number };
    const { ctx } = createContext();

    const order: Order = { status: "paid", amount: 500 };

    const result = await ctx.switch<Order, string>("process-order", order, [
      {
        id: "refund",
        match: (o) => o.status === "refunded",
        run: async () => "refund-flow",
      },
      {
        id: "high-value",
        match: (o) => o.status === "paid" && o.amount > 100,
        run: async (o) => `high-value-${o.amount}`,
      },
      {
        id: "standard",
        match: (o) => o.status === "paid",
        run: async () => "standard-flow",
      },
    ]);

    expect(result).toBe("high-value-500");
  });

  it("passes the switch value to the branch run function", async () => {
    const { ctx } = createContext();

    const result = await ctx.switch("transform", 42, [
      {
        id: "double",
        match: (v) => v > 0,
        run: async (v) => v * 2,
      },
    ]);

    expect(result).toBe(84);
  });
});
