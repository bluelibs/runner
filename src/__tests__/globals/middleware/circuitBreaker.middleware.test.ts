import { defineTask, defineResource } from "../../../define";
import { run } from "../../../run";
import {
  circuitBreakerMiddleware,
  CircuitBreakerOpenError,
} from "../../../globals/middleware/circuitBreaker.middleware";

describe("Circuit Breaker Middleware", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // We might need to reset the statusMap if it was global,
    // but since it's internal to the module and not exported,
    // we rely on different task IDs or we might need to export a reset function for tests if needed.
    // For now, I'll use unique task IDs per test or a shared one where it makes sense.
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should allow calls when in CLOSED state", async () => {
    const task = defineTask({
      id: "task.closed",
      middleware: [circuitBreakerMiddleware.with({ failureThreshold: 2 })],
      run: async () => "ok",
    });

    const app = defineResource({
      id: "app.closed",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        const result = await task();
        expect(result).toBe("ok");
      },
    });

    await run(app);
  });

  it("should trip to OPEN state after failure threshold is reached", async () => {
    const shouldFail = true;
    const task = defineTask({
      id: "task.tripping",
      middleware: [circuitBreakerMiddleware.with({ failureThreshold: 2 })],
      run: async () => {
        if (shouldFail) throw new Error("fail");
        return "ok";
      },
    });

    const app = defineResource({
      id: "app.tripping",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        // 1st failure
        await expect(task()).rejects.toThrow("fail");
        // 2nd failure - should trip
        await expect(task()).rejects.toThrow("fail");
        // 3rd call - should be OPEN
        await expect(task()).rejects.toThrow(CircuitBreakerOpenError);
      },
    });

    await run(app);
  });

  it("should transition to HALF_OPEN after resetTimeout", async () => {
    let shouldFail = true;
    const task = defineTask({
      id: "task.reset",
      middleware: [
        circuitBreakerMiddleware.with({
          failureThreshold: 1,
          resetTimeout: 1000,
        }),
      ],
      run: async () => {
        if (shouldFail) throw new Error("fail");
        return "ok";
      },
    });

    const app = defineResource({
      id: "app.reset",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        // Trip it
        await expect(task()).rejects.toThrow("fail");
        await expect(task()).rejects.toThrow(CircuitBreakerOpenError);

        // Advance time
        jest.advanceTimersByTime(1000);

        // Now it should be HALF_OPEN, allow one call
        shouldFail = false;
        const result = await task();
        expect(result).toBe("ok");

        // Should be CLOSED now
        const result2 = await task();
        expect(result2).toBe("ok");
      },
    });

    await run(app);
  });

  it("should go back to OPEN if call fails in HALF_OPEN", async () => {
    let shouldFail = true;
    const task = defineTask({
      id: "task.halfOpenFail",
      middleware: [
        circuitBreakerMiddleware.with({
          failureThreshold: 1,
          resetTimeout: 1000,
        }),
      ],
      run: async () => {
        if (shouldFail) throw new Error("fail");
        return "ok";
      },
    });

    const app = defineResource({
      id: "app.halfOpenFail",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        // Trip it
        await expect(task()).rejects.toThrow("fail");

        // Advance time
        jest.advanceTimersByTime(1000);

        // Now it is HALF_OPEN, let it fail again
        shouldFail = true;
        await expect(task()).rejects.toThrow("fail");

        // Should be OPEN again immediately
        await expect(task()).rejects.toThrow(CircuitBreakerOpenError);
      },
    });

    await run(app);
  });

  it("should isolate states between different tasks", async () => {
    const task1 = defineTask({
      id: "task.isolate1",
      middleware: [circuitBreakerMiddleware.with({ failureThreshold: 1 })],
      run: async () => {
        throw new Error("fail");
      },
    });

    const task2 = defineTask({
      id: "task.isolate2",
      middleware: [circuitBreakerMiddleware.with({ failureThreshold: 1 })],
      run: async () => "ok",
    });

    const app = defineResource({
      id: "app.isolate",
      register: [task1, task2],
      dependencies: { task1, task2 },
      async init(_, { task1, task2 }) {
        // Trip task1
        await expect(task1()).rejects.toThrow("fail");
        await expect(task1()).rejects.toThrow(CircuitBreakerOpenError);

        // task2 should still work
        const result = await task2();
        expect(result).toBe("ok");
      },
    });

    await run(app);
  });

  it("should use default config values", async () => {
    // failureThreshold default 5
    const task = defineTask({
      id: "task.defaults",
      middleware: [circuitBreakerMiddleware],
      run: async () => {
        throw new Error("fail");
      },
    });

    const app = defineResource({
      id: "app.defaults",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        for (let i = 0; i < 4; i++) {
          await expect(task()).rejects.toThrow("fail");
        }
        // Still not open after 4 failures
        await expect(task()).rejects.toThrow("fail");
        // 5th failure happened in previous call, now it should be open
        await expect(task()).rejects.toThrow(CircuitBreakerOpenError);
      },
    });

    await run(app);
  });
});
