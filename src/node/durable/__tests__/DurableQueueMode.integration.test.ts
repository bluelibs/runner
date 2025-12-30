import { r, run } from "../../..";
import { DurableWorker } from "../core/DurableWorker";
import { createDurableServiceResource } from "../core/resource";
import { durableContext } from "../context";
import { MemoryEventBus } from "../bus/MemoryEventBus";
import { MemoryQueue } from "../queue/MemoryQueue";
import { MemoryStore } from "../store/MemoryStore";

describe("durable: queue mode integration", () => {
  it("executes via queue + worker", async () => {
    const store = new MemoryStore();
    const queue = new MemoryQueue();
    const bus = new MemoryEventBus();

    const task = r
      .task("durable.test.queue")
      .dependencies({ durableContext })
      .run(async (input: { v: number }, { durableContext }) => {
        const ctx = durableContext.use();
        const v = await ctx.step("double", async () => input.v * 2);
        return { v };
      })
      .build();

    const durableService = createDurableServiceResource({
      store,
      queue,
      eventBus: bus,
      tasks: [task],
    });

    const durableWorker = DurableWorker.create(durableService, { queue });

    const app = r
      .resource("app")
      .register([durableService, durableWorker, durableContext, task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durableService);

    const result = await service.execute(task, { v: 2 }, { timeout: 5_000 });
    expect(result).toEqual({ v: 4 });

    await runtime.dispose();
  });
});
