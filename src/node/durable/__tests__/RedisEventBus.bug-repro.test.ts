import { RedisEventBus } from "../bus/RedisEventBus";
import { Serializer } from "../../../serializer";

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

  it("fails second subscriber if first subscriber fails (parallel)", async () => {
    // 1. Arrange: Make subscribe delay then fail
    let rejectSubscribe: (err: Error) => void;

    redisMock.subscribe.mockImplementation(() => {
      return new Promise((_, reject) => {
        rejectSubscribe = reject;
      });
    });

    const handler1 = jest.fn().mockResolvedValue(undefined);
    const handler2 = jest.fn().mockResolvedValue(undefined);

    // 2. Act: Both subscribe in parallel
    const p1 = bus.subscribe("race-chan", handler1);
    const p2 = bus.subscribe("race-chan", handler2);

    // Both are now waiting for the subscription to complete

    // Fail the subscription
    rejectSubscribe!(new Error("Network Error"));

    // 3. Assert: Both subscribers should fail
    await expect(p1).rejects.toThrow("Network Error");
    await expect(p2).rejects.toThrow("Network Error");

    // 4. Verify: Neither handler should be registered
    // A new successful subscription should only have its own handler
    redisMock.subscribe.mockResolvedValue(1);
    const handler3 = jest.fn().mockResolvedValue(undefined);
    await bus.subscribe("race-chan", handler3);

    // Simulate a message arriving
    const messageCallback = redisMock.on.mock.calls.find(
      (args: any[]) => args[0] === "message",
    )?.[1];

    const event = { type: "test", payload: "foo", timestamp: new Date() };
    const serialized = new Serializer().stringify(event);
    messageCallback("durable:bus:race-chan", serialized);

    // Only handler3 should receive the message (handler1 and handler2 were never registered)
    expect(handler3).toHaveBeenCalled();
    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();
  });
});
