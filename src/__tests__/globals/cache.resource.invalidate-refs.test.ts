import { defineResource, defineTask } from "../../define";
import { run } from "../../run";
import {
  type CacheFactoryOptions,
  type CacheProvider,
  cacheMiddleware,
  cacheResource,
} from "../../globals/middleware/cache.middleware";
import { loggerResource } from "../../globals/resources/logger.resource";
import { storeResource } from "../../globals/resources/store.resource";
import { MiddlewareResolver } from "../../models/middleware/MiddlewareResolver";
import { getSubtreeMiddlewareDuplicateKey } from "../../tools/subtreeMiddleware";
import { genericError } from "../../errors";

describe("cache resource invalidateRefs", () => {
  it("reuses transient custom providers created for invalidation", async () => {
    let createCount = 0;
    const invalidationCalls: Array<{
      refs: readonly string[];
      taskId: string;
    }> = [];

    const customProvider = defineResource({
      id: "cache-invalidation-custom-provider",
      init:
        async (): Promise<CacheProvider> =>
        async ({ taskId }) => {
          createCount += 1;
          return {
            get: async () => undefined,
            set: async () => undefined,
            clear: async () => undefined,
            invalidateRefs: async (refs) => {
              invalidationCalls.push({ refs, taskId });
              return 0;
            },
          };
        },
    });

    const cachedTask = defineTask({
      id: "cache-invalidation-transient-task",
      middleware: [
        cacheMiddleware.with({
          keyBuilder: (_taskId: string, input: { userId: string }) => ({
            cacheKey: `user:${input.userId}`,
            refs: [`user:${input.userId}`],
          }),
        }),
      ],
      run: async () => "never-called",
    });

    const app = defineResource({
      id: "cache-invalidation-transient-app",
      register: [
        cacheResource.with({
          provider: customProvider,
        }),
        cachedTask,
      ],
      dependencies: { cache: cacheResource },
      async init(_, { cache }) {
        await cache.invalidateRefs("user:u1");
        await cache.invalidateRefs("user:u1");

        expect(createCount).toBe(1);
        expect(cache.map.has("cache-invalidation-transient-task")).toBe(true);
        expect(invalidationCalls).toEqual([
          {
            refs: ["user:u1"],
            taskId: "cache-invalidation-transient-task",
          },
          {
            refs: ["user:u1"],
            taskId: "cache-invalidation-transient-task",
          },
        ]);
      },
    });

    await run(app);
  });

  it("reuses pending transient provider creation across concurrent invalidations", async () => {
    let createCount = 0;
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });

    const customProvider = defineResource({
      id: "cache-invalidation-pending-provider",
      init: async (): Promise<CacheProvider> => async () => {
        createCount += 1;
        await providerGate;
        return {
          get: async () => undefined,
          set: async () => undefined,
          clear: async () => undefined,
          invalidateRefs: async () => 0,
        };
      },
    });

    const cachedTask = defineTask({
      id: "cache-invalidation-pending-task",
      middleware: [
        cacheMiddleware.with({
          keyBuilder: (_taskId: string, input: { userId: string }) => ({
            cacheKey: `user:${input.userId}`,
            refs: [`user:${input.userId}`],
          }),
        }),
      ],
      run: async () => "never-called",
    });

    const app = defineResource({
      id: "cache-invalidation-pending-app",
      register: [
        cacheResource.with({
          provider: customProvider,
        }),
        cachedTask,
      ],
      dependencies: { cache: cacheResource },
      async init(_, { cache }) {
        const first = cache.invalidateRefs("user:u1");
        const second = cache.invalidateRefs("user:u1");

        await Promise.resolve();
        releaseProvider();
        await Promise.all([first, second]);

        expect(createCount).toBe(1);
      },
    });

    await run(app);
  });

  it("continues invalidating other cache targets when one target fails", async () => {
    const invalidationCalls: Array<{
      refs: readonly string[];
      taskId: string;
    }> = [];
    const createdOptions = new Map<string, CacheFactoryOptions>();

    const customProvider = defineResource({
      id: "cache-invalidation-error-provider",
      init:
        async (): Promise<CacheProvider> =>
        async ({ options, taskId }) => {
          createdOptions.set(taskId, options);
          return {
            get: async () => undefined,
            set: async () => undefined,
            clear: async () => undefined,
            invalidateRefs: async (refs) => {
              invalidationCalls.push({ refs, taskId });
              if (taskId === "cache-invalidation-error-task") {
                throw "boom";
              }

              return 2;
            },
          };
        },
    });

    const failingTask = defineTask({
      id: "cache-invalidation-error-task",
      middleware: [
        cacheMiddleware.with({
          ttl: 111,
          keyBuilder: (_taskId: string, input: { userId: string }) => ({
            cacheKey: `error:${input.userId}`,
            refs: [`user:${input.userId}`],
          }),
        }),
      ],
      run: async () => "never-called",
    });

    const healthyTask = defineTask({
      id: "cache-invalidation-healthy-task",
      middleware: [
        cacheMiddleware.with({
          ttl: 222,
          keyBuilder: (_taskId: string, input: { userId: string }) => ({
            cacheKey: `ok:${input.userId}`,
            refs: [`user:${input.userId}`],
          }),
        }),
      ],
      run: async () => "never-called",
    });

    const app = defineResource({
      id: "cache-invalidation-error-app",
      register: [
        cacheResource.with({
          provider: customProvider,
        }),
        failingTask,
        healthyTask,
      ],
      dependencies: { cache: cacheResource, logger: loggerResource },
      async init(_, { cache }) {
        await expect(cache.invalidateRefs("user:u1")).resolves.toBe(2);
        expect(invalidationCalls).toEqual([
          {
            refs: ["user:u1"],
            taskId: "cache-invalidation-error-task",
          },
          {
            refs: ["user:u1"],
            taskId: "cache-invalidation-healthy-task",
          },
        ]);
        expect(createdOptions.get("cache-invalidation-error-task")?.ttl).toBe(
          111,
        );
        expect(createdOptions.get("cache-invalidation-healthy-task")?.ttl).toBe(
          222,
        );
      },
    });

    await run(app);
  });

  it("includes subtree-inherited cache middleware when invalidating refs", async () => {
    const invalidationCalls: Array<{
      refs: readonly string[];
      taskId: string;
    }> = [];

    const customProvider = defineResource({
      id: "cache-invalidation-inherited-provider",
      init:
        async (): Promise<CacheProvider> =>
        async ({ taskId }) => ({
          get: async () => undefined,
          set: async () => undefined,
          clear: async () => undefined,
          invalidateRefs: async (refs) => {
            invalidationCalls.push({ refs, taskId });
            return 1;
          },
        }),
    });

    const cachedTask = defineTask({
      id: "cache-invalidation-inherited-task",
      run: async () => "never-called",
    });

    const subtreeOwner = defineResource({
      id: "cache-invalidation-inherited-owner",
      subtree: {
        tasks: {
          middleware: [
            cacheMiddleware.with({
              keyBuilder: (_taskId: string, input: { userId: string }) => ({
                cacheKey: `user:${input.userId}`,
                refs: [`user:${input.userId}`],
              }),
            }),
          ],
        },
      },
      register: [cachedTask],
      init: async () => "owner",
    });

    const app = defineResource({
      id: "cache-invalidation-inherited-app",
      register: [
        cacheResource.with({
          provider: customProvider,
        }),
        subtreeOwner,
      ],
      init: async () => "app",
    });

    const runtime = await run(app);
    const cache = runtime.getResourceValue(cacheResource);
    const store = runtime.getResourceValue(storeResource);
    const applicableMiddlewares = new MiddlewareResolver(
      store,
    ).getApplicableTaskMiddlewares(cachedTask);

    expect(
      applicableMiddlewares.some(
        (middleware) =>
          getSubtreeMiddlewareDuplicateKey(middleware.id) ===
          cacheMiddleware.id,
      ),
    ).toBe(true);

    await expect(cache.invalidateRefs("user:u1")).resolves.toBe(1);
    expect(invalidationCalls).toEqual([
      {
        refs: ["user:u1"],
        taskId: "cache-invalidation-inherited-task",
      },
    ]);
  });

  it("keeps going when a cache target throws an Error instance during invalidation", async () => {
    const customProvider = defineResource({
      id: "cache-invalidation-error-instance-provider",
      init:
        async (): Promise<CacheProvider> =>
        async ({ taskId }) => ({
          get: async () => undefined,
          set: async () => undefined,
          clear: async () => undefined,
          invalidateRefs: async () => {
            if (taskId === "cache-invalidation-error-instance-task") {
              throw genericError.new({ message: "error instance" });
            }

            return 1;
          },
        }),
    });

    const failingTask = defineTask({
      id: "cache-invalidation-error-instance-task",
      middleware: [
        cacheMiddleware.with({
          keyBuilder: (_taskId: string, input: { userId: string }) => ({
            cacheKey: `error:${input.userId}`,
            refs: [`user:${input.userId}`],
          }),
        }),
      ],
      run: async () => "never-called",
    });

    const healthyTask = defineTask({
      id: "cache-invalidation-error-instance-healthy-task",
      middleware: [
        cacheMiddleware.with({
          keyBuilder: (_taskId: string, input: { userId: string }) => ({
            cacheKey: `ok:${input.userId}`,
            refs: [`user:${input.userId}`],
          }),
        }),
      ],
      run: async () => "never-called",
    });

    const app = defineResource({
      id: "cache-invalidation-error-instance-app",
      register: [
        cacheResource.with({
          provider: customProvider,
        }),
        failingTask,
        healthyTask,
      ],
      dependencies: { cache: cacheResource, logger: loggerResource },
      async init(_, { cache }) {
        await expect(cache.invalidateRefs("user:u1")).resolves.toBe(1);
      },
    });

    await run(app);
  });
});
