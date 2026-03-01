import { defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import { rateLimitTaskMiddleware } from "../../../globals/middleware/rateLimit.middleware";
import { RunnerError } from "../../../definers/defineError";

describe("Rate Limit Middleware", () => {
  const expectValidationError = (fn: () => unknown): void => {
    try {
      fn();
      throw new Error("Expected validation error");
    } catch (error) {
      expect(error).toBeInstanceOf(RunnerError);
    }
  };

  it("should allow requests within limit", async () => {
    let callCount = 0;
    const task = defineTask({
      id: "rateLimit.allow",
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

  it("should throw RateLimitError when exceeding limit", async () => {
    const task = defineTask({
      id: "rateLimit.exceed",
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

    await expect(run(app)).rejects.toThrow(/Rate limit exceeded/i);
  });

  it("should reset after window expires", async () => {
    jest.useFakeTimers();
    let callCount = 0;
    const config = { windowMs: 100, max: 1 };
    const task = defineTask({
      id: "rateLimit.reset",
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

  it("should reset exactly at window boundary", async () => {
    expect.assertions(1);
    jest.useFakeTimers();
    let callCount = 0;
    const config = { windowMs: 100, max: 1 };
    const task = defineTask({
      id: "rateLimit.boundary",
      middleware: [rateLimitTaskMiddleware.with(config)],
      run: async () => {
        callCount += 1;
        return "ok";
      },
    });

    const app = defineResource({
      id: "app.boundary",
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
    });

    expect(configured.config).toEqual({
      windowMs: 1000,
      max: 1,
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

  it("should throw when windowMs is not positive", () => {
    expectValidationError(() => {
      rateLimitTaskMiddleware.with({ windowMs: 0, max: 1 });
    });
  });

  it("should throw when max is not finite", () => {
    expectValidationError(() => {
      rateLimitTaskMiddleware.with({ windowMs: 1000, max: Infinity });
    });
  });

  it("should throw when max is not positive", () => {
    expectValidationError(() => {
      rateLimitTaskMiddleware.with({ windowMs: 1000, max: 0 });
    });
  });
});
