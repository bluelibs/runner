import { defineResource, defineTask } from "../../../define";
import {
  middlewareKeyCapacityExceededError,
  middlewareRateLimitExceededError,
} from "../../../errors";
import {
  rateLimitResource,
  rateLimitTaskMiddleware,
} from "../../../globals/middleware/rateLimit.middleware";
import { run } from "../../../run";

describe("Rate Limit Middleware", () => {
  const expectValidationError = (fn: () => unknown): void => {
    expect(fn).toThrow();
  };

  it("should allow requests within limit", async () => {
    let callCount = 0;
    const task = defineTask({
      id: "rateLimit-allow",
      middleware: [rateLimitTaskMiddleware.with({ windowMs: 1000, max: 2 })],
      run: async () => {
        callCount++;
        return "ok";
      },
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        await task();
        await task();
        return "done";
      },
    });

    await run(app);
    expect(callCount).toBe(2);
  });

  it("throws the built-in rate-limit helper when exceeding the limit", async () => {
    expect.assertions(2);
    const task = defineTask({
      id: "rateLimit-exceed",
      middleware: [rateLimitTaskMiddleware.with({ windowMs: 1000, max: 1 })],
      run: async () => "ok",
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        await task();
        await task();
      },
    });

    try {
      await run(app);
    } catch (error) {
      expect(String(error)).toMatch(/Rate limit exceeded/i);
      expect(middlewareRateLimitExceededError.is(error)).toBe(true);
    }
  });

  it("should reset after window expires", async () => {
    jest.useFakeTimers();
    let callCount = 0;
    const config = { windowMs: 100, max: 1 };
    const task = defineTask({
      id: "rateLimit-reset",
      middleware: [rateLimitTaskMiddleware.with(config)],
      run: async () => {
        callCount++;
        return "ok";
      },
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        await task();
        await expect(task()).rejects.toThrow(/Rate limit exceeded/i);
        jest.advanceTimersByTime(150);
        await Promise.resolve();
        await task();
      },
    });

    try {
      await run(app);
      expect(callCount).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("limits independently per computed key", async () => {
    const task = defineTask({
      id: "rateLimit-keyed",
      middleware: [
        rateLimitTaskMiddleware.with({
          windowMs: 1000,
          max: 1,
          keyBuilder: (_taskId, input) => input as string,
        }),
      ],
      run: async (input: string) => input,
    });

    const app = defineResource({
      id: "app-keyed",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        await expect(task("a")).resolves.toBe("a");
        await expect(task("b")).resolves.toBe("b");
        await expect(task("a")).rejects.toThrow(/Rate limit exceeded/i);
      },
    });

    await run(app);
  });

  it("isolates rate-limit state by task when reusing one configured middleware instance", async () => {
    const sharedRateLimit = rateLimitTaskMiddleware.with({
      windowMs: 1000,
      max: 1,
    });

    const taskA = defineTask({
      id: "rateLimit-shared-a",
      middleware: [sharedRateLimit],
      run: async () => "a",
    });

    const taskB = defineTask({
      id: "rateLimit-shared-b",
      middleware: [sharedRateLimit],
      run: async () => "b",
    });

    const app = defineResource({
      id: "app-shared",
      register: [taskA, taskB],
      dependencies: { taskA, taskB },
      async init(_, { taskA, taskB }) {
        await expect(taskA()).resolves.toBe("a");
        await expect(taskB()).resolves.toBe("b");
      },
    });

    await run(app);
  });

  it("should reset exactly at window boundary", async () => {
    expect.assertions(1);
    jest.useFakeTimers();
    let callCount = 0;
    const config = { windowMs: 100, max: 1 };
    const task = defineTask({
      id: "rateLimit-boundary",
      middleware: [rateLimitTaskMiddleware.with(config)],
      run: async () => {
        callCount += 1;
        return "ok";
      },
    });

    const app = defineResource({
      id: "app-boundary",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
        await task();
        jest.setSystemTime(new Date("2026-01-01T00:00:00.100Z"));
        await task();
      },
    });

    try {
      await run(app);
      expect(callCount).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("should validate config on with()", () => {
    const configured = rateLimitTaskMiddleware.with({
      windowMs: 1000,
      max: 1,
      maxKeys: 3,
      keyBuilder: (taskId) => taskId,
    });

    expect(configured.config).toEqual({
      windowMs: 1000,
      max: 1,
      maxKeys: 3,
      keyBuilder: expect.any(Function),
    });
  });

  it("should throw when config is null", () => {
    expectValidationError(() => {
      // @ts-expect-error - runtime guard should reject invalid config.
      rateLimitTaskMiddleware.with(null);
    });
  });

  it("should throw when config is a non-object", () => {
    expectValidationError(() => {
      // @ts-expect-error - runtime guard should reject invalid config.
      rateLimitTaskMiddleware.with(5);
    });
  });

  it("should throw when required config keys are missing", () => {
    expectValidationError(() => {
      // @ts-expect-error - runtime guard should reject missing keys.
      rateLimitTaskMiddleware.with({});
    });
  });

  it("should throw when windowMs is not finite", () => {
    expectValidationError(() => {
      rateLimitTaskMiddleware.with({ windowMs: Infinity, max: 1 });
    });
  });

  it("should throw when windowMs is negative", () => {
    expectValidationError(() => {
      rateLimitTaskMiddleware.with({ windowMs: -1, max: 1 });
    });
  });

  it("should throw when windowMs is zero", () => {
    expectValidationError(() => {
      rateLimitTaskMiddleware.with({ windowMs: 0, max: 1 });
    });
  });

  it("should throw when max is not finite", () => {
    expectValidationError(() => {
      rateLimitTaskMiddleware.with({ windowMs: 1000, max: Infinity });
    });
  });

  it("should throw when max is negative", () => {
    expectValidationError(() => {
      rateLimitTaskMiddleware.with({ windowMs: 1000, max: -1 });
    });
  });

  it("should throw when max is zero", () => {
    expectValidationError(() => {
      rateLimitTaskMiddleware.with({ windowMs: 1000, max: 0 });
    });
  });

  it("should throw when maxKeys is zero", () => {
    expectValidationError(() => {
      rateLimitTaskMiddleware.with({ windowMs: 1000, max: 1, maxKeys: 0 });
    });
  });

  it("propagates keyBuilder errors", async () => {
    const task = defineTask({
      id: "rateLimit-keyBuilder-error",
      middleware: [
        rateLimitTaskMiddleware.with({
          windowMs: 1000,
          max: 1,
          keyBuilder: () => {
            throw new Error("bad-key");
          },
        }),
      ],
      run: async () => "ok",
    });

    const app = defineResource({
      id: "app-keyBuilder-error",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        await expect(task()).rejects.toThrow("bad-key");
      },
    });

    await run(app);
  });

  it("fails fast when keyBuilder returns a non-string", async () => {
    const task = defineTask({
      id: "rateLimit-keyBuilder-invalid-return",
      middleware: [
        rateLimitTaskMiddleware.with({
          windowMs: 1000,
          max: 1,
          keyBuilder: () => ({ invalid: true }) as unknown as string,
        }),
      ],
      run: async () => "ok",
    });

    const app = defineResource({
      id: "app-rateLimit-keyBuilder-invalid-return",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        await expect(task()).rejects.toThrow();
      },
    });

    await run(app);
  });

  it("prunes expired keyed windows before admitting a new distinct key", async () => {
    const config = { windowMs: 1000, max: 1, keyBuilder: () => "shared" };
    const keyedStates = new Map<string, { count: number; resetTime: number }>();

    keyedStates.set("expired-a", {
      count: 1,
      resetTime: Date.now() - 1,
    });
    keyedStates.set("expired-b", {
      count: 1,
      resetTime: Date.now() - 1,
    });

    keyedStates.set("keep", {
      count: 0,
      resetTime: Date.now() + 10_000,
    });

    const trackedStates = new Map([[config, keyedStates]]);
    const deps = {
      state: {
        states: new WeakMap([[config, keyedStates]]),
        trackedStates,
        disposeCleanupTimer: jest.fn(),
        registerConfigMap: jest.fn(),
        sweepExpiredStates: (now: number) => {
          for (const [trackedConfig, trackedMap] of trackedStates) {
            for (const [key, value] of trackedMap) {
              if (now >= value.resetTime) {
                trackedMap.delete(key);
              }
            }

            if (trackedMap.size === 0) {
              trackedStates.delete(trackedConfig);
            }
          }
        },
      },
      identityContext: {
        tryUse: () => undefined,
      },
    } as Parameters<typeof rateLimitTaskMiddleware.run>[1];

    await expect(
      rateLimitTaskMiddleware.run(
        {
          task: {
            definition: { id: "rateLimit-prune" } as any,
            input: "fresh",
          },
          journal: {
            set: jest.fn(),
          } as any,
          next: async (input?: string) => input,
        },
        deps,
        config,
      ),
    ).resolves.toBe("fresh");

    expect(keyedStates.size).toBe(2);
    expect(keyedStates.has("keep")).toBe(true);
    expect(keyedStates.has("shared")).toBe(true);
  });

  it("rejects new distinct keys when maxKeys is reached but still allows the existing key", async () => {
    const task = defineTask({
      id: "rateLimit-max-keys",
      middleware: [
        rateLimitTaskMiddleware.with({
          windowMs: 60_000,
          max: 10,
          maxKeys: 1,
          keyBuilder: (_taskId, input) => String(input),
        }),
      ],
      run: async (input: string) => input,
    });

    const app = defineResource({
      id: "app-rateLimit-max-keys",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        await expect(task("a")).resolves.toBe("a");
        await expect(task("a")).resolves.toBe("a");
        let capacityError: unknown;
        try {
          await task("b");
        } catch (error) {
          capacityError = error;
        }
        expect(middlewareKeyCapacityExceededError.is(capacityError)).toBe(true);
        expect(capacityError).toMatchObject({
          data: {
            middlewareId: "app-rateLimit-max-keys.tasks.rateLimit-max-keys",
            maxKeys: 1,
          },
        });
      },
    });

    await run(app);
  });

  it("evicts expired windows on the background cleanup timer without a new request", async () => {
    jest.useFakeTimers();
    const middleware = rateLimitTaskMiddleware.with({
      windowMs: 50,
      max: 1,
      keyBuilder: (_taskId, input) => String(input),
    });
    const task = defineTask({
      id: "rateLimit-background-cleanup",
      middleware: [middleware],
      run: async (input: string) => input,
    });
    const app = defineResource({
      id: "app-rateLimit-background-cleanup",
      register: [task],
      dependencies: { task, rateLimit: rateLimitResource },
      init: async () => "ok",
    });

    try {
      const runtime = await run(app);
      const state = runtime.getResourceValue(rateLimitResource);

      await runtime.runTask(task, "a");
      const keyedStates = state.states.get(middleware.config);
      expect(keyedStates?.size).toBe(1);

      jest.advanceTimersByTime(1_100);
      await Promise.resolve();

      expect(keyedStates?.size).toBe(0);
      expect(state.states.get(middleware.config)).toBeUndefined();
      await runtime.dispose();
    } finally {
      jest.useRealTimers();
    }
  });

  it("cancels the cleanup timer during cooldown and dispose", async () => {
    const cancel = jest.fn();
    const context = {
      cleanupIntervalMs: 1_000,
      cleanupTimer: { cancel },
    };

    await rateLimitResource.cooldown?.(
      {} as never,
      undefined as never,
      {} as never,
      context,
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(context.cleanupTimer).toBeUndefined();

    context.cleanupTimer = { cancel };
    await rateLimitResource.dispose?.(
      {
        trackedStates: new Map(),
        disposeCleanupTimer: () => {
          context.cleanupTimer?.cancel();
        },
      } as never,
      undefined as never,
      {} as never,
      context,
    );
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(context.cleanupTimer).toBeUndefined();
  });

  it("disposes the internally scheduled cleanup timer directly from the resource state", async () => {
    const cancel = jest.fn();
    const context = {};
    const state = await rateLimitResource.init?.(
      undefined as never,
      {
        timers: {
          setInterval: jest.fn(() => ({ cancel })),
        },
      } as never,
      context as never,
    );
    const config = { windowMs: 5_000, max: 1 };

    state?.registerConfigMap(config, new Map());
    state?.disposeCleanupTimer();

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("falls back to direct pruning when a mocked state does not expose sweepExpiredStates", async () => {
    const config = {
      windowMs: 1_000,
      max: 1,
      maxKeys: 1,
      keyBuilder: () => "shared",
    };
    const keyedStates = new Map<string, { count: number; resetTime: number }>([
      [
        "expired",
        {
          count: 1,
          resetTime: Date.now() - 1,
        },
      ],
    ]);
    const deps = {
      state: {
        states: new WeakMap([[config, keyedStates]]),
        trackedStates: new Map(),
        disposeCleanupTimer: jest.fn(),
        registerConfigMap: jest.fn(),
      },
      identityContext: {
        tryUse: () => undefined,
      },
    } as unknown as Parameters<typeof rateLimitTaskMiddleware.run>[1];

    await expect(
      rateLimitTaskMiddleware.run(
        {
          task: {
            definition: { id: "rateLimit-fallback-prune" } as any,
            input: "fresh",
          },
          journal: {
            set: jest.fn(),
          } as any,
          next: async (input?: string) => input,
        },
        deps,
        config,
      ),
    ).resolves.toBe("fresh");

    expect(keyedStates.has("expired")).toBe(false);
    expect(keyedStates.has("shared")).toBe(true);
  });
});
