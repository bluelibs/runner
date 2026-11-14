import { RedisStore } from "../../../durable/store/RedisStore";
import {
  setupRedisStoreMock,
  serializer,
} from "../helpers/RedisStore.mock.helpers";
import type { Timer } from "../../../durable/core/types";

describe("Redis execution timer recovery index", () => {
  const harness = setupRedisStoreMock();
  const timer: Timer = {
    id: "timer",
    executionId: "one/resource",
    type: "sleep",
    status: "pending",
    fireAt: new Date(),
  };

  it("atomically indexes new timers and backfills old timers in scan pages", async () => {
    const { redisMock: redis } = harness;
    redis.hscan = jest
      .fn()
      .mockResolvedValueOnce(["17", ["timer", serializer.stringify(timer)]])
      .mockResolvedValueOnce([
        "0",
        [
          "schedule",
          serializer.stringify({ ...timer, executionId: undefined }),
        ],
      ]);
    // The store captures optional transport capabilities at construction.
    const store = new RedisStore({ redis });
    redis.sscan.mockResolvedValue(["0", ["timer"]]);
    redis.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, serializer.stringify(timer)]]),
    });
    await store.createTimer(timer);
    expect(redis.eval).toHaveBeenLastCalledWith(
      expect.stringContaining('redis.call("sadd"'),
      2,
      "durable:timers",
      "durable:timers_schedule",
      "timer",
      expect.any(String),
      timer.fireAt.getTime(),
      "durable:execution_timers:one%2Fresource",
    );
    expect(await store.getExecutionTimers("one/resource")).toEqual([timer]);
    expect(redis.hscan).toHaveBeenNthCalledWith(
      2,
      "durable:timers",
      "17",
      "COUNT",
      100,
    );
    expect(redis.sadd).toHaveBeenCalledWith(
      "durable:execution_timers:one%2Fresource",
      "timer",
    );
    expect(redis.set).toHaveBeenCalledWith(
      "durable:execution_timer_index_ready",
      "1",
    );
  });

  it("uses completed indexes, prunes stale entries, and handles empty transport results", async () => {
    const { redisMock: redis, store } = harness;
    redis.get.mockResolvedValue("1");
    expect(await store.getExecutionTimers("one/resource")).toEqual([]);
    redis.sscan.mockResolvedValue([
      "0",
      ["missing", "fired", "other", "pending"],
    ]);
    redis.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [null, null],
        [null, serializer.stringify({ ...timer, status: "fired" })],
        [null, serializer.stringify({ ...timer, executionId: "other" })],
        [null, serializer.stringify(timer)],
      ]),
    });
    expect(await store.getExecutionTimers("one/resource")).toEqual([timer]);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("srem"'),
      2,
      "durable:timers",
      "durable:execution_timers:one%2Fresource",
      "missing",
      "",
    );
    redis.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(null),
    });
    expect(await store.getExecutionTimers("one/resource")).toEqual([]);
  });

  it("fails closed when pipeline inspection fails and tolerates absent entries", async () => {
    const { redisMock: redis, store } = harness;
    redis.get.mockResolvedValue("1");
    redis.sscan.mockResolvedValue(["0", ["missing"]]);
    redis.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    });
    expect(await store.getExecutionTimers("one")).toEqual([]);
    redis.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[new Error("read failed"), null]]),
    });
    await expect(store.getExecutionTimers("one")).rejects.toThrow(
      "inspection failed",
    );
  });

  it("fails clearly when a legacy index needs unsupported HSCAN or malformed data", async () => {
    const { redisMock: redis, store } = harness;
    await expect(store.getExecutionTimers("one")).rejects.toThrow("hscan()");
    const scan = jest.fn().mockResolvedValue("invalid");
    redis.hscan = scan;
    const malformed = new RedisStore({ redis });
    await expect(malformed.getExecutionTimers("one")).rejects.toThrow();
    scan.mockResolvedValue(["0", "invalid"]);
    await expect(malformed.getExecutionTimers("one")).rejects.toThrow();
  });
});
