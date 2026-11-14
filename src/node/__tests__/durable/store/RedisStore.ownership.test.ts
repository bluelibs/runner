import { ownershipRedisClient } from "../../../durable/store/RedisStore.ownership";
import type { DurableExecutionOwnership } from "../../../durable/core/interfaces/ownership";
import { setupRedisStoreMock } from "../helpers/RedisStore.mock.helpers";

describe("Redis atomic ownership transport", () => {
  const harness = setupRedisStoreMock();
  it("preserves unscoped calls and fences every scoped mutation in one script", async () => {
    const { redisMock: redis } = harness;
    const scope: { owner?: DurableExecutionOwnership } = {};
    const client = ownershipRedisClient(
      redis,
      () => scope.owner,
      (id) => `lease:${id}`,
    );
    for (const command of [
      "set",
      "sadd",
      "srem",
      "hset",
      "hdel",
      "zadd",
      "zrem",
    ] as const) {
      await client[command]("key", "value");
      expect(redis[command]).toHaveBeenCalledWith("key", "value");
    }
    await client.eval("return 1", 1, "data", "argument");
    expect(redis.eval).toHaveBeenLastCalledWith(
      "return 1",
      1,
      "data",
      "argument",
    );
    scope.owner = {
      executionId: "one",
      lockId: "token",
      onLost: () => {
        throw new Error("lost");
      },
    };
    for (const command of [
      "set",
      "sadd",
      "srem",
      "hset",
      "hdel",
      "zadd",
      "zrem",
    ] as const) {
      await client[command]("key", "value");
      expect(redis.eval).toHaveBeenLastCalledWith(
        expect.stringContaining(`redis.call("${command}"`),
        1,
        "lease:one",
        "key",
        "value",
        "token",
      );
    }
    await client.eval("return #KEYS", 2, "first", "second", "arg");
    expect(redis.eval).toHaveBeenLastCalledWith(
      expect.stringContaining("table.remove(KEYS)"),
      3,
      "first",
      "second",
      "lease:one",
      "arg",
      "token",
    );
    redis.eval.mockResolvedValueOnce("__durable_execution_ownership_lost__");
    await expect(client.set("key", "value")).rejects.toThrow("lost");
    await client.get("key");
    await client.hget("hash", "key");
    await client.hgetall("hash");
    await client.sscan("set", "0");
    await client.zrangebyscore("zset", "-inf", "+inf");
    client.pipeline();
    await client.quit();
    await client.keys!("*");
    expect(redis.get).toHaveBeenCalledWith("key");
  });

  it("keeps optional client methods optional and scopes facade writes", async () => {
    const { redisMock: redis, store } = harness;
    redis.hscan = jest.fn().mockResolvedValue(["0", []]);
    const client = ownershipRedisClient(
      redis,
      () => undefined,
      (id) => id,
    );
    await expect(client.hscan!("timers", "0")).resolves.toEqual(["0", []]);
    delete redis.keys;
    delete redis.hscan;
    const minimal = ownershipRedisClient(
      redis,
      () => undefined,
      (id) => id,
    );
    expect(minimal.keys).toBeUndefined();
    expect(minimal.hscan).toBeUndefined();
    redis.get.mockResolvedValueOnce("live-token").mockResolvedValueOnce(null);
    expect(await store.hasExecutionLease("one")).toBe(true);
    expect(await store.hasExecutionLease("one")).toBe(false);
    const owned = store.withExecutionOwnership({
      executionId: "one",
      lockId: "old-token",
      onLost: () => {
        throw new Error("lost");
      },
    });
    redis.eval.mockResolvedValueOnce("__durable_execution_ownership_lost__");
    await expect(
      owned.saveStepResult({
        executionId: "one",
        stepId: "work",
        result: true,
        completedAt: new Date(),
      }),
    ).rejects.toThrow("lost");
  });
});
