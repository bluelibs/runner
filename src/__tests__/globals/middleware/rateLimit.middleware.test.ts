import { defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import {
  rateLimitTaskMiddleware,
  RateLimitError,
} from "../../../globals/middleware/rateLimit.middleware";

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

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

    await expect(run(app)).rejects.toThrow(RateLimitError);
  });

  it("should reset after window expires", async () => {
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
        await expect(task()).rejects.toThrow(RateLimitError);
        await sleep(150);
        await task();
      },
    });

    await run(app);
    expect(callCount).toBe(2);
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
    await expect(runPromise).rejects.toThrow(TypeError);
    await expect(runPromise).rejects.toThrow(
      /requires \.with\(\{\s*windowMs,\s*max\s*\}\s*\)/i,
    );
  });

  it("should throw when config is null", async () => {
    const task = defineTask({
      id: "rateLimit.invalidConfig.null",
      // @ts-expect-error - runtime guard should reject invalid config.
      middleware: [rateLimitTaskMiddleware.with(null)],
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
    await expect(runPromise).rejects.toThrow(TypeError);
    await expect(runPromise).rejects.toThrow(
      /requires \.with\(\{\s*windowMs,\s*max\s*\}\s*\)/i,
    );
  });

  it("should throw when config is a non-object", async () => {
    const task = defineTask({
      id: "rateLimit.invalidConfig.nonObject",
      // @ts-expect-error - runtime guard should reject invalid config.
      middleware: [rateLimitTaskMiddleware.with(5)],
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
    await expect(runPromise).rejects.toThrow(TypeError);
    await expect(runPromise).rejects.toThrow(
      /requires \.with\(\{\s*windowMs,\s*max\s*\}\s*\)/i,
    );
  });

  it("should throw when windowMs is not finite", async () => {
    const task = defineTask({
      id: "rateLimit.invalidConfig.windowMsNotFinite",
      middleware: [
        rateLimitTaskMiddleware.with({ windowMs: Infinity, max: 1 }),
      ],
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

    await expect(run(app)).rejects.toThrow(TypeError);
    await expect(run(app)).rejects.toThrow(
      /positive number for config\.windowMs/i,
    );
  });

  it("should throw when windowMs is not positive", async () => {
    const task = defineTask({
      id: "rateLimit.invalidConfig.windowMsNotPositive",
      middleware: [rateLimitTaskMiddleware.with({ windowMs: 0, max: 1 })],
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

    await expect(run(app)).rejects.toThrow(TypeError);
    await expect(run(app)).rejects.toThrow(
      /positive number for config\.windowMs/i,
    );
  });

  it("should throw when max is not finite", async () => {
    const task = defineTask({
      id: "rateLimit.invalidConfig.maxNotFinite",
      middleware: [
        rateLimitTaskMiddleware.with({ windowMs: 1000, max: Infinity }),
      ],
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

    await expect(run(app)).rejects.toThrow(TypeError);
    await expect(run(app)).rejects.toThrow(/positive number for config\.max/i);
  });

  it("should throw when max is not positive", async () => {
    const task = defineTask({
      id: "rateLimit.invalidConfig.maxNotPositive",
      middleware: [rateLimitTaskMiddleware.with({ windowMs: 1000, max: 0 })],
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

    await expect(run(app)).rejects.toThrow(TypeError);
    await expect(run(app)).rejects.toThrow(/positive number for config\.max/i);
  });
});
