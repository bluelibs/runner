import { defineTaskMiddleware } from "../../definers/defineTaskMiddleware";
import { journal as journalHelper } from "../../models/ExecutionJournal";
import { safeStringify } from "../../models/utils/safeStringify";
import { Match } from "../../tools/check";
import { loggerResource } from "../resources/logger.resource";
import {
  normalizeCacheKeyBuilderResult,
  toStableTaskId,
  type CacheKeyBuilderResult,
} from "./cache.key";
import {
  applyTenantScopeToKey,
  tenantScopePattern,
  type TenantScopedMiddlewareConfig,
} from "./tenantScope.shared";
import {
  cacheResource,
  createCacheInstance,
  type CacheFactoryOptions,
} from "./cache.resource";

export {
  cacheProviderResource,
  cacheResource,
  createCacheInstance,
} from "./cache.resource";
export type {
  CacheEntryMetadata,
  CacheFactoryOptions,
  CacheProvider,
  CacheProviderInput,
  CacheProviderResource,
  CacheResourceConfig,
  CacheResourceValue,
  CacheRef,
  ICacheProvider,
} from "./cache.resource";
export type { CacheKeyBuilderResult } from "./cache.key";

type CacheMiddlewareConfig = CacheFactoryOptions &
  TenantScopedMiddlewareConfig & {
    keyBuilder?: (taskId: string, input: any) => CacheKeyBuilderResult;
  };

type ResolvedCacheMiddlewareConfig = {
  cacheOptions: CacheFactoryOptions;
  keyBuilder: (taskId: string, input: any) => CacheKeyBuilderResult;
};

const cacheMiddlewareConfigPattern = Match.ObjectIncluding({
  keyBuilder: Match.Optional(Function),
  tenantScope: tenantScopePattern,
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

const defaultKeyBuilder = (taskId: string, input: unknown): string =>
  `${taskId}-${safeStringify(input)}`;

export function resolveCacheMiddlewareConfig(
  config: CacheMiddlewareConfig | undefined,
  defaultOptions: CacheFactoryOptions,
): ResolvedCacheMiddlewareConfig {
  const mergedConfig: CacheMiddlewareConfig = {
    keyBuilder: defaultKeyBuilder,
    ttl: 10 * 1000,
    max: 100,
    ttlAutopurge: true,
    ...config,
  };
  const { keyBuilder, tenantScope, ...cacheOptions } = mergedConfig;

  return {
    keyBuilder: keyBuilder ?? defaultKeyBuilder,
    cacheOptions: {
      ...defaultOptions,
      ...cacheOptions,
    },
  };
}

export const cacheMiddleware = defineTaskMiddleware({
  id: "cache",
  configSchema: cacheMiddlewareConfigPattern,
  dependencies: () => ({
    cache: cacheResource,
    logger: loggerResource.optional(),
  }),
  async run({ task, next, journal }, deps, config: CacheMiddlewareConfig) {
    const { cache, logger } = deps;
    const resolvedConfig = resolveCacheMiddlewareConfig(
      config,
      cache.defaultOptions,
    );

    const taskId = toStableTaskId(task!.definition.id);
    let cacheHolderForTask = cache.map.get(taskId)!;
    if (!cacheHolderForTask) {
      const pendingCreate = cache.pendingCreates.get(taskId);

      if (pendingCreate) {
        cacheHolderForTask = await pendingCreate;
      } else {
        const createPromise = createCacheInstance({
          cache,
          cacheOptions: resolvedConfig.cacheOptions,
          taskId,
        })
          .then((instance) => {
            cache.map.set(taskId, instance);
            return instance;
          })
          .finally(() => {
            cache.pendingCreates.delete(taskId);
          });
        cache.pendingCreates.set(taskId, createPromise);
        cacheHolderForTask = await createPromise;
      }
    }

    const cacheKey = normalizeCacheKeyBuilderResult(
      resolvedConfig.keyBuilder(taskId, task!.input),
    );
    const key = applyTenantScopeToKey(cacheKey.cacheKey, config.tenantScope);
    const refs = cacheKey.refs.map((ref) =>
      applyTenantScopeToKey(ref, config.tenantScope),
    );

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
      await cacheHolderForTask.set(key, result, { refs });
    } catch (error) {
      await logger?.error(
        "Cache middleware write failed; returning fresh result.",
        {
          taskId,
          data: { key, refs },
          error: error instanceof Error ? error : new Error(String(error)),
        },
      );
    }

    return result;
  },
});
