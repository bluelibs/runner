import { asyncContexts, defineResource, defineTask, run } from "../../../";
import { cacheResource } from "../../../globals/middleware/cache.middleware";
import { cacheMiddleware } from "../../../globals/middleware/cache.middleware";
import { concurrencyTaskMiddleware } from "../../../globals/middleware/concurrency.middleware";
import { rateLimitTaskMiddleware } from "../../../globals/middleware/rateLimit.middleware";
import {
  debounceTaskMiddleware,
  throttleTaskMiddleware,
} from "../../../globals/middleware/temporal.middleware";
import {
  applyIdentityScopeToKey,
  resolveIdentityContext,
} from "../../../globals/middleware/identityScope.shared";
import { identityInvalidContextError } from "../../../errors";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const tenantValue = (tenantId: string, userId?: string) => ({
  tenantId,
  region: `${tenantId}-region`,
  ...(userId === undefined ? {} : { userId }),
});

describe("identityScope middleware support", () => {
  it("isolates cache entries by tenant by default", async () => {
    let callCount = 0;

    const task = defineTask({
      id: "tenant-cache-task",
      middleware: [
        cacheMiddleware.with({
          ttl: 60_000,
          keyBuilder: (_taskId: string, input: unknown) => String(input),
        }),
      ],
      run: async (input: string) => `${input}-${++callCount}`,
    });

    const app = defineResource({
      id: "tenant-cache-app",
      register: [cacheResource, task],
      dependencies: { task },
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

  it("scopes cache ref invalidation by tenant by default", async () => {
    let callCount = 0;

    const task = defineTask({
      id: "tenant-cache-ref-task",
      middleware: [
        cacheMiddleware.with({
          ttl: 60_000,
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
      id: "tenant-cache-ref-app",
      register: [cacheResource, task],
      dependencies: { task, cache: cacheResource },
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
    ).resolves.toBe("u1-2");

    await runtime.dispose();
  });

  it('uses the target cache policy when invalidating refs with identityScope: "off"', async () => {
    let callCount = 0;

    const task = defineTask({
      id: "tenant-cache-ref-off-task",
      middleware: [
        cacheMiddleware.with({
          ttl: 60_000,
          identityScope: "off",
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
      id: "tenant-cache-ref-off-app",
      register: [cacheResource, task],
      dependencies: { task, cache: cacheResource },
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

    expect(callCount).toBe(1);

    await asyncContexts.identity.provide(tenantValue("acme"), () =>
      cache.invalidateRefs("user:u1"),
    );

    await expect(
      asyncContexts.identity.provide(tenantValue("globex"), () =>
        runtime.runTask(task, { userId: "u1" }),
      ),
    ).resolves.toBe("u1-2");

    await runtime.dispose();
  });

  it("isolates rate limits by tenant by default", async () => {
    const task = defineTask({
      id: "tenant-rate-limit-task",
      middleware: [rateLimitTaskMiddleware.with({ windowMs: 60_000, max: 1 })],
      run: async () => "ok",
    });

    const app = defineResource({
      id: "tenant-rate-limit-app",
      register: [task],
      init: async () => "ok",
    });

    const runtime = await run(app);

    await expect(
      asyncContexts.identity.provide(tenantValue("acme"), () =>
        runtime.runTask(task),
      ),
    ).resolves.toBe("ok");
    await expect(
      asyncContexts.identity.provide(tenantValue("globex"), () =>
        runtime.runTask(task),
      ),
    ).resolves.toBe("ok");
    await expect(
      asyncContexts.identity.provide(tenantValue("acme"), () =>
        runtime.runTask(task),
      ),
    ).rejects.toThrow(/rate limit exceeded/i);

    await runtime.dispose();
  });

  it("can also isolate rate limits by user within the same tenant", async () => {
    const task = defineTask({
      id: "tenant-rate-limit-user-scope-task",
      middleware: [
        rateLimitTaskMiddleware.with({
          windowMs: 60_000,
          max: 1,
          identityScope: "full",
        }),
      ],
      run: async () => "ok",
    });

    const app = defineResource({
      id: "tenant-rate-limit-user-scope-app",
      register: [task],
      init: async () => "ok",
    });

    const runtime = await run(app);

    await expect(
      asyncContexts.identity.provide(tenantValue("acme", "u1"), () =>
        runtime.runTask(task),
      ),
    ).resolves.toBe("ok");
    await expect(
      asyncContexts.identity.provide(tenantValue("acme", "u2"), () =>
        runtime.runTask(task),
      ),
    ).resolves.toBe("ok");
    await expect(
      asyncContexts.identity.provide(tenantValue("acme", "u1"), () =>
        runtime.runTask(task),
      ),
    ).rejects.toThrow(/rate limit exceeded/i);

    await runtime.dispose();
  });

  it('fails fast when identityScope: "full" is missing userId', async () => {
    const task = defineTask({
      id: "tenant-rate-limit-full-missing-user-task",
      middleware: [
        rateLimitTaskMiddleware.with({
          windowMs: 60_000,
          max: 1,
          identityScope: "full",
        }),
      ],
      run: async () => "ok",
    });

    const app = defineResource({
      id: "tenant-rate-limit-full-missing-user-app",
      register: [task],
      init: async () => "ok",
    });

    const runtime = await run(app);

    await expect(
      asyncContexts.identity.provide(tenantValue("acme"), () =>
        runtime.runTask(task),
      ),
    ).rejects.toThrow(/identityScope is "full"/i);

    await runtime.dispose();
  });

  it("supports opting out of tenant isolation explicitly", async () => {
    const task = defineTask({
      id: "tenant-rate-limit-off-task",
      middleware: [
        rateLimitTaskMiddleware.with({
          windowMs: 60_000,
          max: 1,
          identityScope: "off",
        }),
      ],
      run: async () => "ok",
    });

    const app = defineResource({
      id: "tenant-rate-limit-off-app",
      register: [task],
      init: async () => "ok",
    });

    const runtime = await run(app);

    await expect(
      asyncContexts.identity.provide(tenantValue("acme"), () =>
        runtime.runTask(task),
      ),
    ).resolves.toBe("ok");
    await expect(
      asyncContexts.identity.provide(tenantValue("globex"), () =>
        runtime.runTask(task),
      ),
    ).rejects.toThrow(/rate limit exceeded/i);

    await runtime.dispose();
  });

  it("fails fast when identityScope is required and no tenant exists", async () => {
    const task = defineTask({
      id: "tenant-rate-limit-required-task",
      middleware: [
        rateLimitTaskMiddleware.with({
          windowMs: 60_000,
          max: 1,
          identityScope: "required",
        }),
      ],
      run: async () => "ok",
    });

    const app = defineResource({
      id: "tenant-rate-limit-required-app",
      register: [task],
      init: async () => "ok",
    });

    const runtime = await run(app);

    await expect(runtime.runTask(task)).rejects.toThrow();
    await runtime.dispose();
  });

  it("rejects invalid identityScope values at config time", () => {
    expect(() =>
      concurrencyTaskMiddleware.with({
        limit: 1,
        identityScope: "invalid" as never,
      }),
    ).toThrow();

    expect(() =>
      concurrencyTaskMiddleware.with({
        limit: 1,
        identityScope: "invalid" as never,
      }),
    ).toThrow();
  });

  it("supports explicit helper resolution paths without mutating global identity state", () => {
    expect(
      resolveIdentityContext("off", () => tenantValue("ignored")),
    ).toBeUndefined();
    expect(resolveIdentityContext("auto", () => null)).toBeUndefined();
    expect(
      resolveIdentityContext("auto", () => ({ userId: "u1" })),
    ).toBeUndefined();
    expect(() =>
      resolveIdentityContext("required", () => ({ userId: "u1" })),
    ).toThrow();
    expect(
      applyIdentityScopeToKey("search", "auto", () => tenantValue("acme")),
    ).toBe("acme:search");
    expect(
      applyIdentityScopeToKey("search", "auto:userId", () =>
        tenantValue("acme", "u1"),
      ),
    ).toBe("acme:u1:search");
    expect(
      applyIdentityScopeToKey("search", "auto:userId", () =>
        tenantValue("acme"),
      ),
    ).toBe("acme:search");
    expect(
      applyIdentityScopeToKey("search", "full", () =>
        tenantValue("acme", "u1"),
      ),
    ).toBe("acme:u1:search");
    expect(() =>
      applyIdentityScopeToKey("search", "full", () => tenantValue("acme")),
    ).toThrow(/identityScope is "full"/i);
  });

  it("uses the built-in identity reader when no explicit reader is provided", async () => {
    await asyncContexts.identity.provide(tenantValue("acme"), async () => {
      expect(resolveIdentityContext("auto")).toEqual(tenantValue("acme"));
      expect(applyIdentityScopeToKey("search", "auto")).toBe("acme:search");
    });
  });

  it("treats identity without tenantId as absent unless tenant partitioning is required", () => {
    expect(
      resolveIdentityContext("auto", () => ({ userId: "u1" })),
    ).toBeUndefined();

    expect(() =>
      resolveIdentityContext("required", () => ({ userId: "u1" })),
    ).toThrow(/Identity context is required/);
  });

  it("fails fast on invalid identity payloads when resolving identity scope", () => {
    expect(() =>
      resolveIdentityContext("auto", () => tenantValue("")),
    ).toThrow();
    expect(() =>
      resolveIdentityContext("auto", () => tenantValue("acme:west")),
    ).toThrow(/cannot contain ":"/);
    expect(() =>
      resolveIdentityContext("auto", () => tenantValue("__global__")),
    ).toThrow(/reserved for the shared non-identity namespace/);

    try {
      resolveIdentityContext("auto", () => tenantValue(""));
    } catch (error) {
      expect(identityInvalidContextError.is(error)).toBe(true);
    }

    try {
      resolveIdentityContext("auto", () => tenantValue("acme:west"));
    } catch (error) {
      expect(identityInvalidContextError.is(error)).toBe(true);
    }

    try {
      resolveIdentityContext("auto", () => tenantValue("__global__"));
    } catch (error) {
      expect(identityInvalidContextError.is(error)).toBe(true);
    }

    expect(() =>
      applyIdentityScopeToKey("search", "auto:userId", () =>
        tenantValue("acme", "u:1"),
      ),
    ).toThrow(/cannot contain ":"/);
    expect(() =>
      applyIdentityScopeToKey("search", "auto:userId", () =>
        tenantValue("acme", ""),
      ),
    ).toThrow(/userId.*non-empty string/i);
  });

  it('supports the explicit "auto" identityScope mode', async () => {
    const task = defineTask({
      id: "tenant-rate-limit-mode-scope-task",
      middleware: [
        rateLimitTaskMiddleware.with({
          windowMs: 60_000,
          max: 1,
          identityScope: "auto",
        }),
      ],
      run: async () => "ok",
    });

    const app = defineResource({
      id: "tenant-rate-limit-mode-scope-app",
      register: [task],
      init: async () => "ok",
    });

    const runtime = await run(app);

    await expect(
      asyncContexts.identity.provide(tenantValue("acme"), () =>
        runtime.runTask(task),
      ),
    ).resolves.toBe("ok");
    await expect(
      asyncContexts.identity.provide(tenantValue("globex"), () =>
        runtime.runTask(task),
      ),
    ).resolves.toBe("ok");

    await runtime.dispose();
  });

  it("scopes cache refs by user when identityScope opts into user-aware partitioning", async () => {
    let callCount = 0;

    const task = defineTask({
      id: "tenant-cache-user-scope-task",
      middleware: [
        cacheMiddleware.with({
          ttl: 60_000,
          identityScope: "full",
          keyBuilder: () => ({
            cacheKey: "profile",
            refs: ["profile"],
          }),
        }),
      ],
      run: async () => `profile-${++callCount}`,
    });

    const app = defineResource({
      id: "tenant-cache-user-scope-app",
      register: [cacheResource, task],
      dependencies: { task, cache: cacheResource },
      init: async () => "ok",
    });

    const runtime = await run(app);
    const cache = runtime.getResourceValue(cacheResource);

    const acmeUserOneFirst = await asyncContexts.identity.provide(
      tenantValue("acme", "u1"),
      () => runtime.runTask(task),
    );
    const acmeUserOneSecond = await asyncContexts.identity.provide(
      tenantValue("acme", "u1"),
      () => runtime.runTask(task),
    );
    const acmeUserTwo = await asyncContexts.identity.provide(
      tenantValue("acme", "u2"),
      () => runtime.runTask(task),
    );

    await asyncContexts.identity.provide(tenantValue("acme", "u1"), () =>
      cache.invalidateRefs("profile"),
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
    expect(acmeUserOneSecond).toBe("profile-1");
    expect(acmeUserTwo).toBe("profile-2");
    expect(acmeUserOneAfterInvalidate).toBe("profile-3");
    expect(acmeUserTwoStillCached).toBe("profile-2");

    await runtime.dispose();
  });

  it("isolates concurrency limits per tenant by default", async () => {
    let activeTasks = 0;
    let maxActiveTasks = 0;

    const task = defineTask({
      id: "tenant-concurrency-task",
      middleware: [concurrencyTaskMiddleware.with({ limit: 1 })],
      run: async () => {
        activeTasks += 1;
        maxActiveTasks = Math.max(maxActiveTasks, activeTasks);
        await sleep(10);
        activeTasks -= 1;
        return "ok";
      },
    });

    const app = defineResource({
      id: "tenant-concurrency-app",
      register: [task],
      init: async () => "ok",
    });

    const runtime = await run(app);

    await Promise.all([
      asyncContexts.identity.provide(tenantValue("acme"), () =>
        runtime.runTask(task),
      ),
      asyncContexts.identity.provide(tenantValue("globex"), () =>
        runtime.runTask(task),
      ),
    ]);

    expect(maxActiveTasks).toBe(2);
    await runtime.dispose();
  });

  it("isolates debounce and throttle state per tenant by default", async () => {
    jest.useFakeTimers();

    let debounceRuns = 0;
    let throttleRuns = 0;

    const debounced = defineTask({
      id: "tenant-debounce-task",
      middleware: [debounceTaskMiddleware.with({ ms: 20 })],
      run: async () => {
        debounceRuns += 1;
        return `debounce-${debounceRuns}`;
      },
    });

    const throttled = defineTask({
      id: "tenant-throttle-task",
      middleware: [throttleTaskMiddleware.with({ ms: 20 })],
      run: async () => {
        throttleRuns += 1;
        return `throttle-${throttleRuns}`;
      },
    });

    const app = defineResource({
      id: "tenant-temporal-app",
      register: [debounced, throttled],
      init: async () => "ok",
    });

    const runtime = await run(app);

    const debouncePromises = [
      asyncContexts.identity.provide(tenantValue("acme"), () =>
        runtime.runTask(debounced),
      ),
      asyncContexts.identity.provide(tenantValue("globex"), () =>
        runtime.runTask(debounced),
      ),
    ];

    jest.advanceTimersByTime(25);
    await Promise.resolve();
    await expect(Promise.all(debouncePromises)).resolves.toEqual([
      "debounce-1",
      "debounce-2",
    ]);

    const throttlePromises = [
      asyncContexts.identity.provide(tenantValue("acme"), () =>
        runtime.runTask(throttled),
      ),
      asyncContexts.identity.provide(tenantValue("globex"), () =>
        runtime.runTask(throttled),
      ),
    ];

    await expect(Promise.all(throttlePromises)).resolves.toEqual([
      "throttle-1",
      "throttle-2",
    ]);

    expect(debounceRuns).toBe(2);
    expect(throttleRuns).toBe(2);

    await runtime.dispose();
    jest.useRealTimers();
  });
});
