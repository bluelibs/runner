import {
  createTaskScopedCacheInstance,
  createDefaultCacheProvider,
  createSharedCacheBudgetState,
  type CacheFactoryOptions,
  type CacheProvider,
  type ICacheProvider,
  type SharedCacheBudgetState,
  supportsTaskScopedCacheProvider,
} from "./cache.shared";
import {
  defineFrameworkResource,
  defineFrameworkTaskMiddleware,
} from "../../definers/frameworkDefinition";
import {
  symbolResource,
  symbolResourceWithConfig,
  type IResource,
  type IResourceWithConfig,
} from "../../defs";
import { extractResourceAndConfig } from "../../tools/extractResourceAndConfig";
import { loggerResource } from "../resources/logger.resource";
import { journal as journalHelper } from "../../models/ExecutionJournal";
import { safeStringify } from "../../models/utils/safeStringify";
import { Match } from "../../tools/check";
import { validationError } from "../../errors";

export type {
  CacheFactoryOptions,
  CacheProvider,
  ICacheProvider,
} from "./cache.shared";

type CacheProviderResourceDefinition = IResource<
  any,
  Promise<CacheProvider>,
  any,
  any,
  any,
  any,
  any
>;

type CacheProviderResource =
  | CacheProviderResourceDefinition
  | IResourceWithConfig<any, Promise<CacheProvider>, any, any, any, any, any>;

export const cacheProviderResource = defineFrameworkResource({
  id: "runner.cacheProvider",
  init: async () => createDefaultCacheProvider(),
});

export interface CacheResourceConfig {
  defaultOptions?: CacheFactoryOptions;
  provider?: CacheProviderResource;
  totalBudgetBytes?: number;
}

type CacheMiddlewareConfig = CacheFactoryOptions & {
  keyBuilder?: (taskId: string, input: unknown) => string;
};

const cacheFactoryOptionsPattern = Match.Where(
  (value: unknown): value is CacheFactoryOptions =>
    value !== null && typeof value === "object",
);

