import { r, run } from "../../..";
import { memoryDurableResource } from "../../durable/resources/memoryDurableResource";
import { durableWorkflowTag } from "../../durable/tags/durableWorkflow.tag";
import { createMessageError } from "../../../errors";

describe("durable: describe() defaults", () => {
  it("uses durableWorkflowTag.defaults when describe() input is omitted", async () => {
    const durable = memoryDurableResource.fork(
      "durable.tests.recorder.defaults",
    );

    const task = r
      .task("durable.tests.recorder.task.defaults")
      .dependencies({ durable })
      .tags([
        durableWorkflowTag.with({
          category: "orders",
          defaults: { route: "default" },
        }),
      ])
      .run(async (input: { route: string }, { durable }) => {
        const ctx = durable.use();

        if (input.route === "default") {
          await ctx.step("from-default", async () => "ok");
          return;
        }

        await ctx.step("from-input", async () => "ok");
      })
      .build();

    const app = r
      .resource("durable.tests.recorder.app.defaults")
      .register([durable.with({}), task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const durableRuntime = runtime.getResourceValue(durable);

    const shape = await durableRuntime.describe(task);
    expect(shape.nodes).toEqual([
      { kind: "step", stepId: "from-default", hasCompensation: false },
    ]);

    await runtime.dispose();
  });

  it("prefers explicit describe() input over durableWorkflowTag.defaults", async () => {
    const durable = memoryDurableResource.fork(
      "durable.tests.recorder.defaults.override",
    );

    const task = r
      .task("durable.tests.recorder.task.defaults.override")
      .dependencies({ durable })
      .tags([
        durableWorkflowTag.with({
          category: "orders",
          defaults: { route: "default" },
        }),
      ])
      .run(async (input: { route: string }, { durable }) => {
        const ctx = durable.use();
        await ctx.step(
          input.route === "default" ? "from-default" : "from-explicit",
          async () => "ok",
        );
      })
      .build();

    const app = r
      .resource("durable.tests.recorder.app.defaults.override")
      .register([durable.with({}), task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const durableRuntime = runtime.getResourceValue(durable);

    const shape = await durableRuntime.describe(task, { route: "explicit" });
    expect(shape.nodes).toEqual([
      { kind: "step", stepId: "from-explicit", hasCompensation: false },
    ]);

    await runtime.dispose();
  });

  it("clones durableWorkflowTag.defaults for each describe() call", async () => {
    const durable = memoryDurableResource.fork(
      "durable.tests.recorder.defaults.clone",
    );

    const task = r
      .task("durable.tests.recorder.task.defaults.clone")
      .dependencies({ durable })
      .tags([
        durableWorkflowTag.with({
          category: "orders",
          defaults: { count: 1, nested: { values: [1] } },
        }),
      ])
      .run(
        async (
          input: { count: number; nested: { values: number[] } },
          { durable },
        ) => {
          const ctx = durable.use();

          await ctx.step(
            input.count === 1 ? "count-from-default" : "count-mutated",
            async () => "ok",
          );

          input.count += 1;
          input.nested.values.push(99);
        },
      )
      .build();

    const app = r
      .resource("durable.tests.recorder.app.defaults.clone")
      .register([durable.with({}), task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const durableRuntime = runtime.getResourceValue(durable);

    const first = await durableRuntime.describe(task);
    const second = await durableRuntime.describe(task);

    expect(first.nodes).toEqual([
      { kind: "step", stepId: "count-from-default", hasCompensation: false },
    ]);
    expect(second.nodes).toEqual([
      { kind: "step", stepId: "count-from-default", hasCompensation: false },
    ]);

    const tagConfig = durableWorkflowTag.extract(task.tags);
    expect(tagConfig?.defaults).toEqual({ count: 1, nested: { values: [1] } });

    await runtime.dispose();
  });

  it("fails fast when durableWorkflowTag.defaults cannot be cloned", async () => {
    const durable = memoryDurableResource.fork(
      "durable.tests.recorder.defaults.uncloneable",
    );

    const task = r
      .task("durable.tests.recorder.task.defaults.uncloneable")
      .dependencies({ durable })
      .tags([
        durableWorkflowTag.with({
          category: "orders",
          defaults: { bad: () => "nope" },
        }),
      ])
      .run(async (_input: { bad: unknown }, { durable }) => {
        const ctx = durable.use();
        await ctx.step("s1", async () => "ok");
      })
      .build();

    const app = r
      .resource("durable.tests.recorder.app.defaults.uncloneable")
      .register([durable.with({}), task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const durableRuntime = runtime.getResourceValue(durable);

    await expect(durableRuntime.describe(task)).rejects.toThrow(
      /durableWorkflowTag\.defaults could not be cloned/,
    );

    await runtime.dispose();
  });

  it("surfaces non-Error clone failures from structuredClone", async () => {
    const durable = memoryDurableResource.fork(
      "durable.tests.recorder.defaults.nonerror-clone-failure",
    );

    const task = r
      .task("durable.tests.recorder.task.defaults.nonerror-clone-failure")
      .dependencies({ durable })
      .tags([
        durableWorkflowTag.with({
          category: "orders",
          defaults: { count: 1 },
        }),
      ])
      .run(async (_input: { count: number }, { durable }) => {
        const ctx = durable.use();
        await ctx.step("s1", async () => "ok");
      })
      .build();

    const app = r
      .resource("durable.tests.recorder.app.defaults.nonerror-clone-failure")
      .register([durable.with({}), task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const durableRuntime = runtime.getResourceValue(durable);

    const cloneSpy = jest
      .spyOn(globalThis, "structuredClone")
      .mockImplementation(() => {
        throw "non-error-clone-failure";
      });

    try {
      await expect(durableRuntime.describe(task)).rejects.toThrow(
        /Original error: non-error-clone-failure/,
      );
    } finally {
      cloneSpy.mockRestore();
      await runtime.dispose();
    }
  });

  it("surfaces Error clone failures from structuredClone", async () => {
    const durable = memoryDurableResource.fork(
      "durable.tests.recorder.defaults.error-clone-failure",
    );

    const task = r
      .task("durable.tests.recorder.task.defaults.error-clone-failure")
      .dependencies({ durable })
      .tags([
        durableWorkflowTag.with({
          category: "orders",
          defaults: { count: 1 },
        }),
      ])
      .run(async (_input: { count: number }, { durable }) => {
        const ctx = durable.use();
        await ctx.step("s1", async () => "ok");
      })
      .build();

    const app = r
      .resource("durable.tests.recorder.app.defaults.error-clone-failure")
      .register([durable.with({}), task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const durableRuntime = runtime.getResourceValue(durable);

    const cloneSpy = jest
      .spyOn(globalThis, "structuredClone")
      .mockImplementation(() => {
        throw createMessageError("error-clone-failure");
      });

    try {
      await expect(durableRuntime.describe(task)).rejects.toThrow(
        /Original error: error-clone-failure/,
      );
    } finally {
      cloneSpy.mockRestore();
      await runtime.dispose();
    }
  });
});
