import { r, run } from "../../..";
import { createDurableTestSetup, waitUntil } from "../../durable/test-utils";

describe("durable test utils", () => {
  it("creates a durable test setup with memory backends", async () => {
    const { durable, durableRegistration, store } = createDurableTestSetup();

    const task = r
      .task("durable.tests.utils.step")
      .dependencies({ durable })
      .run(async (_input: undefined, { durable }) => {
        const ctx = durable.use();
        const value = await ctx.step("step", async () => "ok");
        return { value };
      })
      .build();

    const app = r
      .resource("durable.tests.app")
      .register([durableRegistration, task])
      .build();
    const runtime = await run(app, { logs: { printThreshold: null } });
    const durableRuntime = runtime.getResourceValue(durable);

    await expect(durableRuntime.execute(task)).resolves.toEqual({
      value: "ok",
    });
    expect((await store.listExecutions({})).length).toBeGreaterThan(0);

    await runtime.dispose();
  });

  it("accepts overrides for polling and queue", async () => {
    const { durable, durableRegistration } = createDurableTestSetup({
      pollingIntervalMs: 1,
      durableConfig: { polling: { enabled: true, interval: 2 } },
    });

    const task = r
      .task("durable.tests.utils.overrides")
      .dependencies({ durable })
      .run(async (_input: undefined, { durable }) => {
        const ctx = durable.use();
        await ctx.step("once", async () => "done");
        return "done";
      })
      .build();

    const app = r
      .resource("durable.tests.app.overrides")
      .register([durableRegistration, task])
      .build();
    const runtime = await run(app, { logs: { printThreshold: null } });
    const durableRuntime = runtime.getResourceValue(durable);

    await expect(durableRuntime.execute(task)).resolves.toBe("done");

    await runtime.dispose();
  });

  it("waitUntil resolves when the predicate becomes true", async () => {
    let ready = false;
    setTimeout(() => {
      ready = true;
    }, 5);

    await waitUntil(() => ready, { timeoutMs: 200, intervalMs: 2 });
  });

  it("waitUntil rejects after timing out", async () => {
    await expect(
      waitUntil(() => false, { timeoutMs: 15, intervalMs: 5 }),
    ).rejects.toThrow("waitUntil timed out");
  });
});
