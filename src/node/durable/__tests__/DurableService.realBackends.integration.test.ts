import { r, run } from "../../..";
import { RabbitMQQueue } from "../queue/RabbitMQQueue";
import { RedisEventBus } from "../bus/RedisEventBus";
import { RedisStore } from "../store/RedisStore";
import { durableResource } from "../core/resource";

const redisUrl = process.env.DURABLE_TEST_REDIS_URL ?? "redis://localhost:6379";
const rabbitUrl = process.env.DURABLE_TEST_RABBIT_URL ?? "amqp://localhost";

const shouldRun = process.env.DURABLE_INTEGRATION === "1";

(shouldRun ? describe : describe.skip)("durable: real backends", () => {
  it("executes with Redis + RabbitMQ", async () => {
    const store = new RedisStore({ redis: redisUrl, prefix: "durable:test:" });
    const bus = new RedisEventBus({
      redis: redisUrl,
      prefix: "durable:test:bus:",
    });
    const queue = new RabbitMQQueue({
      url: rabbitUrl,
      queue: {
        name: "durable_test_queue",
        quorum: true,
        deadLetter: "durable_test_dlq",
      },
    });

    const durable = durableResource.fork("durable.integration.durable");
    const durableRegistration = durable.with({
      store,
      queue,
      eventBus: bus,
      worker: true,
    });

    let ran = 0;
    const task = r
      .task("durable.integration.task")
      .dependencies({ durable })
      .run(async (_input: { v: number }, { durable }) => {
        const ctx = durable.use();
        return await ctx.step("once", async () => {
          ran += 1;
          return { ok: true, ran };
        });
      })
      .build();

    const app = r.resource("app").register([durableRegistration, task]).build();

    const runtime = await run(app, { logs: { printThreshold: null } });
    const service = runtime.getResourceValue(durable);

    const result = await service.execute(task, { v: 1 });
    expect(result.ok).toBe(true);
    expect(result.ran).toBe(1);

    await runtime.dispose();
  }, 30_000);
});
