import { defineEvent, r, resources, run } from "../../node";
import { durableResource } from "../../durable/core/resource";
import { MemoryEventBus } from "../../durable/bus/MemoryEventBus";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { waitUntil } from "../../durable/test-utils";

describe("durable: signal timeout integration", () => {
  const Paid = defineEvent<{ paidAt: number }>({
    id: "durable-tests-timeout-paid",
  });

  it("returns timeout when no signal arrives before deadline", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

    const durable = durableResource.fork("durable-tests-timeout-durable");
    const durableRegistration = durable.with({
      store,
      eventBus: bus,
      polling: { interval: 5 },
    });

    const task = r
      .task("durable-test-waitForSignalOrTimeout")
      .dependencies({ durable })
      .run(async (_input: undefined, { durable }) => {
        const ctx = durable.use();
        return await ctx.waitForSignal(Paid, { timeoutMs: 30 });
      })
      .build();

    const app = r
      .resource("app")
      .register([resources.durable, durableRegistration, task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const executionId = await service.start(task, undefined, {
      timeout: 5_000,
    });

    await waitUntil(
      async () =>
        (await store.getExecution(executionId))?.status === "sleeping",
      { timeoutMs: 1000, intervalMs: 5 },
    );

    await expect(
      service.wait(executionId, { timeout: 5_000, waitPollIntervalMs: 5 }),
    ).resolves.toEqual({ kind: "timeout" });

    await runtime.dispose();
  });

  it("returns signal payload when signal arrives before deadline (and cancels timer)", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

    const durable = durableResource.fork(
      "durable-tests-timeout-durable-signal",
    );
    const durableRegistration = durable.with({
      store,
      eventBus: bus,
      polling: { interval: 5 },
    });

    const task = r
      .task("durable-test-waitForSignalOrTimeout-signal")
      .dependencies({ durable })
      .run(async (_input: undefined, { durable }) => {
        const ctx = durable.use();
        return await ctx.waitForSignal(Paid, { timeoutMs: 200 });
      })
      .build();

    const app = r
      .resource("app")
      .register([resources.durable, durableRegistration, task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const executionId = await service.start(task, undefined, {
      timeout: 5_000,
    });

    await waitUntil(
      async () =>
        (await store.getExecution(executionId))?.status === "sleeping",
      { timeoutMs: 1000, intervalMs: 5 },
    );

    await service.signal(executionId, Paid, { paidAt: 1 });

    await expect(
      service.wait(executionId, { timeout: 5_000, waitPollIntervalMs: 5 }),
    ).resolves.toEqual({ kind: "signal", payload: { paidAt: 1 } });

    const timers = await store.getReadyTimers(new Date(Date.now() + 5_000));
    expect(timers.some((t) => t.type === "signal_timeout")).toBe(false);

    await runtime.dispose();
  });
});
