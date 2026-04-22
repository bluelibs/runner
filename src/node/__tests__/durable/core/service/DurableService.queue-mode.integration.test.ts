import { r, resources, run } from "../../../../node";

describe("durable: queue mode integration", () => {
  it("executes via queue + embedded queue consumer", async () => {
    const durable = resources.memoryWorkflow.fork(
      "durable-tests-queue-durable",
    );
    const durableRegistration = durable.with({
      queue: { consume: true },
    });

    const task = r
      .task("durable-test-queue")
      .dependencies({ durable })
      .run(async (input: { v: number }, { durable }) => {
        const ctx = durable.use();
        const v = await ctx.step("double", async () => input.v * 2);
        return { v };
      })
      .build();

    const app = r
      .resource("app")
      .register([resources.durable, durableRegistration, task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const result = await service.startAndWait(
      task,
      { v: 2 },
      {
        timeout: 5_000,
        waitPollIntervalMs: 5,
      },
    );
    expect(result).toEqual({
      durable: { executionId: expect.any(String) },
      data: { v: 4 },
    });

    await runtime.dispose();
  });
});
