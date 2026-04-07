import { middleware, r, resources, run } from "../../..";

const tenantScope = { tenant: true } as const;

describe("tenant runtime option cache.invalidateKeys integration", () => {
  it("expects the concrete tenant-scoped storage key", async () => {
    const tenant = r
      .asyncContext<{ tenantId: string; userId: string }>(
        "tenant-runtime-option-cache-key-ctx",
      )
      .configSchema({
        tenantId: String,
        userId: String,
      })
      .build();

    let calls = 0;
    const cached = r
      .task("tenant-runtime-option-cache-key-task")
      .middleware([
        middleware.task.cache.with({
          ttl: 60_000,
          identityScope: tenantScope,
          keyBuilder: () => "profile",
        }),
      ])
      .run(async () => ++calls)
      .build();

    const app = r
      .resource("tenant-runtime-option-cache-key-app")
      .register([tenant, resources.cache, cached])
      .build();
    const runtime = await run(app, { identity: tenant });
    const cache = runtime.getResourceValue(resources.cache);

    const acmeFirst = await tenant.provide(
      { tenantId: "acme", userId: "u1" },
      () => runtime.runTask(cached),
    );
    const globexFirst = await tenant.provide(
      { tenantId: "globex", userId: "u2" },
      () => runtime.runTask(cached),
    );

    await tenant.provide({ tenantId: "acme", userId: "u1" }, () =>
      cache.invalidateKeys("profile"),
    );

    const acmeStillCached = await tenant.provide(
      { tenantId: "acme", userId: "u1" },
      () => runtime.runTask(cached),
    );
    const globexStillCached = await tenant.provide(
      { tenantId: "globex", userId: "u2" },
      () => runtime.runTask(cached),
    );

    await cache.invalidateKeys("acme:profile");

    const acmeAfterInvalidate = await tenant.provide(
      { tenantId: "acme", userId: "u1" },
      () => runtime.runTask(cached),
    );
    const globexAfterConcreteInvalidate = await tenant.provide(
      { tenantId: "globex", userId: "u2" },
      () => runtime.runTask(cached),
    );

    expect(acmeFirst).toBe(1);
    expect(globexFirst).toBe(2);
    expect(acmeStillCached).toBe(1);
    expect(globexStillCached).toBe(2);
    expect(acmeAfterInvalidate).toBe(3);
    expect(globexAfterConcreteInvalidate).toBe(2);

    await runtime.dispose();
  });

  it("can opt into tenant-scoped invalidation by base key", async () => {
    const tenant = r
      .asyncContext<{ tenantId: string; userId: string }>(
        "tenant-runtime-option-cache-key-opt-in-ctx",
      )
      .configSchema({
        tenantId: String,
        userId: String,
      })
      .build();

    let calls = 0;
    const cached = r
      .task("tenant-runtime-option-cache-key-opt-in-task")
      .middleware([
        middleware.task.cache.with({
          ttl: 60_000,
          identityScope: tenantScope,
          keyBuilder: () => "profile",
        }),
      ])
      .run(async () => ++calls)
      .build();

    const app = r
      .resource("tenant-runtime-option-cache-key-opt-in-app")
      .register([tenant, resources.cache, cached])
      .build();
    const runtime = await run(app, { identity: tenant });
    const cache = runtime.getResourceValue(resources.cache);

    await tenant.provide({ tenantId: "acme", userId: "u1" }, () =>
      runtime.runTask(cached),
    );
    await tenant.provide({ tenantId: "globex", userId: "u2" }, () =>
      runtime.runTask(cached),
    );

    await tenant.provide({ tenantId: "acme", userId: "u1" }, () =>
      cache.invalidateKeys("profile", { identityScope: tenantScope }),
    );

    await expect(
      tenant.provide({ tenantId: "acme", userId: "u1" }, () =>
        runtime.runTask(cached),
      ),
    ).resolves.toBe(3);
    await expect(
      tenant.provide({ tenantId: "globex", userId: "u2" }, () =>
        runtime.runTask(cached),
      ),
    ).resolves.toBe(2);

    await runtime.dispose();
  });
});
