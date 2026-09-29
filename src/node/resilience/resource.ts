import { resilienceResource as reference } from "../../globals/resilience/resource";
import { Match } from "../../tools/check";
import { createIORedisClient } from "../durable/optionalDeps/ioredis";
import { RedisResilience, type ResilienceRedisClient } from "./RedisResilience";
import type { ResilienceConfig } from "../../globals/resilience/types";

const clientSchema = Match.compile(
  Match.Where((value: unknown): value is ResilienceRedisClient => {
    if (value === null || typeof value !== "object") return false;
    const client = value as Partial<ResilienceRedisClient>;
    return (
      typeof client.connect === "function" &&
      typeof client.eval === "function" &&
      typeof client.ping === "function" &&
      typeof client.disconnect === "function"
    );
  }),
);

/** Opt-in shared Redis state for rate-limit, circuit-breaker and concurrency middleware. */
export const resilienceResource: typeof reference = Object.freeze({
  ...reference,
  // Preserve the portable dependency identity without global platform registration.
  async init(config: ResilienceConfig) {
    const client = clientSchema.parse(
      createIORedisClient(config.redis, {
        maxRetriesPerRequest: 0,
        retryStrategy: (attempt: number) => Math.min(attempt * 100, 2000),
        lazyConnect: true,
        enableOfflineQueue: false,
        autoResendUnfulfilledCommands: false,
        commandTimeout: 5000,
        connectTimeout: 5000,
      }),
    );
    try {
      await client.connect();
      await client.ping();
      return new RedisResilience(client, config);
    } catch (error) {
      client.disconnect();
      throw error;
    }
  },
});
