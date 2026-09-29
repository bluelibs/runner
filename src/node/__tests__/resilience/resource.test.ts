import { r, resources, run } from "../../node";
import { createIORedisClient } from "../../durable/optionalDeps/ioredis";
import type { ResilienceRedisClient } from "../../resilience/RedisResilience";

jest.mock("../../durable/optionalDeps/ioredis", () => ({
  createIORedisClient: jest.fn(),
}));
const createClient = jest.mocked(createIORedisClient);
const config = { namespace: "test", redis: "redis://example" };

function client(): jest.Mocked<ResilienceRedisClient> {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    eval: jest.fn(),
    ping: jest.fn().mockResolvedValue("PONG"),
    disconnect: jest.fn(),
  };
}

const app = () =>
  r
    .resource("app")
    .register([resources.resilience.with(config)])
    .build();

describe("Redis resilience resource", () => {
  beforeEach(() => {
    createClient.mockReset();
  });

  it("owns one connection per runtime and never deletes shared state at disposal", async () => {
    const first = client();
    const second = client();
    createClient.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const one = await run(app());
    const two = await run(app());
    expect(first.ping).toHaveBeenCalledTimes(1);
    expect(second.ping).toHaveBeenCalledTimes(1);
    expect(createClient.mock.calls[0][0]).toBe(config.redis);
    const options = createClient.mock.calls[0][1];
    expect(options).toMatchObject({
      maxRetriesPerRequest: 0,
      commandTimeout: 5000,
    });
    expect((options?.retryStrategy as (attempt: number) => number)(1)).toBe(
      100,
    );
    expect((options?.retryStrategy as (attempt: number) => number)(100)).toBe(
      2000,
    );
    expect(options).toMatchObject({
      lazyConnect: true,
      enableOfflineQueue: false,
      autoResendUnfulfilledCommands: false,
    });
    await one.dispose();
    await two.dispose();
    expect(first.disconnect).toHaveBeenCalledTimes(1);
    expect(second.disconnect).toHaveBeenCalledTimes(1);
    expect(first.eval).not.toHaveBeenCalled();
  });

  it("closes its connection if startup fails", async () => {
    const redis = client();
    redis.ping.mockRejectedValue(new Error("Redis unavailable"));
    createClient.mockReturnValue(redis);
    await expect(run(app())).rejects.toThrow("Redis unavailable");
    expect(redis.disconnect).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, 1.5, Infinity, NaN, 2_147_483_648, "1000"])(
    "rejects unsupported leases: %p",
    (leaseMs) => {
      expect(() =>
        resources.resilience.with({ ...config, leaseMs: leaseMs as number }),
      ).toThrow();
    },
  );

  it("accepts the largest supported timer duration", () => {
    expect(() =>
      resources.resilience.with({ ...config, leaseMs: 2_147_483_647 }),
    ).not.toThrow();
  });

  it("closes the connection if connect fails", async () => {
    const redis = client();
    redis.connect.mockRejectedValue(new Error("connect failed"));
    createClient.mockReturnValue(redis);
    await expect(run(app())).rejects.toThrow("connect failed");
    expect(redis.disconnect).toHaveBeenCalled();
    expect(redis.ping).not.toHaveBeenCalled();
  });

  it.each([
    null,
    42,
    {},
    { connect() {} },
    { connect() {}, eval() {} },
    { connect() {}, eval() {}, ping() {} },
  ])("rejects an incompatible optional client export: %p", async (value) => {
    createClient.mockReturnValue(value);
    await expect(run(app())).rejects.toThrow();
  });
});
