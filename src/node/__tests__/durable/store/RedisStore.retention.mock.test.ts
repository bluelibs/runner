import {
  setupRedisStoreMock,
  serializer,
} from "../helpers/RedisStore.mock.helpers";
import type { Execution } from "../../../durable/core/types";

const harness = setupRedisStoreMock();

describe("Redis history collector contract", () => {
  const now = new Date("2024-01-01T00:00:00Z");
  const execution: Execution = {
    id: "one",
    workflowKey: "workflow",
    input: "large",
    result: { receipt: 1 },
    status: "completed",
    attempt: 1,
    maxAttempts: 1,
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    retention: { onComplete: "delete" },
  };

  it("uses a bounded due index and compare-and-set receipt replacement", async () => {
    const { store, redisMock } = harness;
    redisMock.zrangebyscore.mockResolvedValue(["one"]);
    redisMock.get.mockResolvedValue(serializer.stringify(execution));
    redisMock.hgetall.mockResolvedValue({});
    expect(await store.collectCompletedHistory(now, 2)).toBe(1);
    expect(redisMock.zrangebyscore).toHaveBeenCalledWith(
      "durable:execution_index_metadata:cleanup",
      "-inf",
      now.getTime(),
      "LIMIT",
      0,
      2,
    );
    const args = redisMock.eval.mock.calls[0];
    expect(args[0]).toContain("if raw ~= ARGV[2] then return 0 end");
    expect(args[0]).toContain('redis.call("exists", KEYS[8])');
    expect(serializer.parse(args[14] as string)).toMatchObject({
      input: undefined,
      result: { receipt: 1 },
      historyCollectedAt: now,
    });
    redisMock.eval.mockResolvedValue(0);
    expect(await store.collectCompletedHistory(now, 2)).toBe(0);
  });

  it("drops missing due entries rather than resurrecting execution", async () => {
    const { store, redisMock } = harness;
    redisMock.zrangebyscore.mockResolvedValue(["missing"]);
    redisMock.get.mockResolvedValue(null);
    expect(await store.collectCompletedHistory(now, 1)).toBe(0);
    expect(redisMock.zrem).toHaveBeenCalledWith(
      "durable:execution_index_metadata:cleanup",
      "missing",
    );
    expect(redisMock.eval).not.toHaveBeenCalled();
  });

  it("removes only the execution's signal and timer details", async () => {
    const { store, redisMock } = harness;
    redisMock.zrangebyscore.mockResolvedValue(["one"]);
    redisMock.get.mockResolvedValue(serializer.stringify(execution));
    redisMock.sscan.mockResolvedValue(["0", ["signal/one"]]);
    redisMock.hgetall.mockResolvedValue({
      timer: serializer.stringify({ id: "timer", executionId: "one" }),
      other: serializer.stringify({ id: "other", executionId: "other" }),
    });
    await store.collectCompletedHistory(now, 1);
    const args = redisMock.eval.mock.calls[0];
    expect(args[16]).toContain("signal%2Fone");
    expect(JSON.parse(args[17] as string)).toEqual(["timer"]);
  });
});
