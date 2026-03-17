import {
  createDefaultCacheProvider,
  createSharedCacheBudgetState,
  type CacheFactoryOptions,
  type CacheProvider,
  type CacheProviderInput,
  type CacheRef,
  type ICacheProvider,
  type SharedCacheBudgetState,
  isBuiltInCacheProvider,
} from "./cache.shared";
import { defineResource } from "../../definers/defineResource";
import {
  type IResource,
  type IResourceWithConfig,
  type RegisterableItem,
} from "../../defs";
import { extractResourceAndConfig } from "../../tools/extractResourceAndConfig";
import { Match } from "../../tools/check";
import { validationError } from "../../errors";
import {
  cacheMiddleware,
  resolveCacheMiddlewareConfig,
} from "./cache.middleware";
import { isResource, isResourceWithConfig } from "../../define";
import { storeResource } from "../resources/store.resource";
import { loggerResource } from "../resources/logger.resource";
import { normalizeCacheRefs, toStableTaskId } from "./cache.key";
import { applyTenantScopeToKey } from "./tenantScope.shared";
import type { TenantScopeConfig } from "./tenantScope.shared";
import type { Store } from "../../models/Store";
import { MiddlewareResolver } from "../../models/middleware/MiddlewareResolver";
import { getSubtreeMiddlewareDuplicateKey } from "../../tools/subtreeMiddleware";

