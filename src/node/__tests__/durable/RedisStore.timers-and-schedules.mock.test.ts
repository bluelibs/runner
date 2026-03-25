import type { Schedule, Timer } from "../../durable/core/types";
import { serializer, setupRedisStoreMock } from "./RedisStore.mock.helpers";

const harness = setupRedisStoreMock();

describe("durable: RedisStore timers and schedules (mock)", () => {
  it("creates, reads, fires, and deletes timers", async () => {
    const { redisMock, store } = harness;
    const timer: Timer = {
      id: "t1",
      type: "sleep",
      fireAt: new Date(),
      status: "pending",
    };

    await store.createTimer(timer);
    redisMock.zrangebyscore.mockResolvedValue(["t1"]);
    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, serializer.stringify(timer)]]),
    });
    await expect(store.getReadyTimers()).resolves.toEqual([timer]);

    redisMock.hget.mockResolvedValue(serializer.stringify(timer));
    await store.markTimerFired("t1");
    await store.markTimerFired("missing");
    await store.deleteTimer("t1");
  });

  it("claims ready timers through a single eval-backed round trip", async () => {
    const { redisMock, store } = harness;
    const timerA: Timer = {
      id: "t1",
      type: "sleep",
      fireAt: new Date(),
      status: "pending",
    };
    const timerB: Timer = {
      id: "t2",
      type: "retry",
      fireAt: new Date(),
      status: "pending",
    };

    redisMock.eval.mockResolvedValueOnce([
      serializer.stringify(timerA),
      serializer.stringify(timerB),
    ]);

    await expect(
      store.claimReadyTimers(
        new Date("2024-01-01T00:00:00.000Z"),
        2,
        "w1",
        5000,
      ),
    ).resolves.toEqual([timerA, timerB]);
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining('"zrangebyscore"'),
      2,
      "durable:timers_schedule",
      "durable:timers",
      `${new Date("2024-01-01T00:00:00.000Z").getTime()}`,
      "2024-01-01T00:00:00.000Z",
      "2",
      "w1",
      "5000",
      "50",
      "durable:timer:claim:",
      "pending",
    );
    const claimReadyTimersScript = redisMock.eval.mock.calls[0]?.[0];
    expect(claimReadyTimersScript).toEqual(
      expect.stringContaining("local limit = tonumber(ARGV[3]) or 0"),
    );
    expect(claimReadyTimersScript).toEqual(
      expect.stringContaining("local nowIso = ARGV[2]"),
    );
  });

  it("fails fast on malformed claim-ready responses", async () => {
    const { redisMock, store } = harness;

    await expect(
      store.claimReadyTimers(
        new Date("2024-01-01T00:00:00.000Z"),
        0,
        "w1",
        5000,
      ),
    ).resolves.toEqual([]);

    redisMock.eval.mockResolvedValueOnce("bad" as any);
    await expect(
      store.claimReadyTimers(
        new Date("2024-01-01T00:00:00.000Z"),
        1,
        "w1",
        5000,
      ),
    ).rejects.toThrow("Unexpected Redis claimed timer response shape");
  });

  it("fails fast when claimed timer entries are malformed or not pending", async () => {
    const { redisMock, store } = harness;

    redisMock.eval.mockResolvedValueOnce([123 as any]);
    await expect(
      store.claimReadyTimers(
        new Date("2024-01-01T00:00:00.000Z"),
        1,
        "w1",
        5000,
      ),
    ).rejects.toThrow("Unexpected Redis claimed timer payload shape");

    redisMock.eval.mockResolvedValueOnce([
      serializer.stringify({
        id: "t-fired",
        type: "sleep",
        fireAt: new Date("2024-01-01T00:00:00.000Z"),
        status: "fired",
      } satisfies Timer),
    ]);
    await expect(
      store.claimReadyTimers(
        new Date("2024-01-01T00:00:00.000Z"),
        1,
        "w1",
        5000,
      ),
    ).rejects.toThrow("Unexpected claimed timer status 'fired'");
  });

  it("handles empty and malformed timer lookups", async () => {
    const { redisMock, store } = harness;
    redisMock.zrangebyscore.mockResolvedValue([]);
    await expect(store.getReadyTimers()).resolves.toEqual([]);

    redisMock.zrangebyscore.mockResolvedValue("bad" as any);
    await expect(store.getReadyTimers()).resolves.toEqual([]);

    redisMock.zrangebyscore.mockResolvedValue(["t1"]);
    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(null),
    });
    await expect(store.getReadyTimers()).resolves.toEqual([]);

    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, null]]),
    });
    await expect(store.getReadyTimers()).resolves.toEqual([]);
  });

  it("creates timers atomically to avoid ghost entries", async () => {
    const { redisMock, store } = harness;
    const timer: Timer = {
      id: "t-atomic",
      type: "sleep",
      fireAt: new Date("2024-01-01T00:00:00.000Z"),
      status: "pending",
    };

    await store.createTimer(timer);
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("hset"'),
      2,
      "durable:timers",
      "durable:timers_schedule",
      "t-atomic",
      expect.any(String),
      timer.fireAt.getTime(),
    );
  });

  it("creates, updates, lists, and deletes schedules", async () => {
    const { redisMock, store } = harness;
    const schedule: Schedule = {
      id: "s1",
      workflowKey: "t",
      type: "interval",
      pattern: "1000",
      input: undefined,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await store.createSchedule(schedule);
    redisMock.hget.mockResolvedValue(serializer.stringify(schedule));
    await store.updateSchedule("s1", { status: "paused" });
    redisMock.hgetall.mockResolvedValue({ s1: serializer.stringify(schedule) });
    await expect(store.listSchedules()).resolves.toEqual([schedule]);
    await expect(store.listActiveSchedules()).resolves.toEqual([schedule]);
    await store.deleteSchedule("s1");
  });

  it("saves recurring schedules and timers atomically", async () => {
    const { redisMock, store } = harness;
    const schedule: Schedule = {
      id: "s-atomic",
      workflowKey: "t",
      type: "interval",
      pattern: "1000",
      input: undefined,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
      nextRun: new Date("2024-01-01T00:00:00.000Z"),
    };
    const timer: Timer = {
      id: "timer-atomic",
      scheduleId: "s-atomic",
      workflowKey: "t",
      type: "scheduled",
      fireAt: schedule.nextRun!,
      status: "pending",
    };

    await store.saveScheduleWithTimer(schedule, timer);
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("hset", KEYS[1], ARGV[1], ARGV[2])'),
      3,
      "durable:schedules",
      "durable:timers",
      "durable:timers_schedule",
      "s-atomic",
      expect.any(String),
      "timer-atomic",
      expect.any(String),
      timer.fireAt.getTime(),
    );
  });

  it("handles missing and malformed schedule reads", async () => {
    const { redisMock, store } = harness;
    redisMock.hgetall.mockResolvedValue(null as any);
    await expect(store.listSchedules()).resolves.toEqual([]);

    redisMock.hget.mockResolvedValue(null);
    await expect(store.getSchedule("missing")).resolves.toBeNull();
    await expect(
      store.updateSchedule("missing", { status: "paused" }),
    ).resolves.toBeUndefined();
  });
});
