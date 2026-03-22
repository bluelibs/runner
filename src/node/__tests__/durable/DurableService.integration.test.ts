import { r, resources, run, tags } from "../../node";
import { durableResource } from "../../durable/core/resource";
import { MemoryEventBus } from "../../durable/bus/MemoryEventBus";
import { MemoryStore } from "../../durable/store/MemoryStore";

describe("durable: DurableService integration", () => {
  it("executes and memoizes steps across resume (sleep)", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

    const durable = durableResource.fork("durable-test-durable");
    const durableRegistration = durable.with({
      store,
      eventBus: bus,
      polling: { interval: 5 },
    });

    let stepExecutions = 0;
    const task = r
      .task("durable-test-sleep")
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

    const app = r
      .resource("app")
      .register([resources.durable, durableRegistration, task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const res = await service.startAndWait(
      task,
      { v: 1 },
      {
        timeout: 5_000,
        waitPollIntervalMs: 5,
      },
    );
    expect(res).toEqual({
      durable: { executionId: expect.any(String) },
      data: { before: "before", after: "after" },
    });
    expect(stepExecutions).toBe(1);

    await runtime.dispose();
  });

  it("workflow() auto-links parent executions and returns child execution ids", async () => {
    const store = new MemoryStore();
    const bus = new MemoryEventBus();

    const durable = durableResource.fork("durable-test-parent-link");
    const durableRegistration = durable.with({
      store,
      eventBus: bus,
      polling: { interval: 5 },
    });

    const childTask = r
      .task("durable-test-child")
      .tags([tags.durableWorkflow.with({ category: "tests" })])
      .run(async () => "child-ok")
      .build();

    const parentTask = r
      .task("durable-test-parent")
      .dependencies({ durable })
      .run(async (_input: undefined, { durable }) => {
        const ctx = durable.use();
        const childExecutionId = await ctx.workflow("start-child", childTask);
        const childResult = await ctx.waitForExecution(
          childTask,
          childExecutionId,
        );
        return { childExecutionId, childResult };
      })
      .build();

    const app = r
      .resource("app")
      .register([resources.durable, durableRegistration, childTask, parentTask])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const parentResult = await service.startAndWait(parentTask, undefined, {
      completionTimeout: 5_000,
      waitPollIntervalMs: 5,
    });

    expect(parentResult.data).toEqual({
      childExecutionId: expect.any(String),
      childResult: "child-ok",
    });

    await expect(
      store.getExecution(parentResult.durable.executionId),
    ).resolves.toEqual(
      expect.objectContaining({ parentExecutionId: undefined }),
    );
    await expect(
      store.getExecution(parentResult.data.childExecutionId),
    ).resolves.toEqual(
      expect.objectContaining({
        parentExecutionId: parentResult.durable.executionId,
      }),
    );

    await runtime.dispose();
  });
});
