import { r, resources, run } from "../../../../node";

const redisUrl = process.env.DURABLE_TEST_REDIS_URL ?? "redis://localhost:6379";
const rabbitUrl = process.env.DURABLE_TEST_RABBIT_URL ?? "amqp://localhost";

const shouldRun = process.env.DURABLE_INTEGRATION === "1";

(shouldRun ? describe : describe.skip)("durable: real backends", () => {
  it("executes with Redis + RabbitMQ", async () => {
    const durable = resources.redisWorkflow.fork("durable-integration-durable");
    const durableRegistration = durable.with({
      namespace: "durable-integration-durable",
      redis: { url: redisUrl },
      queue: {
        url: rabbitUrl,
        consume: true,
        quorum: true,
      },
    });

    let ran = 0;
    const task = r
      .task("durable-integration-task")
      .dependencies({ durable })
      .run(async (_input: { v: number }, { durable }) => {
        const ctx = durable.use();
        return await ctx.step("once", async () => {
          ran += 1;
          return { ok: true, ran };
        });
      })
      .build();

    const app = r
      .resource("app")
      .register([resources.durable, durableRegistration, task])
      .build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const result = await service.startAndWait(task, { v: 1 });
    expect(result.data.ok).toBe(true);
    expect(result.data.ran).toBe(1);
    expect(result.durable.executionId).toEqual(expect.any(String));

    await runtime.dispose();
  }, 30_000);
});
