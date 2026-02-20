import { r, run } from "../../..";
import { memoryDurableResource } from "../../durable/resources/memoryDurableResource";
import { createMessageError } from "../../../errors";

describe("durable: describe()", () => {
  it("describes a task using real non-durable deps and shimmed durable.use()", async () => {
    const durable = memoryDurableResource.fork(
      "durable.tests.recorder.durable",
    );

    const other = r
      .resource("durable.tests.recorder.other")
      .init(async () => ({ n: 2 }))
      .build();

    const task = r
      .task("durable.tests.recorder.task")
      .dependencies({ durable, other })
      .run(async (_input: undefined, deps) => {
        // Access a non-"use" property to cover the proxy passthrough path.
        if (typeof (deps.durable as any).start !== "function") {
          throw createMessageError("unexpected durable.start");
        }

        // This must work in describe mode; recorder uses real computed deps.
        if (deps.other.n !== 2) {
          throw createMessageError("unexpected other.n");
        }

        const ctx = deps.durable.use();
        await ctx.step("a", async () => "ok");
        await ctx.note("done");
      })
      .build();

    const app = r
      .resource("durable.tests.recorder.app")
      .register([durable.with({}), other, task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const durableRuntime = runtime.getResourceValue(durable);

    const shape = await durableRuntime.describe(task);
    expect(shape.nodes).toEqual([
      { kind: "step", stepId: "a", hasCompensation: false },
      { kind: "note", message: "done" },
    ]);

    await runtime.dispose();
  });

  it("throws when describing an unregistered task id", async () => {
    const durable = memoryDurableResource.fork(
      "durable.tests.recorder.durable.unregistered",
    );

    const registeredTask = r
      .task("durable.tests.recorder.task.registered")
      .run(async () => "ok")
      .build();

    const unregisteredTask = r
      .task("durable.tests.recorder.task.unregistered")
      .run(async () => "nope")
      .build();

    const app = r
      .resource("durable.tests.recorder.app.unregistered")
      .register([durable.with({}), registeredTask])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const durableRuntime = runtime.getResourceValue(durable);

    await expect(durableRuntime.describe(unregisteredTask)).rejects.toThrow(
      /task is not registered in the runtime store/,
    );

    await runtime.dispose();
  });
});
