import { defineEvent, r, resources, run } from "../../../../node";
import { durableResource } from "../../../../durable/core/resource";
import { MemoryEventBus } from "../../../../durable/bus/MemoryEventBus";
import { MemoryStore } from "../../../../durable/store/MemoryStore";
import { ExecutionStatus } from "../../../../durable/core/types";
import { waitUntil } from "../../../../durable/test-utils";

describe("durable: continueAsNew signal backlog (integration)", () => {
  it("hands signals buffered on the prior run to the successor", async () => {
    const store = new MemoryStore();
    const durable = durableResource.fork("durable-tests-continue-backlog");
    const Item = defineEvent<{ n: number }>({
      id: "durable-tests-continue-backlog-item",
    });

    const task = r
      .task("durable-tests-continue-backlog-task")
      .dependencies({ durable })
      .run(async (input: { page: number }, { durable }) => {
        const ctx = durable.use();
        if (input.page === 1) {
          await ctx.waitForSignal(Item, { stepId: "first" });
          await ctx.sleep(100, { stepId: "work" });
          await ctx.continueAsNew({ page: 2 });
        }
        const next = await ctx.waitForSignal(Item, { stepId: "next" });
        return next.payload.n;
      })
      .build();

    const app = r
      .resource("app")
      .register([
        resources.durable,
        durable.with({
          store,
          eventBus: new MemoryEventBus(),
          polling: { interval: 5 },
        }),
        task,
      ])
      .build();
    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const executionId = await service.start(task, { page: 1 });
    await waitUntil(
      async () =>
        (await store.getExecution(executionId))?.status ===
        ExecutionStatus.Sleeping,
      { timeoutMs: 5_000, intervalMs: 5 },
    );
    await service.signal(executionId, Item, { n: 1 });
    await waitUntil(
      async () =>
        (await store.getExecution(executionId))?.current?.kind === "sleep",
      { timeoutMs: 5_000, intervalMs: 5 },
    );
    // Arrives while page 1 sleeps: nobody waits for it yet, so it buffers
    // on the prior run and must survive the continuation.
    await service.signal(executionId, Item, { n: 2 });

    await expect(
      service.wait(executionId, { timeout: 5_000, waitPollIntervalMs: 5 }),
    ).resolves.toBe(2);
    expect((await store.getSignalState(executionId, Item.id))?.queued).toEqual(
      [],
    );

    await runtime.dispose();
  }, 10_000);
});
