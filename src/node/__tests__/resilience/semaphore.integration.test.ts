import { randomUUID } from "node:crypto";
import { r, resources, middleware, run } from "../../node";

const redis = process.env.RESILIENCE_REDIS_URL;
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, promise };
}

(redis ? describe : describe.skip)("public distributed semaphore", () => {
  it("shares permits with concurrency middleware and handles across runtimes", async () => {
    const task = r
      .task("charge")
      .middleware([
        middleware.task.concurrency.with({
          key: "payments",
          limit: 1,
          maxQueue: 0,
          coordination: "distributed",
        }),
      ])
      .run(async () => "charged")
      .build();
    const namespace = randomUUID();
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
    const firstBackend = first.getResourceValue(resources.resilience);
    const secondBackend = second.getResourceValue(resources.resilience);
    const semaphore = firstBackend.semaphore({ key: "payments", limit: 1 });
    const entered = gate();
    const release = gate();
    const held = semaphore.withPermit(async () => {
      entered.open();
      await release.promise;
    });
    try {
      await entered.promise;
      await expect(second.runTask(task)).rejects.toThrow(/queue is full/);
      await expect(
        secondBackend
          .semaphore({ key: "payments", limit: 1, maxQueue: 0 })
          .withPermit(async () => "no"),
      ).rejects.toThrow(/queue is full/);
      await expect(
        secondBackend
          .semaphore({ key: "other", limit: 1 })
          .withPermit(async () => "independent"),
      ).resolves.toBe("independent");
      await expect(
        secondBackend
          .semaphore({ key: "payments", limit: 2 })
          .withPermit(async () => "no"),
      ).rejects.toThrow(/Conflicting/);
      release.open();
      await held;
      await expect(second.runTask(task)).resolves.toBe("charged");
      await expect(semaphore.withPermit(async () => 42)).resolves.toBe(42);
    } finally {
      release.open();
      await held;
      await first.dispose();
      await second.dispose();
    }
  });

  it("supports bounded waits and cancellation without consuming a permit", async () => {
    const runtime = await run(
      r
        .resource("app")
        .register([
          resources.resilience.with({ namespace: randomUUID(), redis: redis! }),
        ])
        .build(),
    );
    const backend = runtime.getResourceValue(resources.resilience);
    const entered = gate();
    const release = gate();
    const semaphore = backend.semaphore({ key: "pool", limit: 1 });
    const held = semaphore.withPermit(async () => {
      entered.open();
      await release.promise;
    });
    try {
      await entered.promise;
      await expect(
        backend
          .semaphore({ key: "pool", limit: 1, waitTimeoutMs: 20 })
          .withPermit(async () => "no"),
      ).rejects.toThrow(/timed out/);
      const caller = new AbortController();
      const callback = jest.fn();
      const pending = semaphore.withPermit(callback, { signal: caller.signal });
      const rejected = pending.catch((error: unknown) => error);
      caller.abort(new Error("cancelled"));
      expect(await rejected).toMatchObject({
        message: expect.stringMatching("cancelled"),
      });
      expect(callback).not.toHaveBeenCalled();
      release.open();
      await held;
      await expect(semaphore.withPermit(async () => "available")).resolves.toBe(
        "available",
      );
    } finally {
      release.open();
      await held;
      await runtime.dispose();
    }
  });
});
