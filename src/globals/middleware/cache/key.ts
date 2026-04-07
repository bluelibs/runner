import { validationError } from "../../../errors";

/**
 * Concrete cache storage key returned by `keyBuilder(...)`.
 */
export type CacheKey = string;

/**
 * Semantic cache reference used for cross-task invalidation.
 * Applications usually build these through small typed helpers such as
 * `CacheRefs.user(id)`.
 */
export type CacheRef = string;

/**
 * Optional metadata attached to a stored cache entry.
 */
export interface CacheEntryMetadata {
  /** Semantic refs that should invalidate this entry when deleted. */
  refs?: readonly CacheRef[];
}

/**
 * Structured cache key payload returned by `keyBuilder(...)`.
 */
export interface CacheKeyDescriptor {
  /** Concrete storage key used by the cache provider. */
  cacheKey: CacheKey;
  /** Optional semantic refs indexed for later invalidation. */
  refs?: readonly CacheRef[];
}

/**
 * Value returned by cache middleware key builders.
 *
 * - `string`: legacy/simple storage key
 * - `{ cacheKey, refs }`: storage key plus invalidation metadata
 */
export type CacheKeyBuilderResult = string | CacheKeyDescriptor;

/**
 * Normalized cache key payload used internally by cache middleware/providers.
 */
export interface NormalizedCacheKeyDescriptor {
  cacheKey: CacheKey;
  refs: readonly CacheRef[];
}

export function normalizeCacheKeys(
  keys: CacheKey | readonly CacheKey[] | undefined,
): readonly CacheKey[] {
  if (keys === undefined) {
    return [];
  }

  const values = Array.isArray(keys) ? keys : [keys];

  for (const key of values) {
    if (typeof key !== "string") {
      validationError.throw({
        subject: "Cache keys",
        id: "cache",
        originalError: `Cache keys must be strings. Received ${typeof key}.`,
      });
    }
  }

  return [...new Set(values)];
}

export function normalizeCacheRefs(
  refs: CacheRef | readonly CacheRef[] | undefined,
): readonly CacheRef[] {
  if (refs === undefined) {
    return [];
  }

  const values = Array.isArray(refs) ? refs : [refs];

  for (const ref of values) {
    if (typeof ref !== "string") {
      validationError.throw({
        subject: "Cache refs",
        id: "cache",
        originalError: `Cache refs must be strings. Received ${typeof ref}.`,
      });
    }
  }

  return [...new Set(values)];
}

export function normalizeCacheKeyBuilderResult(
  value: CacheKeyBuilderResult,
): NormalizedCacheKeyDescriptor {
  if (typeof value === "string") {
    return {
      cacheKey: value,
      refs: [],
    };
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (typeof value.cacheKey !== "string") {
      validationError.throw({
        subject: "Cache keyBuilder result",
        id: "cache",
        originalError:
          "Structured cache keyBuilder results must provide a string cacheKey.",
      });
    }

    return {
      cacheKey: value.cacheKey,
      refs: normalizeCacheRefs(value.refs),
    };
  }

  return validationError.throw({
    subject: "Cache keyBuilder result",
    id: "cache",
    originalError:
      "Cache keyBuilder must return a string or { cacheKey, refs? } object.",
  });
}
