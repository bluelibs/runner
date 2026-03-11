import { defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import {
  debounceTaskMiddleware,
  temporalResource,
} from "../../../globals/middleware/temporal.middleware";
import { createMessageError } from "../../../errors";

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
        expect(temporal.debounceStates.get(middleware.config)?.size).toBe(0);
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

  it("should handle errors in debounced task", async () => {
    jest.useFakeTimers();
    let callCount = 0;
    const task = defineTask({
      id: "debounce-error",
      middleware: [debounceTaskMiddleware.with({ ms: 50 })],
      run: async () => {
        callCount++;
        throw createMessageError("Debounce error");
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
