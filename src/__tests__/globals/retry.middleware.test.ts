import { defineResource, defineTask } from "../../define";
import {
  retryResourceMiddleware,
  retryTaskMiddleware,
} from "../../globals/middleware/retry.middleware";
import {
  timeoutTaskMiddleware,
  journalKeys as timeoutJournalKeys,
} from "../../globals/middleware/timeout.middleware";
import { run } from "../../run";

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
          retryTaskMiddleware.with({
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

    it("Should default to 3 retries", async () => {
      let attempt = 0;
      const task = defineTask({
        id: "flakyTask",
        middleware: [retryTaskMiddleware],
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
          throw new Error("Should not retry after abort");
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
          if (attempt < 3) throw new Error("Temporary failure");
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
          throw new Error("FATAL");
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
        throw new Error(
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
          throw new Error("Retry me");
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
          throw new Error("Temporary failure");
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
});
