import { r, run } from "../../..";
import { createDurableResource } from "../core/resource";
import { MemoryEventBus } from "../bus/MemoryEventBus";
import { MemoryQueue } from "../queue/MemoryQueue";
import { MemoryStore } from "../store/MemoryStore";

describe("durable: queue mode integration", () => {
  it("executes via queue + worker", async () => {
    const store = new MemoryStore();
    const queue = new MemoryQueue();
    const bus = new MemoryEventBus();

    const durable = createDurableResource("durable.tests.queue.durable", {
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

    const app = r.resource("app").register([durable, task]).build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const result = await service.execute(task, { v: 2 }, {
      timeout: 5_000,
      waitPollIntervalMs: 5,
    });
    expect(result).toEqual({ v: 4 });

    await runtime.dispose();
  });
});
