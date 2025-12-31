import { event, r, run } from "../../..";
import { createDurableResource } from "../core/resource";
import { MemoryEventBus } from "../bus/MemoryEventBus";
import { MemoryStore } from "../store/MemoryStore";

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  options: { timeoutMs: number; intervalMs: number },
): Promise<void> {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > options.timeoutMs) {
      throw new Error("waitUntil timed out");
    }
    await new Promise((r) => setTimeout(r, options.intervalMs));
  }
}

describe("durable: signals integration", () => {
  const Paid = event<{ paidAt: number }>({ id: "durable.tests.signals.paid" });

  it("waits for a signal and resumes the workflow", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

    const durable = createDurableResource("durable.tests.signals.durable", {
      store,
      eventBus: bus,
      polling: { interval: 5 },
    });

    const task = r
      .task("durable.test.waitForSignal")
      .dependencies({ durable })
      .run(async (_input: undefined, { durable }) => {
        const ctx = durable.use();
        const payment = await ctx.waitForSignal(Paid);
        return { ok: true, paidAt: payment.paidAt };
      })
      .build();

    const app = r.resource("app").register([durable, task]).build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const executionId = await service.startExecution(task, undefined, {
      timeout: 5_000,
      waitPollIntervalMs: 5,
    });

    await waitUntil(
      async () =>
        (await store.getExecution(executionId))?.status === "sleeping",
      { timeoutMs: 1000, intervalMs: 5 },
    );

    await service.signal(executionId, Paid, { paidAt: Date.now() });
    await expect(
      service.wait(executionId, { timeout: 5_000, waitPollIntervalMs: 5 }),
    ).resolves.toEqual(expect.objectContaining({ ok: true }));

    await runtime.dispose();
  });

  it("supports waiting for the same signal multiple times", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

    const durable = createDurableResource(
      "durable.tests.signals.durable.twice",
      {
        store,
        eventBus: bus,
        polling: { interval: 5 },
      },
    );

    const task = r
      .task("durable.test.waitForSignal.twice")
      .dependencies({ durable })
      .run(async (_input: undefined, { durable }) => {
        const ctx = durable.use();
        const first = await ctx.waitForSignal(Paid);
        const second = await ctx.waitForSignal(Paid);
        return { first, second };
      })
      .build();

    const app = r.resource("app").register([durable, task]).build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const executionId = await service.startExecution(task, undefined, {
      timeout: 5_000,
      waitPollIntervalMs: 5,
    });

    await waitUntil(
      async () =>
        (await store.getExecution(executionId))?.status === "sleeping",
      { timeoutMs: 1000, intervalMs: 5 },
    );

    await service.signal(executionId, Paid, { paidAt: 1 });

    await waitUntil(
      async () => {
        const exec = await store.getExecution(executionId);
        const secondWait = await store.getStepResult(
          executionId,
          "__signal:durable.tests.signals.paid:1",
        );

        return (
          exec?.status === "sleeping" &&
          typeof secondWait?.result === "object" &&
          secondWait?.result !== null &&
          (secondWait.result as { state?: unknown }).state === "waiting"
        );
      },
      { timeoutMs: 1000, intervalMs: 5 },
    );

    await service.signal(executionId, Paid, { paidAt: 2 });

    await expect(
      service.wait(executionId, { timeout: 5_000, waitPollIntervalMs: 5 }),
    ).resolves.toEqual({
      first: { paidAt: 1 },
      second: { paidAt: 2 },
    });

    await runtime.dispose();
  });
});
