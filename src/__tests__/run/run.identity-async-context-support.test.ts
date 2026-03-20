import { defineResource, defineTask, middleware, run } from "../../";
import { identityFeatureRequiresAsyncLocalStorageError } from "../../errors";
import { PlatformAdapter, resetPlatform, setPlatform } from "../../platform";

const tenantScope = { tenant: true } as const;

describe("identity-sensitive features require AsyncLocalStorage", () => {
  afterEach(() => {
    resetPlatform();
  });

  it("does not fail on platforms without AsyncLocalStorage when identity-sensitive features are absent", async () => {
    setPlatform(new PlatformAdapter("browser"));

    const task = defineTask({
      id: "identity-als-support-shared-task",
      run: async () => "ok",
    });
    const app = defineResource({
      id: "identity-als-support-shared-app",
      register: [task],
      init: async () => "ok",
    });

    const runtime = await run(app);
    await expect(runtime.runTask(task)).resolves.toBe("ok");
    await runtime.dispose();
  });

  it("fails fast at boot when a task middleware explicitly configures identityScope", async () => {
    setPlatform(new PlatformAdapter("browser"));

    const task = defineTask({
      id: "identity-als-support-local-scope-task",
      middleware: [
        middleware.task.rateLimit.with({
          windowMs: 5_000,
          max: 1,
          identityScope: tenantScope,
        }),
      ],
      run: async () => "ok",
    });
    const app = defineResource({
      id: "identity-als-support-local-scope-app",
      register: [task],
      init: async () => "ok",
    });

    await expect(run(app)).rejects.toThrow(/requires AsyncLocalStorage/i);

    try {
      await run(app);
    } catch (error) {
      expect(identityFeatureRequiresAsyncLocalStorageError.is(error)).toBe(
        true,
      );
    }
  });

  it("does not fail at boot when a task middleware explicitly disables identity partitioning", async () => {
    setPlatform(new PlatformAdapter("browser"));

    const task = defineTask({
      id: "identity-als-support-global-scope-task",
      middleware: [
        middleware.task.rateLimit.with({
          windowMs: 5_000,
          max: 1,
          identityScope: { tenant: false },
        }),
      ],
      run: async () => "ok",
    });
    const app = defineResource({
      id: "identity-als-support-global-scope-app",
      register: [task],
      init: async () => "ok",
    });

    const runtime = await run(app);
    await expect(runtime.runTask(task)).resolves.toBe("ok");
    await runtime.dispose();
  });

  it("fails fast at boot when subtree tasks.identity is declared", async () => {
    setPlatform(new PlatformAdapter("browser"));

    const task = defineTask({
      id: "identity-als-support-subtree-identity-task",
      run: async () => "ok",
    });
    const app = defineResource({
      id: "identity-als-support-subtree-identity-app",
      subtree: {
        tasks: {
          identity: { user: true },
        },
      },
      register: [task],
      init: async () => "ok",
    });

    await expect(run(app)).rejects.toThrow(/subtree\.tasks\.identity/i);
  });

  it("fails fast at boot when identityChecker middleware is attached", async () => {
    setPlatform(new PlatformAdapter("browser"));

    const task = defineTask({
      id: "identity-als-support-checker-task",
      middleware: [
        middleware.task.identityChecker.with({
          roles: ["ADMIN"],
        }),
      ],
      run: async () => "ok",
    });
    const app = defineResource({
      id: "identity-als-support-checker-app",
      register: [task],
      init: async () => "ok",
    });

    await expect(run(app)).rejects.toThrow(/identityChecker/i);
  });

  it("fails fast at boot when subtree middleware.identityScope is declared", async () => {
    setPlatform(new PlatformAdapter("browser"));

    const app = defineResource({
      id: "identity-als-support-subtree-scope-app",
      subtree: {
        middleware: {
          identityScope: { tenant: true, user: true },
        },
      },
      init: async () => "ok",
    });

    await expect(run(app)).rejects.toThrow(
      /subtree\.middleware\.identityScope/i,
    );
  });

  it("does not fail at boot when subtree middleware.identityScope disables identity partitioning", async () => {
    setPlatform(new PlatformAdapter("browser"));

    const task = defineTask({
      id: "identity-als-support-global-subtree-scope-task",
      middleware: [middleware.task.rateLimit.with({ windowMs: 5_000, max: 1 })],
      run: async () => "ok",
    });
    const app = defineResource({
      id: "identity-als-support-global-subtree-scope-app",
      subtree: {
        middleware: {
          identityScope: { tenant: false },
        },
      },
      register: [task],
      init: async () => "ok",
    });

    const runtime = await run(app);
    await expect(runtime.runTask(task)).resolves.toBe("ok");
    await runtime.dispose();
  });

  it("fails fast at boot when subtree task middleware attaches identityChecker", async () => {
    setPlatform(new PlatformAdapter("browser"));

    const task = defineTask({
      id: "identity-als-support-subtree-checker-task",
      run: async () => "ok",
    });
    const app = defineResource({
      id: "identity-als-support-subtree-checker-app",
      subtree: {
        tasks: {
          middleware: [
            middleware.task.identityChecker.with({
              roles: ["ADMIN"],
            }),
          ],
        },
      },
      register: [task],
      init: async () => "ok",
    });

    await expect(run(app)).rejects.toThrow(/identityChecker/i);
  });

  it("fails fast at boot when subtree task middleware explicitly configures identityScope", async () => {
    setPlatform(new PlatformAdapter("browser"));

    const task = defineTask({
      id: "identity-als-support-subtree-scoped-middleware-task",
      run: async () => "ok",
    });
    const app = defineResource({
      id: "identity-als-support-subtree-scoped-middleware-app",
      subtree: {
        tasks: {
          middleware: [
            middleware.task.rateLimit.with({
              windowMs: 5_000,
              max: 1,
              identityScope: tenantScope,
            }),
          ],
        },
      },
      register: [task],
      init: async () => "ok",
    });

    await expect(run(app)).rejects.toThrow(/identityScope/i);
  });
});
