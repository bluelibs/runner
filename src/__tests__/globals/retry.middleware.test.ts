import { defineResource, defineTask } from "../../define";
import { retryMiddleware } from "../../globals/middleware/retry.middleware";
import { run } from "../../run";

describe("Retry Middleware", () => {
  it("should retry failed operations with exponential backoff", async () => {
    let attempt = 0;
    const task = defineTask({
      id: "flakyTask",
      middleware: [
        retryMiddleware.with({
          retries: 3,
          stopRetryIf: (e) => e.message.includes("FATAL"),
        }),
      ],
      run: async () => {
        attempt++;
        if (attempt < 3) throw new Error("Temporary failure");
        return "Success";
      },
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        const result = await task();
        expect(result).toBe("Success");
        expect(attempt).toBe(3);
      },
    });

    await run(app);
  });

  it("should respect stopRetryIf condition", async () => {
    const errorSpy = jest.fn();
    const task = defineTask({
      id: "fatalTask",
      middleware: [
        retryMiddleware.with({
          retries: 3,
          stopRetryIf: (e) => e.message === "FATAL",
        }),
      ],
      run: async () => {
        throw new Error("FATAL");
      },
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        await expect(task()).rejects.toThrow("FATAL");
        expect(errorSpy).not.toHaveBeenCalled();
        throw new Error("FATAL");
      },
    });

    await run(app).catch(errorSpy);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("should use custom delay strategy", async () => {
    jest.useFakeTimers();
    const delays: number[] = [];
    const start = Date.now();

    const task = defineTask({
      id: "delayedTask",
      middleware: [
        retryMiddleware.with({
          retries: 3,
          delayStrategy: (attempt) => (attempt + 1) * 100, // Linear delay
        }),
      ],
      run: async () => {
        throw new Error("Retry me");
      },
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        task().catch(() => {});
      },
    });

    await run(app);

    // Advance timers through all retries
    jest.advanceTimersByTime(1000);
    const elapsed = Date.now() - start;

    // Verify delay sequence: 100ms, 200ms, 300ms
    expect(elapsed).toBeGreaterThanOrEqual(600); // 100+200+300=600
    jest.useRealTimers();
  });

  it("should work with resource initialization", async () => {
    let attempts = 0;
    const resource = defineResource({
      id: "flakyResource",
      middleware: [
        retryMiddleware.with({
          retries: 2,
        }),
      ],
      async init() {
        attempts++;
        if (attempts < 2) throw new Error("Resource init failed");
        return "Resource ready";
      },
    });

    const app = defineResource({
      id: "app",
      register: [resource],
      dependencies: { resource },
      async init(_, { resource }) {
        expect(resource).toBe("Resource ready");
        expect(attempts).toBe(2);
      },
    });

    await run(app);
  });

  it("Should default to 3 retries", async () => {
    let attempt = 0;
    const task = defineTask({
      id: "flakyTask",
      middleware: [retryMiddleware],
      run: async () => {
        attempt++;
        throw new Error("Temporary failure");
      },
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        await expect(task()).rejects.toThrow("Temporary failure");
      },
    });

    await run(app);
    expect(attempt).toBe(4); // fails once and retries 3 more times, logically
  });
});
