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
        invalidateRefs: () => 0,
      })),
    ).toBe(false);

    const defaultCache = await provider({
      taskId: "task",
      options: { max: 1 },
    });

    expect(typeof defaultCache.get).toBe("function");
    expect(typeof defaultCache.set).toBe("function");
    expect(typeof defaultCache.invalidateRefs).toBe("function");
  });

  it("invalidates ref-indexed entries and keeps plain entries untouched", async () => {
    const provider = createDefaultCacheProvider();
    const cache = await provider({
      taskId: "task",
      options: { max: 10 },
    });

    await cache.set("user:1:full", "A", { refs: ["user:1"] });
    await cache.set("user:1:summary", "B", { refs: ["user:1"] });
    await cache.set("user:2:full", "C", { refs: ["user:2"] });
    await cache.set("plain", "D");

    expect(cache.invalidateRefs(["user:1"])).toBe(2);
    expect(cache.has?.("user:1:full")).toBe(false);
    expect(cache.has?.("user:1:summary")).toBe(false);
    expect(cache.has?.("user:2:full")).toBe(true);
    expect(cache.has?.("plain")).toBe(true);
  });

  it("updates ref bindings when overwriting an existing key", async () => {
    const provider = createDefaultCacheProvider();
    const cache = await provider({
      taskId: "task",
      options: { max: 10 },
    });

    await cache.set("same-key", "A", { refs: ["user:1"] });
    await cache.set("same-key", "B", { refs: ["user:2"] });

    expect(cache.invalidateRefs(["user:1"])).toBe(0);
    expect(cache.invalidateRefs(["user:2"])).toBe(1);
  });

  it("updates ref bindings on overwrite even when noDisposeOnSet is enabled", async () => {
    const provider = createDefaultCacheProvider();
    const cache = await provider({
      taskId: "task",
      options: { max: 10, noDisposeOnSet: true },
    });

    await cache.set("same-key", "A", { refs: ["user:1"] });
    await cache.set("same-key", "B", { refs: ["user:2"] });

    expect(cache.invalidateRefs(["user:1"])).toBe(0);
    expect(cache.invalidateRefs(["user:2"])).toBe(1);
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

  it("supports maxSize caches without a custom sizeCalculation", () => {
    const sharedBudget = createSharedCacheBudgetState(100);
    expect(() =>
      createBudgetedCacheInstance({
        taskId: "max-size-default-size-task",
        options: {
          maxSize: 10,
        },
        sharedBudget,
      }),
    ).not.toThrow();
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

  it("drops ref bindings when shared-budget eviction removes an entry", () => {
    const sharedBudget = createSharedCacheBudgetState(4);
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

    firstCache.set("first", "AAAA", { refs: ["user:1"] });
    secondCache.set("second", "BBBB", { refs: ["user:2"] });

    expect(firstCache.has?.("first")).toBe(false);
    expect(secondCache.has?.("second")).toBe(true);
    expect(firstCache.invalidateRefs(["user:1"])).toBe(0);
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
    undeletableState.localCaches.set(
      "task",
      new LRUCache<string, { value: {}; refs: readonly string[] }>({
        max: 1,
      }),
    );

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

  it("tolerates unlinking refs that are no longer indexed", () => {
    const refIndex = cacheSharedInternals.createCacheRefIndexState();

    cacheSharedInternals.linkCacheRefs(refIndex, "key", ["user:1"]);
    refIndex.keysByRef.delete("user:1");
    cacheSharedInternals.unlinkCacheRefs(refIndex, "key", ["user:1"]);

    expect(refIndex.refsByKey.has("key")).toBe(false);
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
