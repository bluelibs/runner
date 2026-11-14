import type { DurableExecutionOwnership } from "../core/interfaces/ownership";
import type { RedisClient } from "./RedisStore.runtime";

const LOST_OWNERSHIP = "__durable_execution_ownership_lost__";

/** Adds the lease comparison to the same Redis operation as each mutation. */
export function ownershipRedisClient(
  client: RedisClient,
  currentOwner: () => DurableExecutionOwnership | undefined,
  lockKey: (executionId: string) => string,
): RedisClient {
  const evaluate = async (
    script: string,
    numberOfKeys: number,
    ...args: unknown[]
  ): Promise<unknown> => {
    const owner = currentOwner();
    if (!owner) return client.eval(script, numberOfKeys, ...args);
    const result = await client.eval(
      `local ownershipKey = table.remove(KEYS)
       local ownershipToken = table.remove(ARGV)
       if redis.call("get", ownershipKey) ~= ownershipToken then
         return "${LOST_OWNERSHIP}"
       end
       ${script}`,
      numberOfKeys + 1,
      ...args.slice(0, numberOfKeys),
      lockKey(owner.executionId),
      ...args.slice(numberOfKeys),
      owner.lockId,
    );
    if (result === LOST_OWNERSHIP) owner.onLost();
    return result;
  };

  const mutate = (
    command: "set" | "sadd" | "srem" | "hset" | "hdel" | "zadd" | "zrem",
    args: unknown[],
  ): Promise<unknown> => {
    if (!currentOwner()) return client[command](...args);
    return evaluate(
      `return redis.call("${command}", unpack(ARGV))`,
      0,
      ...args,
    );
  };

  return {
    get: (...args) => client.get(...args),
    hget: (...args) => client.hget(...args),
    hgetall: (...args) => client.hgetall(...args),
    hscan: client.hscan?.bind(client),
    sscan: (...args) => client.sscan(...args),
    keys: client.keys?.bind(client),
    zrangebyscore: (...args) => client.zrangebyscore(...args),
    pipeline: () => client.pipeline(),
    quit: (...args) => client.quit(...args),
    eval: evaluate,
    set: (...args) => mutate("set", args),
    sadd: (...args) => mutate("sadd", args),
    srem: (...args) => mutate("srem", args),
    hset: (...args) => mutate("hset", args),
    hdel: (...args) => mutate("hdel", args),
    zadd: (...args) => mutate("zadd", args),
    zrem: (...args) => mutate("zrem", args),
  };
}
