import { validationError } from "../../../errors";
import type { Logger } from "../../../models/Logger";
import { normalizeCacheKeys, normalizeCacheRefs } from "./key";
import {
  applyIdentityScopeToKey,
  isIdentityScopeConfig,
  type IdentityScopeConfig,
} from "../identityScope.shared";
import {
  type CacheFactoryOptions,
  type CacheKey,
  type CacheProvider,
  type CacheRef,
  type ICacheProvider,
  type SharedCacheBudgetState,
  isBuiltInCacheProvider,
} from "./shared";

export interface CacheInvalidateKeysOptions {
  /**
   * Optionally scope the provided base keys through the active identity
   * namespace before invalidation. Omit to invalidate the raw keys exactly as
   * provided.
   */
  identityScope?: IdentityScopeConfig;
}

export type CacheInvalidationTarget = {
  cacheOptions: CacheFactoryOptions;
  taskId: string;
};

type CacheInvalidationCacheState = {
  map: Map<string, ICacheProvider>;
  pendingCreates: Map<string, Promise<ICacheProvider>>;
  cacheProvider: CacheProvider;
  sharedBudget?: SharedCacheBudgetState;
};

export class CacheInvalidationCoordinator {
  constructor(
    private readonly config: {
      cache: CacheInvalidationCacheState;
      createCacheInstance: (
        target: CacheInvalidationTarget,
      ) => Promise<ICacheProvider>;
      getTargets: () => CacheInvalidationTarget[];
      logger?: Logger;
      readIdentity: () => unknown;
    },
  ) {}

  async invalidateKeys(
    keys: CacheKey | readonly CacheKey[],
    options?: CacheInvalidateKeysOptions,
  ): Promise<number> {
    const baseKeys = normalizeCacheKeys(keys);

    if (baseKeys.length === 0) {
      return 0;
    }

    const resolvedKeys = this.resolveInvalidateKeysInput(baseKeys, options);

    return this.invalidateAcrossTargets({
      kind: "key",
      payload: { keys: resolvedKeys },
      invalidate: (cacheInstance) => cacheInstance.invalidateKeys(resolvedKeys),
    });
  }

  async invalidateRefs(refs: CacheRef | readonly CacheRef[]): Promise<number> {
    const baseRefs = normalizeCacheRefs(refs);

    if (baseRefs.length === 0) {
      return 0;
    }

    return this.invalidateAcrossTargets({
      kind: "ref",
      payload: { refs: baseRefs },
      invalidate: (cacheInstance) => cacheInstance.invalidateRefs(baseRefs),
    });
  }

  private async invalidateAcrossTargets({
    kind,
    payload,
    invalidate,
  }: {
    kind: "key" | "ref";
    payload: { keys: readonly CacheKey[] } | { refs: readonly CacheRef[] };
    invalidate: (
      cacheInstance: ICacheProvider,
      taskId: string,
    ) => Promise<number> | number;
  }): Promise<number> {
    const cacheTargets = this.config.getTargets();
    let deletedCount = 0;

    for (const target of cacheTargets) {
      try {
        const cacheInstance =
          await this.getCacheInstanceForInvalidation(target);

        if (!cacheInstance) {
          continue;
        }

        deletedCount += await invalidate(cacheInstance, target.taskId);
      } catch (error) {
        if (validationError.is(error)) {
          throw error;
        }
        this.logInvalidationFailure(kind, target.taskId, payload, error);
      }
    }

    return deletedCount;
  }

  private async getCacheInstanceForInvalidation(
    target: CacheInvalidationTarget,
  ): Promise<ICacheProvider | undefined> {
    const { cache } = this.config;
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
    // task ever ran. Store the transient instance in the same map as normal
    // task caches so later invalidations and teardown can reuse it consistently.
    const createPromise = this.config
      .createCacheInstance(target)
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

  private resolveInvalidateKeysInput(
    keys: readonly CacheKey[],
    options: CacheInvalidateKeysOptions | undefined,
  ): readonly CacheKey[] {
    if (options?.identityScope === undefined) {
      return keys;
    }

    if (!isIdentityScopeConfig(options.identityScope)) {
      validationError.throw({
        subject: "Cache invalidateKeys options",
        id: "cache",
        originalError:
          "invalidateKeys(..., options) requires identityScope to be a valid IdentityScopeConfig when provided.",
      });
    }

    return keys.map((key) =>
      applyIdentityScopeToKey(
        key,
        options.identityScope,
        this.config.readIdentity,
      ),
    );
  }

  private logInvalidationFailure(
    kind: "key" | "ref",
    taskId: string,
    payload: { keys: readonly CacheKey[] } | { refs: readonly CacheRef[] },
    error: unknown,
  ) {
    const message =
      kind === "key"
        ? "Cache key invalidation failed for one cache target; continuing."
        : "Cache ref invalidation failed for one cache target; continuing.";

    this.config.logger?.error(message, {
      source: "cache",
      data: {
        ...payload,
        taskId,
      },
      error: error instanceof Error ? error : new Error(String(error)),
    });
  }
}
