import { defineTaskMiddleware } from "../../../definers/defineTaskMiddleware";
import { journal as journalHelper } from "../../../models/ExecutionJournal";
import { Match } from "../../../tools/check";
import type { ExecutionJournal } from "../../../types/executionJournal";
import type { ValidationSchemaInput } from "../../../types/utilities";
import { loggerResource } from "../../resources/logger.resource";
import { identityContextResource } from "../../resources/identityContext.resource";
import { globalTags } from "../../globalTags";
import {
  normalizeCacheRefs,
  normalizeCacheKeyBuilderResult,
  type CacheKeyBuilderResult,
} from "./key";
import { defaultTaskKeyBuilder } from "../keyBuilder.shared";
import {
  applyIdentityScopeToKey,
  identityScopePattern,
  type IdentityScopedMiddlewareConfig,
} from "../identityScope.shared";
import { journalKeys as retryJournalKeys } from "../retry.middleware";
import {
  cacheResource,
  createCacheInstance,
  type CacheRef,
  type CacheFactoryOptions,
} from "./resource";

export {
  cacheProviderResource,
  cacheResource,
  createCacheInstance,
} from "./resource";
export type {
  CacheInvalidateKeysOptions,
  CacheEntryMetadata,
  CacheFactoryOptions,
  CacheKey,
  CacheProvider,
  CacheProviderInput,
  CacheProviderResource,
  CacheResourceConfig,
  CacheResourceValue,
  CacheRef,
  ICacheProvider,
} from "./resource";
export type { CacheKeyBuilderResult } from "./key";

/**
 * Journal-scoped collector exposed during active cache misses so task code can
 * attach semantic refs discovered during execution.
 */
export interface CacheRefCollector {
  /** Adds one or more semantic refs to the active cache-miss collector. */
  add(refs: CacheRef | readonly CacheRef[]): void;
}

type CacheMiddlewareConfig = CacheFactoryOptions &
  IdentityScopedMiddlewareConfig & {
    keyBuilder?: (taskId: string, input: any) => CacheKeyBuilderResult;
  };

type ResolvedCacheMiddlewareConfig = {
  cacheOptions: CacheFactoryOptions;
  keyBuilder: (taskId: string, input: any) => CacheKeyBuilderResult;
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
  /** Collector available during active cache misses for late ref attachment. */
  refs: journalHelper.createKey<CacheRefCollector | undefined>(
    "runner.middleware.task.cache.refs",
  ),
} as const;

function resolveRetryAttempt(journal: ExecutionJournal): number {
  const attempt = journal.get(retryJournalKeys.attempt);

  return typeof attempt === "number" &&
    Number.isInteger(attempt) &&
    attempt >= 0
    ? attempt
    : 0;
}

function createCacheRefCollector(journal: ExecutionJournal) {
  const refsByAttempt = new Map<number, Set<CacheRef>>();
  const collector: CacheRefCollector = {
    add(refs) {
      const attempt = resolveRetryAttempt(journal);
      let refsForAttempt = refsByAttempt.get(attempt);

      if (!refsForAttempt) {
        refsForAttempt = new Set<CacheRef>();
        refsByAttempt.set(attempt, refsForAttempt);
      }

      for (const ref of normalizeCacheRefs(refs)) {
        refsForAttempt.add(ref);
      }
    },
  };

  return {
    collector,
    getRefs() {
      return [...(refsByAttempt.get(resolveRetryAttempt(journal)) ?? [])];
    },
  };
}

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

    const taskId = task!.definition.id;
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
    // Apply identity scope from the normalized config, not the raw attachment.
    // The resolver owns defaulting ("auto") and keeps cache key + refs aligned
    // with the exact policy used for the provider instance itself.
    const key = applyIdentityScopeToKey(
      cacheKey.cacheKey,
      resolvedConfig.identityScope,
      identityContext?.tryUse,
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
    const previousCollectorExists = journal.has(journalKeys.refs);
    const previousCollector = journal.get(journalKeys.refs);
    const cacheRefCollector = createCacheRefCollector(journal);
    journal.set(journalKeys.refs, cacheRefCollector.collector, {
      override: true,
    });

    try {
      const result = await next(task!.input);
      const refs = normalizeCacheRefs([
        ...cacheKey.refs,
        ...cacheRefCollector.getRefs(),
      ]);

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
    } finally {
      if (previousCollectorExists) {
        journal.set(journalKeys.refs, previousCollector, { override: true });
      } else if (typeof journal.delete === "function") {
        journal.delete(journalKeys.refs);
      } else {
        journal.set(journalKeys.refs, undefined as never, { override: true });
      }
    }
  },
});
