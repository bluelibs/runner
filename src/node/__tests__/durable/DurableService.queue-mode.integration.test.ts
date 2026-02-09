import { r, run } from "../../..";
import { durableResource } from "../../durable/core/resource";
import { MemoryEventBus } from "../../durable/bus/MemoryEventBus";
import { MemoryQueue } from "../../durable/queue/MemoryQueue";
import { MemoryStore } from "../../durable/store/MemoryStore";

describe("durable: queue mode integration", () => {
  it("executes via queue + worker", async () => {
    const store = new MemoryStore();
    const queue = new MemoryQueue();
    const bus = new MemoryEventBus();

    const durable = durableResource.fork("durable.tests.queue.durable");
    const durableRegistration = durable.with({
      store,
      queue,
      eventBus: bus,
      worker: true,
    });

    const task = r
      .task("durable.test.queue")
      .dependencies({ durable })
      .run(async (input: { v: number }, { durable }) => {
        const ctx = durable.use();
        const v = await ctx.step("double", async () => input.v * 2);
        return { v };
      })
      .build();

    const app = r.resource("app").register([durableRegistration, task]).build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const result = await service.startAndWait(
      task,
      { v: 2 },
      {
        timeout: 5_000,
        waitPollIntervalMs: 5,
      },
    );
    expect(result).toEqual({ v: 4 });

    await runtime.dispose();
  });
});
