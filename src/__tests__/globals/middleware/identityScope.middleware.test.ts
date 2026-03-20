import { asyncContexts, defineResource, defineTask, run } from "../../../";
import { concurrencyTaskMiddleware } from "../../../globals/middleware/concurrency.middleware";
import { rateLimitTaskMiddleware } from "../../../globals/middleware/rateLimit.middleware";
import {
  debounceTaskMiddleware,
  throttleTaskMiddleware,
} from "../../../globals/middleware/temporal.middleware";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const tenantScope = { tenant: true } as const;
const userScope = { tenant: true, user: true } as const;
const tenantValue = (tenantId: string, userId?: string) => ({
  tenantId,
  region: `${tenantId}-region`,
  ...(userId === undefined ? {} : { userId }),
});

describe("identityScope middleware support", () => {
  it("isolates rate limits by tenant when identityScope is omitted", async () => {
    const task = defineTask({
      id: "identity-scope-shared-rate-limit-task",
      middleware: [rateLimitTaskMiddleware.with({ windowMs: 60_000, max: 1 })],
      run: async () => "ok",
    });
    const app = defineResource({
      id: "identity-scope-shared-rate-limit-app",
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

  it("can isolate rate limits by tenant or by user explicitly", async () => {
    const tenantTask = defineTask({
      id: "identity-scope-tenant-rate-limit-task",
      middleware: [
        rateLimitTaskMiddleware.with({
          windowMs: 60_000,
          max: 1,
          identityScope: tenantScope,
        }),
      ],
      run: async () => "ok",
    });
    const userTask = defineTask({
      id: "identity-scope-user-rate-limit-task",
      middleware: [
        rateLimitTaskMiddleware.with({
          windowMs: 60_000,
          max: 1,
          identityScope: userScope,
        }),
      ],
      run: async () => "ok",
    });
    const app = defineResource({
      id: "identity-scope-rate-limit-app",
      register: [tenantTask, userTask],
      init: async () => "ok",
    });

    const runtime = await run(app);
    await expect(
      asyncContexts.identity.provide(tenantValue("acme"), () =>
        runtime.runTask(tenantTask),
      ),
    ).resolves.toBe("ok");
    await expect(
      asyncContexts.identity.provide(tenantValue("globex"), () =>
        runtime.runTask(tenantTask),
      ),
    ).resolves.toBe("ok");
    await expect(
      asyncContexts.identity.provide(tenantValue("acme", "u1"), () =>
        runtime.runTask(userTask),
      ),
    ).resolves.toBe("ok");
    await expect(
      asyncContexts.identity.provide(tenantValue("acme", "u2"), () =>
        runtime.runTask(userTask),
      ),
    ).resolves.toBe("ok");
    await expect(
      asyncContexts.identity.provide(tenantValue("acme", "u1"), () =>
        runtime.runTask(userTask),
      ),
    ).rejects.toThrow(/rate limit exceeded/i);
    await runtime.dispose();
  });

  it("fails fast when user-scoped middleware is missing userId", async () => {
    const task = defineTask({
      id: "identity-scope-missing-user-task",
      middleware: [
        rateLimitTaskMiddleware.with({
          windowMs: 60_000,
          max: 1,
          identityScope: userScope,
        }),
      ],
      run: async () => "ok",
    });
    const app = defineResource({
      id: "identity-scope-missing-user-app",
      register: [task],
      init: async () => "ok",
    });

    const runtime = await run(app);
    await expect(
      asyncContexts.identity.provide(tenantValue("acme"), () =>
        runtime.runTask(task),
      ),
    ).rejects.toThrow(/userId/i);
    await runtime.dispose();
  });

  it("supports optional tenant and optional user refinement when required is false", async () => {
    const optionalTenantTask = defineTask({
      id: "identity-scope-optional-tenant-rate-limit-task",
      middleware: [
        rateLimitTaskMiddleware.with({
          windowMs: 60_000,
          max: 1,
          identityScope: { required: false, tenant: true },
        }),
      ],
      run: async () => "ok",
    });
    const optionalUserTask = defineTask({
      id: "identity-scope-optional-user-rate-limit-task",
      middleware: [
        rateLimitTaskMiddleware.with({
          windowMs: 60_000,
          max: 1,
          identityScope: { required: false, tenant: true, user: true },
        }),
      ],
      run: async () => "ok",
    });
    const app = defineResource({
      id: "identity-scope-optional-rate-limit-app",
      register: [optionalTenantTask, optionalUserTask],
      init: async () => "ok",
    });

    const runtime = await run(app);
    await expect(runtime.runTask(optionalTenantTask)).resolves.toBe("ok");
    await expect(
      asyncContexts.identity.provide(tenantValue("acme"), () =>
        runtime.runTask(optionalTenantTask),
      ),
    ).resolves.toBe("ok");
    await expect(runtime.runTask(optionalTenantTask)).rejects.toThrow(
      /rate limit exceeded/i,
    );
    await expect(
      asyncContexts.identity.provide(tenantValue("acme"), () =>
        runtime.runTask(optionalTenantTask),
      ),
    ).rejects.toThrow(/rate limit exceeded/i);

    await expect(
      asyncContexts.identity.provide(tenantValue("acme"), () =>
        runtime.runTask(optionalUserTask),
      ),
    ).resolves.toBe("ok");
    await expect(
      asyncContexts.identity.provide(tenantValue("acme", "u1"), () =>
        runtime.runTask(optionalUserTask),
      ),
    ).resolves.toBe("ok");
    await expect(
      asyncContexts.identity.provide(tenantValue("acme"), () =>
        runtime.runTask(optionalUserTask),
      ),
    ).rejects.toThrow(/rate limit exceeded/i);
    await expect(
      asyncContexts.identity.provide(tenantValue("acme", "u1"), () =>
        runtime.runTask(optionalUserTask),
      ),
    ).rejects.toThrow(/rate limit exceeded/i);

    await runtime.dispose();
  });

  it("isolates concurrency by tenant by default and when tenant scope is enabled", async () => {
    let automaticActiveTasks = 0;
    let automaticMaxActiveTasks = 0;
    let scopedActiveTasks = 0;
    let scopedMaxActiveTasks = 0;

    const automaticTask = defineTask({
      id: "identity-scope-automatic-concurrency-task",
      middleware: [concurrencyTaskMiddleware.with({ limit: 1 })],
      run: async () => {
        automaticActiveTasks += 1;
        automaticMaxActiveTasks = Math.max(
          automaticMaxActiveTasks,
          automaticActiveTasks,
        );
        await sleep(10);
        automaticActiveTasks -= 1;
        return "ok";
      },
    });
    const scopedTask = defineTask({
      id: "identity-scope-tenant-concurrency-task",
      middleware: [
        concurrencyTaskMiddleware.with({
          limit: 1,
          identityScope: tenantScope,
        }),
      ],
      run: async () => {
        scopedActiveTasks += 1;
        scopedMaxActiveTasks = Math.max(
          scopedMaxActiveTasks,
          scopedActiveTasks,
        );
        await sleep(10);
        scopedActiveTasks -= 1;
        return "ok";
      },
    });
    const app = defineResource({
      id: "identity-scope-concurrency-app",
      register: [automaticTask, scopedTask],
      init: async () => "ok",
    });

    const runtime = await run(app);
    await Promise.all([
      asyncContexts.identity.provide(tenantValue("acme"), () =>
        runtime.runTask(automaticTask),
      ),
      asyncContexts.identity.provide(tenantValue("globex"), () =>
        runtime.runTask(automaticTask),
      ),
    ]);
    await Promise.all([
      asyncContexts.identity.provide(tenantValue("acme"), () =>
        runtime.runTask(scopedTask),
      ),
      asyncContexts.identity.provide(tenantValue("globex"), () =>
        runtime.runTask(scopedTask),
      ),
    ]);

    expect(automaticMaxActiveTasks).toBe(2);
    expect(scopedMaxActiveTasks).toBe(2);
    await runtime.dispose();
  });

  it("isolates debounce and throttle state when tenant scope is enabled", async () => {
    jest.useFakeTimers();

    let debounceRuns = 0;
    let throttleRuns = 0;
    const debounced = defineTask({
      id: "identity-scope-debounce-task",
      middleware: [
        debounceTaskMiddleware.with({ ms: 20, identityScope: tenantScope }),
      ],
      run: async () => `debounce-${++debounceRuns}`,
    });
    const throttled = defineTask({
      id: "identity-scope-throttle-task",
      middleware: [
        throttleTaskMiddleware.with({ ms: 20, identityScope: tenantScope }),
      ],
      run: async () => `throttle-${++throttleRuns}`,
    });
    const app = defineResource({
      id: "identity-scope-temporal-app",
      register: [debounced, throttled],
      init: async () => "ok",
    });

    const runtime = await run(app);

    try {
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
    } finally {
      await runtime.dispose();
      jest.useRealTimers();
    }
  });
});
