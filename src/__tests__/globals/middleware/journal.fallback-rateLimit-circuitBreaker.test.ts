import {
  defineResource,
  defineTask,
  defineTaskMiddleware,
} from "../../../define";
import { globals, run } from "../../../index";
import { CircuitBreakerState } from "../../../globals/middleware/circuitBreaker.middleware";

const fallbackJournalKeys = globals.middleware.task.fallback.journalKeys;
const rateLimitJournalKeys = globals.middleware.task.rateLimit.journalKeys;
const circuitBreakerJournalKeys =
  globals.middleware.task.circuitBreaker.journalKeys;

describe("Middleware Journal Keys (Fallback + RateLimit + CircuitBreaker)", () => {
  describe("Fallback Middleware", () => {
    it("should expose active=false before failure", async () => {
      let capturedActive: boolean | undefined;

      const fallbackFn = async (error: Error) => {
        return `fallback: ${error.message}`;
      };

      const failingTask = defineTask({
        id: "test.journal.fallback.failing",
        middleware: [
          globals.middleware.task.fallback.with({ fallback: fallbackFn }),
        ],
        run: async (_input: void, _deps, context) => {
          capturedActive = context?.journal.get(fallbackJournalKeys.active);
          throw new Error("Primary failed");
        },
      });

      const app = defineResource({
        id: "test.journal.fallback.app",
        register: [failingTask],
      });
      const runtime = await run(app);

      const result = await runtime.runTask(failingTask);

      expect(result).toBe("fallback: Primary failed");
      // Before failure, active should be false
      expect(capturedActive).toBe(false);

      await runtime.dispose();
    });

    it("should expose active=true and error when fallback triggers", async () => {
      let observedActive: boolean | undefined;
      let observedErrorMessage: string | undefined;

      const fallbackObserver = defineTaskMiddleware({
        id: "test.journal.fallback.observer",
        async run({ task, next, journal }) {
          const result = await next(task.input);
          observedActive = journal.get(fallbackJournalKeys.active);
          observedErrorMessage = journal.get(
            fallbackJournalKeys.error,
          )?.message;
          return result;
        },
      });

      const myTask = defineTask({
        id: "test.journal.fallback.observed",
        middleware: [
          fallbackObserver,
          globals.middleware.task.fallback.with({ fallback: "default" }),
        ],
        run: async () => {
          throw new Error("Primary failed");
        },
      });

      const app = defineResource({
        id: "test.journal.fallback.app3",
        register: [fallbackObserver, myTask],
      });
      const runtime = await run(app);

      const result = await runtime.runTask(myTask);

      expect(result).toBe("default");
      expect(observedActive).toBe(true);
      expect(observedErrorMessage).toBe("Primary failed");

      await runtime.dispose();
    });

    it("should keep active=false when primary succeeds", async () => {
      let capturedActive: boolean | undefined;

      const successTask = defineTask({
        id: "test.journal.fallback.success",
        middleware: [
          globals.middleware.task.fallback.with({ fallback: "unused" }),
        ],
        run: async (_input: void, _deps, context) => {
          capturedActive = context?.journal.get(fallbackJournalKeys.active);
          return "success";
        },
      });

      const app = defineResource({
        id: "test.journal.fallback.app2",
        register: [successTask],
      });
      const runtime = await run(app);

      const result = await runtime.runTask(successTask);

      expect(result).toBe("success");
      expect(capturedActive).toBe(false);

      await runtime.dispose();
    });
  });

  describe("RateLimit Middleware", () => {
    it("should expose remaining, resetTime, and limit in journal", async () => {
      let capturedRemaining: number | undefined;
      let capturedResetTime: number | undefined;
      let capturedLimit: number | undefined;

      const rateLimitedTask = defineTask({
        id: "test.journal.rateLimit.task",
        middleware: [
          globals.middleware.task.rateLimit.with({ windowMs: 60000, max: 5 }),
        ],
        run: async (_input: void, _deps, context) => {
          capturedRemaining = context?.journal.get(
            rateLimitJournalKeys.remaining,
          );
          capturedResetTime = context?.journal.get(
            rateLimitJournalKeys.resetTime,
          );
          capturedLimit = context?.journal.get(rateLimitJournalKeys.limit);
          return "ok";
        },
      });

      const app = defineResource({
        id: "test.journal.rateLimit.app",
        register: [rateLimitedTask],
      });
      const runtime = await run(app);

      await runtime.runTask(rateLimitedTask);

      expect(capturedLimit).toBe(5);
      expect(capturedRemaining).toBe(4); // 5 - 1 = 4 after first call
      expect(capturedResetTime).toBeGreaterThan(Date.now() - 1000);

      await runtime.dispose();
    });
  });

  describe("CircuitBreaker Middleware", () => {
    it("should expose state and failures in journal", async () => {
      let capturedState: CircuitBreakerState | undefined;
      let capturedFailures: number | undefined;

      const circuitTask = defineTask({
        id: "test.journal.circuitBreaker.task",
        middleware: [
          globals.middleware.task.circuitBreaker.with({
            failureThreshold: 3,
            resetTimeout: 1000,
          }),
        ],
        run: async (_input: void, _deps, context) => {
          capturedState = context?.journal.get(circuitBreakerJournalKeys.state);
          capturedFailures = context?.journal.get(
            circuitBreakerJournalKeys.failures,
          );
          return "ok";
        },
      });

      const app = defineResource({
        id: "test.journal.circuitBreaker.app",
        register: [circuitTask],
      });
      const runtime = await run(app);

      await runtime.runTask(circuitTask);

      expect(capturedState).toBe(CircuitBreakerState.CLOSED);
      expect(capturedFailures).toBe(0);

      await runtime.dispose();
    });

    it("should expose post-execution state transitions in journal", async () => {
      let mode: "fail" | "success" = "fail";
      let observedState: CircuitBreakerState | undefined;
      let observedFailures: number | undefined;

      const observer = defineTaskMiddleware({
        id: "test.journal.circuitBreaker.observer",
        async run({ task, next, journal }) {
          try {
            return await next(task.input);
          } finally {
            observedState = journal.get(circuitBreakerJournalKeys.state);
            observedFailures = journal.get(circuitBreakerJournalKeys.failures);
          }
        },
      });

      const task = defineTask({
        id: "test.journal.circuitBreaker.transitions",
        middleware: [
          observer,
          globals.middleware.task.circuitBreaker.with({
            failureThreshold: 1,
            resetTimeout: 1,
          }),
        ],
        run: async () => {
          if (mode === "fail") {
            throw new Error("boom");
          }
          return "ok";
        },
      });

      const app = defineResource({
        id: "test.journal.circuitBreaker.transitions.app",
        register: [observer, task],
      });
      const runtime = await run(app);

      await expect(runtime.runTask(task)).rejects.toThrow("boom");
      expect(observedState).toBe(CircuitBreakerState.OPEN);
      expect(observedFailures).toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 5));
      mode = "success";
      await expect(runtime.runTask(task)).resolves.toBe("ok");
      expect(observedState).toBe(CircuitBreakerState.CLOSED);
      expect(observedFailures).toBe(0);

      await runtime.dispose();
    });
  });
});
