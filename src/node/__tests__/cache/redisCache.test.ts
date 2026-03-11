import { RedisCache } from "../../cache";
import type { SerializerLike } from "../../../serializer";

class FakeRedis {
  private readonly expirations = new Map<string, number>();
  private readonly hashes = new Map<string, Map<string, string>>();
  private readonly sets = new Map<string, Set<string>>();
  private readonly strings = new Map<string, string>();
  private readonly zsets = new Map<string, Map<string, number>>();
  public setCalls: Array<Array<string | number>> = [];
  public setexCalls: Array<[string, number, string]> = [];

  async del(...keys: string[]) {
    for (const key of keys) {
      this.deleteExpired(key);
      this.strings.delete(key);
      this.hashes.delete(key);
      this.sets.delete(key);
      this.zsets.delete(key);
      this.expirations.delete(key);
    }

    return keys.length;
  }

  async exists(key: string) {
    this.deleteExpired(key);
    return this.strings.has(key) ? 1 : 0;
  }

  async get(key: string) {
    this.deleteExpired(key);
    return this.strings.get(key) ?? null;
  }

  async hdel(key: string, ...fields: string[]) {
    const hash = this.hashes.get(key);
    if (!hash) {
      return 0;
    }

    for (const field of fields) {
      hash.delete(field);
    }

    if (hash.size === 0) {
      this.hashes.delete(key);
    }

    return fields.length;
  }

  async hget(key: string, field: string) {
    return this.hashes.get(key)?.get(field) ?? null;
  }

  async hset(key: string, field: string, value: string) {
    const hash = this.hashes.get(key) ?? new Map<string, string>();
    hash.set(field, value);
    this.hashes.set(key, hash);
    return 1;
  }

  async incrby(key: string, increment: number) {
    const current = Number.parseInt(this.strings.get(key) ?? "0", 10);
    const nextValue = current + increment;
    this.strings.set(key, String(nextValue));
    return nextValue;
  }

  async sadd(key: string, ...members: string[]) {
    const set = this.sets.get(key) ?? new Set<string>();
    for (const member of members) {
      set.add(member);
    }
    this.sets.set(key, set);
    return set.size;
  }

  async set(key: string, value: string, ...args: Array<string | number>) {
    this.setCalls.push([key, value, ...args]);
    this.strings.set(key, value);
    this.expirations.delete(key);

    if (args[0] === "PX" && typeof args[1] === "number") {
      this.expirations.set(key, Date.now() + args[1]);
    }

    return "OK";
  }

  async setex(key: string, seconds: number, value: string) {
    this.setexCalls.push([key, seconds, value]);
    this.strings.set(key, value);
    this.expirations.set(key, Date.now() + seconds * 1000);
    return "OK";
  }

  async smembers(key: string) {
    return [...(this.sets.get(key) ?? new Set<string>())];
  }

  async srem(key: string, ...members: string[]) {
    const set = this.sets.get(key);
    if (!set) {
      return 0;
    }

    for (const member of members) {
      set.delete(member);
    }

    if (set.size === 0) {
      this.sets.delete(key);
    }

    return members.length;
  }

  async zadd(key: string, score: number, member: string) {
    const zset = this.zsets.get(key) ?? new Map<string, number>();
    zset.set(member, score);
    this.zsets.set(key, zset);
    return 1;
  }

  async zrange(key: string, start: number, stop: number) {
    const sorted = [
      ...(this.zsets.get(key) ?? new Map<string, number>()).entries(),
    ]
      .sort(
        (left, right) => left[1] - right[1] || left[0].localeCompare(right[0]),
      )
      .map(([member]) => member);
    const normalizedStop = stop < 0 ? sorted.length + stop : stop;
    return sorted.slice(start, normalizedStop + 1);
  }

  async zrem(key: string, ...members: string[]) {
    const zset = this.zsets.get(key);
    if (!zset) {
      return 0;
    }

    for (const member of members) {
      zset.delete(member);
    }

    if (zset.size === 0) {
      this.zsets.delete(key);
    }

    return members.length;
  }

  private deleteExpired(key: string) {
    const expiresAt = this.expirations.get(key);
    if (expiresAt === undefined || Date.now() <= expiresAt) {
      return;
    }

    this.strings.delete(key);
    this.expirations.delete(key);
  }
}

const serializer: SerializerLike = {
  parse: <T = unknown>(payload: string) => JSON.parse(payload) as T,
  stringify: (value: unknown) => JSON.stringify(value),
};

