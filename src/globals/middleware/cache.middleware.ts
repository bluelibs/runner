import { defineMiddleware, defineResource, defineTask } from "../../define";
import { LRUCache } from "lru-cache";
import { IResource, ITask } from "../../defs";

export interface ICacheInstance {
  set(key: string, value: any): void;
  get(key: string): any;
  clear(): void;
}

// Default cache factory task that can be overridden
export const cacheFactoryTask = defineTask({
  id: "globals.tasks.cacheFactory",
  run: async (options: any) => {
    return new LRUCache(options) as ICacheInstance;
  },
});

type CacheResourceConfig = {
  defaultOptions?: any;
  /**
   * This specifies whether the cache handler is async or not (get, set, clear)
   * This is for speed purposes.
   */
  async?: boolean;
};

type CacheMiddlewareConfig = {
  keyBuilder?: (taskId: string, input: any) => string;
} & any;

export const cacheResource = defineResource({
  id: "globals.resources.cache",
  register: [cacheFactoryTask],
  dependencies: {
    cacheFactoryTask,
  },
  init: async (config: CacheResourceConfig, { cacheFactoryTask }) => {
    return {
      map: new Map<string, ICacheInstance>(),
      cacheFactoryTask,
      async: config.async,
      defaultOptions: {
        ttl: 10 * 1000,
        max: 100, // Maximum number of items in cache
        ttlAutopurge: true, // Automatically purge expired items
        ...config.defaultOptions,
      },
    };
  },
  dispose: async (cache) => {
    for (const cacheInstance of cache.map.values()) {
      await cacheInstance.clear();
    }
  },
});

const defaultKeyBuilder = (taskId: string, input: any) =>
  `${taskId}-${JSON.stringify(input)}`;

export const cacheMiddleware = defineMiddleware({
  id: "globals.middleware.cache",
  dependencies: { cache: cacheResource },
  async run({ task, resource, next }, deps, config: CacheMiddlewareConfig) {
    const { cache } = deps;
    config = {
      keyBuilder: defaultKeyBuilder,
      ttl: 10 * 1000,
      max: 100, // Maximum number of items in cache
      ttlAutopurge: true, // Automatically purge expired items
      ...config,
    };

    if (!task) {
      throw new Error("Cache middleware can only be used in tasks");
    }

    const taskId = task.definition.id;
    const isAsync = cache.async;
    let cacheHolderForTask = cache.map.get(taskId);
    if (!cacheHolderForTask) {
      // Extract only LRUCache options, excluding keyBuilder
      const { keyBuilder, ...lruOptions } = config;
      const cacheOptions = {
        ...cache.defaultOptions,
        ...lruOptions,
      };

      // Use the factory task to create the cache instance
      cacheHolderForTask = await cache.cacheFactoryTask(cacheOptions);

      cache.map.set(taskId, cacheHolderForTask);
    }

    const key = config.keyBuilder!(taskId, task.input);

    const cachedValue = isAsync
      ? await cacheHolderForTask.get(key)
      : cacheHolderForTask.get(key);

    if (cachedValue) {
      return cachedValue;
    }

    const result = await next(task.input);

    if (isAsync) {
      await cacheHolderForTask.set(key, result);
    } else {
      cacheHolderForTask.set(key, result);
    }

    return result;
  },
});
