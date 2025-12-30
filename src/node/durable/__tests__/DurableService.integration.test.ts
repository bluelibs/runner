import { r, run } from "../../..";
import { createDurableServiceResource } from "../core/resource";
import { durableContext } from "../context";
import { MemoryEventBus } from "../bus/MemoryEventBus";
import { MemoryStore } from "../store/MemoryStore";

describe("durable: DurableService integration", () => {
  it("executes and memoizes steps across resume (sleep)", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

    let stepExecutions = 0;
    const task = r
      .task("durable.test.sleep")
      .dependencies({ durableContext })
      .run(async (_input: { v: number }, { durableContext }) => {
        const ctx = durableContext.use();
        const before = await ctx.step("before", async () => {
          stepExecutions += 1;
          return "before";
        });

        await ctx.sleep(1);

        const after = await ctx.step("after", async () => "after");
        return { before, after };
      })
      .build();

    const durableService = createDurableServiceResource({
      store,
      eventBus: bus,
      polling: { interval: 5 },
      tasks: [task],
    });

    const app = r
      .resource("app")
      .register([durableService, durableContext, task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durableService);

    const res = await service.execute(task, { v: 1 }, { timeout: 5_000 });
    expect(res).toEqual({ before: "before", after: "after" });
    expect(stepExecutions).toBe(1);

    await runtime.dispose();
  });
});
