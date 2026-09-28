import { r, resources, run } from "../../../../node";
import { durableResource } from "../../../../durable/core/resource";
import { MemoryEventBus } from "../../../../durable/bus/MemoryEventBus";
import { MemoryStore } from "../../../../durable/store/MemoryStore";

describe("durable: restart (integration)", () => {
  it("restarts a completed workflow as a fresh linked run", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

    const durable = durableResource.fork("durable-tests-restart");
    const durableRegistration = durable.with({
      store,
      eventBus: bus,
      polling: { interval: 5 },
    });

    const task = r
      .task("durable-test-restart")
      .dependencies({ durable })
      .run(async (input: { v: number }) => ({ v: input.v + 1 }))
      .build();

    const app = r
      .resource("app")
      .register([resources.durable, durableRegistration, task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const executionId = await service.start(task, { v: 1 });
    await expect(
      service.wait(executionId, { timeout: 5_000, waitPollIntervalMs: 5 }),
    ).resolves.toEqual({ v: 2 });

    const restartedId = await service.restartExecution(executionId);
    expect(restartedId).not.toBe(executionId);
    await expect(
      service.wait(restartedId, { timeout: 5_000, waitPollIntervalMs: 5 }),
    ).resolves.toEqual({ v: 2 });

    const source = await store.getExecution(executionId);
    expect(source?.restartedAsExecutionId).toBe(restartedId);
    const restarted = await store.getExecution(restartedId);
    expect(restarted?.restartedFromExecutionId).toBe(executionId);
    expect(restarted?.attempt).toBe(1);

    const overriddenId = await service.restartExecution(executionId, {
      input: { v: 10 },
    });
    await expect(
      service.wait(overriddenId, { timeout: 5_000, waitPollIntervalMs: 5 }),
    ).resolves.toEqual({ v: 11 });

    await runtime.dispose();
  });

  it("rejects restarting an active execution end to end", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

    const durable = durableResource.fork("durable-tests-restart-active");
    const durableRegistration = durable.with({
      store,
      eventBus: bus,
      polling: { interval: 5 },
    });

    const task = r
      .task("durable-test-restart-active")
      .dependencies({ durable })
      .run(async (_input: undefined, { durable }) => {
        const ctx = durable.use();
        await ctx.sleep(60, { stepId: "nap" });
        return "woke";
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

    await expect(service.restartExecution(executionId)).rejects.toThrow(
      `Cannot restart execution "${executionId}" with status "sleeping".`,
    );

    await service.pauseExecution(executionId);
    const restartedId = await service.restartExecution(executionId);
    expect(restartedId).not.toBe(executionId);
    await expect(
      service.wait(restartedId, { timeout: 5_000, waitPollIntervalMs: 5 }),
    ).resolves.toBe("woke");

    await runtime.dispose();
  });
});
