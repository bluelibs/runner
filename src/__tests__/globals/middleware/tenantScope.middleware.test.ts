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
  applyTenantScopeToKey,
  resolveTenantContext,
} from "../../../globals/middleware/tenantScope.shared";
import { tenantInvalidContextError } from "../../../errors";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("tenantScope middleware support", () => {
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

    const acmeFirst = await asyncContexts.tenant.provide(
      { tenantId: "acme" },
      () => runtime.runTask(task, "x"),
    );
    const acmeSecond = await asyncContexts.tenant.provide(
      { tenantId: "acme" },
      () => runtime.runTask(task, "x"),
    );
    const globex = await asyncContexts.tenant.provide(
      { tenantId: "globex" },
      () => runtime.runTask(task, "x"),
    );

    expect(acmeFirst).toBe("x-1");
    expect(acmeSecond).toBe("x-1");
    expect(globex).toBe("x-2");

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
      asyncContexts.tenant.provide({ tenantId: "acme" }, () =>
        runtime.runTask(task),
      ),
    ).resolves.toBe("ok");
    await expect(
      asyncContexts.tenant.provide({ tenantId: "globex" }, () =>
        runtime.runTask(task),
      ),
    ).resolves.toBe("ok");
    await expect(
      asyncContexts.tenant.provide({ tenantId: "acme" }, () =>
        runtime.runTask(task),
      ),
    ).rejects.toThrow(/rate limit exceeded/i);

    await runtime.dispose();
  });

  it("supports opting out of tenant isolation explicitly", async () => {
    const task = defineTask({
      id: "tenant-rate-limit-off-task",
      middleware: [
        rateLimitTaskMiddleware.with({
          windowMs: 60_000,
          max: 1,
          tenantScope: "off",
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
      asyncContexts.tenant.provide({ tenantId: "acme" }, () =>
        runtime.runTask(task),
      ),
    ).resolves.toBe("ok");
    await expect(
      asyncContexts.tenant.provide({ tenantId: "globex" }, () =>
        runtime.runTask(task),
      ),
    ).rejects.toThrow(/rate limit exceeded/i);

    await runtime.dispose();
  });

  it("fails fast when tenantScope is required and no tenant exists", async () => {
    const task = defineTask({
      id: "tenant-rate-limit-required-task",
      middleware: [
        rateLimitTaskMiddleware.with({
          windowMs: 60_000,
          max: 1,
          tenantScope: "required",
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

  it("rejects invalid tenantScope values at config time", () => {
    expect(() =>
      concurrencyTaskMiddleware.with({
        limit: 1,
        tenantScope: "invalid" as never,
      }),
    ).toThrow();

    expect(() =>
      concurrencyTaskMiddleware.with({
        limit: 1,
        tenantScope: "invalid" as never,
      }),
    ).toThrow();
  });

  it("supports explicit helper resolution paths without mutating global tenant state", () => {
    expect(
      resolveTenantContext("off", () => ({ tenantId: "ignored" })),
    ).toBeUndefined();
    expect(
      applyTenantScopeToKey("search", "auto", () => ({ tenantId: "acme" })),
    ).toBe("acme:search");
    expect(
      applyTenantScopeToKey("search", "auto", () => ({
        tenantId: "acme",
      })),
    ).toBe("acme:search");
  });

  it("fails fast on invalid tenant payloads when resolving tenant scope", () => {
    expect(() =>
      resolveTenantContext("auto", () => ({ tenantId: "" })),
    ).toThrow();

    try {
      resolveTenantContext("auto", () => ({ tenantId: "" }));
    } catch (error) {
      expect(tenantInvalidContextError.is(error)).toBe(true);
    }
  });

  it('supports the explicit "auto" tenantScope mode', async () => {
    const task = defineTask({
      id: "tenant-rate-limit-mode-scope-task",
      middleware: [
        rateLimitTaskMiddleware.with({
          windowMs: 60_000,
          max: 1,
          tenantScope: "auto",
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
      asyncContexts.tenant.provide({ tenantId: "acme" }, () =>
        runtime.runTask(task),
      ),
    ).resolves.toBe("ok");
    await expect(
      asyncContexts.tenant.provide({ tenantId: "globex" }, () =>
        runtime.runTask(task),
      ),
    ).resolves.toBe("ok");

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
      asyncContexts.tenant.provide({ tenantId: "acme" }, () =>
        runtime.runTask(task),
      ),
      asyncContexts.tenant.provide({ tenantId: "globex" }, () =>
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
      asyncContexts.tenant.provide({ tenantId: "acme" }, () =>
        runtime.runTask(debounced),
      ),
      asyncContexts.tenant.provide({ tenantId: "globex" }, () =>
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
      asyncContexts.tenant.provide({ tenantId: "acme" }, () =>
        runtime.runTask(throttled),
      ),
      asyncContexts.tenant.provide({ tenantId: "globex" }, () =>
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
