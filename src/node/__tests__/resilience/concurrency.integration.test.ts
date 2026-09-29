import { randomUUID } from "node:crypto";
import {
  r,
  run,
  resources,
  middleware,
  asyncContexts,
  Match,
} from "../../node";
import {
  middlewareConcurrencyQueueFullError,
  middlewareConcurrencyWaitTimeoutError,
} from "../../../errors";

const redis = process.env.RESILIENCE_REDIS_URL;
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

(redis ? describe : describe.skip)("Redis concurrency admission limits", () => {
  it("caps queues locally while sharing running permits globally", async () => {
    const namespace = randomUUID();
    const entered = gate();
    const release = gate();
    const task = r
      .task("limited")
      .middleware([
        middleware.task.concurrency.with({
          limit: 1,
          maxQueue: 1,
          keyBuilder: (_id, input) => String(input),
        }),
      ])
      .run(async (_input: string) => {
        entered.open();
        await release.promise;
        return "ok";
      })
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
    const held = first.runTask(task, "pool:a");
    await entered.promise;
    const rejected = gate();
    let rejectionCount = 0;
    const observe = (promise: Promise<string>) =>
      promise.catch((error: unknown) => {
        if (
          middlewareConcurrencyQueueFullError.is(error) &&
          ++rejectionCount === 2
        )
          rejected.open();
        return error;
      });
    const firstQueue = [
      observe(first.runTask(task, "pool:a")),
      observe(first.runTask(task, "pool:a")),
    ];
    const secondQueue = [
      observe(second.runTask(task, "pool:a")),
      observe(second.runTask(task, "pool:a")),
    ];
    try {
      await rejected.promise;
      expect(rejectionCount).toBe(2);
    } finally {
      release.open();
      await held;
    }
    try {
      const results = await Promise.all([...firstQueue, ...secondQueue]);
      expect(results.filter((value) => value === "ok")).toHaveLength(2);
      expect(
        results.filter((value) =>
          middlewareConcurrencyQueueFullError.is(value),
        ),
      ).toHaveLength(2);
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });

  it("applies dynamic keys and tenant identity consistently across replicas", async () => {
    const namespace = randomUUID();
    const entered = gate();
    const release = gate();
    const inputSchema = Match.compile({ key: String, hold: Boolean });
    const task = r
      .task("limited")
      .inputSchema(inputSchema)
      .middleware([
        middleware.task.concurrency.with({
          limit: 1,
          maxQueue: 0,
          keyBuilder: (_id, input) => inputSchema.parse(input).key,
          identityScope: { tenant: true, required: true },
        }),
      ])
      .run(async ({ key, hold }) => {
        if (hold) {
          entered.open();
          await release.promise;
        }
        return key;
      })
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
    const held = asyncContexts.identity.provide(
      { region: "eu", tenantId: "first" },
      () => first.runTask(task, { key: "provider:one", hold: true }),
    );
    try {
      await entered.promise;
      await expect(
        asyncContexts.identity.provide(
          { region: "eu", tenantId: "first" },
          () => second.runTask(task, { key: "provider:one", hold: false }),
        ),
      ).rejects.toThrow(/queue is full/);
      await expect(
        asyncContexts.identity.provide(
          { region: "eu", tenantId: "second" },
          () => second.runTask(task, { key: "provider:one", hold: false }),
        ),
      ).resolves.toBe("provider:one");
      await expect(
        asyncContexts.identity.provide(
          { region: "eu", tenantId: "first" },
          () => second.runTask(task, { key: "provider:two", hold: false }),
        ),
      ).resolves.toBe("provider:two");
    } finally {
      release.open();
      await held;
      await first.dispose();
      await second.dispose();
    }
  });

  it("times out waiting calls and reclaims cancelled waiters without running them", async () => {
    const namespace = randomUUID();
    const entered = gate();
    const release = gate();
    const handler = jest.fn(async (hold: boolean) => {
      if (hold) {
        entered.open();
        await release.promise;
      }
      return "ok";
    });
    const task = r
      .task("limited")
      .middleware([
        middleware.task.concurrency.with({
          limit: 1,
          maxQueue: 1,
          waitTimeoutMs: 100,
        }),
      ])
      .run(handler)
      .build();
    const runtime = await run(
      r
        .resource("app")
        .register([
          task,
          resources.resilience.with({ namespace, redis: redis! }),
        ])
        .build(),
    );
    const held = runtime.runTask(task, true);
    await entered.promise;
    try {
      const timeout = await runtime
        .runTask(task, false)
        .catch((error: unknown) => error);
      expect(middlewareConcurrencyWaitTimeoutError.is(timeout)).toBe(true);
      const controller = new AbortController();
      const cancelled = runtime
        .runTask(task, false, { signal: controller.signal })
        .catch((error: unknown) => error);
      controller.abort();
      expect(await cancelled).toBeInstanceOf(Error);
      const nextTimeout = await runtime
        .runTask(task, false)
        .catch((error: unknown) => error);
      expect(middlewareConcurrencyWaitTimeoutError.is(nextTimeout)).toBe(true);
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      release.open();
      await held;
      await runtime.dispose();
    }
  });
});
