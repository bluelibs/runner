import type Redis from "ioredis";
import { randomUUID } from "node:crypto";
import { r, resources, middleware, run } from "../../node";
import * as transport from "../../durable/optionalDeps/ioredis";

const url = process.env.RESILIENCE_REDIS_URL;
(url ? describe : describe.skip)("resilience connection recovery", () => {
  it("fails disconnected calls promptly and admits future calls after reconnect", async () => {
    let owned!: Redis;
    const createClient = transport.createIORedisClient;
    const factory = jest
      .spyOn(transport, "createIORedisClient")
      .mockImplementation((url, options) => {
        owned = createClient(url, options) as Redis;
        return owned;
      });
    const admin = createClient(url) as Redis;
    const handler = jest.fn(async () => "ok");
    const task = r
      .task("limited")
      .middleware([
        middleware.task.rateLimit.with({ max: 10, windowMs: 60_000 }),
      ])
      .run(handler)
      .build();
    const runtime = await run(
      r
        .resource("app")
        .register([
          task,
          resources.resilience.with({ namespace: randomUUID(), redis: url! }),
        ])
        .build(),
    );
    try {
      await expect(runtime.runTask(task)).resolves.toBe("ok");
      const id = Number(await owned.client("ID"));
      const closed = new Promise<void>((resolve) =>
        owned.once("close", resolve),
      );
      const ready = new Promise<void>((resolve) =>
        owned.once("ready", resolve),
      );
      await admin.client("KILL", "ID", id);
      await closed;
      await expect(runtime.runTask(task)).rejects.toThrow();
      expect(handler).toHaveBeenCalledTimes(1);
      await ready;
      await expect(runtime.runTask(task)).resolves.toBe("ok");
      expect(handler).toHaveBeenCalledTimes(2);
    } finally {
      await runtime.dispose();
      admin.disconnect();
      factory.mockRestore();
    }
  });
});
