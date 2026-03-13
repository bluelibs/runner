import { LRUCache } from "lru-cache";
import { safeStringify } from "../../models/utils/safeStringify";

export interface ICacheProvider {
  set(key: string, value: unknown): unknown | Promise<unknown>;
  get(key: string): unknown | Promise<unknown>;
  clear(): void | Promise<void>;
  has?(key: string): boolean | Promise<boolean>;
}

export type CacheStoredValue = NonNullable<unknown>;
export type CacheFactoryOptions = Partial<
  LRUCache.Options<string, CacheStoredValue, unknown>
>;

/**
 * Context passed to each cache provider instance factory.
 * Providers always create a cache instance for one task at a time.
 */
export type CacheProviderInput = {
  /** Canonical task id for the cache instance being created. */
  taskId: string;
  /** Effective cache options after resource and middleware defaults are merged. */
  options: CacheFactoryOptions;
  /** Shared budget passed through when the runtime enables cache-wide byte limits. */
  totalBudgetBytes?: number;
  /** Shared in-memory budget state used by the built-in provider. */
  sharedBudget?: SharedCacheBudgetState;
};

/**
 * Creates the cache instance used by one task.
 */
export type CacheProvider = (
  input: CacheProviderInput,
) => Promise<ICacheProvider>;

type BuiltInCacheProvider = CacheProvider & {
  [builtInCacheProviderSymbol]: true;
};

type BudgetEntry = {
  taskId: string;
  key: string;
  size: number;
  order: number;
};

export type SharedCacheBudgetState = {
  totalBudgetBytes: number;
  totalBytesUsed: number;
  touchOrder: number;
  entries: Map<string, BudgetEntry>;
  localCaches: Map<string, LRUCache<string, CacheStoredValue, unknown>>;
};

const builtInCacheProviderSymbol = Symbol("runner.builtInCacheProvider");

export function createDefaultCacheProvider(): CacheProvider {
  return Object.assign(
    async ({
      options,
      sharedBudget,
      taskId,
    }: CacheProviderInput): Promise<ICacheProvider> => {
      if (sharedBudget) {
        return createBudgetedCacheInstance({
          taskId,
          options,
          sharedBudget,
        });
      }

      return new LRUCache<string, CacheStoredValue, unknown>(
        options as LRUCache.Options<string, CacheStoredValue, unknown>,
      );
    },
    {
      [builtInCacheProviderSymbol]: true as const,
    },
  ) as BuiltInCacheProvider;
}

export function isBuiltInCacheProvider(
  value: unknown,
): value is BuiltInCacheProvider {
  return (
    typeof value === "function" &&
    (value as Partial<BuiltInCacheProvider>)[builtInCacheProviderSymbol] ===
      true
  );
}

export function createSharedCacheBudgetState(
  totalBudgetBytes: number,
): SharedCacheBudgetState {
  return {
    totalBudgetBytes,
    totalBytesUsed: 0,
    touchOrder: 0,
    entries: new Map<string, BudgetEntry>(),
    localCaches: new Map<string, LRUCache<string, CacheStoredValue, unknown>>(),
  };
}

export function createBudgetedCacheInstance({
  taskId,
  options,
  sharedBudget,
}: {
  taskId: string;
  options: CacheFactoryOptions;
  sharedBudget: SharedCacheBudgetState;
}): ICacheProvider {
  const localCache = createLocalCache(taskId, options, sharedBudget);
  sharedBudget.localCaches.set(taskId, localCache);

  return {
    get(key: string) {
      const value = localCache.get(key);

      if (value !== undefined || localCache.has(key)) {
        touchBudgetEntry(sharedBudget, taskId, key);
      }

      return value;
    },
    set(key: string, value: unknown) {
      localCache.set(key, value as CacheStoredValue);

      if (!localCache.has(key)) {
        return;
      }

      upsertBudgetEntry(
        sharedBudget,
        taskId,
        key,
        computeEntrySize(options, key, value),
      );
      enforceTotalBudget(sharedBudget);
    },
    clear() {
      localCache.clear();
      removeBudgetEntriesForTask(sharedBudget, taskId);
    },
    has(key: string) {
      const present = localCache.has(key);

      if (present) {
        touchBudgetEntry(sharedBudget, taskId, key);
      }

      return present;
    },
  };
}

