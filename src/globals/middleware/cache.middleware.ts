import { defineTaskMiddleware } from "../../definers/defineTaskMiddleware";
import { defineResource } from "../../definers/defineResource";
import type { IResource } from "../../defs";
import { loggerResource } from "../resources/logger.resource";
import { LRUCache } from "lru-cache";
import { journal as journalHelper } from "../../models/ExecutionJournal";
import { safeStringify } from "../../models/utils/safeStringify";

export interface ICacheInstance {
  set(key: string, value: unknown): unknown | Promise<unknown>;
  get(key: string): unknown | Promise<unknown>;
  clear(): void | Promise<void>;
  /** Optional presence check to disambiguate cached undefined values */
  has?(key: string): boolean | Promise<boolean>;
}

type CacheStoredValue = NonNullable<unknown>;
type CacheFactoryOptions = Partial<
  LRUCache.Options<string, CacheStoredValue, unknown>
>;

export type CacheProvider = (
  options: CacheFactoryOptions,
) => Promise<ICacheInstance>;

type CacheProviderResource = IResource<
  any,
  Promise<CacheProvider>,
  any,
  any,
  any,
  any,
  any
>;

export const cacheProviderResource = defineResource({
  id: "globals.resources.cacheProvider",
  init: async () => {
    const provider: CacheProvider = async (
      options: CacheFactoryOptions,
    ): Promise<ICacheInstance> =>
      new LRUCache<string, CacheStoredValue, unknown>(
        options as LRUCache.Options<string, CacheStoredValue, unknown>,
      );
    return provider;
  },
});

export interface CacheResourceConfig {
  defaultOptions?: CacheFactoryOptions;
  provider?: CacheProviderResource;
}

type CacheMiddlewareConfig = CacheFactoryOptions & {
  keyBuilder?: (taskId: string, input: unknown) => string;
};

/**
 * Journal keys exposed by the cache middleware.
 * Use these to access shared state from downstream middleware or tasks.
 */
export const journalKeys = {
  /** Whether the result was served from cache (true) or freshly computed (false) */
  hit: journalHelper.createKey<boolean>("globals.middleware.task.cache.hit"),
} as const;

export const cacheResource = defineResource({
  id: "globals.resources.cache",
  register: (config: CacheResourceConfig) => [
    config?.provider ?? cacheProviderResource,
  ],
  dependencies: (config: CacheResourceConfig) => ({
    cacheProvider: config?.provider ?? cacheProviderResource,
  }),
  init: async (config: CacheResourceConfig, { cacheProvider }) => {
    return {
      map: new Map<string, ICacheInstance>(),
      pendingCreates: new Map<string, Promise<ICacheInstance>>(),
      cacheProvider,
      defaultOptions: {
        ttl: 10 * 1000,
        max: 100, // Maximum number of items in cache
        ttlAutopurge: true, // Automatically purge expired items
        ...(config?.defaultOptions ?? {}),
      },
    };
  },
  dispose: async (cache) => {
    cache.pendingCreates?.clear();
    for (const cacheInstance of cache.map.values()) {
      await cacheInstance.clear();
    }
  },
});

const defaultKeyBuilder = (taskId: string, input: unknown) =>
  `${taskId}-${safeStringify(input)}`;

export const cacheMiddleware = defineTaskMiddleware({
  id: "globals.middleware.task.cache",
  dependencies: { cache: cacheResource, logger: loggerResource.optional() },
  async run({ task, next, journal }, deps, config: CacheMiddlewareConfig) {
    const { cache, logger } = deps;
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
      const pendingCreates = cache.pendingCreates;

      const pendingCreate = pendingCreates.get(taskId);
      if (pendingCreate) {
        cacheHolderForTask = await pendingCreate;
      } else {
        const createPromise = cache
          .cacheProvider(cacheOptions)
          .then((instance) => {
            cache.map.set(taskId, instance);
            return instance;
          })
          .finally(() => {
            pendingCreates.delete(taskId);
          });
        pendingCreates.set(taskId, createPromise);
        cacheHolderForTask = await createPromise;
      }
    }

    const key = config.keyBuilder!(taskId, task!.input);

    const cachedValue = await cacheHolderForTask.get(key);
    const hasCachedEntry =
      typeof cacheHolderForTask.has === "function"
        ? await cacheHolderForTask.has(key)
        : cachedValue !== undefined;

    if (hasCachedEntry) {
      journal.set(journalKeys.hit, true, { override: true });
      return cachedValue;
    }

    journal.set(journalKeys.hit, false, { override: true });
    const result = await next(task!.input);

    try {
      await cacheHolderForTask.set(key, result);
    } catch (error) {
      // Fail-open: preserve successful task result even if cache backend write fails.
      await logger?.error(
        "Cache middleware write failed; returning fresh result.",
        {
          taskId,
          data: {
            key,
          },
          error: error instanceof Error ? error : new Error(String(error)),
        },
      );
    }

    return result;
  },
});
