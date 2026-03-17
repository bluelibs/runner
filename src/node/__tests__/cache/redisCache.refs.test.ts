import { RedisCache } from "../../cache";
import type { SerializerLike } from "../../../serializer";

class FakeRedis {
  private readonly hashes = new Map<string, Map<string, string>>();
  private readonly sets = new Map<string, Set<string>>();
  private readonly strings = new Map<string, string>();
  private readonly zsets = new Map<string, Map<string, number>>();

  async del(...keys: string[]) {
    for (const key of keys) {
      this.strings.delete(key);
      this.hashes.delete(key);
      this.sets.delete(key);
      this.zsets.delete(key);
    }

    return keys.length;
  }

  async exists(key: string) {
    return this.strings.has(key) ? 1 : 0;
  }

  async get(key: string) {
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

  async set(key: string, value: string) {
    this.strings.set(key, value);
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

  async zrange(key: string) {
    return [...(this.zsets.get(key) ?? new Map<string, number>()).keys()];
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
}

const serializer: SerializerLike = {
  parse: <T = unknown>(payload: string) => JSON.parse(payload) as T,
  stringify: (value: unknown) => JSON.stringify(value),
};

describe("RedisCache ref bookkeeping", () => {
  it("cleans the evicted entry from its own task ref set during shared-budget eviction", async () => {
    const redis = new FakeRedis();
    const firstCache = new RedisCache({
      options: {
        maxSize: 10,
        sizeCalculation: (value) => String(value).length,
      },
      prefix: "tests:redis:shared-ref-cleanup",
      redis,
      serializer,
      taskId: "tests-redis-ref-cleanup-first",
      totalBudgetBytes: 4,
    });
    const secondCache = new RedisCache({
      options: {
        maxSize: 10,
        sizeCalculation: (value) => String(value).length,
      },
      prefix: "tests:redis:shared-ref-cleanup",
      redis,
      serializer,
      taskId: "tests-redis-ref-cleanup-second",
      totalBudgetBytes: 4,
    });

    await firstCache.set("a", "AAAA", { refs: ["user:1"] });
    const firstRefKey = (firstCache as any).getRefMembersKey("user:1");
    expect(await redis.smembers(firstRefKey)).toHaveLength(1);

    await secondCache.set("b", "BBBB", { refs: ["user:2"] });

    expect(await redis.smembers(firstRefKey)).toEqual([]);
    await expect(firstCache.invalidateRefs(["user:1"])).resolves.toBe(0);
  });
});
