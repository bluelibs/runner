import {
  RedisResilience,
  type ResilienceRedisClient,
} from "../../resilience/RedisResilience";

function fixture() {
  const redis: jest.Mocked<ResilienceRedisClient> = {
    eval: jest.fn(),
    ping: jest.fn(),
    disconnect: jest.fn(),
  };
  const backend = new RedisResilience(redis, {
    namespace: "app",
    redis: "redis://localhost",
  });
  return { redis, backend };
}

describe("Redis resilience backend contract", () => {
  it("consumes allowances and reports denial, capacity and policy conflicts", async () => {
    const { redis, backend } = fixture();
    redis.eval
      .mockResolvedValueOnce([1, 2, 1000])
      .mockResolvedValueOnce([0, 0, 1000])
      .mockResolvedValueOnce([-1, 0, 0])
      .mockResolvedValueOnce([-2, 0, 0]);
    await expect(backend.rateLimit("task", "key", 3, 1000)).resolves.toEqual({
      allowed: true,
      remaining: 2,
      resetTime: 1000,
    });
    await expect(
      backend.rateLimit("task", "key", 3, 1000),
    ).resolves.toMatchObject({ allowed: false });
    await expect(backend.rateLimit("task", "key", 4, 1000)).rejects.toThrow(
      /Conflicting/,
    );
    await expect(backend.rateLimit("task", "key", 3, 1000, 1)).rejects.toThrow(
      /maxKeys/,
    );
    await backend.dispose();
  });

  it("maps circuit states and settles each outcome using its admission generation", async () => {
    const { redis, backend } = fixture();
    redis.eval
      .mockResolvedValueOnce([1, 0, 0, "generation"])
      .mockResolvedValueOnce([1, 0, 0, "generation"])
      .mockResolvedValueOnce([1, 1, 5, "next"])
      .mockResolvedValueOnce([0, 2, 5, "probe"])
      .mockResolvedValueOnce([-2, 2, 5, "probe"]);
    const admitted = await backend.enterCircuit("task", 5, 1000);
    expect(admitted).toMatchObject({ state: "CLOSED", allowed: true });
    expect(await backend.settleCircuit("task", admitted, true)).toMatchObject({
      state: "CLOSED",
    });
    expect(await backend.settleCircuit("task", admitted, false)).toMatchObject({
      state: "OPEN",
    });
    const probe = await backend.enterCircuit("task", 5, 1000);
    expect(probe).toMatchObject({ state: "HALF_OPEN", allowed: false });
    await expect(backend.settleCircuit("task", probe, true)).rejects.toThrow(
      /lease expired/,
    );
    await backend.dispose();
  });

  it("releases successful and failed executions and rejects a conflicting permit policy", async () => {
    const { redis, backend } = fixture();
    redis.eval.mockResolvedValue(1);
    await expect(
      backend.withPermit("key", 1, undefined, jest.fn(), async () => "ok"),
    ).resolves.toBe("ok");
    await expect(
      backend.withPermit("key", 1, undefined, jest.fn(), async () => {
        throw new Error("task failed");
      }),
    ).rejects.toThrow("task failed");
    redis.eval.mockResolvedValueOnce(-1);
    await expect(
      backend.withPermit("key", 2, undefined, jest.fn(), async () => "no"),
    ).rejects.toThrow(/Conflicting/);
    await backend.dispose();
    expect(redis.disconnect).toHaveBeenCalledTimes(1);
  });

  it("encodes namespaces and full identities without ambiguous separators", async () => {
    const { redis, backend } = fixture();
    redis.eval.mockResolvedValue([1, 0, 1000]);
    await backend.rateLimit("a.tasks.task", "key", 1, 1000);
    await backend.rateLimit("b.tasks.task", "key", 1, 1000);
    expect(redis.eval.mock.calls[0][2]).not.toBe(redis.eval.mock.calls[1][2]);
    const [state, index] = redis.eval.mock.calls[0].slice(2, 4).map(String);
    expect(state.match(/\{[^}]+\}/)?.[0]).toBe(index.match(/\{[^}]+\}/)?.[0]);
    await backend.dispose();
  });
});
