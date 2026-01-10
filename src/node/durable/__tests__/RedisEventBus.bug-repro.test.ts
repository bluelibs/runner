import { RedisEventBus } from "../bus/RedisEventBus";
import { Serializer } from "../../../serializer";
import { createIORedisClient } from "../optionalDeps/ioredis";

jest.mock("../optionalDeps/ioredis", () => ({
  createIORedisClient: jest.fn(),
}));

describe("durable: RedisEventBus Bug Repro", () => {
  let redisMock: any;
  let bus: RedisEventBus;

  beforeEach(() => {
    redisMock = {
      publish: jest.fn().mockResolvedValue(1),
      subscribe: jest.fn().mockResolvedValue(1),
      unsubscribe: jest.fn().mockResolvedValue(1),
      on: jest.fn(),
      quit: jest.fn().mockResolvedValue("OK"),
      duplicate: jest.fn().mockReturnThis(),
    };
    bus = new RedisEventBus({ redis: redisMock });
  });

  it("handles Redis subscription failure by cleaning up local state", async () => {
    // 1. Arrange: Make subscribe fail once
    redisMock.subscribe.mockRejectedValueOnce(new Error("Network Error"));

    const handler1 = jest.fn();
    const handler2 = jest.fn();

    // 2. Act: First subscription fails
    await expect(bus.subscribe("flaky-chan", handler1)).rejects.toThrow(
      "Network Error",
    );

    // 3. Act: Second subscription should retry redis subscription
    await bus.subscribe("flaky-chan", handler2);

    // 4. Assert: verify redis.subscribe was called twice (once failed, once succeeded)
    // If the bug exists, it will only be called once because the first call left the Set in the map
    expect(redisMock.subscribe).toHaveBeenCalledTimes(2);
    expect(redisMock.subscribe).toHaveBeenCalledWith("durable:bus:flaky-chan");
  });
});
