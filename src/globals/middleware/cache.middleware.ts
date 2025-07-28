import { defineMiddleware, defineResource } from "../../define";
import { LRUCache } from "lru-cache";
import { IResource } from "../../defs";

export interface ICacheInstance {
  set(key: string, value: any): void;
  get(key: string): any;
  clear(): void;
}

type CacheResourceConfig = {
  cacheHandler?: new (...args: any[]) => ICacheInstance;
  defaultOptions?: LRUCache.Options<any, any, any>;
  /**
   * This specifies whether the cache handler is async or not (get, set, clear)
   */
  async?: boolean;
};

type CacheMiddlewareConfig = {
  keyBuilder?: (taskId: string, input: any) => string;
} & LRUCache.Options<any, any, any>;

// Singleton cache resource
export const cacheResource = defineResource({
  id: "global.resources.cache",
  init: async (config: CacheResourceConfig) => {
    const cacheHandler = config.cacheHandler || LRUCache;

    return {
      map: new Map<string, ICacheInstance>(),
      cacheHandler,
      async: config.async,
      defaultOptions: {
        ttl: 10 * 1000,
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
  id: "global.middleware.cache",
  dependencies: { cache: cacheResource },
  async run({ task, resource, next }, deps, config: CacheMiddlewareConfig) {
    const { cache } = deps;
    config = {
      keyBuilder: defaultKeyBuilder,
      ttl: 10 * 1000,
      ...config,
    };

    if (!task) {
      throw new Error("Cache middleware can only be used in tasks");
    }

    const taskId = task.definition.id;
    const isAsync = cache.async;
    let cacheHolderForTask = cache.map.get(taskId);
    if (!cacheHolderForTask) {
      cacheHolderForTask = new cache.cacheHandler({
        ...cache.defaultOptions,
        ...config,
      });

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
