import { randomUUID } from "node:crypto";
import { r, resources, middleware, run } from "../../node";

const redis = process.env.RESILIENCE_REDIS_URL;
(redis ? describe : describe.skip)("distributed policy composition", () => {
  it("keeps stacked rate policies separate and shares each across replicas", async () => {
    const namespace = randomUUID();
    const task = r
      .task("limited")
      .middleware([
        middleware.task.rateLimit.with({ max: 2, windowMs: 60_000 }),
        middleware.task.rateLimit.with({ max: 3, windowMs: 120_000 }),
      ])
      .run(async () => "ok")
      .build();
    const app = () =>
      r
        .resource("app")
        .register([
          task,
          resources.resilience.with({ namespace, redis: redis! }),
        ])
        .build();
    const first = await run(app());
    const second = await run(app());
    try {
      await expect(first.runTask(task)).resolves.toBe("ok");
      await expect(second.runTask(task)).resolves.toBe("ok");
      await expect(first.runTask(task)).rejects.toThrow(/Rate limit exceeded/);
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });

  it("does not acquire the same implicit permit twice for nested layers", async () => {
    const task = r
      .task("limited")
      .middleware([
        middleware.task.concurrency.with({ limit: 1, waitTimeoutMs: 100 }),
        middleware.task.concurrency.with({ limit: 1, waitTimeoutMs: 100 }),
      ])
      .run(async () => "ok")
      .build();
    const runtime = await run(
      r
        .resource("app")
        .register([
          task,
          resources.resilience.with({ namespace: randomUUID(), redis: redis! }),
        ])
        .build(),
    );
    try {
      await expect(runtime.runTask(task)).resolves.toBe("ok");
    } finally {
      await runtime.dispose();
    }
  });

  it("isolates stacked circuit configurations", async () => {
    const task = r
      .task("limited")
      .middleware([
        middleware.task.circuitBreaker.with({
          failureThreshold: 2,
          resetTimeout: 1000,
        }),
        middleware.task.circuitBreaker.with({
          failureThreshold: 3,
          resetTimeout: 2000,
        }),
      ])
      .run(async () => "ok")
      .build();
    const runtime = await run(
      r
        .resource("app")
        .register([
          task,
          resources.resilience.with({ namespace: randomUUID(), redis: redis! }),
        ])
        .build(),
    );
    try {
      await expect(runtime.runTask(task)).resolves.toBe("ok");
    } finally {
      await runtime.dispose();
    }
  });
});
