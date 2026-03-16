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
import { isSameDefinition } from "../../tools/isSameDefinition";
import { normalizeCacheRefs, toStableTaskId } from "./cache.key";
import { applyTenantScopeToKey } from "./tenantScope.shared";
import type { TenantScopeConfig } from "./tenantScope.shared";
import type { Store } from "../../models/Store";

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
      return { cacheProvider: resource, store: storeResource };
    }

    return {
      cacheProvider: cacheProviderResource,
      store: storeResource,
    };
  },
  init: async (config: CacheResourceConfig, { cacheProvider, store }) => {
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
    const cacheTargets = getCacheEnabledTaskIds(store, defaultOptions);

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

        let deletedCount = 0;

        for (const target of cacheTargets) {
          const scopedRefs = baseRefs.map((ref) =>
            applyTenantScopeToKey(ref, target.tenantScope),
          );
          const cacheInstance = await getCacheInstanceForInvalidation(
            cacheValue,
            target,
          );

          if (!cacheInstance) {
            continue;
          }

          deletedCount += await cacheInstance.invalidateRefs(scopedRefs);
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

  if (isBuiltInCacheProvider(cache.cacheProvider)) {
    return undefined;
  }

  return createCacheInstance({
    cache,
    cacheOptions: target.cacheOptions,
    taskId: target.taskId,
  });
}

function getCacheEnabledTaskIds(
  store: Store,
  defaultOptions: CacheFactoryOptions,
): CacheInvalidationTarget[] {
  const taskTargets = new Map<string, CacheInvalidationTarget>();

  for (const { task } of store.tasks.values()) {
    const cacheAttachment = task.middleware.find((middleware) =>
      isSameDefinition(middleware, cacheMiddleware),
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
      tenantScope: cacheAttachment.config?.tenantScope,
    });
  }

  return [...taskTargets.values()];
}
