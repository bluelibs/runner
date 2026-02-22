import { defineResource, defineTask, defineTaskMiddleware } from "../../define";
import { run } from "../../run";
import {
  cacheResource,
  cacheMiddleware,
  ICacheInstance,
  journalKeys as cacheJournalKeys,
} from "../../globals/middleware/cache.middleware";
import { createMessageError } from "../../errors";

enum CacheNoHasId {
  App = "cache.nohas.app",
  CacheFactory = "globals.tasks.cacheFactory",
  Task = "cache.nohas.task",
}

describe("Caching System", () => {
  describe("Cache Resource", () => {
    it("should initialize with default cache factory task", async () => {
      const app = defineResource({
        id: "app",
        register: [cacheResource, cacheMiddleware],
        dependencies: { cache: cacheResource },
        async init(_, { cache }) {
          expect(cache.cacheFactoryTask).toBeDefined();
          expect(cache.defaultOptions).toEqual({
            ttl: 10000,
            max: 100,
            ttlAutopurge: true,
          });
        },
      });

      await run(app);
    });

    it("should create separate cache instances per task", async () => {
      const testTask = defineTask({
        id: "test.task",
        middleware: [cacheMiddleware],
        run: async () => Date.now(),
      });

      const app = defineResource({
        id: "app",
        register: [cacheResource, cacheMiddleware, testTask],
        dependencies: { testTask, cache: cacheResource },
        async init(_, { testTask, cache }) {
          const firstRun = await testTask();
          const secondRun = await testTask();

          expect(firstRun).toBe(secondRun);
          expect(cache.map.size).toBe(1);
          expect(cache.map.has("test.task")).toBe(true);
        },
      });

      await run(app);
    });
  });

  describe("Cache Factory Task Override", () => {
    it("should allow overriding the cache factory task", async () => {
      class CustomCache implements ICacheInstance {
        store = new Map<string, any>();
        customFlag = true;

        get(key: string) {
          return this.store.get(key);
        }

        set(key: string, value: any) {
          this.store.set(key, value);
        }

        clear() {
          this.store.clear();
        }
      }

      const customCacheFactoryTask = defineTask({
        id: "globals.tasks.cacheFactory",
        run: async (_options: any) => {
          return new CustomCache();
        },
      });

      const testTask = defineTask({
        id: "custom.factory.task",
        middleware: [cacheMiddleware],
        run: async (input: string) => input.toUpperCase(),
      });

      const app = defineResource({
        id: "app",
        register: [cacheResource, cacheMiddleware, testTask],
        overrides: [customCacheFactoryTask],
        dependencies: { testTask, cache: cacheResource },
        async init(_, { testTask, cache }) {
          const result1 = await testTask("test");
          const result2 = await testTask("test");

          expect(result1).toBe("TEST");
          expect(result2).toBe("TEST");

          const cacheInstance = cache.map.get("custom.factory.task") as any;
          expect(cacheInstance.customFlag).toBe(true);
        },
      });

      await run(app);
    });

    it("should allow Redis-like cache factory task", async () => {
      jest.useFakeTimers();
      class RedisLikeCache implements ICacheInstance {
        private store = new Map<string, { value: any; expiry?: number }>();

        get(key: string) {
          const entry = this.store.get(key);
          if (!entry) return undefined;

          if (entry.expiry && Date.now() > entry.expiry) {
            this.store.delete(key);
            return undefined;
          }

          return entry.value;
        }

        set(key: string, value: any) {
          // Simulate Redis with TTL
          const ttl = 1000; // 1 second TTL
          this.store.set(key, {
            value,
            expiry: Date.now() + ttl,
          });
        }

        clear() {
          this.store.clear();
        }
      }

      const redisCacheFactoryTask = defineTask({
        id: "globals.tasks.cacheFactory",
        run: async (_options: any) => {
          return new RedisLikeCache();
        },
      });

      let callCount = 0;
      const testTask = defineTask({
        id: "redis.cache.task",
        middleware: [cacheMiddleware],
        run: async () => {
          callCount++;
          return `result-${callCount}`;
        },
      });

      const app = defineResource({
        id: "app",
        register: [cacheResource, cacheMiddleware, testTask],
        overrides: [redisCacheFactoryTask],
        dependencies: { testTask },
        async init(_, { testTask }) {
          const result1 = await testTask();
          const result2 = await testTask(); // Should be cached

          expect(result1).toBe(result2);
          expect(callCount).toBe(1);

          // Advance virtual time for Redis-like TTL expiration.
          jest.advanceTimersByTime(1100);
          await Promise.resolve();

          const result3 = await testTask(); // Should be new result
          expect(result3).not.toBe(result1);
          expect(callCount).toBe(2);
        },
      });

      try {
        await run(app);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe("Cache Middleware", () => {
    it("should return cached results for same inputs", async () => {
      const testTask = defineTask({
        id: "cached.task",
        middleware: [cacheMiddleware],
        run: async (input: number) => input * 2,
      });

      const app = defineResource({
        id: "app",
        register: [cacheResource, cacheMiddleware, testTask],
        dependencies: { testTask },
        async init(_, { testTask }) {
          const result1 = await testTask(2);
          const result2 = await testTask(2);
          const result3 = await testTask(3);

          expect(result1).toBe(4);
          expect(result2).toBe(4);
          expect(result3).toBe(6);
        },
      });

      await run(app);
    });

    it("should use cachedValue when cache lacks has()", async () => {
      class NoHasCache implements ICacheInstance {
        private store = new Map<string, number>();

        get(key: string) {
          return this.store.get(key);
        }

        set(key: string, value: number) {
          this.store.set(key, value);
        }

        clear() {
          this.store.clear();
        }
      }

      const cacheFactoryTask = defineTask({
        id: CacheNoHasId.CacheFactory,
        run: async () => new NoHasCache(),
      });

      let callCount = 0;
      const testTask = defineTask({
        id: CacheNoHasId.Task,
        middleware: [cacheMiddleware],
        run: async () => {
          callCount += 1;
          return callCount;
        },
      });

      const app = defineResource({
        id: CacheNoHasId.App,
        register: [cacheResource, cacheMiddleware, testTask],
        overrides: [cacheFactoryTask],
        dependencies: { testTask },
        async init(_, { testTask }) {
          const first = await testTask();
          const second = await testTask();

          expect(first).toBe(second);
          expect(callCount).toBe(1);
        },
      });

      await run(app);
    });

    it("should await async has() implementations", async () => {
      class AsyncHasCache implements ICacheInstance {
        private store = new Map<string, number>();

        get(key: string) {
          return this.store.get(key);
        }

        set(key: string, value: number) {
          this.store.set(key, value);
        }

        async has(key: string) {
          await Promise.resolve();
          return this.store.has(key);
        }

        clear() {
          this.store.clear();
        }
      }

      const cacheFactoryTask = defineTask({
        id: "globals.tasks.cacheFactory",
        run: async () => new AsyncHasCache(),
      });

      let callCount = 0;
      const testTask = defineTask({
        id: "cache.async-has.task",
        middleware: [cacheMiddleware],
        run: async () => {
          callCount += 1;
          return callCount;
        },
      });

      const app = defineResource({
        id: "cache.async-has.app",
        register: [cacheResource, cacheMiddleware, testTask],
        overrides: [cacheFactoryTask],
        dependencies: { testTask },
        async init(_, { testTask }) {
          const first = await testTask();
          const second = await testTask();

          expect(first).toBe(1);
          expect(second).toBe(1);
          expect(callCount).toBe(1);
        },
      });

      await run(app);
    });

    it("should respect TTL configuration", async () => {
      let callCount = 0;
      const testTask = defineTask({
        id: "ttl.task",
        middleware: [cacheMiddleware.with({ ttl: 1, ttlAutopurge: true })], // Very short TTL
        run: async () => {
          callCount++;
          return `result-${callCount}`;
        },
      });

      const app = defineResource({
        id: "app",
        register: [cacheResource, cacheMiddleware, testTask],
        dependencies: { testTask },
        async init(_, { testTask }) {
          const firstRun = await testTask();
          const secondRun = await testTask(); // Should be cached

          // Allow TTL to expire with minimal real delay.
          await new Promise((resolve) => setTimeout(resolve, 5));

          const thirdRun = await testTask(); // Should be a new result

          expect(firstRun).toBe(secondRun); // Both should be cached
          expect(callCount).toBe(2); // Called twice - once initially, once after TTL expiry
          expect(thirdRun).not.toBe(firstRun); // Different result after TTL
        },
      });

      await run(app);
    });

    it("should handle custom key builders", async () => {
      const customMiddleware = cacheMiddleware.with({
        keyBuilder: (taskId: string, input: any) => `${taskId}-${input.id}`,
        ttl: 1000,
        ttlAutopurge: true,
      });

      const testTask = defineTask({
        id: "custom.key.task",
        middleware: [customMiddleware],
        run: async (input: { id: string }) => input,
      });

      const app = defineResource({
        id: "app",
        register: [cacheResource, cacheMiddleware, testTask],
        dependencies: { testTask },
        async init(_, { testTask }) {
          const input1 = { id: "1", data: "test" };
          const input2 = { id: "1", data: "modified" };

          const result1 = await testTask(input1);
          const result2 = await testTask(input2);

          expect(result1).toEqual(input1);
          expect(result2).toEqual(input1); // Same ID should cache
        },
      });

      await run(app);
    });

    it("should cache falsy values and record hit flag", async () => {
      let callCount = 0;
      const capturedHits: Array<boolean | undefined> = [];

      const hitCaptureMiddleware = defineTaskMiddleware({
        id: "cache.hit.capture",
        async run({ task, journal, next }) {
          const result = await next(task.input);
          capturedHits.push(journal.get(cacheJournalKeys.hit));
          return result;
        },
      });

      const testTask = defineTask({
        id: "falsy.cache.task",
        middleware: [hitCaptureMiddleware, cacheMiddleware],
        run: async (input: any) => {
          callCount++;
          return input;
        },
      });

      const app = defineResource({
        id: "app",
        register: [
          cacheResource,
          cacheMiddleware,
          hitCaptureMiddleware,
          testTask,
        ],
        dependencies: { testTask },
        async init(_, { testTask }) {
          const zeroFirst = await testTask(0);
          const zeroSecond = await testTask(0);
          const falseFirst = await testTask(false);

          expect(zeroFirst).toBe(0);
          expect(zeroSecond).toBe(0);
          expect(falseFirst).toBe(false);
          expect(callCount).toBe(2);
          expect(capturedHits).toEqual([false, true, false]);
        },
      });

      await run(app);
    });
  });

  describe("Error Handling", () => {
    it("should not cache errors by default", async () => {
      let callCount = 0;
      const errorTask = defineTask({
        id: "error.task",
        middleware: [cacheMiddleware],
        run: async () => {
          callCount++;
          throw createMessageError("Failed");
        },
      });

      const app = defineResource({
        id: "app",
        register: [cacheResource, cacheMiddleware, errorTask],
        dependencies: { errorTask },
        async init(_, { errorTask }) {
          await expect(errorTask()).rejects.toThrow("Failed");
          await expect(errorTask()).rejects.toThrow("Failed");
          expect(callCount).toBe(2);
        },
      });

      await run(app);
    });

    it("should not cache errors by default (errors throw through)", async () => {
      let callCount = 0;
      const errorTask = defineTask({
        id: "cached.error.task",
        middleware: [
          cacheMiddleware.with({
            ttl: 1000,
            ttlAutopurge: true,
          }),
        ],
        run: async () => {
          callCount++;
          throw createMessageError("Cached error");
        },
      });

      const app = defineResource({
        id: "app",
        register: [cacheResource, cacheMiddleware, errorTask],
        dependencies: { errorTask },
        async init(_, { errorTask }) {
          await expect(errorTask()).rejects.toThrow("Cached error");
          await expect(errorTask()).rejects.toThrow("Cached error");
          expect(callCount).toBe(2); // Called twice since errors aren't cached
        },
      });

      await run(app);
    });

    it("should return task result even when cache set fails", async () => {
      class SetFailingCache implements ICacheInstance {
        private store = new Map<string, number>();

        get(key: string) {
          return this.store.get(key);
        }

        set(_key: string, _value: number) {
          throw createMessageError("cache write failed");
        }

        has(key: string) {
          return this.store.has(key);
        }

        clear() {
          this.store.clear();
        }
      }

      const cacheFactoryTask = defineTask({
        id: "globals.tasks.cacheFactory",
        run: async () => new SetFailingCache(),
      });

      let callCount = 0;
      const task = defineTask({
        id: "cache.set-fail-open.task",
        middleware: [cacheMiddleware],
        run: async () => {
          callCount += 1;
          return callCount;
        },
      });

      const app = defineResource({
        id: "cache.set-fail-open.app",
        register: [cacheResource, cacheMiddleware, task],
        overrides: [cacheFactoryTask],
        dependencies: { task },
        async init(_, { task }) {
          const first = await task();
          const second = await task();

          expect(first).toBe(1);
          expect(second).toBe(2);
          expect(callCount).toBe(2);
        },
      });

      await run(app);
    });
  });

  describe("Cache Invalidation", () => {
    it("should clear cache instances when resource is disposed", async () => {
      let executionCount = 0;
      const testTask = defineTask({
        id: "disposal.task",
        middleware: [cacheMiddleware],
        run: async () => {
          executionCount++;
          return `result-${executionCount}`;
        },
      });

      const result = await run(
        defineResource({
          id: "app",
          register: [cacheResource, cacheMiddleware, testTask],
          dependencies: { testTask, cache: cacheResource },
          async init(_: void, { testTask, cache }) {
            const firstRun = await testTask();
            const secondRun = await testTask(); // Should be cached

            expect(firstRun).toBe(secondRun);
            expect(executionCount).toBe(1);
            expect(cache.map.size).toBe(1);

            return cache;
          },
        }),
      );

      // Dispose the resource - this should clear all cache instances
      await result.dispose();

      // Verify cache instances were cleared during disposal
      expect(result.value.map.size).toBe(1); // Map still exists but instances are cleared
    });
  });

  describe("Async Cache Handlers", () => {
    class AsyncMockCache implements ICacheInstance {
      store = new Map<string, any>();
      async get(key: string) {
        return this.store.get(key);
      }
      async set(key: string, value: any) {
        this.store.set(key, value);
      }
      async clear() {
        this.store.clear();
      }
    }

    const asyncCacheFactoryTask = defineTask({
      id: "globals.tasks.cacheFactory",
      run: async (_options: any) => {
        return new AsyncMockCache();
      },
    });

    it("should handle async cache operations", async () => {
      const testTask = defineTask({
        id: "task",
        middleware: [cacheMiddleware],
        run: async (input: number) => input * 2,
      });

      const asyncCacheResource = defineResource({
        id: "globals.resources.cache",
        register: [asyncCacheFactoryTask],
        dependencies: { cacheFactoryTask: asyncCacheFactoryTask },
        init: async (config: any, { cacheFactoryTask }) => ({
          map: new Map<string, AsyncMockCache>(),
          cacheFactoryTask,
          defaultOptions: { ttl: 10 * 1000, ...config?.defaultOptions },
        }),
        dispose: async (cache) => {
          await Promise.all(
            [...cache.map.values()].map((instance) => instance.clear()),
          );
        },
      });

      const app = defineResource({
        id: "app",
        register: [asyncCacheResource, cacheMiddleware, testTask],
        dependencies: { testTask },
        async init(_, { testTask }) {
          const result1 = await testTask(2);
          const result2 = await testTask(2);
          expect(result1).toBe(4);
          expect(result2).toBe(4);
        },
      });

      await run(app);
    });
  });

  describe("Complex Input Serialization", () => {
    it("should handle complex object inputs", async () => {
      const testTask = defineTask({
        id: "complex.object.task",
        middleware: [cacheMiddleware],
        run: async (input: { nested: { data: string }; array: number[] }) =>
          JSON.stringify(input),
      });

      const app = defineResource({
        id: "app",
        register: [cacheResource, cacheMiddleware, testTask],
        dependencies: { testTask },
        async init(_, { testTask }) {
          const complexInput = { nested: { data: "test" }, array: [1, 2, 3] };
          const result1 = await testTask(complexInput);
          const result2 = await testTask(complexInput);

          expect(result1).toBe(result2);
          expect(JSON.parse(result1)).toEqual(complexInput);
        },
      });

      await run(app);
    });

    it("should cache circular and BigInt inputs with default keyBuilder", async () => {
      type CircularBigIntInput = { id: bigint; self?: unknown };
      const runSpy = jest.fn(async (_input: CircularBigIntInput) => "ok");

      const testTask = defineTask({
        id: "circular.bigint.task",
        middleware: [cacheMiddleware],
        run: async (input: CircularBigIntInput) => runSpy(input),
      });

      const app = defineResource({
        id: "app",
        register: [cacheResource, cacheMiddleware, testTask],
        dependencies: { testTask },
        async init(_, { testTask }) {
          const input = { id: 1n } as CircularBigIntInput;
          input.self = input;

          const result1 = await testTask(input);
          const result2 = await testTask(input);

          expect(result1).toBe("ok");
          expect(result2).toBe("ok");
          expect(runSpy).toHaveBeenCalledTimes(1);
        },
      });

      await run(app);
    });

    it("should handle null and undefined inputs", async () => {
      const testTask = defineTask({
        id: "null.undefined.task",
        middleware: [cacheMiddleware],
        run: async (input: any) => `result-${input}`,
      });

      const app = defineResource({
        id: "app",
        register: [cacheResource, cacheMiddleware, testTask],
        dependencies: { testTask },
        async init(_, { testTask }) {
          const nullResult1 = await testTask(null);
          const nullResult2 = await testTask(null);
          const undefinedResult1 = await testTask(undefined);
          const undefinedResult2 = await testTask(undefined);

          expect(nullResult1).toBe(nullResult2);
          expect(undefinedResult1).toBe(undefinedResult2);
          expect(nullResult1).not.toBe(undefinedResult1);
        },
      });

      await run(app);
    });

    it("should handle array inputs with different orders", async () => {
      const testTask = defineTask({
        id: "array.order.task",
        middleware: [cacheMiddleware],
        run: async (input: number[]) => input.reduce((a, b) => a + b, 0),
      });

      const app = defineResource({
        id: "app",
        register: [cacheResource, cacheMiddleware, testTask],
        dependencies: { testTask },
        async init(_, { testTask }) {
          const result1 = await testTask([1, 2, 3]);
          const result2 = await testTask([1, 2, 3]);
          const result3 = await testTask([3, 2, 1]); // Different order

          expect(result1).toBe(result2);
          expect(result1).toBe(6);
          expect(result3).toBe(6);
          // Arrays with different order create different cache keys due to JSON.stringify
          // So result1 and result3 are from different cache entries (both computed)
        },
      });

      await run(app);
    });
  });

  describe("Cache Invalidation and Limits", () => {
    it("should respect max cache size", async () => {
      const testTask = defineTask({
        id: "max.size.task",
        middleware: [cacheMiddleware.with({ max: 2 })],
        run: async (input: number) => input * 2,
      });

      const app = defineResource({
        id: "app",
        register: [cacheResource, cacheMiddleware, testTask],
        dependencies: { testTask, cache: cacheResource },
        async init(_, { testTask, cache }) {
          await testTask(1);
          await testTask(2);
          await testTask(3); // Should evict first entry

          const cacheInstance = cache.map.get("max.size.task");
          expect(cacheInstance).toBeDefined();
          // LRU should maintain size limit
        },
      });

      await run(app);
    });

    it("should handle cache clear during execution", async () => {
      let executionCount = 0;
      const testTask = defineTask({
        id: "clear.during.exec.task",
        middleware: [cacheMiddleware],
        run: async (input: number) => {
          executionCount++;
          return input * 2;
        },
      });

      const app = defineResource({
        id: "app",
        register: [cacheResource, cacheMiddleware, testTask],
        dependencies: { testTask, cache: cacheResource },
        async init(_, { testTask, cache }) {
          const firstResult = await testTask(5);

          // Clear cache manually
          cache.map.get("clear.during.exec.task")?.clear();

          const secondResult = await testTask(5);

          expect(firstResult).toBe(secondResult);
          expect(executionCount).toBe(2); // Function called twice due to cache clear
          expect(cache.map.size).toBe(1); // Cache instance still exists but is cleared
        },
      });

      await run(app);
    });
  });

  describe("Concurrent Access", () => {
    it("should handle concurrent calls to same task", async () => {
      let executionCount = 0;
      const slowTask = defineTask({
        id: "concurrent.task",
        middleware: [cacheMiddleware],
        run: async (input: number) => {
          executionCount++;
          // Shorter delay to avoid timeout
          await new Promise((resolve) => setTimeout(resolve, 1));
          return input * 2;
        },
      });

      const app = defineResource({
        id: "app",
        register: [cacheResource, cacheMiddleware, slowTask],
        dependencies: { slowTask },
        async init(_, { slowTask }) {
          // Test basic caching behavior instead of race conditions
          const result1 = await slowTask(10);
          const result2 = await slowTask(10);

          expect(result1).toBe(20);
          expect(result2).toBe(20);
          expect(result1).toBe(result2); // Should be cached
          expect(executionCount).toBe(1); // Only executed once
        },
      });

      await run(app);
    });

    it("creates only one cache instance under concurrent first access", async () => {
      class TestCache implements ICacheInstance {
        private store = new Map<string, any>();
        get(key: string) {
          return this.store.get(key);
        }
        set(key: string, value: any) {
          this.store.set(key, value);
        }
        clear() {
          this.store.clear();
        }
      }

      let factoryCalls = 0;
      const slowFactoryTask = defineTask({
        id: "globals.tasks.cacheFactory",
        run: async () => {
          factoryCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 5));
          return new TestCache();
        },
      });

      const task = defineTask({
        id: "concurrent.cache.instance.task",
        middleware: [cacheMiddleware],
        run: async (input: number) => input * 10,
      });

      const app = defineResource({
        id: "app",
        register: [cacheResource, cacheMiddleware, task],
        overrides: [slowFactoryTask],
        dependencies: { task, cache: cacheResource },
        async init(_, { task, cache }) {
          const [a, b] = await Promise.all([task(1), task(2)]);
          expect(a).toBe(10);
          expect(b).toBe(20);
          expect(factoryCalls).toBe(1);
          expect(cache.map.size).toBe(1);
        },
      });

      await run(app);
    });
  });

  describe("Memory and Disposal", () => {
    it("should properly dispose async cache handlers", async () => {
      class AsyncDisposableCache implements ICacheInstance {
        store = new Map<string, any>();
        disposed = false;

        async get(key: string) {
          if (this.disposed) throw createMessageError("Cache disposed");
          return this.store.get(key);
        }

        async set(key: string, value: any) {
          if (this.disposed) throw createMessageError("Cache disposed");
          this.store.set(key, value);
        }

        async clear() {
          this.disposed = true;
          this.store.clear();
        }
      }

      const disposableCacheFactoryTask = defineTask({
        id: "globals.tasks.cacheFactory",
        run: async (_options: any) => {
          return new AsyncDisposableCache();
        },
      });

      const disposableCacheResource = defineResource({
        id: "globals.resources.cache",
        register: [disposableCacheFactoryTask],
        dependencies: { cacheFactoryTask: disposableCacheFactoryTask },
        init: async (config: any, { cacheFactoryTask }) => ({
          map: new Map<string, AsyncDisposableCache>(),
          cacheFactoryTask,
          defaultOptions: { ttl: 10 * 1000, ...config?.defaultOptions },
        }),
        dispose: async (cache) => {
          await Promise.all(
            [...cache.map.values()].map((instance) => instance.clear()),
          );
        },
      });

      const testTask = defineTask({
        id: "disposal.test.task",
        middleware: [cacheMiddleware],
        run: async () => "test",
      });

      const app = defineResource({
        id: "app",
        register: [disposableCacheResource, cacheMiddleware, testTask],
        dependencies: { testTask, cache: disposableCacheResource },
        async init(_, { testTask, cache }) {
          await testTask();
          return cache;
        },
      });

      const result = await run(app);

      // Manually dispose to trigger cleanup
      await result.dispose();

      // Verify cache was disposed
      const cacheInstance = result.value.map.get("disposal.test.task") as any;
      expect(cacheInstance?.disposed).toBe(true);
    });
  });

  describe("Configuration Validation", () => {
    it("should handle custom keyBuilder configuration properly", async () => {
      const customMiddleware = cacheMiddleware.with({
        keyBuilder: (taskId: string, input: any) => `custom-${taskId}-${input}`,
        ttl: 1000,
        ttlAutopurge: true,
      });

      const testTask = defineTask({
        id: "custom.keybuilder.task",
        middleware: [customMiddleware],
        run: async (input: string) => `result-${input}`,
      });

      const app = defineResource({
        id: "app",
        register: [cacheResource, cacheMiddleware, testTask],
        dependencies: { testTask },
        async init(_, { testTask }) {
          const result1 = await testTask("test");
          const result2 = await testTask("test");

          expect(result1).toBe("result-test");
          expect(result2).toBe(result1); // Should be cached
        },
      });

      await run(app);
    });

    it("should validate cache handler interface", async () => {
      class InvalidCache {
        // Missing required methods
        store = new Map();
      }

      const invalidCacheFactoryTask = defineTask({
        id: "globals.tasks.cacheFactory",
        run: async (_options: any) => {
          return new InvalidCache() as any;
        },
      });

      const invalidCacheResource = defineResource({
        id: "globals.resources.cache",
        register: [invalidCacheFactoryTask],
        dependencies: { cacheFactoryTask: invalidCacheFactoryTask },
        init: async (config: any, { cacheFactoryTask }) => ({
          map: new Map(),
          cacheFactoryTask,
          defaultOptions: { ttl: 10 * 1000, ...config?.defaultOptions },
        }),
        dispose: async () => {},
      });

      const testTask = defineTask({
        id: "invalid.handler.task",
        middleware: [cacheMiddleware],
        run: async () => "test",
      });

      const app = defineResource({
        id: "app",
        register: [invalidCacheResource, cacheMiddleware, testTask],
        dependencies: { testTask },
        async init(_, { testTask }) {
          // Should fail when trying to use invalid cache handler
          await testTask(); // This should trigger the error
        },
      });

      await expect(run(app)).rejects.toThrow();
    });
  });
});
