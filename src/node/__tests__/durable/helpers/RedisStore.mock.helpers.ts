import { RedisStore } from "../../../durable/store/RedisStore";
import type { RedisClient } from "../../../durable/store/RedisStore";
import { Serializer } from "../../../../serializer";
import * as ioredisOptional from "../../../durable/optionalDeps/ioredis";

export const serializer = new Serializer();

export function setupRedisStoreMock() {
  let redisMock!: jest.Mocked<RedisClient>;
  let store!: RedisStore;

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
      .mockReturnValue(redisMock as any);
    store = new RedisStore({ redis: redisMock });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  return {
    get redisMock() {
      return redisMock;
    },
    get store() {
      return store;
    },
  };
}
