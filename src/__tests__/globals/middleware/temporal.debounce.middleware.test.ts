import { defineResource, defineTask } from "../../../define";
import {
  middlewareKeyCapacityExceededError,
  genericError,
} from "../../../errors";
import { run } from "../../../run";
import {
  debounceTaskMiddleware,
  temporalResource,
} from "../../../globals/middleware/temporal.middleware";
import { pruneStaleDebounceStates } from "../../../globals/middleware/temporal.shared";

describe("Temporal Middleware: Debounce", () => {
  it("should debounce task executions", async () => {
    jest.useFakeTimers();
    let callCount = 0;
    const task = defineTask({
      id: "debounce-task",
      middleware: [debounceTaskMiddleware.with({ ms: 50 })],
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
        const pending = Promise.all([task("a"), task("b"), task("c")]);
        jest.advanceTimersByTime(50);
        await Promise.resolve();
        return pending;
      },
    });

    try {
      const results = (await run(app)).value;
      expect(callCount).toBe(1);
      expect(results).toEqual(["c", "c", "c"]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("should handle multiple debounce cycles", async () => {
    jest.useFakeTimers();
    let callCount = 0;
    const task = defineTask({
      id: "debounce-cycles",
      middleware: [debounceTaskMiddleware.with({ ms: 50 })],
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
        const firstCycle = Promise.all([task("a"), task("b")]);
        jest.advanceTimersByTime(50);
        await Promise.resolve();
        const r1 = await firstCycle;

        jest.advanceTimersByTime(100);
        await Promise.resolve();

        const secondCycle = Promise.all([task("c"), task("d")]);
        jest.advanceTimersByTime(50);
        await Promise.resolve();
        const r2 = await secondCycle;
        return [...r1, ...r2];
      },
    });

    try {
      const results = (await run(app)).value;
      expect(callCount).toBe(2);
      expect(results).toEqual(["b", "b", "d", "d"]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("debounces independently per computed key", async () => {
    jest.useFakeTimers();
    let callCount = 0;
    const middleware = debounceTaskMiddleware.with({
      ms: 50,
      keyBuilder: (_taskId, input) => String((input as string)[0]),
    });
    const task = defineTask({
      id: "debounce-keyed",
      middleware: [middleware],
      run: async (val: string) => {
        callCount++;
        return val;
      },
    });

    const app = defineResource({
      id: "app-keyed",
      register: [task],
      dependencies: { task, temporal: temporalResource },
      async init(_, { task, temporal }) {
        const pending = Promise.all([task("a1"), task("a2"), task("b1")]);
        jest.advanceTimersByTime(50);
        await Promise.resolve();
        const results = await pending;
        expect(temporal.debounceStates.get(middleware.config)).toBeUndefined();
        return results;
      },
    });

    try {
      const results = (await run(app)).value;
      expect(callCount).toBe(2);
      expect(results).toEqual(["a2", "a2", "b1"]);
    } finally {
      jest.useRealTimers();
    }
  });

  it("isolates debounce state by task when reusing one configured middleware instance", async () => {
    jest.useFakeTimers();
    const sharedDebounce = debounceTaskMiddleware.with({ ms: 50 });
    const executions: string[] = [];

    const taskA = defineTask({
      id: "debounce-shared-a",
      middleware: [sharedDebounce],
      run: async (value: string) => {
        executions.push(`a:${value}`);
        return `a:${value}`;
      },
    });

    const taskB = defineTask({
      id: "debounce-shared-b",
      middleware: [sharedDebounce],
      run: async (value: string) => {
        executions.push(`b:${value}`);
        return `b:${value}`;
      },
    });

    const app = defineResource({
      id: "app-shared-debounce",
      register: [taskA, taskB],
      dependencies: { taskA, taskB },
      async init(_, { taskA, taskB }) {
        const pending = Promise.all([taskA("1"), taskB("2")]);
        jest.advanceTimersByTime(50);
        await Promise.resolve();
        return pending;
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

  it("propagates keyBuilder errors before scheduling debounce work", async () => {
    const task = defineTask({
      id: "debounce-keyBuilder-error",
      middleware: [
        debounceTaskMiddleware.with({
          ms: 50,
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

  it("fails fast when debounce keyBuilder returns a non-string", async () => {
    const task = defineTask({
      id: "debounce-keyBuilder-invalid-return",
      middleware: [
        debounceTaskMiddleware.with({
          ms: 50,
          keyBuilder: () => ({ invalid: true }) as unknown as string,
        }),
      ],
      run: async () => "ok",
    });

    const app = defineResource({
      id: "app-keyBuilder-invalid-return",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        await expect(task()).rejects.toThrow(
          /Middleware config validation failed for .*debounce-keyBuilder-invalid-return: Temporal middleware keyBuilder must return a string\. Received object\./,
        );
      },
    });

    await run(app);
  });

  it("rejects new distinct keys when maxKeys is reached but still allows the existing key", async () => {
    jest.useFakeTimers();
    const task = defineTask({
      id: "debounce-max-keys",
      middleware: [
        debounceTaskMiddleware.with({
          ms: 50,
          maxKeys: 1,
          keyBuilder: (_taskId, input) => String(input),
        }),
      ],
      run: async (value: string) => value,
    });

    const app = defineResource({
      id: "app-debounce-max-keys",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        const first = task("a");
        const second = task("a");

        let capacityError: unknown;
        try {
          await task("b");
        } catch (error) {
          capacityError = error;
        }

        jest.advanceTimersByTime(50);
        await Promise.resolve();

        await expect(first).resolves.toBe("a");
        await expect(second).resolves.toBe("a");
        expect(middlewareKeyCapacityExceededError.is(capacityError)).toBe(true);
        expect(capacityError).toMatchObject({
          data: {
            middlewareId: "app-debounce-max-keys.tasks.debounce-max-keys",
            maxKeys: 1,
          },
        });
      },
    });

    try {
      await run(app);
    } finally {
      jest.useRealTimers();
    }
  });

  it("frees capacity after completed debounce cycles", async () => {
    jest.useFakeTimers();
    const middleware = debounceTaskMiddleware.with({
      ms: 50,
      maxKeys: 1,
      keyBuilder: (_taskId, input) => String(input),
    });
    const task = defineTask({
      id: "debounce-capacity-release",
      middleware: [middleware],
      run: async (value: string) => value,
    });

    const app = defineResource({
      id: "app-debounce-capacity-release",
      register: [task],
      init: async () => "ok",
    });

    try {
      const runtime = await run(app);
      const temporal = runtime.getResourceValue(temporalResource);
      const first = runtime.runTask(task, "a");
      jest.advanceTimersByTime(50);
      await Promise.resolve();
      await expect(first).resolves.toBe("a");
      expect(temporal.debounceStates.get(middleware.config)).toBeUndefined();

      const second = runtime.runTask(task, "b");
      jest.advanceTimersByTime(50);
      await Promise.resolve();
      await expect(second).resolves.toBe("b");
      await runtime.dispose();
    } finally {
      jest.useRealTimers();
    }
  });

  it("sweeps stale debounce states when they are orphaned", () => {
    const config = { ms: 50 };
    const keyedStates = new Map([
      [
        "stale",
        {
          key: "stale",
          latestInput: undefined,
          rejectList: [],
          resolveList: [],
          scheduledAt: Date.now() - 100,
        },
      ],
    ]);
    const trackedDebounceStates = new Set(keyedStates.values());

    pruneStaleDebounceStates(
      keyedStates,
      trackedDebounceStates,
      Date.now(),
      config.ms,
    );

    expect(keyedStates.size).toBe(0);
    expect(trackedDebounceStates.size).toBe(0);
  });

  it("should handle errors in debounced task", async () => {
    jest.useFakeTimers();
    let callCount = 0;
    const task = defineTask({
      id: "debounce-error",
      middleware: [debounceTaskMiddleware.with({ ms: 50 })],
      run: async () => {
        callCount++;
        throw genericError.new({ message: "Debounce error" });
      },
    });

    const app = defineResource({
      id: "app",
      register: [task],
      dependencies: { task },
      async init(_, { task }) {
        const pending = Promise.all([
          task().catch((e) => e.message),
          task().catch((e) => e.message),
        ]);
        jest.advanceTimersByTime(50);
        await Promise.resolve();
        await pending;
      },
    });

    try {
      await run(app);
      expect(callCount).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
