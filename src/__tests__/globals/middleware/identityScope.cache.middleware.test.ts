import { asyncContexts, defineResource, defineTask, run } from "../../../";
import { cacheResource } from "../../../globals/middleware/cache.middleware";
import { cacheMiddleware } from "../../../globals/middleware/cache.middleware";

const tenantScope = { tenant: true } as const;
const userScope = { tenant: true, user: true } as const;
const tenantValue = (tenantId: string, userId?: string) => ({
  tenantId,
  region: `${tenantId}-region`,
  ...(userId === undefined ? {} : { userId }),
});

describe("identityScope cache middleware support", () => {
  it("keeps cache entries shared when identityScope is omitted", async () => {
    let callCount = 0;
    const task = defineTask({
      id: "identity-scope-shared-cache-task",
      middleware: [
        cacheMiddleware.with({
          ttl: 60_000,
          keyBuilder: (_taskId: string, input: unknown) => String(input),
        }),
      ],
      run: async (input: string) => `${input}-${++callCount}`,
    });
    const app = defineResource({
      id: "identity-scope-shared-cache-app",
      register: [cacheResource, task],
      init: async () => "ok",
    });

    const runtime = await run(app);
    const acme = await asyncContexts.identity.provide(tenantValue("acme"), () =>
      runtime.runTask(task, "x"),
    );
    const globex = await asyncContexts.identity.provide(
      tenantValue("globex"),
      () => runtime.runTask(task, "x"),
    );

    expect(acme).toBe("x-1");
    expect(globex).toBe("x-1");
    await runtime.dispose();
  });

  it("isolates cache entries by tenant when identityScope enables partitioning", async () => {
    let callCount = 0;
    const task = defineTask({
      id: "identity-scope-tenant-cache-task",
      middleware: [
        cacheMiddleware.with({
          ttl: 60_000,
          identityScope: tenantScope,
          keyBuilder: (_taskId: string, input: unknown) => String(input),
        }),
      ],
      run: async (input: string) => `${input}-${++callCount}`,
    });
    const app = defineResource({
      id: "identity-scope-tenant-cache-app",
      register: [cacheResource, task],
      init: async () => "ok",
    });

    const runtime = await run(app);
    const acmeFirst = await asyncContexts.identity.provide(
      tenantValue("acme"),
      () => runtime.runTask(task, "x"),
    );
    const acmeSecond = await asyncContexts.identity.provide(
      tenantValue("acme"),
      () => runtime.runTask(task, "x"),
    );
    const globex = await asyncContexts.identity.provide(
      tenantValue("globex"),
      () => runtime.runTask(task, "x"),
    );

    expect(acmeFirst).toBe("x-1");
    expect(acmeSecond).toBe("x-1");
    expect(globex).toBe("x-2");
    await runtime.dispose();
  });

  it("invalidates raw cache refs across tenant-scoped entries", async () => {
    let callCount = 0;
    const task = defineTask({
      id: "identity-scope-raw-refs-task",
      middleware: [
        cacheMiddleware.with({
          ttl: 60_000,
          identityScope: tenantScope,
          keyBuilder: (_taskId: string, input: { userId: string }) => ({
            cacheKey: `user:${input.userId}`,
            refs: [`user:${input.userId}`],
          }),
        }),
      ],
      run: async (input: { userId: string }) =>
        `${input.userId}-${++callCount}`,
    });
    const app = defineResource({
      id: "identity-scope-raw-refs-app",
      register: [cacheResource, task],
      init: async () => "ok",
    });

    const runtime = await run(app);
    const cache = runtime.getResourceValue(cacheResource);

    await asyncContexts.identity.provide(tenantValue("acme"), () =>
      runtime.runTask(task, { userId: "u1" }),
    );
    await asyncContexts.identity.provide(tenantValue("globex"), () =>
      runtime.runTask(task, { userId: "u1" }),
    );

    await asyncContexts.identity.provide(tenantValue("acme"), () =>
      cache.invalidateRefs("user:u1"),
    );

    await expect(
      asyncContexts.identity.provide(tenantValue("acme"), () =>
        runtime.runTask(task, { userId: "u1" }),
      ),
    ).resolves.toBe("u1-3");
    await expect(
      asyncContexts.identity.provide(tenantValue("globex"), () =>
        runtime.runTask(task, { userId: "u1" }),
      ),
    ).resolves.toBe("u1-4");

    await runtime.dispose();
  });

  it("supports manually identity-aware refs when keyBuilder encodes them", async () => {
    let callCount = 0;
    const task = defineTask({
      id: "identity-scope-manual-refs-task",
      middleware: [
        cacheMiddleware.with({
          ttl: 60_000,
          identityScope: userScope,
          keyBuilder: () => ({
            cacheKey: "profile",
            refs: [`profile:${asyncContexts.identity.use().userId}`],
          }),
        }),
      ],
      run: async () => `profile-${++callCount}`,
    });
    const app = defineResource({
      id: "identity-scope-manual-refs-app",
      register: [cacheResource, task],
      init: async () => "ok",
    });

    const runtime = await run(app);
    const cache = runtime.getResourceValue(cacheResource);
    const acmeUserOneFirst = await asyncContexts.identity.provide(
      tenantValue("acme", "u1"),
      () => runtime.runTask(task),
    );
    const acmeUserTwoFirst = await asyncContexts.identity.provide(
      tenantValue("acme", "u2"),
      () => runtime.runTask(task),
    );

    await asyncContexts.identity.provide(tenantValue("acme", "u1"), () =>
      cache.invalidateRefs("profile:u1"),
    );

    const acmeUserOneAfterInvalidate = await asyncContexts.identity.provide(
      tenantValue("acme", "u1"),
      () => runtime.runTask(task),
    );
    const acmeUserTwoStillCached = await asyncContexts.identity.provide(
      tenantValue("acme", "u2"),
      () => runtime.runTask(task),
    );

    expect(acmeUserOneFirst).toBe("profile-1");
    expect(acmeUserTwoFirst).toBe("profile-2");
    expect(acmeUserOneAfterInvalidate).toBe("profile-3");
    expect(acmeUserTwoStillCached).toBe("profile-2");
    await runtime.dispose();
  });
});
