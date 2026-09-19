import { defineEvent, r, resources, run } from "../../../../node";
import { durableResource } from "../../../../durable/core/resource";
import { MemoryEventBus } from "../../../../durable/bus/MemoryEventBus";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { ExecutionStatus } from "../../../../durable/core/types";
import { waitUntil } from "../../../../durable/test-utils";

describe("durable: continueAsNew (integration)", () => {
  it("continues a workflow twice and resolves the root wait with the tip result", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

    const durable = durableResource.fork("durable-tests-continue");
    const durableRegistration = durable.with({
      store,
      eventBus: bus,
      polling: { interval: 5 },
    });

    const task = r
      .task("durable-test-continue")
      .dependencies({ durable })
      .run(async (input: { page: number }, { durable }) => {
        const ctx = durable.use();
        if (input.page < 3) {
          await ctx.continueAsNew({ page: input.page + 1 });
          throw new Error("unreachable: continueAsNew never returns");
        }
        return { page: input.page };
      })
      .build();

    const app = r
      .resource("app")
      .register([resources.durable, durableRegistration, task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const executionId = await service.start(task, { page: 1 });
    await expect(
      service.wait(executionId, { timeout: 10_000, waitPollIntervalMs: 5 }),
    ).resolves.toEqual({ page: 3 });

    const root = await store.getExecution(executionId);
    expect(root?.status).toBe(ExecutionStatus.ContinuedAsNew);
    const middle = await store.getExecution(root?.continuedAsExecutionId ?? "");
    expect(middle?.status).toBe(ExecutionStatus.ContinuedAsNew);
    expect(middle?.continuedFromExecutionId).toBe(executionId);
    const tip = await store.getExecution(middle?.continuedAsExecutionId ?? "");
    expect(tip?.status).toBe(ExecutionStatus.Completed);
    expect(tip?.result).toEqual({ page: 3 });
    expect(tip?.continuedFromExecutionId).toBe(middle?.id);

    await runtime.dispose();
  });

  it("routes parent waits and signals addressed at the root to the live tip", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

    const durable = durableResource.fork("durable-tests-continue-follow");
    const durableRegistration = durable.with({
      store,
      eventBus: bus,
      polling: { interval: 5 },
    });

    const Ping = defineEvent<{ ping: number }>({
      id: "durable-tests-continue-ping",
    });

    const child = r
      .task("durable-test-continue-child")
      .dependencies({ durable })
      .run(async (input: { hops: number }, { durable }) => {
        const ctx = durable.use();
        if (input.hops > 0) {
          await ctx.continueAsNew({ hops: input.hops - 1 });
          throw new Error("unreachable: continueAsNew never returns");
        }
        const received = await ctx.waitForSignal(Ping);
        return { pong: received.payload.ping + 1 };
      })
      .build();

    const parent = r
      .task("durable-test-continue-parent")
      .dependencies({ durable })
      .run(async (input: { childId: string }, { durable }) => {
        const ctx = durable.use();
        return await ctx.waitForExecution(child, input.childId);
      })
      .build();

    const app = r
      .resource("app")
      .register([resources.durable, durableRegistration, child, parent])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const childId = await service.start(child, { hops: 1 });
    await waitUntil(
      async () =>
        (await store.getExecution(childId))?.status ===
        ExecutionStatus.ContinuedAsNew,
      { timeoutMs: 5_000, intervalMs: 5 },
    );
    const tipId = (await store.getExecution(childId))?.continuedAsExecutionId;
    await waitUntil(
      async () =>
        (await store.getExecution(tipId ?? ""))?.status ===
        ExecutionStatus.Sleeping,
      { timeoutMs: 5_000, intervalMs: 5 },
    );

    const parentId = await service.start(parent, { childId });
    await service.signal(childId, Ping, { ping: 41 });
    await expect(
      service.wait(parentId, { timeout: 10_000, waitPollIntervalMs: 5 }),
    ).resolves.toEqual({ pong: 42 });

    await runtime.dispose();
  });
});
