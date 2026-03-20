import {
  asyncContexts,
  defineResource,
  defineTask,
  defineTaskMiddleware,
  run,
} from "../../";
import {
  identityContextRequiredError,
  identityInvalidContextError,
} from "../../errors";
import { rateLimitTaskMiddleware } from "../../globals/middleware/rateLimit.middleware";

const tenantScope = { tenant: true } as const;
const userScope = { tenant: true, user: true } as const;

const tenantValue = (tenantId: string, userId?: string) => ({
  tenantId,
  region: `${tenantId}-region`,
  ...(userId === undefined ? {} : { userId }),
});

describe("run subtree task identityScope policy", () => {
  it("can use subtree identityScope to opt out of tenant partitioning", async () => {
    const task = defineTask({
      id: "subtree-identity-scope-global-task",
      middleware: [rateLimitTaskMiddleware.with({ windowMs: 60_000, max: 1 })],
      run: async () => "ok",
    });
    const app = defineResource({
      id: "subtree-identity-scope-global-app",
      subtree: {
        middleware: {
          identityScope: { tenant: false },
        },
      },
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
      asyncContexts.identity.provide(tenantValue("globex", "u2"), () =>
        runtime.runTask(task),
      ),
    ).rejects.toThrow(/rate limit exceeded/i);

    await runtime.dispose();
  });

  it("fills missing identityScope for tagged local task middleware", async () => {
    const task = defineTask({
      id: "subtree-identity-scope-local-task",
      middleware: [rateLimitTaskMiddleware.with({ windowMs: 60_000, max: 1 })],
      run: async () => "ok",
    });
    const app = defineResource({
      id: "subtree-identity-scope-local-app",
      subtree: {
        middleware: {
          identityScope: userScope,
        },
      },
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

  it("applies subtree identityScope to tagged subtree-added middleware", async () => {
    const task = defineTask({
      id: "subtree-identity-scope-global-task",
      run: async () => "ok",
    });
    const app = defineResource({
      id: "subtree-identity-scope-global-app",
      subtree: {
        tasks: {
          middleware: [
            rateLimitTaskMiddleware.with({ windowMs: 60_000, max: 1 }),
          ],
        },
        middleware: {
          identityScope: userScope,
        },
      },
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

  it("accepts exact identityScope matches and rejects mismatches", async () => {
    const matchingTask = defineTask({
      id: "subtree-identity-scope-matching-task",
      middleware: [
        rateLimitTaskMiddleware.with({
          windowMs: 60_000,
          max: 1,
          identityScope: userScope,
        }),
      ],
      run: async () => "ok",
    });
    const mismatchedTask = defineTask({
      id: "subtree-identity-scope-mismatched-task",
      middleware: [
        rateLimitTaskMiddleware.with({
          windowMs: 60_000,
          max: 1,
          identityScope: tenantScope,
        }),
      ],
      run: async () => "ok",
    });
    const app = defineResource({
      id: "subtree-identity-scope-exact-match-app",
      subtree: {
        middleware: {
          identityScope: userScope,
        },
      },
      register: [matchingTask, mismatchedTask],
      init: async () => "ok",
    });

    const runtime = await run(app);

    await expect(
      asyncContexts.identity.provide(tenantValue("acme", "u1"), () =>
        runtime.runTask(matchingTask),
      ),
    ).resolves.toBe("ok");
    await expect(
      asyncContexts.identity.provide(tenantValue("acme", "u1"), () =>
        runtime.runTask(mismatchedTask),
      ),
    ).rejects.toThrow(/must match exactly/i);

    await runtime.dispose();
  });

  it("fails fast when subtree identityScope is filled but runtime identity is missing required fields", async () => {
    const task = defineTask({
      id: "subtree-identity-scope-missing-runtime-identity-task",
      middleware: [rateLimitTaskMiddleware.with({ windowMs: 60_000, max: 1 })],
      run: async () => "ok",
    });
    const app = defineResource({
      id: "subtree-identity-scope-missing-runtime-identity-app",
      subtree: {
        middleware: {
          identityScope: userScope,
        },
      },
      register: [task],
      init: async () => "ok",
    });

    const runtime = await run(app);

    let missingIdentityError: unknown;
    try {
      await runtime.runTask(task);
    } catch (error) {
      missingIdentityError = error;
    }

    expect(identityContextRequiredError.is(missingIdentityError)).toBe(true);

    let missingUserError: unknown;
    try {
      await asyncContexts.identity.provide(tenantValue("acme"), () =>
        runtime.runTask(task),
      );
    } catch (error) {
      missingUserError = error;
    }

    expect(identityInvalidContextError.is(missingUserError)).toBe(true);
    expect(String(missingUserError)).toMatch(/userId/i);

    await runtime.dispose();
  });

  it("uses the nearest owner subtree identityScope policy", async () => {
    const task = defineTask({
      id: "subtree-identity-scope-nearest-task",
      middleware: [rateLimitTaskMiddleware.with({ windowMs: 60_000, max: 1 })],
      run: async () => "ok",
    });
    const feature = defineResource({
      id: "subtree-identity-scope-nearest-feature",
      subtree: {
        middleware: {
          identityScope: tenantScope,
        },
      },
      register: [task],
      init: async () => "ok",
    });
    const app = defineResource({
      id: "subtree-identity-scope-nearest-app",
      subtree: {
        middleware: {
          identityScope: userScope,
        },
      },
      register: [feature],
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
    ).rejects.toThrow(/rate limit exceeded/i);

    await runtime.dispose();
  });

  it("leaves untagged task middleware unchanged under subtree identityScope", async () => {
    const labelMiddleware = defineTaskMiddleware<{ label: string }>({
      id: "subtree-identity-scope-untagged-label",
      run: async ({ next }, _deps, config) => {
        const value = await next(undefined as never);
        return `${config.label}:${String(value)}`;
      },
    });
    const task = defineTask({
      id: "subtree-identity-scope-untagged-task",
      middleware: [labelMiddleware.with({ label: "ok" })],
      run: async () => "value",
    });
    const app = defineResource({
      id: "subtree-identity-scope-untagged-app",
      subtree: {
        middleware: {
          identityScope: userScope,
        },
      },
      register: [labelMiddleware, task],
      init: async () => "ok",
    });

    const runtime = await run(app);

    await expect(runtime.runTask(task)).resolves.toBe("ok:value");

    await runtime.dispose();
  });
});
