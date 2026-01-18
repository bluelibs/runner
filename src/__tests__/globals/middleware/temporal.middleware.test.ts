import { defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import {
  debounceTaskMiddleware,
  throttleTaskMiddleware,
} from "../../../globals/middleware/temporal.middleware";

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

describe("Temporal Middleware", () => {
  describe("Debounce", () => {
    it("should debounce task executions", async () => {
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
          const results = await Promise.all([task("a"), task("b"), task("c")]);
          return results;
        },
      });

      const results = (await run(app)).value;

      expect(callCount).toBe(1);
      expect(results).toEqual(["c", "c", "c"]);
    });

    it("should handle multiple debounce cycles", async () => {
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
          const r1 = await Promise.all([task("a"), task("b")]);
          await sleep(100);
          const r2 = await Promise.all([task("c"), task("d")]);
          return [...r1, ...r2];
        },
      });

      const results = (await run(app)).value;

      expect(callCount).toBe(2);
      expect(results).toEqual(["b", "b", "d", "d"]);
    });

    it("should handle errors in debounced task", async () => {
      let callCount = 0;
      const task = defineTask({
        id: "debounce.error",
        middleware: [debounceTaskMiddleware.with({ ms: 50 })],
        run: async () => {
          callCount++;
          throw new Error("Debounce error");
        },
      });

      const app = defineResource({
        id: "app",
        register: [task],
        dependencies: { task },
        async init(_, { task }) {
          await Promise.all([
            task().catch((e) => e.message),
            task().catch((e) => e.message),
          ]);
        },
      });

      await run(app);
      expect(callCount).toBe(1);
    });
  });

  describe("Throttle", () => {
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

    it("should clear a pending scheduled execution when window elapsed but timer is still pending", async () => {
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

      await expect(
        throttleTaskMiddleware.run(inputFor("a") as any, {} as any, config),
      ).resolves.toBe("a");

      const pending = throttleTaskMiddleware.run(
        inputFor("b") as any,
        {} as any,
        config,
      );

      // Block the event loop long enough for the throttle window to pass, but
      // without allowing the scheduled setTimeout callback to run.
      const start = Date.now();
      while (Date.now() - start < 120) {
        // busy-wait to block event loop
      }

      await expect(
        throttleTaskMiddleware.run(inputFor("c") as any, {} as any, config),
      ).resolves.toBe("c");

      // The previously scheduled callers should be resolved by the immediate execution.
      await expect(pending).resolves.toBe("c");
      expect(callCount).toBe(2);
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

      await expect(
        throttleTaskMiddleware.run(inputFor("a") as any, {} as any, config),
      ).resolves.toBe("a");

      const pending = throttleTaskMiddleware.run(
        inputFor("b") as any,
        {} as any,
        config,
      );

      const start = Date.now();
      while (Date.now() - start < 120) {
        // busy-wait to block event loop
      }

      const immediate = throttleTaskMiddleware.run(
        inputFor("c") as any,
        {} as any,
        config,
      );

      await expect(immediate).rejects.toThrow("boom");
      await expect(pending).rejects.toThrow("boom");
      expect(callCount).toBe(2);
    });
  });
});
