import { defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import {
  type DebounceState,
  type ThrottleState,
  temporalResource,
  throttleTaskMiddleware,
} from "../../../globals/middleware/temporal.middleware";
import { createMessageError } from "../../../errors";

const createTemporalDeps = () => ({
  state: {
    isDisposed: false,
    debounceStates: new WeakMap<
      Parameters<typeof throttleTaskMiddleware.run>[2],
      Map<string, DebounceState>
    >(),
    throttleStates: new WeakMap<
      Parameters<typeof throttleTaskMiddleware.run>[2],
      Map<string, ThrottleState>
    >(),
    trackedDebounceStates: new Set(),
    trackedThrottleStates: new Set(),
  },
});

describe("Temporal Middleware: Throttle", () => {
  it("should throttle task executions", async () => {
    jest.useFakeTimers();
    let callCount = 0;
    const task = defineTask({
      id: "throttle-task",
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

        jest.advanceTimersByTime(100);
        await Promise.resolve();
        return await Promise.all([p1, p2, p3]);
      },
    });

    try {
      const results = (await run(app)).value;
      expect(callCount).toBe(2);
      expect(results[0]).toBe("a");
      expect(results[1]).toBe("c");
      expect(results[2]).toBe("c");
    } finally {
      jest.useRealTimers();
    }
  });

  it("should execute immediately if enough time has passed", async () => {
    jest.useFakeTimers();
    let callCount = 0;
    const task = defineTask({
      id: "throttle-immediate",
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
        jest.advanceTimersByTime(100);
        await Promise.resolve();
        await task("b");
      },
    });

    try {
      await run(app);
      expect(callCount).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("throttles independently per computed key", async () => {
    jest.useFakeTimers();
    let callCount = 0;
    const task = defineTask({
      id: "throttle-keyed",
      middleware: [
        throttleTaskMiddleware.with({
          ms: 100,
          keyBuilder: (_taskId, input) => input as string,
        }),
      ],
      run: async (val: string) => {
        callCount++;
        return val;
      },
    });

    const app = defineResource({
      id: "app-keyed",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        const p1 = task("a");
        const p2 = task("a");
        const p3 = task("b");
        const p4 = task("b");

        jest.advanceTimersByTime(100);
        await Promise.resolve();
        return await Promise.all([p1, p2, p3, p4]);
      },
    });

    try {
      const results = (await run(app)).value;
      expect(callCount).toBe(4);
      expect(results).toEqual(["a", "a", "b", "b"]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("isolates throttle state by task when reusing one configured middleware instance", async () => {
    jest.useFakeTimers();
    const sharedThrottle = throttleTaskMiddleware.with({ ms: 100 });
    const executions: string[] = [];

    const taskA = defineTask({
      id: "throttle-shared-a",
      middleware: [sharedThrottle],
      run: async (value: string) => {
        executions.push(`a:${value}`);
        return `a:${value}`;
      },
    });

    const taskB = defineTask({
      id: "throttle-shared-b",
      middleware: [sharedThrottle],
      run: async (value: string) => {
        executions.push(`b:${value}`);
        return `b:${value}`;
      },
    });

    const app = defineResource({
      id: "app-shared-throttle",
      register: [taskA, taskB],
      dependencies: { taskA, taskB },
      async init(_, { taskA, taskB }) {
        return await Promise.all([taskA("1"), taskB("2")]);
      },
    });

    try {
      const results = (await run(app)).value;
      expect(results).toEqual(["a:1", "b:2"]);
      expect(executions).toEqual(["a:1", "b:2"]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("prunes idle throttle state lazily after the window elapses", async () => {
    jest.useFakeTimers();
    const middleware = throttleTaskMiddleware.with({ ms: 50 });
    const task = defineTask({
      id: "throttle-prune-idle",
      middleware: [middleware],
      run: async (value: string) => value,
    });

    const app = defineResource({
      id: "app-prune-idle",
      register: [task],
      dependencies: { task, temporal: temporalResource },
      async init(_, { task, temporal }) {
        await task("a");
        jest.advanceTimersByTime(100);
        await Promise.resolve();
        await task("b");
        const keyedStates = temporal.throttleStates.get(middleware.config);
        expect(keyedStates?.size).toBe(1);
      },
    });

    try {
      await run(app);
    } finally {
      jest.useRealTimers();
    }
  });

  it("propagates keyBuilder errors before throttle admission", async () => {
    const task = defineTask({
      id: "throttle-keyBuilder-error",
      middleware: [
        throttleTaskMiddleware.with({
          ms: 50,
          keyBuilder: () => {
            throw new Error("bad-key");
          },
        }),
      ],
      run: async () => "ok",
    });

    const app = defineResource({
      id: "app-throttle-keyBuilder-error",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        await expect(task()).rejects.toThrow("bad-key");
      },
    });

    await run(app);
  });

  it("fails fast when throttle keyBuilder returns a non-string", async () => {
    const task = defineTask({
      id: "throttle-keyBuilder-invalid-return",
      middleware: [
        throttleTaskMiddleware.with({
          ms: 50,
          keyBuilder: () => Promise.resolve("invalid") as unknown as string,
        }),
      ],
      run: async () => "ok",
    });

    const app = defineResource({
      id: "app-throttle-keyBuilder-invalid-return",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        await expect(task()).rejects.toThrow(
          "Middleware config validation failed for throttle-keyBuilder-invalid-return: Temporal middleware keyBuilder must return a string. Received object.",
        );
      },
    });

    await run(app);
  });

  it("prunes idle keyed throttle state lazily once the keyed state map grows large", async () => {
    const config = { ms: 50 };
    const idleStates = new Map<string, ThrottleState>();

    for (let index = 0; index < 1_000; index += 1) {
      idleStates.set(`idle-${index}`, {
        key: `idle-${index}`,
        lastExecution: 0,
        resolveList: [],
        rejectList: [],
      });
    }

    idleStates.set("keep", {
      key: "keep",
      lastExecution: Date.now(),
      resolveList: [],
      rejectList: [],
      currentPromise: Promise.resolve("busy"),
    });

    const deps = {
      state: {
        isDisposed: false,
        debounceStates: new WeakMap(),
        throttleStates: new WeakMap([[config, idleStates]]),
        trackedDebounceStates: new Set(),
        trackedThrottleStates: new Set(idleStates.values()),
      },
    } satisfies Parameters<typeof throttleTaskMiddleware.run>[1];

    await expect(
      throttleTaskMiddleware.run(
        {
          task: {
            definition: { id: "throttle-prune" } as any,
            input: "fresh",
          },
          next: async (input?: string) => input,
        } as any,
        deps,
        config,
      ),
    ).resolves.toBe("fresh");

    expect(idleStates.size).toBe(2);
    expect(idleStates.has("keep")).toBe(true);
    expect(idleStates.has("throttle-prune")).toBe(true);
  });

  it("should handle errors in throttled task", async () => {
    let callCount = 0;
    const task = defineTask({
      id: "throttle-error",
      middleware: [throttleTaskMiddleware.with({ ms: 50 })],
      run: async () => {
        callCount++;
        throw createMessageError("Throttle error");
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
    expect.assertions(3);
    const config = { ms: 50 };
    const deps = createTemporalDeps();

    const next = async (input?: string) => {
      if (input === "b") {
        throw createMessageError("Throttle error");
      }
      return input;
    };

    const inputFor = (input: string) => ({
      task: {
        definition: { id: "throttle-unit-scheduled-fail" } as any,
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
    expect.assertions(4);
    jest.useFakeTimers();
    const config = { ms: 50 };
    let callCount = 0;
    const next = async (input?: string) => {
      callCount += 1;
      return input;
    };
    const inputFor = (input: string) => ({
      task: {
        definition: { id: "throttle-unit" } as any,
        input,
      },
      next,
    });

    try {
      const deps = createTemporalDeps();
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
        throw createMessageError("boom");
      }
      return input;
    };
    const inputFor = (input: string) => ({
      task: {
        definition: { id: "throttle-unit-fail" } as any,
        input,
      },
      next,
    });

    const deps = createTemporalDeps();
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
    expect.assertions(4);
    type ThrottleRunInput = Parameters<typeof throttleTaskMiddleware.run>[0];
    type ThrottleRunDeps = Parameters<typeof throttleTaskMiddleware.run>[1];
    type ThrottleRunConfig = Parameters<typeof throttleTaskMiddleware.run>[2];

    const config = { ms: 50 };
    const deps = {
      state: {
        debounceStates: new WeakMap(),
        throttleStates: new WeakMap(),
        trackedDebounceStates: new Set(),
        trackedThrottleStates: new Set(),
        isDisposed: false,
      },
    } satisfies ThrottleRunDeps;

    const next = async (input?: string) => input;
    const inputFor = (input: string): ThrottleRunInput =>
      ({
        task: {
          definition: {
            id: "throttle-unit-latest-input",
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
          throw createMessageError("Expected function timer callback");
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
          Map<string, { latestInput?: unknown }>
        >
      )
        .get(config)
        ?.get("throttle-unit-latest-input");
      expect(throttleState?.latestInput).toBeUndefined();
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });
});