describe("RedisCache", () => {
  it("skips oversized entries and supports both ttl write paths", async () => {
    const oversizedRedis = new FakeRedis();
    const oversizedCache = new RedisCache({
      options: { maxEntrySize: 1 },
      prefix: "tests:redis:oversized",
      redis: oversizedRedis,
      serializer,
      taskId: "tests-redis-oversized",
    });

    await oversizedCache.set("key", "value");
    await expect(oversizedCache.has("key")).resolves.toBe(false);

    const setexRedis = new FakeRedis();
    const setexCache = new RedisCache({
      options: { ttl: 1_200 },
      prefix: "tests:redis:setex",
      redis: setexRedis,
      serializer,
      taskId: "tests-redis-setex",
    });

    await setexCache.set("key", "value");
    expect(setexRedis.setexCalls).toHaveLength(1);

    const pxRedis = new FakeRedis();
    (pxRedis as { setex?: unknown }).setex = undefined;
    const pxCache = new RedisCache({
      options: { ttl: 500 },
      prefix: "tests:redis:px",
      redis: pxRedis,
      serializer,
      taskId: "tests-redis-px",
    });

    await pxCache.set("key", "value");
    expect(
      pxRedis.setCalls.some((call) => call[2] === "PX" && call[3] === 500),
    ).toBe(true);
  });

  it("enforces task limits and shared global budgets", async () => {
    const redis = new FakeRedis();
    const taskMaxFallbackCache = new RedisCache({
      options: { max: 1 },
      prefix: "tests:redis:max-fallback",
      redis,
      serializer,
      taskId: "tests-redis-max-fallback",
    });
    const taskMaxCache = new RedisCache({
      options: { max: 1 },
      prefix: "tests:redis:max",
      redis,
      serializer,
      taskId: "tests-redis-max",
    });

    await taskMaxCache.set("a", "AAAAAA");
    await taskMaxCache.set("b", "BBBBBB");
    await expect(taskMaxCache.has("a")).resolves.toBe(false);
    await expect(taskMaxCache.has("b")).resolves.toBe(true);

    await redis.sadd(
      (taskMaxFallbackCache as any).taskMembersKey,
      "ghost-entry-a",
      "ghost-entry-b",
    );
    const originalTaskZRange = redis.zrange.bind(redis);
    redis.zrange = (async (key: string, start: number, stop: number) => {
      if (key === (taskMaxFallbackCache as any).taskLruKey) {
        return null;
      }

      return originalTaskZRange(key, start, stop);
    }) as any;
    await (taskMaxFallbackCache as any).enforceTaskMaxEntries();

    const taskBudgetCache = new RedisCache({
      options: { maxSize: 10 },
      prefix: "tests:redis:max-size-fallback",
      redis,
      serializer,
      taskId: "tests-redis-max-size-fallback",
    });

    await taskBudgetCache.set("a", "AAAAAA");
    await taskBudgetCache.set("b", "BBBBBB");
    await expect(taskBudgetCache.has("a")).resolves.toBe(false);
    await expect(taskBudgetCache.has("b")).resolves.toBe(true);

    await redis.set((taskBudgetCache as any).taskBytesKey, "nope");
    await (taskBudgetCache as any).enforceTaskMaxSize();

    await redis.set((taskBudgetCache as any).taskBytesKey, "11");
    redis.zrange = (async (key: string, start: number, stop: number) => {
      if (key === (taskBudgetCache as any).taskLruKey) {
        return null;
      }

      return originalTaskZRange(key, start, stop);
    }) as any;
    await (taskBudgetCache as any).enforceTaskMaxSize();
    expect(await redis.get((taskBudgetCache as any).taskBytesKey)).toBe("0");

    const firstCache = new RedisCache({
      options: {},
      prefix: "tests:redis:budget",
      redis,
      serializer,
      taskId: "tests-redis-budget-first",
      totalBudgetBytes: 15,
    });
    const secondCache = new RedisCache({
      options: {},
      prefix: "tests:redis:budget",
      redis,
      serializer,
      taskId: "tests-redis-budget-second",
      totalBudgetBytes: 15,
    });

    await firstCache.set("a", "AAAAAA");
    await secondCache.set("b", "BBBBBB");
    await expect(firstCache.has("a")).resolves.toBe(false);
    await expect(secondCache.has("b")).resolves.toBe(true);

    await redis.set((firstCache as any).globalBytesKey, "20");
    redis.zrange = (async (key: string, start: number, stop: number) => {
      if (key === (firstCache as any).globalLruKey) {
        return null;
      }

      return originalTaskZRange(key, start, stop);
    }) as any;
    await (firstCache as any).enforceTotalBudget();
    expect(await redis.get((firstCache as any).globalBytesKey)).toBe("0");
  });

  it("cleans stale bookkeeping and orphaned entries", async () => {
    const redis = new FakeRedis();
    const cache = new RedisCache({
      options: {},
      prefix: "tests:redis:cleanup",
      redis,
      serializer,
      taskId: "tests-redis-cleanup",
    });

    const stableSizeCache = new RedisCache({
      options: {},
      prefix: "tests:redis:stable-size",
      redis,
      serializer,
      taskId: "tests-redis-stable-size",
    });

    await stableSizeCache.set("key", "aaaaa");
    const stableTaskBytesBefore = await redis.get(
      (stableSizeCache as any).taskBytesKey,
    );
    await stableSizeCache.set("key", "bbbbb");
    expect(await redis.get((stableSizeCache as any).taskBytesKey)).toBe(
      stableTaskBytesBefore,
    );

    const populatedClearCache = new RedisCache({
      options: {},
      prefix: "tests:redis:clear-populated",
      redis,
      serializer,
      taskId: "tests-redis-clear-populated",
    });

    await populatedClearCache.set("clear-me", "value");
    await populatedClearCache.clear();
    await expect(populatedClearCache.has("clear-me")).resolves.toBe(false);
    expect(await redis.get((populatedClearCache as any).taskBytesKey)).toBe(
      null,
    );

    await cache.set("key", "value");
    const entryId = (cache as any).createEntryId("key");
    const dataKey = (cache as any).getEntryDataKey(entryId);
    await redis.del(dataKey);

    await expect(cache.get("key")).resolves.toBeUndefined();
    await expect(cache.has("key")).resolves.toBe(false);

    await redis.hset((cache as any).entrySizesKey, "orphaned", "3");
    await (cache as any).removeTrackedEntry("orphaned");
    expect(await redis.get((cache as any).globalBytesKey)).toBe("0");

    const nanRedis = new FakeRedis();
    nanRedis.incrby = async () => Number.NaN;
    const nanCache = new RedisCache({
      options: {},
      prefix: "tests:redis:nan",
      redis: nanRedis,
      serializer,
      taskId: "tests-redis-nan",
    });

    await (nanCache as any).adjustTrackedBytes("tests:redis:nan:bytes", 1);
    await (cache as any).clear();
  });
});
