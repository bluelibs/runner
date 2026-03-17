import { defineTaskMiddleware } from "../../definers/defineTaskMiddleware";
import { journal as journalHelper } from "../../models/ExecutionJournal";
import { Match } from "../../tools/check";
import type { ValidationSchemaInput } from "../../types/utilities";
import { loggerResource } from "../resources/logger.resource";
import { identityContextResource } from "../resources/identityContext.resource";
import { globalTags } from "../globalTags";
import {
  normalizeCacheKeyBuilderResult,
  toStableTaskId,
  type CacheKeyBuilderResult,
} from "./cache.key";
import {
  createMiddlewareKeyBuilderHelpers,
  defaultTaskKeyBuilder,
} from "./keyBuilder.shared";
import {
  applyIdentityScopeToKey,
  identityScopePattern,
  type IdentityScopedMiddlewareConfig,
} from "./identityScope.shared";
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
  IdentityScopedMiddlewareConfig & {
    keyBuilder?: (
      taskId: string,
      input: any,
      helpers?: ReturnType<typeof createMiddlewareKeyBuilderHelpers>,
    ) => CacheKeyBuilderResult;
  };

type ResolvedCacheMiddlewareConfig = {
  cacheOptions: CacheFactoryOptions;
  keyBuilder: (
    taskId: string,
    input: any,
    helpers?: ReturnType<typeof createMiddlewareKeyBuilderHelpers>,
  ) => CacheKeyBuilderResult;
  identityScope: IdentityScopedMiddlewareConfig["identityScope"];
};

const cacheMiddlewareConfigPattern: ValidationSchemaInput<CacheMiddlewareConfig> =
  Match.ObjectIncluding({
    keyBuilder: Match.Optional(Function),
    identityScope: identityScopePattern,
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

export function resolveCacheMiddlewareConfig(
  config: CacheMiddlewareConfig | undefined,
  defaultOptions: CacheFactoryOptions,
): ResolvedCacheMiddlewareConfig {
  const mergedConfig: CacheMiddlewareConfig = {
    keyBuilder: defaultTaskKeyBuilder,
    ttl: 10 * 1000,
    max: 100,
    ttlAutopurge: true,
    ...config,
  };
  const { keyBuilder, identityScope, ...cacheOptions } = mergedConfig;

  return {
    keyBuilder: keyBuilder ?? defaultTaskKeyBuilder,
    cacheOptions: {
      ...defaultOptions,
      ...cacheOptions,
    },
    identityScope,
  };
}

export const cacheMiddleware = defineTaskMiddleware({
  id: "cache",
  tags: [globalTags.identityScoped],
  meta: {
    title: "Task Cache",
    description:
      "Caches task results by computed key and optional identity scope, reusing task-local providers from resources.cache.",
  },
  configSchema: cacheMiddlewareConfigPattern,
  dependencies: () => ({
    cache: cacheResource,
    logger: loggerResource.optional(),
    identityContext: identityContextResource,
  }),
  async run({ task, next, journal }, deps, config: CacheMiddlewareConfig) {
    const { cache, logger, identityContext } = deps;
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
      resolvedConfig.keyBuilder(
        taskId,
        task!.input,
        createMiddlewareKeyBuilderHelpers(taskId),
      ),
    );
    // Apply identity scope from the normalized config, not the raw attachment.
    // The resolver owns defaulting ("auto") and keeps cache key + refs aligned
    // with the exact policy used for the provider instance itself.
    const key = applyIdentityScopeToKey(
      cacheKey.cacheKey,
      resolvedConfig.identityScope,
      identityContext?.tryUse,
    );
    const refs = cacheKey.refs;

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
