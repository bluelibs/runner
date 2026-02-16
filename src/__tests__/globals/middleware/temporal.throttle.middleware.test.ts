import { defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import { throttleTaskMiddleware } from "../../../globals/middleware/temporal.middleware";

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

describe("Temporal Middleware: Throttle", () => {
  it("should throttle task executions", async () => {
    let callCount = 0;
    const task = defineTask({
      id: "throttle.task",
      middleware: [throttleTaskMiddleware.with({ ms: 100 })],
      run: async (val: string) => {
        callCount++;
        return val;
      },
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        // First one executes immediately
        const p1 = task("a");
        // Second one is throttled and scheduled
        const p2 = task("b");
        // Third one updates the scheduled input
        const p3 = task("c");

        return await Promise.all([p1, p2, p3]);
      },
    });

    const results = (await run(app)).value;

    expect(callCount).toBe(2);
    expect(results[0]).toBe("a");
    expect(results[1]).toBe("c");
    expect(results[2]).toBe("c");
  });

  it("should execute immediately if enough time has passed", async () => {
    let callCount = 0;
    const task = defineTask({
      id: "throttle.immediate",
      middleware: [throttleTaskMiddleware.with({ ms: 50 })],
      run: async (val: string) => {
        callCount++;
        return val;
      },
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        await task("a");
        await sleep(100);
        await task("b");
      },
    });

    await run(app);
    expect(callCount).toBe(2);
  });

  it("should handle errors in throttled task", async () => {
    let callCount = 0;
    const task = defineTask({
      id: "throttle.error",
      middleware: [throttleTaskMiddleware.with({ ms: 50 })],
      run: async () => {
        callCount++;
        throw new Error("Throttle error");
      },
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        // Immediate fail
        await expect(task()).rejects.toThrow("Throttle error");
        // Scheduled fail
        await expect(task()).rejects.toThrow("Throttle error");
      },
    });

    await run(app);
    expect(callCount).toBe(2);
  });

  it("should reject scheduled callers when the scheduled execution fails", async () => {
    const config = { ms: 50 };
    const deps = { state: { throttleStates: new WeakMap() } };

    const next = async (input?: string) => {
      if (input === "b") {
        throw new Error("Throttle error");
      }
      return input;
    };

    const inputFor = (input: string) => ({
      task: {
        definition: { id: "throttle.unit.scheduled.fail" } as any,
        input,
      },
      next,
    });

    const setTimeoutSpy = jest.spyOn(globalThis, "setTimeout");
    try {
      let scheduled: (() => Promise<void>) | undefined;
      setTimeoutSpy.mockImplementation(((fn: any) => {
        scheduled = fn;
        return 1 as any;
      }) as any);

      await expect(
        throttleTaskMiddleware.run(inputFor("a") as any, deps as any, config),
      ).resolves.toBe("a");

      const scheduledPromise = throttleTaskMiddleware.run(
        inputFor("b") as any,
        deps as any,
        config,
      );

      expect(scheduled).toBeDefined();
      await scheduled?.();

      await expect(scheduledPromise).rejects.toThrow("Throttle error");
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it("should clear a pending scheduled execution when window elapsed but timer is still pending", async () => {
    jest.useFakeTimers();
    const config = { ms: 50 };
    let callCount = 0;
    const next = async (input?: string) => {
      callCount += 1;
      return input;
    };
    const inputFor = (input: string) => ({
      task: {
        definition: { id: "throttle.unit" } as any,
        input,
      },
      next,
    });

    try {
      const deps = { state: { throttleStates: new WeakMap() } };
      await expect(
        throttleTaskMiddleware.run(inputFor("a") as any, deps as any, config),
      ).resolves.toBe("a");

      const pending = throttleTaskMiddleware.run(
        inputFor("b") as any,
        deps as any,
        config,
      );

      // Advance logical time without running pending timers.
      jest.setSystemTime(Date.now() + 120);

      await expect(
        throttleTaskMiddleware.run(inputFor("c") as any, deps as any, config),
      ).resolves.toBe("c");

      // The previously scheduled caller should be resolved by the immediate execution.
      await expect(pending).resolves.toBe("c");
      expect(callCount).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("should reject scheduled callers when clearing a stale timeout and immediate execution fails", async () => {
    const config = { ms: 50 };
    let callCount = 0;
    const next = async (input?: string) => {
      callCount += 1;
      if (input === "c") {
        throw new Error("boom");
      }
      return input;
    };
    const inputFor = (input: string) => ({
      task: {
        definition: { id: "throttle.unit.fail" } as any,
        input,
      },
      next,
    });

    const deps = { state: { throttleStates: new WeakMap() } };
    await expect(
      throttleTaskMiddleware.run(inputFor("a") as any, deps as any, config),
    ).resolves.toBe("a");

    const pending = throttleTaskMiddleware.run(
      inputFor("b") as any,
      deps as any,
      config,
    );

    const start = Date.now();
    while (Date.now() - start < 120) {
      // busy-wait to block event loop
    }

    const immediate = throttleTaskMiddleware.run(
      inputFor("c") as any,
      deps as any,
      config,
    );

    await expect(immediate).rejects.toThrow("boom");
    await expect(pending).rejects.toThrow("boom");
    expect(callCount).toBe(2);
  });

  it("should clear latestInput after scheduled execution completes", async () => {
    type ThrottleRunInput = Parameters<typeof throttleTaskMiddleware.run>[0];
    type ThrottleRunDeps = Parameters<typeof throttleTaskMiddleware.run>[1];
    type ThrottleRunConfig = Parameters<typeof throttleTaskMiddleware.run>[2];

    const config = { ms: 50 };
    const deps = {
      state: {
        throttleStates: new WeakMap(),
        trackedThrottleStates: new Set(),
        isDisposed: false,
      },
    } as unknown as ThrottleRunDeps;

    const next = async (input?: string) => input;
    const inputFor = (input: string): ThrottleRunInput =>
      ({
        task: {
          definition: {
            id: "throttle.unit.latest-input",
          } as unknown as ThrottleRunInput["task"]["definition"],
          input,
        },
        next,
      }) as unknown as ThrottleRunInput;

    const setTimeoutSpy = jest.spyOn(globalThis, "setTimeout");
    try {
      let scheduled: (() => Promise<void>) | undefined;
      setTimeoutSpy.mockImplementation(((
        fn: TimerHandler,
      ): ReturnType<typeof setTimeout> => {
        if (typeof fn !== "function") {
          throw new Error("Expected function timer callback");
        }
        scheduled = fn as () => Promise<void>;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout);

      await expect(
        throttleTaskMiddleware.run(
          inputFor("a"),
          deps,
          config as ThrottleRunConfig,
        ),
      ).resolves.toBe("a");

      const pending = throttleTaskMiddleware.run(
        inputFor("b"),
        deps,
        config as ThrottleRunConfig,
      );

      expect(scheduled).toBeDefined();
      await scheduled?.();
      await expect(pending).resolves.toBe("b");

      const throttleState = (
        deps.state.throttleStates as unknown as WeakMap<
          ThrottleRunConfig,
          { latestInput?: unknown }
        >
      ).get(config);
      expect(throttleState?.latestInput).toBeUndefined();
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });
});
