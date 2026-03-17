import { middleware, r, resources, run } from "../../..";

const tenantScope = { tenant: true } as const;
const userScope = { tenant: true, user: true } as const;

describe("tenant runtime option middleware integration", () => {
  it("keeps cache keys tenant-scoped while refs remain raw", async () => {
    const tenant = r
      .asyncContext<{ tenantId: string; userId: string }>(
        "tenant-runtime-option-cache-ctx",
      )
      .configSchema({
        tenantId: String,
        userId: String,
      })
      .build();

    let calls = 0;
    const cached = r
      .task("tenant-runtime-option-cache-task")
      .middleware([
        middleware.task.cache.with({
          ttl: 60_000,
          identityScope: tenantScope,
          keyBuilder: () => ({
            cacheKey: "profile",
            refs: ["profile"],
          }),
        }),
      ])
      .run(async () => {
        calls += 1;
        return calls;
      })
      .build();

    const app = r
      .resource("tenant-runtime-option-cache-app")
      .register([tenant, resources.cache, cached])
      .build();
    const runtime = await run(app, { identity: tenant });
    const cache = runtime.getResourceValue(resources.cache);

    const acme1 = await tenant.provide({ tenantId: "acme", userId: "u1" }, () =>
      runtime.runTask(cached),
    );
    const acme2 = await tenant.provide({ tenantId: "acme", userId: "u1" }, () =>
      runtime.runTask(cached),
    );

    await tenant.provide({ tenantId: "globex", userId: "u2" }, () =>
      cache.invalidateRefs("profile"),
    );

    const acmeAfterGlobexInvalidate = await tenant.provide(
      { tenantId: "acme", userId: "u1" },
      () => runtime.runTask(cached),
    );

    await tenant.provide({ tenantId: "acme", userId: "u1" }, () =>
      cache.invalidateRefs("profile"),
    );

    const acmeAfterInvalidate = await tenant.provide(
      { tenantId: "acme", userId: "u1" },
      () => runtime.runTask(cached),
    );

    expect(acme1).toBe(1);
    expect(acme2).toBe(1);
    expect(acmeAfterGlobexInvalidate).toBe(2);
    expect(acmeAfterInvalidate).toBe(3);

    await runtime.dispose();
  });

  it("can still isolate raw refs by user when keyBuilder encodes them", async () => {
    const tenant = r
      .asyncContext<{ tenantId: string; userId: string }>(
        "tenant-runtime-option-cache-user-ctx",
      )
      .configSchema({
        tenantId: String,
        userId: String,
      })
      .build();

    let calls = 0;
    const cached = r
      .task("tenant-runtime-option-cache-user-task")
      .middleware([
        middleware.task.cache.with({
          ttl: 60_000,
          identityScope: userScope,
          keyBuilder: () => ({
            cacheKey: "profile",
            refs: [`profile:${tenant.use().userId}`],
          }),
        }),
      ])
      .run(async () => {
        calls += 1;
        return calls;
      })
      .build();

    const app = r
      .resource("tenant-runtime-option-cache-user-app")
      .register([tenant, resources.cache, cached])
      .build();
    const runtime = await run(app, { identity: tenant });
    const cache = runtime.getResourceValue(resources.cache);

    const acmeUserOneFirst = await tenant.provide(
      { tenantId: "acme", userId: "u1" },
      () => runtime.runTask(cached),
    );
    const acmeUserOneSecond = await tenant.provide(
      { tenantId: "acme", userId: "u1" },
      () => runtime.runTask(cached),
    );
    const acmeUserTwo = await tenant.provide(
      { tenantId: "acme", userId: "u2" },
      () => runtime.runTask(cached),
    );

    await tenant.provide({ tenantId: "acme", userId: "u1" }, () =>
      cache.invalidateRefs("profile:u1"),
    );

    const acmeUserOneAfterInvalidate = await tenant.provide(
      { tenantId: "acme", userId: "u1" },
      () => runtime.runTask(cached),
    );
    const acmeUserTwoStillCached = await tenant.provide(
      { tenantId: "acme", userId: "u2" },
      () => runtime.runTask(cached),
    );

    expect(acmeUserOneFirst).toBe(1);
    expect(acmeUserOneSecond).toBe(1);
    expect(acmeUserTwo).toBe(2);
    expect(acmeUserOneAfterInvalidate).toBe(3);
    expect(acmeUserTwoStillCached).toBe(2);

    await runtime.dispose();
  });

  it("scopes concurrency semaphores by the configured tenant context", async () => {
    const tenant = r
      .asyncContext<{ tenantId: string }>("tenant-runtime-option-concurrency")
      .configSchema({ tenantId: String })
      .build();

    let active = 0;
    let maxActive = 0;

    const task = r
      .task("tenant-runtime-option-concurrency-task")
      .middleware([
        middleware.task.concurrency.with({
          limit: 1,
          key: "shared",
          identityScope: tenantScope,
        }),
      ])
      .run(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return "ok";
      })
      .build();

    const app = r
      .resource("tenant-runtime-option-concurrency-app")
      .register([tenant, task])
      .build();
    const runtime = await run(app, { identity: tenant });

    await Promise.all([
      tenant.provide({ tenantId: "acme" }, () => runtime.runTask(task)),
      tenant.provide({ tenantId: "globex" }, () => runtime.runTask(task)),
    ]);

    expect(maxActive).toBe(2);

    await runtime.dispose();
  });

  it("scopes debounce by the configured tenant context", async () => {
    jest.useFakeTimers();

    const tenant = r
      .asyncContext<{ tenantId: string }>("tenant-runtime-option-debounce")
      .configSchema({ tenantId: String })
      .build();

    let calls = 0;
    const task = r
      .task("tenant-runtime-option-debounce-task")
      .middleware([
        middleware.task.debounce.with({
          ms: 25,
          identityScope: tenantScope,
          keyBuilder: () => "shared",
        }),
      ])
      .run(async () => {
        calls += 1;
        return calls;
      })
      .build();

    const app = r
      .resource("tenant-runtime-option-debounce-app")
      .register([tenant, task])
      .build();
    const runtime = await run(app, { identity: tenant });

    try {
      const pending = Promise.all([
        tenant.provide({ tenantId: "acme" }, () => runtime.runTask(task)),
        tenant.provide({ tenantId: "globex" }, () => runtime.runTask(task)),
      ]);

      jest.advanceTimersByTime(25);
      await Promise.resolve();

      await expect(pending).resolves.toEqual([1, 2]);
      expect(calls).toBe(2);
    } finally {
      await runtime.dispose();
      jest.useRealTimers();
    }
  });

  it("scopes throttle by the configured tenant context", async () => {
    const tenant = r
      .asyncContext<{ tenantId: string }>("tenant-runtime-option-throttle")
      .configSchema({ tenantId: String })
      .build();

    let completions = 0;
    const task = r
      .task("tenant-runtime-option-throttle-task")
      .middleware([
        middleware.task.throttle.with({
          ms: 1_000,
          identityScope: tenantScope,
          keyBuilder: () => "shared",
        }),
      ])
      .run(async () => "ok")
      .build();

    const app = r
      .resource("tenant-runtime-option-throttle-app")
      .register([tenant, task])
      .build();
    const runtime = await run(app, { identity: tenant });

    await Promise.all([
      tenant.provide({ tenantId: "acme" }, async () => {
        await runtime.runTask(task);
        completions += 1;
      }),
      tenant.provide({ tenantId: "globex" }, async () => {
        await runtime.runTask(task);
        completions += 1;
      }),
    ]);

    expect(completions).toBe(2);

    await runtime.dispose();
  });
});
