import { defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import { rateLimitTaskMiddleware } from "../../../globals/middleware/rateLimit.middleware";

describe("Rate Limit Middleware", () => {
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

  it("should throw a clear error when used without .with(config)", async () => {
    const task = defineTask({
      id: "rateLimit.missingConfig",
      // Intentionally bypass typing to simulate JS usage without `.with(...)`.
      // @ts-expect-error - rateLimitTaskMiddleware requires `.with({ windowMs, max })`.
      middleware: [rateLimitTaskMiddleware],
      run: async () => "ok",
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        await task();
      },
    });

    const runPromise = run(app);
    await expect(runPromise).rejects.toThrow(
      /requires \.with\(\{\s*windowMs,\s*max\s*\}\s*\)/i,
    );
  });

  it("should throw when config is null", () => {
    expect(() => {
      // @ts-expect-error - runtime guard should reject invalid config.
      rateLimitTaskMiddleware.with(null);
    }).toThrow(/requires \.with\(\{\s*windowMs,\s*max\s*\}\s*\)/i);
  });

  it("should throw when config is a non-object", () => {
    expect(() => {
      // @ts-expect-error - runtime guard should reject invalid config.
      rateLimitTaskMiddleware.with(5);
    }).toThrow(/requires \.with\(\{\s*windowMs,\s*max\s*\}\s*\)/i);
  });

  it("should throw when windowMs is not finite", () => {
    expect(() => {
      rateLimitTaskMiddleware.with({ windowMs: Infinity, max: 1 });
    }).toThrow(/positive number for config\.windowMs/i);
  });

  it("should throw when windowMs is not positive", () => {
    expect(() => {
      rateLimitTaskMiddleware.with({ windowMs: 0, max: 1 });
    }).toThrow(/positive number for config\.windowMs/i);
  });

  it("should throw when max is not finite", () => {
    expect(() => {
      rateLimitTaskMiddleware.with({ windowMs: 1000, max: Infinity });
    }).toThrow(/positive number for config\.max/i);
  });

  it("should throw when max is not positive", () => {
    expect(() => {
      rateLimitTaskMiddleware.with({ windowMs: 1000, max: 0 });
    }).toThrow(/positive number for config\.max/i);
  });
});
