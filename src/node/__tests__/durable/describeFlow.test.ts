import { event, r } from "../../..";
import { describeFlow } from "../../durable/core/describeFlow";
import { createDurableStepId } from "../../durable/core/ids";
import { memoryDurableResource } from "../../durable/resources/memoryDurableResource";

describe("durable: describeFlow", () => {
  it("records step nodes", async () => {
    const shape = await describeFlow(async (ctx) => {
      await ctx.step("validate", async () => ({ ok: true }));
      await ctx.step("process", async () => "done");
    });

    expect(shape.nodes).toEqual([
      { kind: "step", stepId: "validate", hasCompensation: false },
      { kind: "step", stepId: "process", hasCompensation: false },
    ]);
  });

  it("records step nodes with compensation via builder", async () => {
    const shape = await describeFlow(async (ctx) => {
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
    const shape = await describeFlow(async (ctx) => {
      await ctx.step("fetch").up(async () => "data");
    });

    expect(shape.nodes).toEqual([
      { kind: "step", stepId: "fetch", hasCompensation: false },
    ]);
  });

  it("records sleep nodes", async () => {
    const shape = await describeFlow(async (ctx) => {
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

    const shape = await describeFlow(async (ctx) => {
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

    const shape = await describeFlow(async (ctx) => {
      await ctx.emit(OrderShipped, { orderId: "123" }, { stepId: "notify" });
    });

    expect(shape.nodes).toEqual([
      { kind: "emit", eventId: "app.orderShipped", stepId: "notify" },
    ]);
  });

  it("records switch nodes", async () => {
    const shape = await describeFlow(async (ctx) => {
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
    const shape = await describeFlow(async (ctx) => {
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
    const shape = await describeFlow(async (ctx) => {
      await ctx.note("Starting approval flow");
    });

    expect(shape.nodes).toEqual([
      { kind: "note", message: "Starting approval flow" },
    ]);
  });

  it("records rollback as a no-op (no node)", async () => {
    const shape = await describeFlow(async (ctx) => {
      await ctx.step("create", async () => "ok");
      await ctx.rollback();
    });

    expect(shape.nodes).toEqual([
      { kind: "step", stepId: "create", hasCompensation: false },
    ]);
  });

  it("captures a complex multi-node workflow", async () => {
    const PaymentReceived = event<{ amount: number }>({
      id: "payment.received",
    });
    const OrderNotification = event<{ orderId: string }>({
      id: "order.notification",
    });

    const shape = await describeFlow(async (ctx) => {
      await ctx.step("validate-order", async () => ({ valid: true }));
      await ctx.waitForSignal(PaymentReceived, {
        timeoutMs: 86_400_000,
        stepId: "await-payment",
      });
      await ctx.switch(
        "fulfillment-route",
        "digital",
        [
          {
            id: "digital",
            match: (v) => v === "digital",
            run: async () => "instant",
          },
          {
            id: "physical",
            match: (v) => v === "physical",
            run: async () => "shipping",
          },
        ],
        { id: "unknown", run: async () => "manual-review" },
      );
      await ctx.sleep(5_000, { stepId: "cooldown" });
      await ctx.emit(
        OrderNotification,
        { orderId: "123" },
        { stepId: "notify" },
      );
      await ctx.note("Order processing complete");
    });

    expect(shape.nodes).toHaveLength(6);
    expect(shape.nodes[0]).toEqual({
      kind: "step",
      stepId: "validate-order",
      hasCompensation: false,
    });
    expect(shape.nodes[1]).toEqual({
      kind: "waitForSignal",
      signalId: "payment.received",
      timeoutMs: 86_400_000,
      stepId: "await-payment",
    });
    expect(shape.nodes[2]).toEqual({
      kind: "switch",
      stepId: "fulfillment-route",
      branchIds: ["digital", "physical"],
      hasDefault: true,
    });
    expect(shape.nodes[3]).toEqual({
      kind: "sleep",
      durationMs: 5_000,
      stepId: "cooldown",
    });
    expect(shape.nodes[4]).toEqual({
      kind: "emit",
      eventId: "order.notification",
      stepId: "notify",
    });
    expect(shape.nodes[5]).toEqual({
      kind: "note",
      message: "Order processing complete",
    });
  });

  it("returns an empty shape for a no-op descriptor", async () => {
    const shape = await describeFlow(async () => {});
    expect(shape.nodes).toEqual([]);
  });

  it("covers the builder then() rejection path", async () => {
    const shape = await describeFlow(async (ctx) => {
      // Call the builder's then() with both onfulfilled and onrejected handlers
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
    const shape = await describeFlow(async (ctx) => {
      // Call the builder's then() with null onfulfilled to hit the fallback branch
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

    const shape = await describeFlow(async (ctx) => {
      await ctx.step(validateId, async () => ({ ok: true }));
      await ctx.step(processId).up(async () => "done");
    });

    expect(shape.nodes).toEqual([
      { kind: "step", stepId: "validate", hasCompensation: false },
      { kind: "step", stepId: "process", hasCompensation: false },
    ]);
  });

  it("records note nodes with meta (meta is ignored in shape)", async () => {
    const shape = await describeFlow(async (ctx) => {
      await ctx.note("checkpoint reached", { orderId: "123", attempt: 2 });
    });

    expect(shape.nodes).toEqual([
      { kind: "note", message: "checkpoint reached" },
    ]);
  });

  // ─── Task-based describeFlow ────────────────────────────────────────────

  describe("from task", () => {
    const durable = memoryDurableResource.fork("describe.test.durable");

    it("extracts the shape from a task definition", async () => {
      const task = r
        .task("describe.test.simple")
        .dependencies({ durable })
        .run(async (_input: undefined, { durable }) => {
          const ctx = durable.use();
          await ctx.step("validate", async () => ({ ok: true }));
          await ctx.step("process", async () => "done");
        })
        .build();

      const shape = await describeFlow(task);

      expect(shape.nodes).toEqual([
        { kind: "step", stepId: "validate", hasCompensation: false },
        { kind: "step", stepId: "process", hasCompensation: false },
      ]);
    });

    it("extracts a complex multi-node shape from a task", async () => {
      const PaymentReceived = event<{ amount: number }>({
        id: "describe.test.payment",
      });

      const task = r
        .task("describe.test.complex")
        .dependencies({ durable })
        .run(async (_input: undefined, { durable }) => {
          const ctx = durable.use();
          await ctx.step("validate-order", async () => ({ valid: true }));
          await ctx.waitForSignal(PaymentReceived, {
            timeoutMs: 86_400_000,
            stepId: "await-payment",
          });
          await ctx.sleep(5_000, { stepId: "cooldown" });
          await ctx.note("Order complete");
        })
        .build();

      const shape = await describeFlow(task);

      expect(shape.nodes).toHaveLength(4);
      expect(shape.nodes[0]).toEqual({
        kind: "step",
        stepId: "validate-order",
        hasCompensation: false,
      });
      expect(shape.nodes[1]).toEqual({
        kind: "waitForSignal",
        signalId: "describe.test.payment",
        timeoutMs: 86_400_000,
        stepId: "await-payment",
      });
      expect(shape.nodes[2]).toEqual({
        kind: "sleep",
        durationMs: 5_000,
        stepId: "cooldown",
      });
      expect(shape.nodes[3]).toEqual({
        kind: "note",
        message: "Order complete",
      });
    });

    it("works with tasks that use lazy (function) dependencies", async () => {
      const task = r
        .task("describe.test.lazy-deps")
        .dependencies(() => ({ durable }))
        .run(async (_input: undefined, { durable }) => {
          const ctx = durable.use();
          await ctx.step("lazy-step", async () => "ok");
        })
        .build();

      const shape = await describeFlow(task);

      expect(shape.nodes).toEqual([
        { kind: "step", stepId: "lazy-step", hasCompensation: false },
      ]);
    });

    it("works with tasks that have step builders and compensation", async () => {
      const task = r
        .task("describe.test.compensation")
        .dependencies({ durable })
        .run(async (_input: undefined, { durable }) => {
          const ctx = durable.use();
          await ctx
            .step("create-resource")
            .up(async () => "created")
            .down(async () => {});
        })
        .build();

      const shape = await describeFlow(task);

      expect(shape.nodes).toEqual([
        { kind: "step", stepId: "create-resource", hasCompensation: true },
      ]);
    });

    it("works with tasks that have multiple dependencies", async () => {
      const otherResource = r
        .resource("describe.test.other")
        .init(async () => ({ value: 42 }))
        .build();

      const task = r
        .task("describe.test.multi-deps")
        .dependencies({ durable, other: otherResource })
        .run(async (_input: undefined, { durable }) => {
          const ctx = durable.use();
          await ctx.step("with-other-deps", async () => "ok");
        })
        .build();

      const shape = await describeFlow(task);

      expect(shape.nodes).toEqual([
        { kind: "step", stepId: "with-other-deps", hasCompensation: false },
      ]);
    });

    it("handles tasks with nullish dependencies gracefully", async () => {
      const task = r
        .task("describe.test.no-deps")
        .run(async () => "ok")
        .build();

      // Force-clear dependencies to simulate an edge case
      (task as unknown as Record<string, unknown>).dependencies = undefined;

      const shape = await describeFlow(task);

      expect(shape.nodes).toEqual([]);
    });
  });
});
