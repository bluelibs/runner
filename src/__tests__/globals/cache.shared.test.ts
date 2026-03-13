import { LRUCache } from "lru-cache";
import {
  cacheSharedInternals,
  createBudgetedCacheInstance,
  createDefaultCacheProvider,
  createSharedCacheBudgetState,
  isBuiltInCacheProvider,
} from "../../globals/middleware/cache.shared";

describe("cache.shared", () => {
  it("marks the built-in provider and creates task-scoped caches", async () => {
    const provider = createDefaultCacheProvider();

    expect(isBuiltInCacheProvider(provider)).toBe(true);
    expect(
      isBuiltInCacheProvider(async () => ({
        get: () => undefined,
        set: () => undefined,
        clear: () => undefined,
      })),
    ).toBe(false);

    const defaultCache = await provider({
      taskId: "task",
      options: { max: 1 },
    });

    expect(defaultCache).toBeInstanceOf(LRUCache);
  });

  it("does not track entries rejected by local cache size rules", () => {
    const sharedBudget = createSharedCacheBudgetState(100);
    const cache = createBudgetedCacheInstance({
      taskId: "budgeted-task",
      options: {
        max: 10,
        maxEntrySize: 1,
        sizeCalculation: () => 2,
      },
      sharedBudget,
    });

    cache.set("key", "value");

    expect(cache.has?.("key")).toBe(false);
    expect(sharedBudget.totalBytesUsed).toBe(0);
  });

  it("keeps cleared task caches enrolled in shared budget enforcement", () => {
    const sharedBudget = createSharedCacheBudgetState(10);
    const firstCache = createBudgetedCacheInstance({
      taskId: "first-task",
      options: {
        max: 10,
        sizeCalculation: (value) => String(value).length,
      },
      sharedBudget,
    });
    const secondCache = createBudgetedCacheInstance({
      taskId: "second-task",
      options: {
        max: 10,
        sizeCalculation: (value) => String(value).length,
      },
      sharedBudget,
    });

    firstCache.set("first", "AAAA");
    expect(sharedBudget.localCaches.has("first-task")).toBe(true);

    firstCache.clear();
    expect(sharedBudget.localCaches.has("first-task")).toBe(true);
    expect(sharedBudget.totalBytesUsed).toBe(0);

    firstCache.set("first", "AAAA");
    secondCache.set("second", "BBBB");
    secondCache.set("third", "CCCC");

    expect(firstCache.has?.("first")).toBe(false);
    expect(secondCache.has?.("second")).toBe(true);
    expect(secondCache.has?.("third")).toBe(true);
    expect(sharedBudget.totalBytesUsed).toBe(8);
  });

  it("covers the shared budget enforcement edge cases", () => {
    const emptyState = createSharedCacheBudgetState(1);
    emptyState.totalBytesUsed = 5;

    cacheSharedInternals.enforceTotalBudget(emptyState);
    expect(emptyState.totalBytesUsed).toBe(0);

    const missingCacheState = createSharedCacheBudgetState(1);
    missingCacheState.totalBytesUsed = 5;
    missingCacheState.entries.set("missing\u0000key", {
      taskId: "missing",
      key: "key",
      size: 5,
      order: 1,
    });

    cacheSharedInternals.enforceTotalBudget(missingCacheState);
    expect(missingCacheState.entries.size).toBe(0);
    expect(missingCacheState.totalBytesUsed).toBe(0);

    const undeletableState = createSharedCacheBudgetState(1);
    undeletableState.totalBytesUsed = 5;
    undeletableState.entries.set("task\u0000key", {
      taskId: "task",
      key: "key",
      size: 5,
      order: 1,
    });
    undeletableState.localCaches.set("task", new LRUCache({ max: 1 }));

    cacheSharedInternals.enforceTotalBudget(undeletableState);
    expect(undeletableState.entries.size).toBe(0);
    expect(undeletableState.totalBytesUsed).toBe(0);
  });

  it("updates tracked entry sizes and handles missing entries idempotently", () => {
    const sharedBudget = createSharedCacheBudgetState(20);

    cacheSharedInternals.touchBudgetEntry(sharedBudget, "task", "missing");
    cacheSharedInternals.removeBudgetEntry(sharedBudget, "task", "missing");
    expect(sharedBudget.totalBytesUsed).toBe(0);

    cacheSharedInternals.upsertBudgetEntry(sharedBudget, "task", "key", 4);
    const originalOrder = sharedBudget.entries.get("task\u0000key")?.order ?? 0;

    cacheSharedInternals.upsertBudgetEntry(sharedBudget, "task", "key", 7);
    expect(sharedBudget.totalBytesUsed).toBe(7);

    cacheSharedInternals.touchBudgetEntry(sharedBudget, "task", "key");
    expect(sharedBudget.entries.get("task\u0000key")?.order).toBeGreaterThan(
      originalOrder,
    );

    cacheSharedInternals.upsertBudgetEntry(sharedBudget, "other", "key", 3);
    cacheSharedInternals.removeBudgetEntriesForTask(sharedBudget, "task");
    expect(sharedBudget.entries.has("task\u0000key")).toBe(false);
    expect(sharedBudget.entries.has("other\u0000key")).toBe(true);

    cacheSharedInternals.removeBudgetEntry(sharedBudget, "task", "key");
    cacheSharedInternals.removeBudgetEntry(sharedBudget, "other", "key");
    expect(sharedBudget.totalBytesUsed).toBe(0);
  });

  it("falls back when TextEncoder is unavailable and rejects invalid sizes", () => {
    const originalTextEncoder = globalThis.TextEncoder;
    const originalBuffer = globalThis.Buffer;

    try {
      expect(cacheSharedInternals.computeEntrySize({}, "k", "value")).toBe(9);

      expect(
        cacheSharedInternals.computeEntrySize(
          { sizeCalculation: () => 5 },
          "k",
          "value",
        ),
      ).toBe(5);

      Object.defineProperty(globalThis, "TextEncoder", {
        value: undefined,
        configurable: true,
        writable: true,
      });

      expect(cacheSharedInternals.computeEntrySize({}, "k", "value")).toBe(9);

      Object.defineProperty(globalThis, "Buffer", {
        value: undefined,
        configurable: true,
        writable: true,
      });

      expect(cacheSharedInternals.computeEntrySize({}, "k", "value")).toBe(9);

      expect(() =>
        cacheSharedInternals.computeEntrySize(
          { sizeCalculation: () => Number.NaN },
          "k",
          "value",
        ),
      ).toThrow(/finite non-negative number/i);
    } finally {
      Object.defineProperty(globalThis, "TextEncoder", {
        value: originalTextEncoder,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, "Buffer", {
        value: originalBuffer,
        configurable: true,
        writable: true,
      });
    }
  });
});
