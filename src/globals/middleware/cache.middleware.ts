import { defineTaskMiddleware } from "../../definers/defineTaskMiddleware";
import { defineResource } from "../../definers/defineResource";
import { defineTask } from "../../definers/defineTask";
import { LRUCache } from "lru-cache";
import { journal as journalHelper } from "../../models/ExecutionJournal";

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
};

type CacheMiddlewareConfig = {
  keyBuilder?: (taskId: string, input: any) => string;
} & any;

/**
 * Journal keys exposed by the cache middleware.
 * Use these to access shared state from downstream middleware or tasks.
 */
export const journalKeys = {
  /** Whether the result was served from cache (true) or freshly computed (false) */
  hit: journalHelper.createKey<boolean>("globals.middleware.cache.hit"),
} as const;

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

export const cacheMiddleware = defineTaskMiddleware({
  id: "globals.middleware.cache",
  dependencies: { cache: cacheResource },
  async run({ task, next, journal }, deps, config: CacheMiddlewareConfig) {
    const { cache } = deps;
    config = {
      keyBuilder: defaultKeyBuilder,
      ttl: 10 * 1000,
      max: 100, // Maximum number of items in cache
      ttlAutopurge: true, // Automatically purge expired items
      ...config,
    };

    const taskId = task!.definition.id;
    let cacheHolderForTask = cache.map.get(taskId)!;
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

    const key = config.keyBuilder!(taskId, task!.input);

    const cachedValue = await cacheHolderForTask.get(key);

    if (cachedValue) {
      journal.set(journalKeys.hit, true, { override: true });
      return cachedValue;
    }

    journal.set(journalKeys.hit, false, { override: true });
    const result = await next(task!.input);

    await cacheHolderForTask.set(key, result);

    return result;
  },
});
