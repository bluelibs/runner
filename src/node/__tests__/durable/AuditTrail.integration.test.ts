import { event, r, run } from "../../..";
import { durableResource } from "../../durable/core/resource";
import { MemoryEventBus } from "../../durable/bus/MemoryEventBus";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { createMessageError } from "../../../errors";

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  options: { timeoutMs: number; intervalMs: number },
): Promise<void> {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > options.timeoutMs) {
      throw createMessageError("waitUntil timed out");
    }
    await new Promise((r) => setTimeout(r, options.intervalMs));
  }
}

describe("durable: audit trail (integration)", () => {
  const Paid = event<{ paidAt: number }>({ id: "durable.tests.audit.paid" });

  it("records steps, emits, sleeps, and custom notes", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

    const durable = durableResource.fork("durable.tests.audit.basic.durable");
    const durableRegistration = durable.with({
      store,
      eventBus: bus,
      audit: { enabled: true },
      polling: { interval: 5 },
    });

    const task = r
      .task("durable.test.audit.basic")
      .dependencies({ durable })
      .run(async (_input: undefined, { durable }) => {
        const ctx = durable.use();
        await ctx.note("starting", { orderId: "o1" });

        const before = await ctx.step("before", async () => "before");
        const AuditEvt = event<{ a: number }>({
          id: "durable.tests.audit.event",
        });
        await ctx.emit(AuditEvt, { a: 1 });

        await ctx.sleep(1);

        const after = await ctx.step("after", async () => "after");
        return { before, after };
      })
      .build();

    const app = r.resource("app").register([durableRegistration, task]).build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const executionId = await service.start(task, undefined, {
      timeout: 5_000,
      waitPollIntervalMs: 5,
    });
    await expect(
      service.wait(executionId, { timeout: 5_000, waitPollIntervalMs: 5 }),
    ).resolves.toEqual({ before: "before", after: "after" });

    const audit = await store.listAuditEntries(executionId);
    const kinds = audit.map((e) => e.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        "execution_status_changed",
        "note",
        "step_completed",
        "emit_published",
        "sleep_scheduled",
        "sleep_completed",
      ]),
    );

    expect(
      audit.some((e) => e.kind === "note" && e.message === "starting"),
    ).toBe(true);

    const internalSteps = audit.filter(
      (e) => e.kind === "step_completed" && e.isInternal,
    );
    expect(internalSteps.length).toBeGreaterThan(0);

    await runtime.dispose();
  });

  it("records signal waiting and delivery", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

    const durable = durableResource.fork(
      "durable.tests.audit.signal.delivered.durable",
    );
    const durableRegistration = durable.with({
      store,
      eventBus: bus,
      audit: { enabled: true },
      polling: { interval: 5 },
    });

    const task = r
      .task("durable.test.audit.signal.delivered")
      .dependencies({ durable })
      .run(async (_input: undefined, { durable }) => {
        const ctx = durable.use();
        const payment = await ctx.waitForSignal(Paid);
        await ctx.note("payment-received", { paidAt: payment.paidAt });
        return { ok: true };
      })
      .build();

    const app = r.resource("app").register([durableRegistration, task]).build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const executionId = await service.start(task, undefined, {
      timeout: 5_000,
      waitPollIntervalMs: 5,
    });

    await waitUntil(
      async () =>
        (await store.getExecution(executionId))?.status === "sleeping",
      { timeoutMs: 1000, intervalMs: 5 },
    );

    const waitingAudit = await store.listAuditEntries(executionId);
    expect(waitingAudit.some((e) => e.kind === "signal_waiting")).toBe(true);

    await service.signal(executionId, Paid, { paidAt: Date.now() });
    await expect(
      service.wait(executionId, { timeout: 5_000, waitPollIntervalMs: 5 }),
    ).resolves.toEqual({ ok: true });

    const finalAudit = await store.listAuditEntries(executionId);
    expect(finalAudit.some((e) => e.kind === "signal_delivered")).toBe(true);
    expect(finalAudit.some((e) => e.kind === "note")).toBe(true);

    await runtime.dispose();
  });

  it("records signal timeout", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

    const durable = durableResource.fork(
      "durable.tests.audit.signal.timeout.durable",
    );
    const durableRegistration = durable.with({
      store,
      eventBus: bus,
      audit: { enabled: true },
      polling: { interval: 5 },
    });

    const task = r
      .task("durable.test.audit.signal.timeout")
      .dependencies({ durable })
      .run(async (_input: undefined, { durable }) => {
        const ctx = durable.use();
        const outcome = await ctx.waitForSignal(Paid, { timeoutMs: 10 });
        return outcome.kind;
      })
      .build();

    const app = r.resource("app").register([durableRegistration, task]).build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const executionId = await service.start(task, undefined, {
      timeout: 5_000,
      waitPollIntervalMs: 5,
    });

    await expect(
      service.wait(executionId, { timeout: 5_000, waitPollIntervalMs: 5 }),
    ).resolves.toBe("timeout");

    const audit = await store.listAuditEntries(executionId);
    expect(audit.some((e) => e.kind === "signal_waiting")).toBe(true);
    expect(audit.some((e) => e.kind === "signal_timed_out")).toBe(true);

    await runtime.dispose();
  });
});
