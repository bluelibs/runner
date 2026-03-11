jest.mock("../../durable/optionalDeps/ioredis", () => ({
  createIORedisClient: jest.fn(() => createFakeRedisClient()),
}));

import { middleware, r, resources, run } from "../../node";
import { createIORedisClient } from "../../durable/optionalDeps/ioredis";
import { RedisCache, redisCacheProviderResource } from "../../cache";

class FakeRedis {
  private readonly expirations = new Map<string, number>();
  private readonly hashes = new Map<string, Map<string, string>>();
  private readonly sets = new Map<string, Set<string>>();
  private readonly strings = new Map<string, string>();
  private readonly zsets = new Map<string, Map<string, number>>();
  public quit = jest.fn(async () => "OK");

  async del(...keys: string[]) {
    let deleted = 0;

    for (const key of keys) {
      this.deleteExpired(key);
      deleted += Number(this.strings.delete(key));
      deleted += Number(this.hashes.delete(key));
      deleted += Number(this.sets.delete(key));
      deleted += Number(this.zsets.delete(key));
      this.expirations.delete(key);
    }

    return deleted;
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

    let deleted = 0;
    for (const field of fields) {
      deleted += Number(hash.delete(field));
    }

    if (hash.size === 0) {
      this.hashes.delete(key);
    }

    return deleted;
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
    let added = 0;

    for (const member of members) {
      if (!set.has(member)) {
        added += 1;
      }
      set.add(member);
    }

    this.sets.set(key, set);
    return added;
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
    const set = this.sets.get(key);
    if (!set) {
      return 0;
    }

    let removed = 0;
    for (const member of members) {
      removed += Number(set.delete(member));
    }

    if (set.size === 0) {
      this.sets.delete(key);
    }

    return removed;
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

    if (sorted.length === 0) {
      return [];
    }

    const normalizedStop = stop < 0 ? sorted.length + stop : stop;
    return sorted.slice(start, normalizedStop + 1);
  }

  async zrem(key: string, ...members: string[]) {
    const zset = this.zsets.get(key);
    if (!zset) {
      return 0;
    }

    let removed = 0;
    for (const member of members) {
      removed += Number(zset.delete(member));
    }

    if (zset.size === 0) {
      this.zsets.delete(key);
    }

    return removed;
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

function createFakeRedisClient() {
  return new FakeRedis();
}

describe("redis cache provider resource", () => {
  let persistentAppId = 0;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("validates redis clients and still exposes the base provider factory", async () => {
    const serializer = {
      parse: JSON.parse,
      stringify: JSON.stringify,
    };

    await expect(
      (redisCacheProviderResource as any).init.call(
        { id: "tests-redis-provider-invalid" },
        {
          prefix: "tests:redis-provider-invalid",
          redis: {} as unknown,
        },
        { serializer },
        { ownsRedisClient: false, redis: null },
      ),
    ).rejects.toThrow(/compatible redis client/i);

    const provider = await (redisCacheProviderResource as any).init.call(
      { id: "tests-redis-provider-factory" },
      {
        redis: createFakeRedisClient(),
      },
      { serializer },
      { ownsRedisClient: false, redis: null },
    );

    await expect(provider({ ttl: 1_000 })).resolves.toBeInstanceOf(RedisCache);
  });

  it("supports shared totalBudgetBytes across cached tasks", async () => {
    const redis = createFakeRedisClient();
    const hits = { first: 0, second: 0 };

    const firstTask = r
      .task("tests-redis-cache-first")
      .middleware([
        middleware.task.cache.with({
          keyBuilder: () => "a",
        }),
      ])
      .run(async () => {
        hits.first += 1;
        return "AAAAAAAAAA";
      })
      .build();

    const secondTask = r
      .task("tests-redis-cache-second")
      .middleware([
        middleware.task.cache.with({
          keyBuilder: () => "b",
        }),
      ])
      .run(async () => {
        hits.second += 1;
        return "BBBBBBBBBB";
      })
      .build();

    const app = r
      .resource("tests-redis-cache-app")
      .register([
        resources.cache.with({
          provider: resources.redisCacheProvider.with({
            prefix: "tests:redis-cache",
            redis,
          }),
          totalBudgetBytes: 20,
        }),
        middleware.task.cache,
        firstTask,
        secondTask,
      ])
      .dependencies({ firstTask, secondTask })
      .init(async (_config, { firstTask, secondTask }) => {
        await firstTask();
        await secondTask();
        await secondTask();
        await firstTask();
      })
      .build();

    const runtime = await run(app);

    try {
      expect(hits).toEqual({ first: 2, second: 1 });
    } finally {
      await runtime.dispose();
    }
  });

  it("keeps redis-backed cache entries across runtime disposal", async () => {
    const redis = createFakeRedisClient();
    let executionCount = 0;

    const cachedTask = r
      .task("tests-redis-cache-persistent")
      .middleware([middleware.task.cache])
      .run(async (input: string) => {
        executionCount += 1;
        return input.toUpperCase();
      })
      .build();

    const createApp = () =>
      r
        .resource(`tests-redis-cache-persistent-app-${++persistentAppId}`)
        .register([
          resources.cache.with({
            provider: resources.redisCacheProvider.with({
              prefix: "tests:redis-cache-persistent",
              redis,
            }),
          }),
          middleware.task.cache,
          cachedTask,
        ])
        .dependencies({ cachedTask })
        .init(async (_config, { cachedTask }) => {
          return cachedTask("value");
        })
        .build();

    const firstRuntime = await run(createApp());
    expect(firstRuntime.value).toBe("VALUE");
    await firstRuntime.dispose();

    const secondRuntime = await run(createApp());

    try {
      expect(secondRuntime.value).toBe("VALUE");
      expect(executionCount).toBe(1);
    } finally {
      await secondRuntime.dispose();
    }
  });

  it("uses the optional ioredis loader and disposes owned clients", async () => {
    const cachedTask = r
      .task("tests-redis-cache-loader")
      .middleware([middleware.task.cache])
      .run(async () => "value")
      .build();

    const app = r
      .resource("tests-redis-cache-loader-app")
      .register([
        resources.cache.with({
          provider: resources.redisCacheProvider.with({
            prefix: "tests:redis-cache-loader",
            redis: "redis://cache.local",
          }),
        }),
        middleware.task.cache,
        cachedTask,
      ])
      .dependencies({ cachedTask })
      .init(async (_config, { cachedTask }) => {
        await cachedTask();
      })
      .build();

    const runtime = await run(app);

    try {
      const createRedisClient = createIORedisClient as jest.MockedFunction<
        typeof createIORedisClient
      >;
      expect(createRedisClient).toHaveBeenCalledWith("redis://cache.local");

      const ownedClient = createRedisClient.mock.results[0]?.value as FakeRedis;
      expect(ownedClient.quit).toHaveBeenCalledTimes(0);
    } finally {
      await runtime.dispose();
    }

    const createRedisClient = createIORedisClient as jest.MockedFunction<
      typeof createIORedisClient
    >;
    const ownedClient = createRedisClient.mock.results[0]?.value as FakeRedis;
    expect(ownedClient.quit).toHaveBeenCalledTimes(1);
  });
});
