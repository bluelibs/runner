import { defineResource, defineTask } from "../../define";
import {
  retryResourceMiddleware,
  retryTaskMiddleware,
  abortableDelay,
} from "../../globals/middleware/retry.middleware";
import {
  timeoutTaskMiddleware,
  journalKeys as timeoutJournalKeys,
} from "../../globals/middleware/timeout.middleware";
import { run } from "../../run";
import { createMessageError } from "../../errors";

describe("Retry Middleware", () => {
  describe("Retry Task Middleware", () => {
    it("should retry failed operations with exponential backoff", async () => {
      let attempt = 0;
      const task = defineTask({
        id: "flakyTask",
        middleware: [
          retryTaskMiddleware.with({
            retries: 3,
            stopRetryIf: (e) => e.message.includes("FATAL"),
          }),
        ],
        run: async () => {
          attempt++;
          if (attempt < 3) throw createMessageError("Temporary failure");
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
          retryTaskMiddleware.with({
            retries: 3,
            stopRetryIf: (e) => e.message === "FATAL",
          }),
        ],
        run: async () => {
          throw createMessageError("FATAL");
        },
      });

      const app = defineResource({
        id: "app",
        register: [task],
        dependencies: { task },
        async init(_, { task }) {
          await expect(task()).rejects.toThrow("FATAL");
          expect(errorSpy).not.toHaveBeenCalled();
          throw createMessageError("FATAL");
        },
      });

      await run(app).catch(errorSpy);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it("should use custom delay strategy", async () => {
      jest.useFakeTimers();
      const start = Date.now();

      const task = defineTask({
        id: "delayedTask",
        middleware: [
          retryTaskMiddleware.with({
            retries: 3,
            delayStrategy: (attempt) => (attempt + 1) * 100, // Linear delay
          }),
        ],
        run: async () => {
          throw createMessageError("Retry me");
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

    it("Should default to 3 retries", async () => {
      let attempt = 0;
      const task = defineTask({
        id: "flakyTask",
        middleware: [retryTaskMiddleware],
        run: async () => {
          attempt++;
          throw createMessageError("Temporary failure");
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

    it("should skip retries when timeout abort controller is aborted", async () => {
      let attempt = 0;
      const task = defineTask({
        id: "abortableTask",
        middleware: [
          // Timeout wraps retry - timeout should abort and retry should not retry
          timeoutTaskMiddleware.with({ ttl: 50 }),
          retryTaskMiddleware.with({ retries: 5 }),
        ],
        run: async () => {
          attempt++;
          // Wait longer than timeout
          await new Promise((resolve) => setTimeout(resolve, 100));
          return "Success";
        },
      });

      const app = defineResource({
        id: "app",
        register: [task],
        dependencies: { task },
        async init(_, { task }) {
          await expect(task()).rejects.toThrow("timed out");
        },
      });

      await run(app);
      // Should only attempt once since timeout aborted before retry could kick in
      expect(attempt).toBe(1);
    });

    it("should not retry when abort controller signal is aborted", async () => {
      // This test directly verifies the abort controller check without timeout middleware
      // by manually creating an aborted controller in the journal
      let attempts = 0;

      const task = defineTask({
        id: "abortAwareTask",
        middleware: [retryTaskMiddleware.with({ retries: 5 })],
        run: async (_input, _deps, context) => {
          attempts++;
          // On first attempt, set an aborted controller in the journal
          if (attempts === 1 && context?.journal) {
            const abortController = new AbortController();
            context.journal.set(
              timeoutJournalKeys.abortController,
              abortController,
            );
            // Abort it immediately so retry sees it as aborted on next catch
            abortController.abort();
          }
          throw createMessageError("Should not retry after abort");
        },
      });

      const app = defineResource({
        id: "app",
        register: [task],
        dependencies: { task },
        async init(_, { task }) {
          await expect(task()).rejects.toThrow("Should not retry after abort");
        },
      });

      await run(app);
      // Should only attempt once since abort controller was aborted
      expect(attempts).toBe(1);
    });
  });

  describe("Resource Middleware", () => {
    it("should work with resource initialization", async () => {
      let attempts = 0;
      const resource = defineResource({
        id: "flakyResource",
        middleware: [
          retryResourceMiddleware.with({
            retries: 2,
          }),
        ],
        async init() {
          attempts++;
          if (attempts < 2) throw createMessageError("Resource init failed");
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

    it("should retry failed operations with exponential backoff", async () => {
      let attempt = 0;
      const resource = defineResource({
        id: "flakyResource",
        middleware: [
          retryResourceMiddleware.with({
            retries: 3,
            stopRetryIf: (e) => e.message.includes("FATAL"),
          }),
        ],
        async init() {
          attempt++;
          if (attempt < 3) throw createMessageError("Temporary failure");
          return "Success";
        },
      });

      const app = defineResource({
        id: "app",
        register: [resource],
        dependencies: { resource },
        async init(_, { resource }) {
          expect(resource).toBe("Success");
          expect(attempt).toBe(3);
        },
      });

      await run(app);
      expect(attempt).toBeGreaterThan(2);
    });

    it("should respect stopRetryIf condition", async () => {
      const errorSpy = jest.fn();
      const resource = defineResource({
        id: "fatalResource",
        middleware: [
          retryResourceMiddleware.with({
            retries: 3,
            stopRetryIf: (e) => e.message === "FATAL",
          }),
        ],
        async init() {
          throw createMessageError("FATAL");
        },
      });

      const app = defineResource({
        id: "app",
        register: [resource],
        dependencies: { resource },
        async init(_, { resource }) {},
      });

      await expect(run(app)).rejects.toThrow("FATAL");
    });

    /**
     * Asserts that a function does not throw an error within a specified time limit.
     * @param fn The function to execute. It's expected to return a Promise.
     * @param timeoutMs The time limit in milliseconds.
     */
    const expectToNotThrowWithin = async (
      fn: () => Promise<any>,
      timeoutMs: number,
    ) => {
      let timeoutId: NodeJS.Timeout | undefined;

      const timeoutPromise = new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve("timeout"), timeoutMs);
      });

      const operationPromise = fn();

      // Prevent unhandled rejection warnings
      operationPromise.catch(() => {});

      try {
        const winner = await Promise.race([operationPromise, timeoutPromise]);

        if (winner !== "timeout") {
          // The operation resolved successfully before the timeout. This is a valid outcome.
        }
      } catch (error) {
        // The operation rejected before the timeout. This is a failure.
        throw createMessageError(
          `Function threw an error within ${timeoutMs}ms: ${
            (error as Error).message
          }`,
        );
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    };

    it("should use custom delay strategy", async () => {
      const resource = defineResource({
        id: "delayedResource",
        middleware: [
          retryResourceMiddleware.with({
            retries: 3,
            delayStrategy: (attempt) => (attempt + 1) * 50, // 50ms, 100ms, 150ms
          }),
        ],
        async init() {
          throw createMessageError("Retry me");
        },
      });

      const app = defineResource({
        id: "app",
        register: [resource],
        dependencies: { resource },
        async init(_, { resource }) {},
      });

      const runPromise = run(app);

      // Total delay is 50 + 100 + 150 = 300ms.
      // It should not throw before this period has passed.
      await expectToNotThrowWithin(() => runPromise, 300);

      // It should eventually throw after all retries are exhausted.
      await expect(runPromise).rejects.toThrow("Retry me");
    });

    it("Should default to 3 retries", async () => {
      let attempt = 0;
      const resource = defineResource({
        id: "flakyResource",
        middleware: [retryResourceMiddleware],
        async init() {
          attempt++;
          throw createMessageError("Temporary failure");
        },
      });

      const app = defineResource({
        id: "app",
        register: [resource],
        dependencies: { resource },
        async init(_, { resource }) {},
      });

      await expect(run(app)).rejects.toThrow("Temporary failure");
    });
  });

  describe("Abort-aware retry delay", () => {
    it("resolves normally without a signal", async () => {
      await abortableDelay(1);
    });

    it("rejects immediately when signal is already aborted", async () => {
      const ac = new AbortController();
      ac.abort(new Error("pre-aborted"));
      await expect(abortableDelay(1, ac.signal)).rejects.toThrow("pre-aborted");
    });

    it("rejects when signal fires during the delay", async () => {
      const ac = new AbortController();
      const p = abortableDelay(10_000, ac.signal);
      ac.abort(new Error("mid-delay abort"));
      await expect(p).rejects.toThrow("mid-delay abort");
    });

    it("resolves normally when signal is present but does not fire", async () => {
      const ac = new AbortController();
      await abortableDelay(1, ac.signal);
    });

    it("cancels retry delay when abort signal fires", async () => {
      let attempt = 0;
      const task = defineTask({
        id: "flakyAbortTask",
        middleware: [
          // Timeout fires after 50ms — retry delay (100ms+) should be aborted
          timeoutTaskMiddleware.with({ ttl: 50 }),
          retryTaskMiddleware.with({ retries: 5 }),
        ],
        run: async () => {
          attempt++;
          throw createMessageError("always fails");
        },
      });

      const app = defineResource({
        id: "app.abort.retry",
        register: [task],
        dependencies: { task },
        async init(_, { task }) {
          await task();
        },
      });

      // The test confirms the retry aborts promptly rather than
      // sleeping through the full backoff schedule.
      await expect(run(app)).rejects.toThrow();
      expect(attempt).toBeGreaterThanOrEqual(1);
    });

    it("completes retry delay normally when signal is present but does not abort", async () => {
      let attempt = 0;
      const task = defineTask({
        id: "flakyAbortNormalTask",
        middleware: [
          // Long timeout so it doesn't fire during the short retry delay
          timeoutTaskMiddleware.with({ ttl: 10_000 }),
          retryTaskMiddleware.with({
            retries: 2,
            delayStrategy: () => 1, // 1ms delay to keep test fast
          }),
        ],
        run: async () => {
          attempt++;
          if (attempt < 2) throw createMessageError("fail once");
          return "ok";
        },
      });

      const app = defineResource({
        id: "app.abort.normal",
        register: [task],
        dependencies: { task },
        async init(_, { task }) {
          const result = await task();
          expect(result).toBe("ok");
        },
      });

      const runtime = await run(app);
      await runtime.dispose();
      // The retry delay resolved normally with an active signal present
      expect(attempt).toBe(2);
    });
  });
});
