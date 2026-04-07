import { defineResource, defineTask } from "../../../../define";
import { run } from "../../../../run";
import {
  type CacheFactoryOptions,
  type CacheProvider,
  cacheMiddleware,
  cacheResource,
} from "../../../../globals/middleware/cache/middleware";
import { genericError } from "../../../../errors";
import { loggerResource } from "../../../../globals/resources/logger.resource";

describe("cache resource invalidateKeys", () => {
  it("invalidates matching keys across cached tasks", async () => {
    let profileCalls = 0;
    let summaryCalls = 0;

    const profileTask = defineTask({
      id: "cache-keys-profile-task",
      middleware: [
        cacheMiddleware.with({
          keyBuilder: (_taskId: string, input: { userId: string }) =>
            `user:${input.userId}`,
        }),
      ],
      run: async (input: { userId: string }) =>
        `profile:${input.userId}:${++profileCalls}`,
    });

    const summaryTask = defineTask({
      id: "cache-keys-summary-task",
      middleware: [
        cacheMiddleware.with({
          keyBuilder: (_taskId: string, input: { userId: string }) =>
            `user:${input.userId}`,
        }),
      ],
      run: async (input: { userId: string }) =>
        `summary:${input.userId}:${++summaryCalls}`,
    });

    const app = defineResource({
      id: "cache-keys-shared-app",
      register: [cacheResource, profileTask, summaryTask],
      dependencies: { cache: cacheResource, profileTask, summaryTask },
      async init(_, { cache, profileTask, summaryTask }) {
        await profileTask({ userId: "u1" });
        await summaryTask({ userId: "u1" });

        expect(await cache.invalidateKeys("user:u1")).toBe(2);
        expect(await profileTask({ userId: "u1" })).toBe("profile:u1:2");
        expect(await summaryTask({ userId: "u1" })).toBe("summary:u1:2");
      },
    });

    await run(app);
  });

  it("reuses transient custom providers created for key invalidation", async () => {
    let createCount = 0;
    const invalidationCalls: Array<{
      keys: readonly string[];
      taskId: string;
    }> = [];

    const customProvider = defineResource({
      id: "cache-key-invalidation-custom-provider",
      init:
        async (): Promise<CacheProvider> =>
        async ({ taskId }) => {
          createCount += 1;
          return {
            get: async () => undefined,
            set: async () => undefined,
            clear: async () => undefined,
            invalidateKeys: async (keys) => {
              invalidationCalls.push({ keys, taskId });
              return 0;
            },
            invalidateRefs: async () => 0,
          };
        },
    });

    const cachedTask = defineTask({
      id: "cache-key-invalidation-transient-task",
      middleware: [
        cacheMiddleware.with({
          keyBuilder: (_taskId: string, input: { userId: string }) =>
            `user:${input.userId}`,
        }),
      ],
      run: async () => "never-called",
    });

    const app = defineResource({
      id: "cache-key-invalidation-transient-app",
      register: [cacheResource.with({ provider: customProvider }), cachedTask],
      dependencies: { cache: cacheResource },
      async init(_, { cache }) {
        await cache.invalidateKeys("user:u1");
        await cache.invalidateKeys("user:u1");

        expect(createCount).toBe(1);
        expect(invalidationCalls).toEqual([
          {
            keys: ["user:u1"],
            taskId:
              "cache-key-invalidation-transient-app.tasks.cache-key-invalidation-transient-task",
          },
          {
            keys: ["user:u1"],
            taskId:
              "cache-key-invalidation-transient-app.tasks.cache-key-invalidation-transient-task",
          },
        ]);
      },
    });

    await run(app);
  });

  it("returns zero when invalidating no keys or built-in caches that were never created", async () => {
    const cachedTask = defineTask({
      id: "cache-key-invalidation-no-holder-task",
      middleware: [
        cacheMiddleware.with({
          keyBuilder: (_taskId: string, input: { userId: string }) =>
            `user:${input.userId}`,
        }),
      ],
      run: async () => "never-called",
    });

    const app = defineResource({
      id: "cache-key-invalidation-no-holder-app",
      register: [cacheResource, cachedTask],
      dependencies: { cache: cacheResource },
      async init(_, { cache }) {
        expect(await cache.invalidateKeys([])).toBe(0);
        expect(await cache.invalidateKeys("user:u1")).toBe(0);
      },
    });

    await run(app);
  });

  it("continues invalidating other cache targets when one key invalidation fails", async () => {
    const invalidationCalls: Array<{
      keys: readonly string[];
      taskId: string;
    }> = [];
    const createdOptions = new Map<string, CacheFactoryOptions>();

    const customProvider = defineResource({
      id: "cache-key-invalidation-error-provider",
      init:
        async (): Promise<CacheProvider> =>
        async ({ options, taskId }) => {
          createdOptions.set(taskId, options);
          return {
            get: async () => undefined,
            set: async () => undefined,
            clear: async () => undefined,
            invalidateKeys: async (keys) => {
              invalidationCalls.push({ keys, taskId });
              if (
                taskId ===
                "cache-key-invalidation-error-app.tasks.cache-key-invalidation-error-task"
              ) {
                throw "boom";
              }

              return 2;
            },
            invalidateRefs: async () => 0,
          };
        },
    });

    const failingTask = defineTask({
      id: "cache-key-invalidation-error-task",
      middleware: [
        cacheMiddleware.with({
          ttl: 111,
          keyBuilder: (_taskId: string, input: { userId: string }) =>
            `error:${input.userId}`,
        }),
      ],
      run: async () => "never-called",
    });

    const healthyTask = defineTask({
      id: "cache-key-invalidation-healthy-task",
      middleware: [
        cacheMiddleware.with({
          ttl: 222,
          keyBuilder: (_taskId: string, input: { userId: string }) =>
            `ok:${input.userId}`,
        }),
      ],
      run: async () => "never-called",
    });

    const app = defineResource({
      id: "cache-key-invalidation-error-app",
      register: [
        cacheResource.with({ provider: customProvider }),
        failingTask,
        healthyTask,
      ],
      dependencies: { cache: cacheResource, logger: loggerResource },
      async init(_, { cache }) {
        await expect(cache.invalidateKeys(["error:u1", "ok:u1"])).resolves.toBe(
          2,
        );
        expect(invalidationCalls).toEqual([
          {
            keys: ["error:u1", "ok:u1"],
            taskId:
              "cache-key-invalidation-error-app.tasks.cache-key-invalidation-error-task",
          },
          {
            keys: ["error:u1", "ok:u1"],
            taskId:
              "cache-key-invalidation-error-app.tasks.cache-key-invalidation-healthy-task",
          },
        ]);
        expect(
          createdOptions.get(
            "cache-key-invalidation-error-app.tasks.cache-key-invalidation-error-task",
          )?.ttl,
        ).toBe(111);
        expect(
          createdOptions.get(
            "cache-key-invalidation-error-app.tasks.cache-key-invalidation-healthy-task",
          )?.ttl,
        ).toBe(222);
      },
    });

    await run(app);
  });

  it("keeps going when a cache target throws an Error instance during key invalidation", async () => {
    const customProvider = defineResource({
      id: "cache-key-invalidation-error-instance-provider",
      init:
        async (): Promise<CacheProvider> =>
        async ({ taskId }) => ({
          get: async () => undefined,
          set: async () => undefined,
          clear: async () => undefined,
          invalidateKeys: async () => {
            if (
              taskId ===
              "cache-key-invalidation-error-instance-app.tasks.cache-key-invalidation-error-instance-task"
            ) {
              throw genericError.new({ message: "error instance" });
            }

            return 1;
          },
          invalidateRefs: async () => 0,
        }),
    });

    const failingTask = defineTask({
      id: "cache-key-invalidation-error-instance-task",
      middleware: [
        cacheMiddleware.with({
          keyBuilder: (_taskId: string, input: { userId: string }) =>
            `error:${input.userId}`,
        }),
      ],
      run: async () => "never-called",
    });

    const healthyTask = defineTask({
      id: "cache-key-invalidation-healthy-instance-task",
      middleware: [
        cacheMiddleware.with({
          keyBuilder: (_taskId: string, input: { userId: string }) =>
            `ok:${input.userId}`,
        }),
      ],
      run: async () => "never-called",
    });

    const app = defineResource({
      id: "cache-key-invalidation-error-instance-app",
      register: [
        cacheResource.with({ provider: customProvider }),
        failingTask,
        healthyTask,
      ],
      dependencies: { cache: cacheResource, logger: loggerResource },
      async init(_, { cache }) {
        await expect(cache.invalidateKeys("user:u1")).resolves.toBe(1);
      },
    });

    await run(app);
  });
});
