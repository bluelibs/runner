import {
  createDefaultCacheProvider,
  createSharedCacheBudgetState,
  type CacheFactoryOptions,
  type CacheKey,
  type CacheProvider,
  type CacheProviderInput,
  type CacheRef,
  type ICacheProvider,
  type SharedCacheBudgetState,
} from "./shared";
import { defineResource } from "../../../definers/defineResource";
import {
  type IResource,
  type IResourceWithConfig,
  type RegisterableItem,
} from "../../../defs";
import { extractResourceAndConfig } from "../../../tools/extractResourceAndConfig";
import { Match } from "../../../tools/check";
import type { ValidationSchemaInput } from "../../../types/utilities";
import { validationError } from "../../../errors";
import { cacheMiddleware, resolveCacheMiddlewareConfig } from "./middleware";
import {
  CacheInvalidationCoordinator,
  type CacheInvalidateKeysOptions,
  type CacheInvalidationTarget,
} from "./invalidationCoordinator";
import { isResource, isResourceWithConfig } from "../../../define";
import { storeResource } from "../../resources/store.resource";
import { identityContextResource } from "../../resources/identityContext.resource";
import { loggerResource } from "../../resources/logger.resource";
import type { Store } from "../../../models/store/Store";
import { MiddlewareResolver } from "../../../models/middleware/MiddlewareResolver";
import { getSubtreeMiddlewareDuplicateKey } from "../../../tools/subtreeMiddleware";

export type {
  CacheEntryMetadata,
  CacheFactoryOptions,
  CacheKey,
  CacheProvider,
  CacheProviderInput,
  CacheRef,
  ICacheProvider,
} from "./shared";
export type { CacheInvalidateKeysOptions } from "./invalidationCoordinator";

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
  /** Delete cache entries by concrete storage key returned by keyBuilder(...). */
  invalidateKeys(
    keys: CacheKey | readonly CacheKey[],
    options?: CacheInvalidateKeysOptions,
  ): Promise<number>;
  /** Delete cache entries indexed by one or more semantic refs. */
  invalidateRefs(refs: CacheRef | readonly CacheRef[]): Promise<number>;
}

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

const cacheResourceConfigPattern: ValidationSchemaInput<CacheResourceConfig> =
  Match.ObjectIncluding({
    defaultOptions: Match.Optional(cacheFactoryOptionsPattern),
    provider: Match.Optional(cacheProviderResourcePattern),
    totalBudgetBytes: Match.Optional(totalBudgetBytesPattern),
  });

export const cacheProviderResource: CacheProviderResourceDefinition =
  defineResource<void, Promise<CacheProvider>>({
    id: "cacheProvider",
    meta: {
      title: "Default Cache Provider",
      description:
        "Creates in-memory task-scoped cache providers when the cache resource is not configured with a custom provider.",
    },
    init: async () => createDefaultCacheProvider(),
  });

export const cacheResource = defineResource<
  CacheResourceConfig,
  Promise<CacheResourceValue>,
  {
    cacheProvider: typeof cacheProviderResource;
    identityContext: typeof identityContextResource;
    logger: ReturnType<typeof loggerResource.optional>;
    store: typeof storeResource;
  }
>({
  id: "cache",
  meta: {
    title: "Task Cache Registry",
    description:
      "Owns task-scoped cache instances, default cache options, and ref-based invalidation helpers for the built-in cache middleware.",
  },
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
        identityContext: identityContextResource,
        logger: loggerResource.optional(),
        store: storeResource,
      };
    }

    return {
      cacheProvider: cacheProviderResource,
      identityContext: identityContextResource,
      logger: loggerResource.optional(),
      store: storeResource,
    };
  },
  init: async (
    config: CacheResourceConfig,
    { cacheProvider, identityContext, logger, store },
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

    const cacheState = {
      map: new Map<string, ICacheProvider>(),
      pendingCreates: new Map<string, Promise<ICacheProvider>>(),
      cacheProvider,
      totalBudgetBytes: config?.totalBudgetBytes,
      sharedBudget,
      defaultOptions,
    };
    const invalidationCoordinator = new CacheInvalidationCoordinator({
      cache: cacheState,
      createCacheInstance: (target) =>
        Promise.resolve(
          createCacheInstance({
            cache: cacheState,
            cacheOptions: target.cacheOptions,
            taskId: target.taskId,
          }),
        ),
      getTargets: () => getCacheEnabledTaskIds(store, defaultOptions),
      logger,
      readIdentity: identityContext.tryUse,
    });
    const cacheValue: CacheResourceValue = {
      ...cacheState,
      invalidateKeys: (keys, options) =>
        invalidationCoordinator.invalidateKeys(keys, options),
      invalidateRefs: (refs) => invalidationCoordinator.invalidateRefs(refs),
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

  return Promise.resolve(cache.cacheProvider(input)).then((instance) =>
    validateCacheProviderInstance(instance, taskId),
  );
}

function validateCacheProviderInstance(
  cacheInstance: ICacheProvider,
  taskId: string,
): ICacheProvider {
  assertCacheProviderMethod(cacheInstance, taskId, "get");
  assertCacheProviderMethod(cacheInstance, taskId, "set");
  assertCacheProviderMethod(cacheInstance, taskId, "clear");
  assertCacheProviderMethod(cacheInstance, taskId, "invalidateKeys");
  assertCacheProviderMethod(cacheInstance, taskId, "invalidateRefs");

  if (
    cacheInstance.has !== undefined &&
    typeof cacheInstance.has !== "function"
  ) {
    validationError.throw({
      subject: "Cache provider",
      id: "cache",
      originalError: `Cache provider instance for task "${taskId}" must implement optional has(key) as a function when provided.`,
    });
  }

  return cacheInstance;
}

function assertCacheProviderMethod(
  cacheInstance: ICacheProvider,
  taskId: string,
  methodName: "get" | "set" | "clear" | "invalidateKeys" | "invalidateRefs",
): void {
  if (typeof cacheInstance[methodName] === "function") {
    return;
  }

  validationError.throw({
    subject: "Cache provider",
    id: "cache",
    originalError: `Cache provider instance for task "${taskId}" must implement ${methodName}(...) as a function.`,
  });
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

    const taskId = task.id;
    const resolvedConfig = resolveCacheMiddlewareConfig(
      cacheAttachment.config,
      defaultOptions,
    );

    taskTargets.set(taskId, {
      cacheOptions: resolvedConfig.cacheOptions,
      taskId,
    });
  }

  return [...taskTargets.values()];
}
