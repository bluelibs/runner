import {
  defineResource,
  defineTask,
  defineTaskMiddleware,
} from "../../../define";
import { globals, run } from "../../../index";

const retryJournalKeys = globals.middleware.task.retry.journalKeys;
const cacheJournalKeys = globals.middleware.task.cache.journalKeys;

describe("Middleware Journal Keys (Cache + Retry)", () => {
  describe("Retry Middleware", () => {
    it("should expose attempt count and lastError in journal", async () => {
      let capturedAttempt: number | undefined;
      let capturedLastError: Error | undefined;
      let callCount = 0;

      const failOnceTask = defineTask({
        id: "test.journal.retry.failOnce",
        middleware: [
          globals.middleware.task.retry.with({
            retries: 3,
            delayStrategy: () => 0, // No delay for fast tests
          }),
        ],
        run: async (_input: void, _deps, context) => {
          capturedAttempt = context?.journal.get(retryJournalKeys.attempt);
          capturedLastError = context?.journal.get(retryJournalKeys.lastError);

          callCount++;
          if (callCount < 2) {
            throw new Error("Transient failure");
          }
          return "success";
        },
      });

      const app = defineResource({
        id: "test.journal.retry.app",
        register: [failOnceTask],
      });
      const runtime = await run(app);

      const result = await runtime.runTask(failOnceTask);

      expect(result).toBe("success");
      expect(capturedAttempt).toBe(1); // Second attempt (0-indexed)
      expect(capturedLastError).toBeDefined();
      expect(capturedLastError?.message).toBe("Transient failure");

      await runtime.dispose();
    });

    it("should start with attempt 0 on first call", async () => {
      let capturedAttempt: number | undefined;

      const successTask = defineTask({
        id: "test.journal.retry.success",
        middleware: [
          globals.middleware.task.retry.with({
            retries: 3,
            delayStrategy: () => 0,
          }),
        ],
        run: async (_input: void, _deps, context) => {
          capturedAttempt = context?.journal.get(retryJournalKeys.attempt);
          return "ok";
        },
      });

      const app = defineResource({
        id: "test.journal.retry.app2",
        register: [successTask],
      });
      const runtime = await run(app);

      await runtime.runTask(successTask);

      expect(capturedAttempt).toBe(0);

      await runtime.dispose();
    });
  });

  describe("Cache Middleware", () => {
    it("should expose hit status in journal", async () => {
      const hitStatuses: boolean[] = [];

      const cacheHitObserver = defineTaskMiddleware({
        id: "test.journal.cache.hitObserver",
        async run({ task, next, journal }) {
          const result = await next(task.input);
          hitStatuses.push(journal.get(cacheJournalKeys.hit) ?? false);
          return result;
        },
      });

      const cachedTask = defineTask({
        id: "test.journal.cache.task",
        middleware: [
          cacheHitObserver,
          globals.middleware.task.cache.with({ ttl: 60000 }),
        ],
        run: async (_input: void) => ({ value: "computed" }),
      });

      const app = defineResource({
        id: "test.journal.cache.app",
        register: [
          globals.resources.cache,
          globals.middleware.task.cache,
          cacheHitObserver,
          cachedTask,
        ],
      });
      const runtime = await run(app);

      // First call - cache miss
      await runtime.runTask(cachedTask);
      // Second call - cache hit (won't run the task body, but the observer still runs)
      await runtime.runTask(cachedTask);

      expect(hitStatuses).toEqual([false, true]);

      await runtime.dispose();
    });

    it("should not throw when cache is re-run under retry", async () => {
      let callCount = 0;

      const task = defineTask({
        id: "test.journal.cache.retry.noThrow",
        middleware: [
          globals.middleware.task.retry.with({
            retries: 2,
            delayStrategy: () => 0,
          }),
          globals.middleware.task.cache.with({ ttl: 60000 }),
        ],
        run: async (_input: void, _deps, context) => {
          expect(context?.journal.get(cacheJournalKeys.hit)).toBe(false);

          callCount++;
          if (callCount < 2) {
            throw new Error("Transient failure");
          }
          return "ok";
        },
      });

      const app = defineResource({
        id: "test.journal.cache.retry.app",
        register: [
          globals.resources.cache,
          globals.middleware.task.cache,
          task,
        ],
      });
      const runtime = await run(app);

      const result = await runtime.runTask(task);

      expect(result).toBe("ok");
      expect(callCount).toBe(2);

      await runtime.dispose();
    });
  });
});
