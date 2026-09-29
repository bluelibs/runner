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
(redis ? describe : describe.skip)(
  "mixed local and distributed coordination",
  () => {
    it("isolates local quotas while sharing distributed quotas in the same runtimes", async () => {
      const local = r
        .task("local")
        .middleware([
          middleware.task.rateLimit.with({
            max: 1,
            windowMs: 60_000,
            coordination: "local",
          }),
        ])
        .run(async () => "ok")
        .build();
      const remote = r
        .task("remote")
        .middleware([
          middleware.task.rateLimit.with({
            max: 1,
            windowMs: 60_000,
            coordination: "distributed",
          }),
        ])
        .run(async () => "ok")
        .build();
      const namespace = randomUUID();
      const app = () =>
        r
          .resource("app")
          .register([
            local,
            remote,
            resources.resilience.with({ namespace, redis: redis! }),
          ])
          .build();
      const first = await run(app());
      const second = await run(app());
      try {
        await expect(first.runTask(local)).resolves.toBe("ok");
        await expect(second.runTask(local)).resolves.toBe("ok");
        await expect(first.runTask(local)).rejects.toThrow(
          /Rate limit exceeded/,
        );
        await expect(first.runTask(remote)).resolves.toBe("ok");
        await expect(second.runTask(remote)).rejects.toThrow(
          /Rate limit exceeded/,
        );
      } finally {
        await first.dispose();
        await second.dispose();
      }
    });

    it.each(["local", "distributed"] as const)(
      "coordinates circuit state with %s scope",
      async (coordination) => {
        let fail = true;
        const task = r
          .task("call")
          .middleware([
            middleware.task.circuitBreaker.with({
              failureThreshold: 1,
              resetTimeout: 60_000,
              coordination,
            }),
          ])
          .run(async () => {
            if (fail) throw new Error("provider failed");
            return "ok";
          })
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
        try {
          await expect(first.runTask(task)).rejects.toThrow("provider failed");
          fail = false;
          await expect(first.runTask(task)).rejects.toThrow(/Circuit/);
          if (coordination === "local")
            await expect(second.runTask(task)).resolves.toBe("ok");
          else await expect(second.runTask(task)).rejects.toThrow(/Circuit/);
        } finally {
          await first.dispose();
          await second.dispose();
        }
      },
    );

    it("keeps a local pool independent of a same-named distributed pool", async () => {
      const entered = gate();
      const release = gate();
      const localEntered = gate();
      const local = r
        .task("local")
        .middleware([
          middleware.task.concurrency.with({
            limit: 1,
            key: "provider",
            maxQueue: 0,
            coordination: "local",
          }),
        ])
        .run(async (hold: boolean) => {
          if (hold) {
            localEntered.open();
            await release.promise;
          }
          return "ok";
        })
        .build();
      const remote = r
        .task("remote")
        .middleware([
          middleware.task.concurrency.with({
            limit: 1,
            key: "provider",
            maxQueue: 0,
            coordination: "distributed",
          }),
        ])
        .run(async (hold: boolean) => {
          if (hold) {
            entered.open();
            await release.promise;
          }
          return "ok";
        })
        .build();
      const namespace = randomUUID();
      const app = () =>
        r
          .resource("app")
          .register([
            local,
            remote,
            resources.resilience.with({ namespace, redis: redis! }),
          ])
          .build();
      const first = await run(app());
      const second = await run(app());
      const held = first.runTask(remote, true);
      const localHeld = first.runTask(local, true);
      try {
        await entered.promise;
        await localEntered.promise;
        await expect(first.runTask(local, false)).rejects.toThrow(
          /queue is full/,
        );
        await expect(second.runTask(local, false)).resolves.toBe("ok");
        await expect(second.runTask(remote, false)).rejects.toThrow(
          /queue is full/,
        );
      } finally {
        release.open();
        await held;
        await localHeld;
        await first.dispose();
        await second.dispose();
      }
    });
  },
);
