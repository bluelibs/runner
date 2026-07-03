import { RedisCache } from "../../cache";
import type { SerializerLike } from "../../../serializer";

class FakeRedis {
  private readonly expirations = new Map<string, number>();
  private readonly hashes = new Map<string, Map<string, string>>();
  private readonly sets = new Map<string, Set<string>>();
  private readonly strings = new Map<string, string>();
  private readonly zsets = new Map<string, Map<string, number>>();
  public delCalls: string[][] = [];
  public hdelCalls: Array<{ fields: string[]; key: string }> = [];
  public hmgetCalls: Array<{ fields: string[]; key: string }> = [];
  public sremCalls: Array<{ key: string; members: string[] }> = [];
  public zremCalls: Array<{ key: string; members: string[] }> = [];

  async del(...keys: string[]) {
    this.delCalls.push(keys);
    for (const key of keys) {
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
    this.hdelCalls.push({ fields, key });
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

  async hmget(key: string, ...fields: string[]) {
    this.hmgetCalls.push({ fields, key });
    return fields.map((field) => this.hashes.get(key)?.get(field) ?? null);
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
    this.strings.set(key, value);
    this.expirations.delete(key);

    if (args[0] === "PX" && typeof args[1] === "number") {
      this.expirations.set(key, Date.now() + args[1]);
    }

    return "OK";
  }

  async setex(key: string, seconds: number, value: string) {
    this.strings.set(key, value);
    this.expirations.set(key, Date.now() + seconds * 1000);
    return "OK";
  }

  async smembers(key: string) {
    return [...(this.sets.get(key) ?? new Set<string>())];
  }

  async srem(key: string, ...members: string[]) {
    this.sremCalls.push({ key, members });
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
    this.zremCalls.push({ key, members });
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

describe("RedisCache invalidateKeys", () => {
  it("invalidates exact keys and removes their ref bindings", async () => {
    const redis = new FakeRedis();
    const cache = new RedisCache({
      options: {},
      prefix: "tests:redis:invalidate-keys",
      redis,
      serializer,
      taskId: "tests-redis-invalidate-keys",
    });

    await cache.set("user-full", "A", { refs: ["user:1"] });
    await cache.set("user-summary", "B", { refs: ["user:1"] });
    await cache.set("plain", "C");

    const removedEntryIds = ["user-full", "plain"].map((key) =>
      (cache as any).createEntryId(key),
    );
    const removedDataKeys = removedEntryIds.map((entryId) =>
      (cache as any).getEntryDataKey(entryId),
    );

    await expect(
      cache.invalidateKeys(["user-full", "plain", "plain"]),
    ).resolves.toBe(2);
    expect(redis.hmgetCalls.slice(-2)).toEqual([
      { key: (cache as any).entryRefsKey, fields: removedEntryIds },
      { key: (cache as any).entrySizesKey, fields: removedEntryIds },
    ]);
    expect(redis.delCalls).toContainEqual(removedDataKeys);
    expect(redis.hdelCalls).toContainEqual({
      key: (cache as any).entryRefsKey,
      fields: removedEntryIds,
    });
    expect(redis.hdelCalls).toContainEqual({
      key: (cache as any).entrySizesKey,
      fields: removedEntryIds,
    });
    expect(redis.zremCalls).toContainEqual({
      key: (cache as any).globalLruKey,
      members: removedEntryIds,
    });
    expect(redis.zremCalls).toContainEqual({
      key: (cache as any).taskLruKey,
      members: removedEntryIds,
    });
    expect(redis.sremCalls).toContainEqual({
      key: (cache as any).taskMembersKey,
      members: removedEntryIds,
    });

    await expect(cache.has("user-full")).resolves.toBe(false);
    await expect(cache.has("plain")).resolves.toBe(false);
    await expect(cache.has("user-summary")).resolves.toBe(true);
    await expect(cache.invalidateRefs(["user:1"])).resolves.toBe(1);
  });
});
