import { defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import { debounceTaskMiddleware } from "../../../globals/middleware/temporal.middleware";
import { createMessageError } from "../../../errors";

describe("Temporal Middleware: Debounce", () => {
  it("should debounce task executions", async () => {
    jest.useFakeTimers();
    let callCount = 0;
    const task = defineTask({
      id: "debounce.task",
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
      id: "debounce.cycles",
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

  it("should handle errors in debounced task", async () => {
    jest.useFakeTimers();
    let callCount = 0;
    const task = defineTask({
      id: "debounce.error",
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
