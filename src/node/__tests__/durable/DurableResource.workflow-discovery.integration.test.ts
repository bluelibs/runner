import { r, resources, run, tags } from "../../node";

describe("durable: workflow discovery", () => {
  it("discovers tasks tagged with durable.workflow at runtime", async () => {
    const durable = resources.memoryWorkflow.fork(
      "durable-tests-discovery-resource",
    );

    const taggedWorkflow = r
      .task("durable-tests-discovery-tagged")
      .dependencies({ durable })
      .tags([tags.durableWorkflow.with({ category: "orders" })])
      .run(async (_input: undefined, { durable }) => {
        const ctx = durable.use();
        await ctx.step("once", async () => "ok");
        return "ok";
      })
      .build();

    const untaggedWorkflow = r
      .task("durable-tests-discovery-untagged")
      .dependencies({ durable })
      .run(async (_input: undefined, { durable }) => {
        const ctx = durable.use();
        await ctx.step("once", async () => "ok");
        return "ok";
      })
      .build();

    const app = r
      .resource("durable-tests-discovery-app")
      .register([
        resources.durable,
        durable.with({}),
        taggedWorkflow,
        untaggedWorkflow,
      ])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const durableRuntime = runtime.getResourceValue(durable);

    const discovered = durableRuntime.getWorkflows();
    expect(discovered.map((task) => task.id)).toEqual([
      runtime.store.findIdByDefinition(taggedWorkflow),
    ]);

    await runtime.dispose();
  });
});
