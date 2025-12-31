import { r, run } from "../../..";
import { createDurableResource } from "../core/resource";
import { MemoryEventBus } from "../bus/MemoryEventBus";
import { MemoryStore } from "../store/MemoryStore";

describe("durable: DurableService integration", () => {
  it("executes and memoizes steps across resume (sleep)", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

    const durable = createDurableResource("durable.test.durable", {
      store,
      eventBus: bus,
      polling: { interval: 5 },
    });

    let stepExecutions = 0;
    const task = r
      .task("durable.test.sleep")
      .dependencies({ durable })
      .run(async (_input: { v: number }, { durable }) => {
        const ctx = durable.use();
        const before = await ctx.step("before", async () => {
          stepExecutions += 1;
          return "before";
        });

        await ctx.sleep(1);

        const after = await ctx.step("after", async () => "after");
        return { before, after };
      })
      .build();

    const app = r.resource("app").register([durable, task]).build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const res = await service.execute(task, { v: 1 }, {
      timeout: 5_000,
      waitPollIntervalMs: 5,
    });
    expect(res).toEqual({ before: "before", after: "after" });
    expect(stepExecutions).toBe(1);

    await runtime.dispose();
  });
});