function createLocalCache(
  taskId: string,
  options: CacheFactoryOptions,
  sharedBudget: SharedCacheBudgetState,
) {
  const { disposeAfter, sizeCalculation, ...rest } = options;
  const localSizeCalculation =
    rest.maxSize || rest.maxEntrySize ? sizeCalculation : undefined;

  return new LRUCache<string, CacheStoredValue, unknown>({
    ...(rest as LRUCache.Options<string, CacheStoredValue, unknown>),
    sizeCalculation: localSizeCalculation,
    disposeAfter: (value, key, reason) => {
      removeBudgetEntry(sharedBudget, taskId, key);
      disposeAfter?.(value, key, reason);
    },
  });
}

function enforceTotalBudget(sharedBudget: SharedCacheBudgetState) {
  if (sharedBudget.totalBytesUsed <= sharedBudget.totalBudgetBytes) {
    return;
  }

  for (const localCache of sharedBudget.localCaches.values()) {
    localCache.purgeStale();
  }

  while (sharedBudget.totalBytesUsed > sharedBudget.totalBudgetBytes) {
    const oldest = findOldestBudgetEntry(sharedBudget.entries);

    if (!oldest) {
      sharedBudget.totalBytesUsed = 0;
      return;
    }

    const localCache = sharedBudget.localCaches.get(oldest.taskId);

    if (!localCache) {
      removeBudgetEntry(sharedBudget, oldest.taskId, oldest.key);
      continue;
    }

    const deleted = localCache.delete(oldest.key);

    if (!deleted) {
      removeBudgetEntry(sharedBudget, oldest.taskId, oldest.key);
    }
  }
}

function findOldestBudgetEntry(entries: Map<string, BudgetEntry>) {
  let oldest: BudgetEntry | undefined;

  for (const entry of entries.values()) {
    if (!oldest || entry.order < oldest.order) {
      oldest = entry;
    }
  }

  return oldest;
}

function upsertBudgetEntry(
  sharedBudget: SharedCacheBudgetState,
  taskId: string,
  key: string,
  size: number,
) {
  const entryId = getBudgetEntryId(taskId, key);
  const current = sharedBudget.entries.get(entryId);

  if (current) {
    sharedBudget.totalBytesUsed -= current.size;
  }

  const entry: BudgetEntry = {
    taskId,
    key,
    size,
    order: nextTouchOrder(sharedBudget),
  };

  sharedBudget.entries.set(entryId, entry);
  sharedBudget.totalBytesUsed += size;
}

function touchBudgetEntry(
  sharedBudget: SharedCacheBudgetState,
  taskId: string,
  key: string,
) {
  const entry = sharedBudget.entries.get(getBudgetEntryId(taskId, key));

  if (!entry) {
    return;
  }

  entry.order = nextTouchOrder(sharedBudget);
}

function removeBudgetEntry(
  sharedBudget: SharedCacheBudgetState,
  taskId: string,
  key: string,
) {
  const entryId = getBudgetEntryId(taskId, key);
  const entry = sharedBudget.entries.get(entryId);

  if (!entry) {
    return;
  }

  sharedBudget.entries.delete(entryId);
  sharedBudget.totalBytesUsed = Math.max(
    0,
    sharedBudget.totalBytesUsed - entry.size,
  );
}

function removeBudgetEntriesForTask(
  sharedBudget: SharedCacheBudgetState,
  taskId: string,
) {
  for (const entry of [...sharedBudget.entries.values()]) {
    if (entry.taskId === taskId) {
      removeBudgetEntry(sharedBudget, taskId, entry.key);
    }
  }
}

function getBudgetEntryId(taskId: string, key: string) {
  return `${taskId}\u0000${key}`;
}

function nextTouchOrder(sharedBudget: SharedCacheBudgetState) {
  sharedBudget.touchOrder += 1;
  return sharedBudget.touchOrder;
}

export function computeEntrySize(
  options: CacheFactoryOptions,
  key: string,
  value: unknown,
) {
  const calculated = options.sizeCalculation
    ? options.sizeCalculation(value as CacheStoredValue, key)
    : getUtf8ByteLength(`${key}:${safeStringify(value)}`);

  if (!Number.isFinite(calculated) || calculated < 0) {
    throw new TypeError(
      "Cache size calculation must return a finite non-negative number.",
    );
  }

  return calculated;
}

function getUtf8ByteLength(value: string) {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value).length;
  }

  if (typeof Buffer !== "undefined") {
    return Buffer.byteLength(value, "utf8");
  }

  return encodeURIComponent(value).replace(/%[A-F\d]{2}/gi, "x").length;
}

export const cacheSharedInternals = {
  computeEntrySize,
  enforceTotalBudget,
  removeBudgetEntry,
  removeBudgetEntriesForTask,
  touchBudgetEntry,
  upsertBudgetEntry,
};
