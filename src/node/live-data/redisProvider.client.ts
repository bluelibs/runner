import { createIORedisClient } from "../durable/optionalDeps/ioredis";
import type {
  RedisLiveDataClient,
  RedisLiveDataProviderOptions,
} from "./redisProvider.types";

export function resolveRedisPublisher(
  redis: RedisLiveDataProviderOptions["redis"],
): unknown {
  return typeof redis === "string" || redis === undefined
    ? createIORedisClient(redis)
    : redis;
}

export async function closeRedisClients(
  subscriber: RedisLiveDataClient,
  ownedPublisher?: RedisLiveDataClient,
): Promise<void> {
  const clients = ownedPublisher ? [subscriber, ownedPublisher] : [subscriber];
  const results = await Promise.allSettled(
    clients.map((client) => Promise.resolve().then(() => client.quit())),
  );
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure) throw failure.reason;
}
