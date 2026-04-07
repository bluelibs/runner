import { asyncContexts, defineResource, defineTask, run } from "../../../";
import {
  cacheMiddleware,
  cacheResource,
} from "../../../globals/middleware/cache/middleware";

const tenantScope = { tenant: true } as const;
const userScope = { tenant: true, user: true } as const;
const tenantValue = (tenantId: string, userId?: string) => ({
  tenantId,
  region: `${tenantId}-region`,
  ...(userId === undefined ? {} : { userId }),
});

describe("identityScope cache.invalidateKeys", () => {
  it("expects the concrete tenant-scoped storage key", async () => {
    let callCount = 0;
    const task = defineTask({
      id: "identity-scope-key-invalidation-tenant-task",
      middleware: [
        cacheMiddleware.with({
          ttl: 60_000,
          identityScope: tenantScope,
          keyBuilder: () => "profile",
        }),
      ],
      run: async () => `profile-${++callCount}`,
    });
    const app = defineResource({
      id: "identity-scope-key-invalidation-tenant-app",
      register: [cacheResource, task],
      init: async () => "ok",
    });

    const runtime = await run(app);
    const cache = runtime.getResourceValue(cacheResource);

    const acmeFirst = await asyncContexts.identity.provide(
      tenantValue("acme"),
      () => runtime.runTask(task),
    );
    const globexFirst = await asyncContexts.identity.provide(
      tenantValue("globex"),
      () => runtime.runTask(task),
    );

    await asyncContexts.identity.provide(tenantValue("acme"), () =>
      cache.invalidateKeys("profile"),
    );

    const acmeStillCached = await asyncContexts.identity.provide(
      tenantValue("acme"),
      () => runtime.runTask(task),
    );
    const globexStillCached = await asyncContexts.identity.provide(
      tenantValue("globex"),
      () => runtime.runTask(task),
    );

    await cache.invalidateKeys("acme:profile");

    const acmeAfterInvalidate = await asyncContexts.identity.provide(
      tenantValue("acme"),
      () => runtime.runTask(task),
    );
    const globexAfterConcreteInvalidate = await asyncContexts.identity.provide(
      tenantValue("globex"),
      () => runtime.runTask(task),
    );

    expect(acmeFirst).toBe("profile-1");
    expect(globexFirst).toBe("profile-2");
    expect(acmeStillCached).toBe("profile-1");
    expect(globexStillCached).toBe("profile-2");
    expect(acmeAfterInvalidate).toBe("profile-3");
    expect(globexAfterConcreteInvalidate).toBe("profile-2");
    await runtime.dispose();
  });

  it("can opt into tenant-scoped invalidation by base key", async () => {
    let callCount = 0;
    const task = defineTask({
      id: "identity-scope-key-invalidation-tenant-opt-in-task",
      middleware: [
        cacheMiddleware.with({
          ttl: 60_000,
          identityScope: tenantScope,
          keyBuilder: () => "profile",
        }),
      ],
      run: async () => `profile-${++callCount}`,
    });
    const app = defineResource({
      id: "identity-scope-key-invalidation-tenant-opt-in-app",
      register: [cacheResource, task],
      init: async () => "ok",
    });

    const runtime = await run(app);
    const cache = runtime.getResourceValue(cacheResource);

    await asyncContexts.identity.provide(tenantValue("acme"), () =>
      runtime.runTask(task),
    );
    await asyncContexts.identity.provide(tenantValue("globex"), () =>
      runtime.runTask(task),
    );

    await asyncContexts.identity.provide(tenantValue("acme"), () =>
      cache.invalidateKeys("profile", { identityScope: tenantScope }),
    );

    await expect(
      asyncContexts.identity.provide(tenantValue("acme"), () =>
        runtime.runTask(task),
      ),
    ).resolves.toBe("profile-3");
    await expect(
      asyncContexts.identity.provide(tenantValue("globex"), () =>
        runtime.runTask(task),
      ),
    ).resolves.toBe("profile-2");

    await runtime.dispose();
  });

  it("expects the concrete user-scoped storage key", async () => {
    let callCount = 0;
    const task = defineTask({
      id: "identity-scope-key-invalidation-user-task",
      middleware: [
        cacheMiddleware.with({
          ttl: 60_000,
          identityScope: userScope,
          keyBuilder: () => "profile",
        }),
      ],
      run: async () => `profile-${++callCount}`,
    });
    const app = defineResource({
      id: "identity-scope-key-invalidation-user-app",
      register: [cacheResource, task],
      init: async () => "ok",
    });

    const runtime = await run(app);
    const cache = runtime.getResourceValue(cacheResource);

    const firstUser = await asyncContexts.identity.provide(
      tenantValue("acme", "u1"),
      () => runtime.runTask(task),
    );
    const secondUser = await asyncContexts.identity.provide(
      tenantValue("acme", "u2"),
      () => runtime.runTask(task),
    );

    await asyncContexts.identity.provide(tenantValue("acme", "u1"), () =>
      cache.invalidateKeys("profile"),
    );

    const firstUserStillCached = await asyncContexts.identity.provide(
      tenantValue("acme", "u1"),
      () => runtime.runTask(task),
    );
    const secondUserStillCached = await asyncContexts.identity.provide(
      tenantValue("acme", "u2"),
      () => runtime.runTask(task),
    );

    await cache.invalidateKeys("acme:u1:profile");

    const firstUserAfterInvalidate = await asyncContexts.identity.provide(
      tenantValue("acme", "u1"),
      () => runtime.runTask(task),
    );
    const secondUserAfterConcreteInvalidate =
      await asyncContexts.identity.provide(tenantValue("acme", "u2"), () =>
        runtime.runTask(task),
      );

    expect(firstUser).toBe("profile-1");
    expect(secondUser).toBe("profile-2");
    expect(firstUserStillCached).toBe("profile-1");
    expect(secondUserStillCached).toBe("profile-2");
    expect(firstUserAfterInvalidate).toBe("profile-3");
    expect(secondUserAfterConcreteInvalidate).toBe("profile-2");
    await runtime.dispose();
  });

  it("can opt into user-scoped invalidation by base key", async () => {
    let callCount = 0;
    const task = defineTask({
      id: "identity-scope-key-invalidation-user-opt-in-task",
      middleware: [
        cacheMiddleware.with({
          ttl: 60_000,
          identityScope: userScope,
          keyBuilder: () => "profile",
        }),
      ],
      run: async () => `profile-${++callCount}`,
    });
    const app = defineResource({
      id: "identity-scope-key-invalidation-user-opt-in-app",
      register: [cacheResource, task],
      init: async () => "ok",
    });

    const runtime = await run(app);
    const cache = runtime.getResourceValue(cacheResource);

    await asyncContexts.identity.provide(tenantValue("acme", "u1"), () =>
      runtime.runTask(task),
    );
    await asyncContexts.identity.provide(tenantValue("acme", "u2"), () =>
      runtime.runTask(task),
    );

    await asyncContexts.identity.provide(tenantValue("acme", "u1"), () =>
      cache.invalidateKeys("profile", { identityScope: userScope }),
    );

    await expect(
      asyncContexts.identity.provide(tenantValue("acme", "u1"), () =>
        runtime.runTask(task),
      ),
    ).resolves.toBe("profile-3");
    await expect(
      asyncContexts.identity.provide(tenantValue("acme", "u2"), () =>
        runtime.runTask(task),
      ),
    ).resolves.toBe("profile-2");

    await runtime.dispose();
  });
});
