import { randomUUID } from "node:crypto";
import { validationError } from "../../errors";
import {
  createTaskScopedCacheProvider,
  type CacheProvider,
  type CacheFactoryOptions,
} from "../../globals/middleware/cache.shared";
import { Match } from "../../tools/check";
import { r, resources } from "../../index";
import { createIORedisClient } from "../durable/optionalDeps/ioredis";
import { RedisCache, type RedisCacheClient } from "./redisCache";

export interface RedisCacheProviderConfig {
  prefix?: string;
  redis?: RedisCacheClient | string;
}

export interface RedisCacheProviderContext {
  ownsRedisClient: boolean;
  redis: RedisCacheClient | null;
}

const redisConfigPattern = Match.Where(
  (value: unknown): value is RedisCacheProviderConfig["redis"] =>
    value === undefined ||
    typeof value === "string" ||
    isRedisCacheClient(value),
);

const redisCacheProviderConfigPattern = Match.ObjectIncluding({
  prefix: Match.Optional(String),
  redis: Match.Optional(redisConfigPattern),
});

export const redisCacheProviderResource = r
  .resource<RedisCacheProviderConfig>("base-cache-provider-redis")
  .dependencies({ serializer: resources.serializer })
  .context<RedisCacheProviderContext>(() => ({
    ownsRedisClient: false,
    redis: null,
  }))
  .configSchema(redisCacheProviderConfigPattern)
  .init(async function (
    this: { id: string },
    config,
    { serializer },
    ctx,
  ): Promise<CacheProvider> {
    const redis = resolveRedisClient(config.redis);
    const prefix = config.prefix ?? `runner:cache:${randomUUID()}`;

    if (!isRedisCacheClient(redis)) {
      validationError.throw({
        subject: "Redis cache provider",
        id: this.id,
        originalError:
          "Redis cache provider requires a compatible redis client or a redis connection string.",
      });
    }

    ctx.redis = redis;
    ctx.ownsRedisClient =
      config.redis === undefined || typeof config.redis === "string";

    const provider: CacheProvider = async (options: CacheFactoryOptions) =>
      new RedisCache({
        options,
        prefix,
        redis,
        serializer,
        taskId: `cache:${randomUUID()}`,
      });

    return createTaskScopedCacheProvider(
      provider,
      async (input) =>
        new RedisCache({
          options: input.options,
          prefix,
          redis,
          serializer,
          taskId: input.taskId,
          totalBudgetBytes: input.totalBudgetBytes,
        }),
    );
  })
  .dispose(async (_provider, _config, _deps, ctx) => {
    if (!ctx.ownsRedisClient || !ctx.redis?.quit) {
      return;
    }

    await ctx.redis.quit();
  })
  .build();

function resolveRedisClient(redis: RedisCacheProviderConfig["redis"]) {
  if (typeof redis === "string" || redis === undefined) {
    return createIORedisClient(redis) as RedisCacheClient;
  }

  return redis;
}

function isRedisCacheClient(value: unknown): value is RedisCacheClient {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<RedisCacheClient>).del === "function" &&
    typeof (value as Partial<RedisCacheClient>).exists === "function" &&
    typeof (value as Partial<RedisCacheClient>).get === "function" &&
    typeof (value as Partial<RedisCacheClient>).hdel === "function" &&
    typeof (value as Partial<RedisCacheClient>).hget === "function" &&
    typeof (value as Partial<RedisCacheClient>).hset === "function" &&
    typeof (value as Partial<RedisCacheClient>).incrby === "function" &&
    typeof (value as Partial<RedisCacheClient>).sadd === "function" &&
    typeof (value as Partial<RedisCacheClient>).set === "function" &&
    typeof (value as Partial<RedisCacheClient>).smembers === "function" &&
    typeof (value as Partial<RedisCacheClient>).srem === "function" &&
    typeof (value as Partial<RedisCacheClient>).zadd === "function" &&
    typeof (value as Partial<RedisCacheClient>).zrange === "function" &&
    typeof (value as Partial<RedisCacheClient>).zrem === "function"
  );
}
