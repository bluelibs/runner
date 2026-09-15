import { setupRedisStoreMock } from "../helpers/RedisStore.mock.helpers";

const harness = setupRedisStoreMock();

describe("durable: RedisStore.deleteExecutionData (mock)", () => {
  it("deletes history keys and index memberships atomically", async () => {
    const { redisMock, store } = harness;
    redisMock.sscan.mockResolvedValueOnce(["0", ["sig-1", "sig-2"]]);

    await store.deleteExecutionData("exec-1");

    expect(redisMock.sscan).toHaveBeenCalledWith(
      "durable:signal_ids:exec-1",
      "0",
      "COUNT",
      100,
    );
    expect(redisMock.eval).toHaveBeenCalledTimes(1);
    const [script, numkeys, ...rest] = redisMock.eval.mock.calls[0] as [
      string,
      number,
      ...string[],
    ];
    expect(script).toContain('redis.call("del"');
    expect(script).toContain('redis.call("srem"');
    expect(numkeys).toBe(9);
    expect(rest.slice(0, 6)).toEqual([
      "durable:exec:exec-1",
      "durable:steps:exec-1",
      "durable:audit:exec-1",
      "durable:signal_ids:exec-1",
      "durable:signal:exec-1:sig-1",
      "durable:signal:exec-1:sig-2",
    ]);
    expect(rest.slice(6, 9)).toEqual([
      "durable:all_executions",
      "durable:active_executions",
      "durable:stuck_executions",
    ]);
    expect(rest[9]).toBe("exec-1");
  });

  it("deletes executions without signal journals", async () => {
    const { redisMock, store } = harness;
    redisMock.sscan.mockResolvedValueOnce(["0", []]);

    await store.deleteExecutionData("exec-1");

    const [, numkeys] = redisMock.eval.mock.calls[0] as [string, number];
    expect(numkeys).toBe(7);
  });
});