function isCacheProviderResource(
  value: unknown,
): value is CacheProviderResource {
  return (
    typeof value === "object" &&
    value !== null &&
    (Boolean((value as Record<symbol, unknown>)[symbolResource]) ||
      Boolean((value as Record<symbol, unknown>)[symbolResourceWithConfig])) &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

const cacheProviderResourcePattern = Match.Where(
  (value: unknown): value is CacheProviderResource =>
    isCacheProviderResource(value),
);

const totalBudgetBytesPattern = Match.Where(
  (value: unknown): value is number =>
    typeof value === "number" && Number.isInteger(value) && value > 0,
);

const cacheResourceConfigPattern = Match.ObjectIncluding({
  defaultOptions: Match.Optional(cacheFactoryOptionsPattern),
  provider: Match.Optional(cacheProviderResourcePattern),
  totalBudgetBytes: Match.Optional(totalBudgetBytesPattern),
});

const cacheMiddlewareConfigPattern = Match.ObjectIncluding({
  keyBuilder: Match.Optional(Function),
  ttl: Match.Optional(Match.PositiveInteger),
  max: Match.Optional(Match.PositiveInteger),
  ttlAutopurge: Match.Optional(Boolean),
  allowStale: Match.Optional(Boolean),
  updateAgeOnGet: Match.Optional(Boolean),
  updateAgeOnHas: Match.Optional(Boolean),
  maxSize: Match.Optional(Match.PositiveInteger),
  maxEntrySize: Match.Optional(Match.PositiveInteger),
  ttlResolution: Match.Optional(Match.PositiveInteger),
  ttlAutopurgeWarn: Match.Optional(Boolean),
  noDeleteOnFetchRejection: Match.Optional(Boolean),
  noDeleteOnStaleGet: Match.Optional(Boolean),
  noDisposeOnSet: Match.Optional(Boolean),
  fetchMethod: Match.Optional(Function),
  sizeCalculation: Match.Optional(Function),
  dispose: Match.Optional(Function),
  disposeAfter: Match.Optional(Function),
  noUpdateTTL: Match.Optional(Boolean),
  noDeleteOnStaleFetchRejection: Match.Optional(Boolean),
  allowStaleOnFetchAbort: Match.Optional(Boolean),
  allowStaleOnFetchRejection: Match.Optional(Boolean),
  ignoreFetchAbort: Match.Optional(Boolean),
  forceRefresh: Match.Optional(Boolean),
  noDeleteOnFetchAbort: Match.Optional(Boolean),
  size: Match.Optional(Number),
  stale: Match.Optional(Boolean),
});

/**
 * Journal keys exposed by the cache middleware.
 * Use these to access shared state from downstream middleware or tasks.
 */
export const journalKeys = {
  /** Whether the result was served from cache (true) or freshly computed (false) */
  hit: journalHelper.createKey<boolean>("runner.middleware.task.cache.hit"),
} as const;

export const cacheResource = defineFrameworkResource({
  id: "runner.cache",
  configSchema: cacheResourceConfigPattern,
  register: (config: CacheResourceConfig) => [
    config?.provider ?? cacheProviderResource,
  ],
  dependencies: (config: CacheResourceConfig) => ({
    cacheProvider: extractResourceAndConfig(
      config?.provider ?? cacheProviderResource,
    ).resource,
  }),
  init: async (config: CacheResourceConfig, { cacheProvider }) => {
    if (typeof cacheProvider !== "function") {
      validationError.throw({
        subject: "Cache provider",
        id: "runner.cache",
        originalError:
          "Cache provider resource must initialize to a function: (options) => provider instance.",
      });
    }

    if (
      config?.totalBudgetBytes &&
      !supportsTaskScopedCacheProvider(cacheProvider)
    ) {
      validationError.throw({
        subject: "Cache provider",
        id: "runner.cache",
        originalError:
          "Global cache budgets require a provider with task-scoped cache support. Remove totalBudgetBytes or use the default cache provider.",
      });
    }

    const sharedBudget = config?.totalBudgetBytes
      ? createSharedCacheBudgetState(config.totalBudgetBytes)
      : undefined;

    return {
      map: new Map<string, ICacheProvider>(),
      pendingCreates: new Map<string, Promise<ICacheProvider>>(),
      cacheProvider,
      totalBudgetBytes: config?.totalBudgetBytes,
      sharedBudget,
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
    cache.sharedBudget?.entries.clear();
    cache.sharedBudget?.localCaches.clear();
    if (cache.sharedBudget) {
      cache.sharedBudget.totalBytesUsed = 0;
    }
  },
});

const defaultKeyBuilder = (taskId: string, input: unknown) =>
  `${taskId}-${safeStringify(input)}`;

function assertCacheProviderInstance(
  provider: unknown,
  sourceId: string,
): asserts provider is ICacheProvider {
  const shape = provider as Partial<ICacheProvider> | null;
  if (
    shape === null ||
    typeof shape !== "object" ||
    typeof shape.get !== "function" ||
    typeof shape.set !== "function" ||
    typeof shape.clear !== "function" ||
    ("has" in shape &&
      shape.has !== undefined &&
      typeof shape.has !== "function")
  ) {
    validationError.throw({
      subject: "Cache provider",
      id: sourceId,
      originalError:
        "Cache provider must return an object with get(key), set(key, value), clear(), and optional has(key).",
    });
  }
}

function createCacheInstance({
  cache,
  cacheOptions,
  taskId,
}: {
  cache: {
    cacheProvider: CacheProvider;
    sharedBudget?: SharedCacheBudgetState;
  };
  cacheOptions: CacheFactoryOptions;
  taskId: string;
}) {
  if (supportsTaskScopedCacheProvider(cache.cacheProvider)) {
    return createTaskScopedCacheInstance(cache.cacheProvider, {
      taskId,
      options: cacheOptions,
      totalBudgetBytes: cache.sharedBudget?.totalBudgetBytes,
      sharedBudget: cache.sharedBudget,
    }).then((instance: ICacheProvider) => {
      assertCacheProviderInstance(instance, cacheProviderResource.id);
      return instance;
    });
  }

  return cache.cacheProvider(cacheOptions).then((instance: ICacheProvider) => {
    assertCacheProviderInstance(instance, cacheProviderResource.id);
    return instance;
  });
}

export const cacheMiddleware = defineFrameworkTaskMiddleware({
  id: "runner.middleware.task.cache",
  configSchema: cacheMiddlewareConfigPattern,
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
        const createPromise = createCacheInstance({
          cache,
          cacheOptions,
          taskId,
        })
          .then((instance: ICacheProvider) => {
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
