import { event } from "../../..";
import { createDurableStepId } from "../../durable/core/ids";
import { recordFlowShape } from "../../durable/core/flowShape";

describe("durable: flowShape recorder", () => {
  it("records step nodes", async () => {
    const shape = await recordFlowShape(async (ctx) => {
      await ctx.step("validate", async () => ({ ok: true }));
      await ctx.step("process", async () => "done");
    });

    expect(shape.nodes).toEqual([
      { kind: "step", stepId: "validate", hasCompensation: false },
      { kind: "step", stepId: "process", hasCompensation: false },
    ]);
  });

  it("records step nodes with compensation via builder", async () => {
    const shape = await recordFlowShape(async (ctx) => {
      await ctx
        .step("create")
        .up(async () => "created")
        .down(async () => {});
    });

    expect(shape.nodes).toEqual([
      { kind: "step", stepId: "create", hasCompensation: true },
    ]);
  });

  it("records step builder without compensation", async () => {
    const shape = await recordFlowShape(async (ctx) => {
      await ctx.step("fetch").up(async () => "data");
    });

    expect(shape.nodes).toEqual([
      { kind: "step", stepId: "fetch", hasCompensation: false },
    ]);
  });

  it("records sleep nodes", async () => {
    const shape = await recordFlowShape(async (ctx) => {
      await ctx.sleep(60_000, { stepId: "cooldown" });
      await ctx.sleep(1_000);
    });

    expect(shape.nodes).toEqual([
      { kind: "sleep", durationMs: 60_000, stepId: "cooldown" },
      { kind: "sleep", durationMs: 1_000, stepId: undefined },
    ]);
  });

  it("records waitForSignal nodes", async () => {
    const Approved = event<{ by: string }>({ id: "app.approved" });

    const shape = await recordFlowShape(async (ctx) => {
      await ctx.waitForSignal(Approved, {
        timeoutMs: 5_000,
        stepId: "wait-approval",
      });
      await ctx.waitForSignal(Approved);
    });

    expect(shape.nodes).toEqual([
      {
        kind: "waitForSignal",
        signalId: "app.approved",
        timeoutMs: 5_000,
        stepId: "wait-approval",
      },
      {
        kind: "waitForSignal",
        signalId: "app.approved",
        timeoutMs: undefined,
        stepId: undefined,
      },
    ]);
  });

  it("records emit nodes", async () => {
    const OrderShipped = event<{ orderId: string }>({
      id: "app.orderShipped",
    });

    const shape = await recordFlowShape(async (ctx) => {
      await ctx.emit(OrderShipped, { orderId: "123" }, { stepId: "notify" });
    });

    expect(shape.nodes).toEqual([
      { kind: "emit", eventId: "app.orderShipped", stepId: "notify" },
    ]);
  });

  it("records switch nodes", async () => {
    const shape = await recordFlowShape(async (ctx) => {
      await ctx.switch(
        "route",
        "premium",
        [
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
        ],
        { id: "fallback", run: async () => "default" },
      );
    });

    expect(shape.nodes).toEqual([
      {
        kind: "switch",
        stepId: "route",
        branchIds: ["free", "premium"],
        hasDefault: true,
      },
    ]);
  });

  it("records switch nodes without default", async () => {
    const shape = await recordFlowShape(async (ctx) => {
      await ctx.switch("pick", 1, [
        { id: "one", match: (v) => v === 1, run: async () => "one" },
      ]);
    });

    expect(shape.nodes).toEqual([
      {
        kind: "switch",
        stepId: "pick",
        branchIds: ["one"],
        hasDefault: false,
      },
    ]);
  });

  it("records note nodes", async () => {
    const shape = await recordFlowShape(async (ctx) => {
      await ctx.note("Starting approval flow");
    });

    expect(shape.nodes).toEqual([
      { kind: "note", message: "Starting approval flow" },
    ]);
  });

  it("records rollback as a no-op (no node)", async () => {
    const shape = await recordFlowShape(async (ctx) => {
      await ctx.step("create", async () => "ok");
      await ctx.rollback();
    });

    expect(shape.nodes).toEqual([
      { kind: "step", stepId: "create", hasCompensation: false },
    ]);
  });

  it("returns an empty shape for a no-op descriptor", async () => {
    const shape = await recordFlowShape(async () => {});
    expect(shape.nodes).toEqual([]);
  });

  it("covers the builder then() rejection path", async () => {
    const shape = await recordFlowShape(async (ctx) => {
      await ctx
        .step("risky")
        .up(async () => "ok")
        .then(
          (v) => v,
          () => "recovered",
        );
    });

    expect(shape.nodes).toEqual([
      { kind: "step", stepId: "risky", hasCompensation: false },
    ]);
  });

  it("covers the builder then() without onfulfilled (fallback path)", async () => {
    const shape = await recordFlowShape(async (ctx) => {
      const result = await ctx
        .step("passthrough")
        .up(async () => "value")
        .then(null);

      expect(result).toBeUndefined();
    });

    expect(shape.nodes).toEqual([
      { kind: "step", stepId: "passthrough", hasCompensation: false },
    ]);
  });

  it("resolves DurableStepId objects to their string id", async () => {
    const validateId = createDurableStepId<{ ok: boolean }>("validate");
    const processId = createDurableStepId<string>("process");

    const shape = await recordFlowShape(async (ctx) => {
      await ctx.step(validateId, async () => ({ ok: true }));
      await ctx.step(processId).up(async () => "done");
    });

    expect(shape.nodes).toEqual([
      { kind: "step", stepId: "validate", hasCompensation: false },
      { kind: "step", stepId: "process", hasCompensation: false },
    ]);
  });

  it("records note nodes with meta (meta is ignored in shape)", async () => {
    const shape = await recordFlowShape(async (ctx) => {
      await ctx.note("checkpoint reached", { orderId: "123", attempt: 2 });
    });

    expect(shape.nodes).toEqual([
      { kind: "note", message: "checkpoint reached" },
    ]);
  });
});
