import { r, resources, run } from "../../node";
import { genericError } from "../../../errors";

describe("durable: describe()", () => {
  it("describes a task using cloned non-durable deps and shimmed durable.use()", async () => {
    const durable = resources.memoryWorkflow.fork(
      "durable-tests-recorder-durable",
    );

    const other = r
      .resource("durable-tests-recorder-other")
      .init(async () => ({ n: 2 }))
      .build();

    const task = r
      .task("durable-tests-recorder-task")
      .dependencies({ durable, other })
      .run(async (_input: undefined, deps) => {
        // Access a non-"use" property to cover the proxy passthrough path.
        if (typeof (deps.durable as any).start !== "function") {
          throw genericError.new({ message: "unexpected durable.start" });
        }

        // Describe mode reads from a cloned dependency snapshot.
        if (deps.other.n !== 2) {
          throw genericError.new({ message: "unexpected other.n" });
        }
        deps.other.n = 99;

        const ctx = deps.durable.use();
        await ctx.step("a", async () => "ok");
        await ctx.note("done");
      })
      .build();

    const app = r
      .resource("durable-tests-recorder-app")
      .register([resources.durable, durable.with({}), other, task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const durableRuntime = runtime.getResourceValue(durable);

    const shape = await durableRuntime.describe(task);
    expect(shape.nodes).toEqual([
      { kind: "step", stepId: "a", hasCompensation: false },
      { kind: "note", message: "done" },
    ]);
    expect(runtime.getResourceValue(other)).toEqual({ n: 2 });

    await runtime.dispose();
  });

  it("throws when a non-durable dependency is not structured-cloneable", async () => {
    const durable = resources.memoryWorkflow.fork(
      "durable-tests-recorder-durable-noncloneable",
    );

    const other = r
      .resource("durable-tests-recorder-other-noncloneable")
      .init(async () => ({
        mutate: () => "boom",
      }))
      .build();

    const task = r
      .task("durable-tests-recorder-task-noncloneable")
      .dependencies({ durable, other })
      .run(async (_input: undefined, deps) => {
        const ctx = deps.durable.use();
        await ctx.note("should-not-run");
      })
      .build();

    const app = r
      .resource("durable-tests-recorder-app-noncloneable")
      .register([resources.durable, durable.with({}), other, task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const durableRuntime = runtime.getResourceValue(durable);

    await expect(durableRuntime.describe(task)).rejects.toThrow(
      /dependency "other" is not structured-cloneable/,
    );

    await runtime.dispose();
  });

  it("keeps the original message when structuredClone throws a non-Error", async () => {
    const durable = resources.memoryWorkflow.fork(
      "durable-tests-recorder-durable-nonerror-clone",
    );

    const other = r
      .resource("durable-tests-recorder-other-nonerror-clone")
      .init(async () => ({ value: 1 }))
      .build();

    const task = r
      .task("durable-tests-recorder-task-nonerror-clone")
      .dependencies({ durable, other })
      .run(async (_input: undefined, deps) => {
        const ctx = deps.durable.use();
        await ctx.note("noop");
      })
      .build();

    const app = r
      .resource("durable-tests-recorder-app-nonerror-clone")
      .register([resources.durable, durable.with({}), other, task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const durableRuntime = runtime.getResourceValue(durable);
    const structuredCloneSpy = jest
      .spyOn(globalThis, "structuredClone")
      .mockImplementationOnce(() => {
        throw "clone-failed";
      });
    try {
      await expect(durableRuntime.describe(task)).rejects.toThrow(
        /Original error: clone-failed/,
      );
    } finally {
      structuredCloneSpy.mockRestore();
      await runtime.dispose();
    }
  });

  it("keeps the original message when structuredClone throws an Error", async () => {
    const durable = resources.memoryWorkflow.fork(
      "durable-tests-recorder-durable-error-clone",
    );

    const other = r
      .resource("durable-tests-recorder-other-error-clone")
      .init(async () => ({ value: 1 }))
      .build();

    const task = r
      .task("durable-tests-recorder-task-error-clone")
      .dependencies({ durable, other })
      .run(async (_input: undefined, deps) => {
        const ctx = deps.durable.use();
        await ctx.note("noop");
      })
      .build();

    const app = r
      .resource("durable-tests-recorder-app-error-clone")
      .register([resources.durable, durable.with({}), other, task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const durableRuntime = runtime.getResourceValue(durable);
    const structuredCloneSpy = jest
      .spyOn(globalThis, "structuredClone")
      .mockImplementationOnce(() => {
        throw new Error("clone-failed-error");
      });
    try {
      await expect(durableRuntime.describe(task)).rejects.toThrow(
        /Original error: clone-failed-error/,
      );
    } finally {
      structuredCloneSpy.mockRestore();
      await runtime.dispose();
    }
  });

  it("surfaces non-Error structuredClone failures from describe dependency snapshots", async () => {
    const durable = resources.memoryWorkflow.fork(
      "durable-tests-recorder-durable-private-clone",
    );
    const app = r
      .resource("durable-tests-recorder-app-private-clone")
      .register([resources.durable, durable.with({})])
      .build();
    const runtime = await run(app, { logs: { printThreshold: null } });
    const durableRuntime = runtime.getResourceValue(durable);
    const structuredCloneSpy = jest
      .spyOn(globalThis, "structuredClone")
      .mockImplementation(() => {
        throw "clone-failed-private";
      });
    try {
      expect(() =>
        (durableRuntime as any).createDescribeDependencies(
          "task-id",
          { other: { value: 1 } },
          {},
        ),
      ).toThrow(/clone-failed-private/);
    } finally {
      structuredCloneSpy.mockRestore();
      await runtime.dispose();
    }
  });

  it("throws when describing an unregistered task id", async () => {
    const durable = resources.memoryWorkflow.fork(
      "durable-tests-recorder-durable-unregistered",
    );

    const registeredTask = r
      .task("durable-tests-recorder-task-registered")
      .run(async () => "ok")
      .build();

    const unregisteredTask = r
      .task("durable-tests-recorder-task-unregistered")
      .run(async () => "nope")
      .build();

    const app = r
      .resource("durable-tests-recorder-app-unregistered")
      .register([resources.durable, durable.with({}), registeredTask])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const durableRuntime = runtime.getResourceValue(durable);

    await expect(durableRuntime.describe(unregisteredTask)).rejects.toThrow(
      /task is not registered in the runtime store/,
    );

    await runtime.dispose();
  });
});
