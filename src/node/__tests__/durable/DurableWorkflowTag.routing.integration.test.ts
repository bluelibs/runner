import { r, run } from "../../..";
import { memoryDurableResource } from "../../durable/resources/memoryDurableResource";
import { durableWorkflowTag } from "../../durable/tags/durableWorkflow.tag";

describe("durable: durableWorkflowTag execution boundaries (integration)", () => {
  it("does not auto-route runtime.runTask(task) for tagged workflows", async () => {
    const durable = memoryDurableResource.fork("durable.tests.routing.direct");
    const durableRegistration = durable.with({ worker: false });

    const task = r
      .task("durable.tests.routing.direct.task")
      .dependencies({ durable })
      .tags([durableWorkflowTag.with({ category: "orders" })])
      .run(async (input: { v: number }, { durable }) => {
        const ctx = durable.use();
        const value = await ctx.step("double", async () => input.v * 2);
        return { value };
      })
      .build();

    const app = r
      .resource("durable.tests.routing.direct.app")
      .register([durableRegistration, task])
      .build();
    const runtime = await run(app, { logs: { printThreshold: null } });

    await expect(runtime.runTask(task, { v: 2 })).rejects.toThrow(
      "Durable context is not available",
    );

    await runtime.dispose();
  });

  it("executes tagged workflows explicitly via durable.startAndWait()", async () => {
    const durable = memoryDurableResource.fork("durable.tests.routing.execute");
    const durableRegistration = durable.with({ worker: false });

    const task = r
      .task("durable.tests.routing.execute.task")
      .dependencies({ durable })
      .tags([durableWorkflowTag.with({ category: "orders" })])
      .run(async (input: { v: number }, { durable }) => {
        const ctx = durable.use();
        const value = await ctx.step("double", async () => input.v * 2);
        return { value };
      })
      .build();

    const app = r
      .resource("durable.tests.routing.execute.app")
      .register([durableRegistration, task])
      .build();
    const runtime = await run(app, { logs: { printThreshold: null } });
    const durableRuntime = runtime.getResourceValue(durable);

    await expect(durableRuntime.startAndWait(task, { v: 2 })).resolves.toEqual(
      expect.objectContaining({
        durable: { executionId: expect.any(String) },
        data: { value: 4 },
      }),
    );

    const executions = await durableRuntime.operator.listExecutions({
      taskId: task.id,
    });
    expect(executions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: task.id,
          status: "completed",
          result: { value: 4 },
        }),
      ]),
    );

    await runtime.dispose();
  });

  it("can start tagged workflows by id and wait by execution id", async () => {
    const durable = memoryDurableResource.fork("durable.tests.routing.start");
    const durableRegistration = durable.with({ worker: false });

    const task = r
      .task("durable.tests.routing.start.task")
      .dependencies({ durable })
      .tags([durableWorkflowTag.with({ category: "orders" })])
      .run(async (input: { v: number }, { durable }) => {
        const ctx = durable.use();
        const value = await ctx.step("double", async () => input.v * 2);
        return { value };
      })
      .build();

    const app = r
      .resource("durable.tests.routing.start.app")
      .register([durableRegistration, task])
      .build();
    const runtime = await run(app, { logs: { printThreshold: null } });
    const durableRuntime = runtime.getResourceValue(durable);

    const executionId = await durableRuntime.start(task.id, { v: 3 });
    const result = await durableRuntime.wait<{ value: number }>(executionId);
    expect(result).toEqual({ value: 6 });

    await runtime.dispose();
  });
});
