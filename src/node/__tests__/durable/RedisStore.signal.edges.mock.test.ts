import { RedisStore } from "../../durable/store/RedisStore";
import type { RedisClient } from "../../durable/store/RedisStore";
import * as ioredisOptional from "../../durable/optionalDeps/ioredis";

describe("durable: RedisStore signal edges", () => {
  let redisMock: jest.Mocked<RedisClient>;
  let store: RedisStore;

  beforeEach(() => {
    jest.clearAllMocks();
    redisMock = {
      set: jest.fn().mockResolvedValue("OK"),
      get: jest.fn(),
      keys: jest.fn().mockResolvedValue([]),
      sscan: jest.fn().mockResolvedValue(["0", []]),
      sadd: jest.fn().mockResolvedValue(1),
      srem: jest.fn().mockResolvedValue(1),
      pipeline: jest.fn().mockReturnValue({
        get: jest.fn().mockReturnThis(),
        hget: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
      hset: jest.fn().mockResolvedValue(1),
      hget: jest.fn(),
      hdel: jest.fn().mockResolvedValue(1),
      hgetall: jest.fn().mockResolvedValue({}),
      zadd: jest.fn().mockResolvedValue(1),
      zrangebyscore: jest.fn().mockResolvedValue([]),
      zrem: jest.fn().mockResolvedValue(1),
      eval: jest.fn().mockResolvedValue(1),
      quit: jest.fn().mockResolvedValue("OK"),
    };
    jest
      .spyOn(ioredisOptional, "createIORedisClient")
      .mockReturnValue(redisMock as never);
    store = new RedisStore({ redis: redisMock });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns null when atomic buffered consumption finds no queued signal", async () => {
    redisMock.eval.mockResolvedValue(null);

    await expect(
      store.consumeBufferedSignalForStep({
        executionId: "e1",
        stepId: "manual-step",
        result: {
          state: "completed",
          signalId: "paid",
          payload: undefined,
        },
        completedAt: new Date(),
      }),
    ).resolves.toBeNull();
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      "durable:signal:e1:paid",
      "durable:steps:e1",
      "manual-step",
      expect.any(String),
    );
  });

  it("throws when buffered step consumption cannot resolve a signal id", async () => {
    await expect(
      store.consumeBufferedSignalForStep({
        executionId: "e1",
        stepId: "manual-step",
        result: { state: "completed" },
        completedAt: new Date(),
      }),
    ).rejects.toThrow("Unable to resolve signal id");
  });

  it("returns null when peeking signal waiters with no stored payload", async () => {
    redisMock.eval.mockResolvedValue(null);

    await expect(store.peekNextSignalWaiter("e1", "paid")).resolves.toBeNull();
  });
});