export type {
  CacheEntryMetadata,
  CacheFactoryOptions,
  CacheProvider,
  CacheProviderInput,
  CacheRef,
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

export type CacheProviderResource =
  | CacheProviderResourceDefinition
  | IResourceWithConfig<any, Promise<CacheProvider>, any, any, any, any, any>;

export interface CacheResourceConfig {
  defaultOptions?: CacheFactoryOptions;
  provider?: CacheProviderResource;
  totalBudgetBytes?: number;
}

/**
 * Runtime value exposed by `resources.cache`.
 */
export interface CacheResourceValue {
  /** Active task-scoped cache instances for the current runtime. */
  map: Map<string, ICacheProvider>;
  /** In-flight provider creations keyed by stable task id. */
  pendingCreates: Map<string, Promise<ICacheProvider>>;
  /** Factory used to create task-scoped cache providers. */
  cacheProvider: CacheProvider;
  /** Optional shared budget enabled for built-in in-memory providers. */
  totalBudgetBytes?: number;
  /** Shared in-memory budget bookkeeping for built-in providers. */
  sharedBudget?: SharedCacheBudgetState;
  /** Default inherited cache options for task-scoped providers. */
  defaultOptions: CacheFactoryOptions;
  /** Delete cache entries indexed by one or more semantic refs. */
  invalidateRefs(refs: CacheRef | readonly CacheRef[]): Promise<number>;
}

type CacheInvalidationTarget = {
  cacheOptions: CacheFactoryOptions;
  taskId: string;
  tenantScope: TenantScopeConfig | undefined;
};

const cacheFactoryOptionsPattern = Match.Where(
  (value: unknown): value is CacheFactoryOptions =>
    value !== null && typeof value === "object",
);

const cacheProviderResourcePattern = Match.Where(
  (value: unknown): value is CacheProviderResource =>
    isResource(value) || isResourceWithConfig(value),
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

export const cacheProviderResource: CacheProviderResourceDefinition =
  defineResource<void, Promise<CacheProvider>>({
    id: "cacheProvider",
    init: async () => createDefaultCacheProvider(),
  });

export const cacheResource = defineResource<
  CacheResourceConfig,
  Promise<CacheResourceValue>,
  {
    cacheProvider: typeof cacheProviderResource;
    logger: ReturnType<typeof loggerResource.optional>;
    store: typeof storeResource;
  }
>({
  id: "cache",
  configSchema: cacheResourceConfigPattern,
  // we cast it to :RegisterableItems[] because cacheMiddleware uses cacheResource
  register: (config): RegisterableItem[] => {
    return [config.provider ?? cacheProviderResource, cacheMiddleware];
  },
  dependencies: (config: CacheResourceConfig) => {
    if (config.provider) {
      const { resource } = extractResourceAndConfig(config.provider);
      return {
        cacheProvider: resource,
        logger: loggerResource.optional(),
        store: storeResource,
      };
    }

    return {
      cacheProvider: cacheProviderResource,
      logger: loggerResource.optional(),
      store: storeResource,
    };
  },
  init: async (
    config: CacheResourceConfig,
    { cacheProvider, logger, store },
  ) => {
    if (typeof cacheProvider !== "function") {
      validationError.throw({
        subject: "Cache provider",
        id: "cache",
        originalError:
          "Cache provider resource must initialize to a function: ({ taskId, options }) => provider instance.",
      });
    }

    const sharedBudget = config?.totalBudgetBytes
      ? createSharedCacheBudgetState(config.totalBudgetBytes)
      : undefined;
    const defaultOptions: CacheFactoryOptions = {
      ttl: 10 * 1000,
      max: 100,
      ttlAutopurge: true,
      ...(config?.defaultOptions ?? {}),
    };

    const cacheValue: CacheResourceValue = {
      map: new Map<string, ICacheProvider>(),
      pendingCreates: new Map<string, Promise<ICacheProvider>>(),
      cacheProvider,
      totalBudgetBytes: config?.totalBudgetBytes,
      sharedBudget,
      defaultOptions,
      invalidateRefs: async (refs) => {
        const baseRefs = normalizeCacheRefs(refs);

        if (baseRefs.length === 0) {
          return 0;
        }

        const cacheTargets = getCacheEnabledTaskIds(store, defaultOptions);
        let deletedCount = 0;

        for (const target of cacheTargets) {
          const scopedRefs = baseRefs.map((ref) =>
            applyTenantScopeToKey(ref, target.tenantScope),
          );
          try {
            const cacheInstance = await getCacheInstanceForInvalidation(
              cacheValue,
              target,
            );

            if (!cacheInstance) {
              continue;
            }

            deletedCount += await cacheInstance.invalidateRefs(scopedRefs);
          } catch (error) {
            // Ref invalidation is a best-effort fan-out across task-local
            // caches. One broken provider must not stop other targets from
            // cleaning up the same semantic ref set.
            logger?.error(
              "Cache ref invalidation failed for one cache target; continuing.",
              {
                source: "cache",
                data: {
                  refs: scopedRefs,
                  taskId: target.taskId,
                },
                error:
                  error instanceof Error ? error : new Error(String(error)),
              },
            );
          }
        }

        return deletedCount;
      },
    };

    return cacheValue;
  },
  dispose: async (cache) => {
    cache.pendingCreates?.clear();
    cache.sharedBudget?.entries.clear();
    cache.sharedBudget?.localCaches.clear();
    if (cache.sharedBudget) {
      cache.sharedBudget.totalBytesUsed = 0;
    }
  },
});

export function createCacheInstance({
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
  const input: CacheProviderInput = {
    taskId,
    options: cacheOptions,
    totalBudgetBytes: cache.sharedBudget?.totalBudgetBytes,
    sharedBudget: cache.sharedBudget,
  };

  return cache.cacheProvider(input);
}

async function getCacheInstanceForInvalidation(
  cache: CacheResourceValue,
  target: CacheInvalidationTarget,
) {
  const existing = cache.map.get(target.taskId);

  if (existing) {
    return existing;
  }

  const pendingCreate = cache.pendingCreates.get(target.taskId);
  if (pendingCreate) {
    // Concurrent invalidations can ask for the same transient provider before
    // the first creation resolves. Reuse the in-flight promise so we do not
    // create duplicate disposable cache instances for one task.
    return pendingCreate;
  }

  if (isBuiltInCacheProvider(cache.cacheProvider)) {
    return undefined;
  }

  // Custom providers may need to participate in invalidation even before the
  // task ever ran. Store the transient instance in the same map as normal task
  // caches so later invalidations and teardown can reuse it consistently.
  const createPromise = Promise.resolve(
    createCacheInstance({
      cache,
      cacheOptions: target.cacheOptions,
      taskId: target.taskId,
    }),
  )
    .then((instance) => {
      cache.map.set(target.taskId, instance);
      return instance;
    })
    .finally(() => {
      cache.pendingCreates.delete(target.taskId);
    });

  cache.pendingCreates.set(target.taskId, createPromise);
  return createPromise;
}

function getCacheEnabledTaskIds(
  store: Store,
  defaultOptions: CacheFactoryOptions,
): CacheInvalidationTarget[] {
  const taskTargets = new Map<string, CacheInvalidationTarget>();
  const middlewareResolver = new MiddlewareResolver(store);

  for (const { task } of store.tasks.values()) {
    const cacheAttachment = middlewareResolver
      .getApplicableTaskMiddlewares(task)
      .find(
        (middleware) =>
          getSubtreeMiddlewareDuplicateKey(middleware.id) ===
          cacheMiddleware.id,
      );

    if (!cacheAttachment) {
      continue;
    }

    const taskId = toStableTaskId(task.id);
    const resolvedConfig = resolveCacheMiddlewareConfig(
      cacheAttachment.config,
      defaultOptions,
    );

    taskTargets.set(taskId, {
      cacheOptions: resolvedConfig.cacheOptions,
      taskId,
      tenantScope: resolvedConfig.tenantScope,
    });
  }

  return [...taskTargets.values()];
}
