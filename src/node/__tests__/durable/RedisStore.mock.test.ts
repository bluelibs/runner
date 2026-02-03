import { RedisStore } from "../../durable/store/RedisStore";
import type { RedisClient } from "../../durable/store/RedisStore";
import type {
  Execution,
  Schedule,
  StepResult,
  Timer,
} from "../../durable/core/types";
import { ExecutionStatus } from "../../durable/core/types";
import { getDefaultSerializer } from "../../../serializer";
import type { DurableAuditEntry } from "../../durable/core/audit";
import * as ioredisOptional from "../../durable/optionalDeps/ioredis";

const serializer = getDefaultSerializer();

describe("durable: RedisStore", () => {
  let redisMock: jest.Mocked<RedisClient>;
  let store: RedisStore;

  beforeEach(() => {
    jest.clearAllMocks();
    redisMock = {
      set: jest.fn().mockResolvedValue("OK"),
      get: jest.fn(),
      keys: jest.fn().mockResolvedValue([]),
      scan: jest.fn().mockResolvedValue(["0", []]),
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

  it("supports execution idempotency key mapping (get/set)", async () => {
    redisMock.get.mockResolvedValueOnce("exec-1");

    await expect(
      store.getExecutionIdByIdempotencyKey({
        taskId: "t",
        idempotencyKey: "k",
      }),
    ).resolves.toBe("exec-1");

    redisMock.get.mockResolvedValueOnce(123 as any);
    await expect(
      store.getExecutionIdByIdempotencyKey({
        taskId: "t",
        idempotencyKey: "k",
      }),
    ).resolves.toBeNull();

    redisMock.set.mockResolvedValueOnce("OK");
    await expect(
      store.setExecutionIdByIdempotencyKey({
        taskId: "t",
        idempotencyKey: "k",
        executionId: "exec-2",
      }),
    ).resolves.toBe(true);

    redisMock.set.mockResolvedValueOnce(null);
    await expect(
      store.setExecutionIdByIdempotencyKey({
        taskId: "t",
        idempotencyKey: "k",
        executionId: "exec-3",
      }),
    ).resolves.toBe(false);
  });

  it("URI-encodes idempotency mapping keys", async () => {
    redisMock.get.mockResolvedValueOnce(null);

    await store.getExecutionIdByIdempotencyKey({
      taskId: "task/with spaces",
      idempotencyKey: "key:with?chars",
    });

    expect(redisMock.get).toHaveBeenCalledWith(
      "durable:idem:task%2Fwith%20spaces:key%3Awith%3Fchars",
    );
  });

  it("saves and fetches execution", async () => {
    const exec: Execution = {
      id: "1",
      taskId: "t",
      input: undefined,
      status: "pending",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await store.saveExecution(exec);
    expect(redisMock.set).toHaveBeenCalled();
    expect(redisMock.sadd).toHaveBeenCalledWith(
      "durable:active_executions",
      "1",
    );

    redisMock.get.mockResolvedValue(serializer.stringify(exec));
    const fetched = await store.getExecution("1");
    expect(fetched?.id).toBe("1");
  });

  it("does not track cancelled executions as active", async () => {
    const exec: Execution = {
      id: "c1",
      taskId: "t",
      input: undefined,
      status: ExecutionStatus.Cancelled,
      error: { message: "cancelled" },
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    };

    await store.saveExecution(exec);

    expect(redisMock.srem).toHaveBeenCalledWith(
      "durable:active_executions",
      "c1",
    );
  });

  it("updates execution (and handles missing)", async () => {
    const exec: Execution = {
      id: "1",
      taskId: "t",
      input: undefined,
      status: "pending",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    redisMock.get.mockResolvedValue(serializer.stringify(exec));
    redisMock.eval.mockResolvedValueOnce("OK");
    await store.updateExecution("1", { status: "failed" });
    expect(redisMock.eval).toHaveBeenCalled();
    expect(redisMock.srem).toHaveBeenCalledWith(
      "durable:active_executions",
      "1",
    );

    redisMock.get.mockResolvedValue(null);
    redisMock.eval.mockResolvedValueOnce(null);
    await store.updateExecution("ghost", { status: "failed" });
    expect(redisMock.srem).not.toHaveBeenCalledWith(
      "durable:active_executions",
      "ghost",
    );
  });

  it("lists executions for dashboard", async () => {
    redisMock.scan.mockResolvedValue(["0", ["durable:exec:1"]]);
    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [
          null,
          serializer.stringify({
            id: "1",
            taskId: "t1",
            status: "completed",
            createdAt: new Date("2024-01-02T00:00:00.000Z"),
          }),
        ],
        [
          null,
          serializer.stringify({
            id: "2",
            taskId: "t1",
            status: "completed",
            createdAt: new Date("2024-01-01T00:00:00.000Z"),
          }),
        ],
      ]),
    });

    const results = await store.listExecutions({
      taskId: "t1",
      status: ["completed"],
    });
    expect(results.length).toBe(2);
    expect(results[0].taskId).toBe("t1");
    expect(results.map((e) => e.id)).toEqual(["1", "2"]);
  });

  it("lists step results for dashboard", async () => {
    redisMock.scan.mockResolvedValue(["0", ["durable:step:e1:s1"]]);
    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [
          null,
          serializer.stringify({
            executionId: "e1",
            stepId: "s2",
            result: "late",
            completedAt: new Date("2024-01-02T00:00:00.000Z"),
          }),
        ],
        [
          null,
          serializer.stringify({
            executionId: "e1",
            stepId: "s1",
            result: "early",
            completedAt: new Date("2024-01-01T00:00:00.000Z"),
          }),
        ],
      ]),
    });

    const results = await store.listStepResults("e1");
    expect(results.length).toBe(2);
    expect(results.map((s) => s.stepId)).toEqual(["s1", "s2"]);
  });

  it("appends and lists audit entries", async () => {
    const at1 = new Date("2024-01-01T00:00:00.000Z");
    const at2 = new Date("2024-01-02T00:00:00.000Z");

    const entry1: DurableAuditEntry = {
      id: "1704067200000:e1",
      executionId: "e1",
      at: at1,
      attempt: 1,
      kind: "note",
      message: "first",
    };

    const entry2: DurableAuditEntry = {
      id: "1704153600000:e2",
      executionId: "e1",
      at: at2,
      attempt: 1,
      kind: "note",
      message: "second",
    };

    await store.appendAuditEntry(entry1);
    expect(redisMock.set).toHaveBeenCalledWith(
      `durable:audit:e1:${entry1.id}`,
      expect.any(String),
    );

    const missingId: DurableAuditEntry = {
      id: "",
      executionId: "e1",
      at: at1,
      attempt: 1,
      kind: "note",
      message: "needs-id",
    };
    await store.appendAuditEntry(missingId);
    expect(redisMock.set).toHaveBeenCalledWith(
      expect.stringMatching(/^durable:audit:e1:1704067200000:.+/),
      expect.any(String),
    );

    redisMock.scan.mockResolvedValue(["0", []]);
    await expect(store.listAuditEntries("e1")).resolves.toEqual([]);

    redisMock.scan.mockResolvedValue([
      "0",
      [`durable:audit:e1:${entry2.id}`, `durable:audit:e1:${entry1.id}`],
    ]);

    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [null, serializer.stringify(entry2)],
        [null, serializer.stringify(entry1)],
      ]),
    });

    const listed = await store.listAuditEntries("e1");
    expect(
      listed.map((e) => (e.kind === "note" ? e.message : "not-note")),
    ).toEqual(["first", "second"]);

    const paged = await store.listAuditEntries("e1", { offset: 1, limit: 1 });
    expect(
      paged.map((e) => (e.kind === "note" ? e.message : "not-note")),
    ).toEqual(["second"]);

    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 123]]),
    });
    await expect(store.listAuditEntries("e1")).resolves.toEqual([]);

    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(null),
    });
    await expect(store.listAuditEntries("e1")).resolves.toEqual([]);
  });

  it("throws when Redis SCAN returns an unexpected shape", async () => {
    redisMock.sscan.mockResolvedValueOnce("bad" as any);
    await expect(store.listIncompleteExecutions()).rejects.toThrow("SCAN");
  });

  it("throws when Redis SCAN returns an unexpected shape (scanKeys)", async () => {
    redisMock.scan.mockResolvedValueOnce("bad" as any);
    await expect(store.listExecutions()).rejects.toThrow("SCAN");
  });

  it("throws when Redis SCAN returns a non-string cursor", async () => {
    redisMock.sscan.mockResolvedValueOnce([1, []] as any);
    await expect(store.listIncompleteExecutions()).rejects.toThrow("SCAN");
  });

  it("throws when Redis SCAN returns non-string keys", async () => {
    redisMock.sscan.mockResolvedValueOnce(["0", [1]] as any);
    await expect(store.listIncompleteExecutions()).rejects.toThrow("SCAN");
  });

  it("returns null when Redis GET returns a non-string", async () => {
    redisMock.get.mockResolvedValueOnce(123 as any);
    await expect(store.getExecution("e1")).resolves.toBeNull();
  });

  it("covers skipStep persistence", async () => {
    await store.skipStep("e1", "s1");
    expect(redisMock.set).toHaveBeenCalledWith(
      "durable:step:e1:s1",
      expect.any(String),
    );
  });

  it("manages step results", async () => {
    const step: StepResult<string> = {
      executionId: "e1",
      stepId: "s1",
      result: "ok",
      completedAt: new Date(),
    };
    await store.saveStepResult(step);
    expect(redisMock.set).toHaveBeenCalledWith(
      "durable:step:e1:s1",
      expect.any(String),
    );

    redisMock.get.mockResolvedValue(serializer.stringify(step));
    expect((await store.getStepResult("e1", "s1"))?.result).toBe("ok");

    redisMock.get.mockResolvedValue(null);
    expect(await store.getStepResult("e1", "ghost")).toBeNull();
  });

  it("lists incomplete executions", async () => {
    redisMock.sscan.mockResolvedValue(["0", ["1"]]);
    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest
        .fn()
        .mockResolvedValue([
          [null, serializer.stringify({ id: "1", status: "running" })],
        ]),
    });

    expect((await store.listIncompleteExecutions()).length).toBe(1);
  });

  it("returns [] from listIncompleteExecutions when pipeline.exec returns null", async () => {
    redisMock.sscan.mockResolvedValue(["0", ["1"]]);
    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(null),
    });

    await expect(store.listIncompleteExecutions()).resolves.toEqual([]);
  });

  it("cleans up stale active execution ids during listIncompleteExecutions", async () => {
    redisMock.sscan.mockResolvedValue(["0", ["1", "2", "3"]]);
    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [null, serializer.stringify({ id: "1", status: "running" })],
        [null, serializer.stringify({ id: "2", status: "completed" })],
        [null, null],
      ]),
    });

    const listed = await store.listIncompleteExecutions();
    expect(listed.map((e) => e.id)).toEqual(["1"]);
    expect(redisMock.srem).toHaveBeenCalledWith(
      "durable:active_executions",
      "2",
      "3",
    );
  });

  it("swallows errors while cleaning stale active execution ids", async () => {
    redisMock.sscan.mockResolvedValue(["0", ["1", "2"]]);
    redisMock.srem.mockRejectedValueOnce(new Error("srem-failed"));
    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [null, serializer.stringify({ id: "1", status: "running" })],
        [null, serializer.stringify({ id: "2", status: "completed" })],
      ]),
    });

    await expect(store.listIncompleteExecutions()).resolves.toHaveLength(1);
  });

  it("returns [] from listIncompleteExecutions when no execution keys exist", async () => {
    redisMock.sscan.mockResolvedValue(["0", []]);
    await expect(store.listIncompleteExecutions()).resolves.toEqual([]);
  });

  it("lists stuck executions (compensation_failed)", async () => {
    redisMock.scan.mockResolvedValue([
      "0",
      ["durable:exec:1", "durable:exec:2"],
    ]);
    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [
          null,
          serializer.stringify({ id: "1", status: "compensation_failed" }),
        ],
        [null, serializer.stringify({ id: "2", status: "running" })],
      ]),
    });

    const stuck = await store.listStuckExecutions();
    expect(stuck?.map((e) => e.id)).toEqual(["1"]);

    redisMock.scan.mockResolvedValue(["0", []]);
    expect(await store.listStuckExecutions()).toEqual([]);
  });

  it("covers listStuckExecutions with null pipeline entries", async () => {
    redisMock.scan.mockResolvedValue([
      "0",
      ["durable:exec:1", "durable:exec:2"],
    ]);
    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [null, null],
        [
          null,
          serializer.stringify({ id: "1", status: "compensation_failed" }),
        ],
      ]),
    });

    const stuck = await store.listStuckExecutions();
    expect(stuck.map((e) => e.id)).toEqual(["1"]);
  });

  it("covers listStuckExecutions null pipeline and operator missing branches", async () => {
    redisMock.scan.mockResolvedValue(["0", ["durable:exec:1"]]);
    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(null),
    });
    expect(await store.listStuckExecutions()).toEqual([]);

    redisMock.get.mockResolvedValue(null);
    await store.retryRollback("missing");
    await store.forceFail("missing", { message: "x" });
  });

  it("covers retryRollback/forceFail/editStepResult success branches", async () => {
    const exec: Execution = {
      id: "1",
      taskId: "t",
      input: undefined,
      status: "compensation_failed",
      error: { message: "boom", stack: "s" },
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    redisMock.get.mockResolvedValue(serializer.stringify(exec));

    await store.retryRollback("1");
    expect(redisMock.set).toHaveBeenCalledWith(
      "durable:exec:1",
      expect.any(String),
    );
    const savedPayload = redisMock.set.mock.calls.find(
      (c) => c[0] === "durable:exec:1",
    )?.[1];
    expect(typeof savedPayload).toBe("string");
    const savedExec = serializer.parse(savedPayload as string) as Execution;
    expect(savedExec.status).toBe("pending");
    expect(savedExec.error).toBeUndefined();

    await store.forceFail("1", { message: "manual", stack: "s" });
    expect(redisMock.eval).toHaveBeenCalled();

    await store.editStepResult("e1", "s1", { ok: true });
    expect(redisMock.set).toHaveBeenCalledWith(
      "durable:step:e1:s1",
      expect.any(String),
    );
  });

  it("returns [] from listExecutions when no execution keys exist", async () => {
    redisMock.scan.mockResolvedValue(["0", []]);
    await expect(store.listExecutions()).resolves.toEqual([]);
  });

  it("returns [] from listExecutions when pipeline results are null", async () => {
    redisMock.scan.mockResolvedValue(["0", ["durable:exec:1"]]);
    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(null),
    });
    await expect(store.listExecutions()).resolves.toEqual([]);
  });

  it("filters non-string pipeline entries when listing executions", async () => {
    redisMock.scan.mockResolvedValue(["0", ["durable:exec:1"]]);
    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 123]]),
    });
    await expect(store.listExecutions()).resolves.toEqual([]);
  });

  it("returns [] from listStepResults when no step keys exist", async () => {
    redisMock.scan.mockResolvedValue(["0", []]);
    await expect(store.listStepResults("e1")).resolves.toEqual([]);
  });

  it("filters non-string pipeline entries when listing step results", async () => {
    redisMock.scan.mockResolvedValue(["0", ["durable:step:e1:s1"]]);
    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 123]]),
    });
    await expect(store.listStepResults("e1")).resolves.toEqual([]);

    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(null),
    });
    await expect(store.listStepResults("e1")).resolves.toEqual([]);
  });

  it("handles empty and null pipeline results when listing incomplete executions", async () => {
    redisMock.scan.mockResolvedValue(["0", ["durable:exec:1"]]);
    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(null),
    });
    expect(await store.listIncompleteExecutions()).toEqual([]);

    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, null]]),
    });
    expect(await store.listIncompleteExecutions()).toEqual([]);
  });

  it("handles timers", async () => {
    const timer: Timer = {
      id: "t1",
      type: "sleep",
      fireAt: new Date(),
      status: "pending",
    };
    await store.createTimer(timer);
    expect(redisMock.hset).toHaveBeenCalled();
    expect(redisMock.zadd).toHaveBeenCalled();

    redisMock.zrangebyscore.mockResolvedValue(["t1"]);
    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, serializer.stringify(timer)]]),
    });

    expect((await store.getReadyTimers()).length).toBe(1);

    redisMock.hget.mockResolvedValue(serializer.stringify(timer));
    await store.markTimerFired("t1");
    expect(redisMock.zrem).toHaveBeenCalled();

    redisMock.hget.mockResolvedValue(null);
    await store.markTimerFired("missing");

    await store.deleteTimer("t1");
    expect(redisMock.hdel).toHaveBeenCalledWith("durable:timers", "t1");
  });

  it("handles empty/null timer lookups", async () => {
    redisMock.zrangebyscore.mockResolvedValue([]);
    expect(await store.getReadyTimers()).toEqual([]);

    redisMock.zrangebyscore.mockResolvedValue("bad" as any);
    expect(await store.getReadyTimers()).toEqual([]);

    redisMock.zrangebyscore.mockResolvedValue(["t1"]);
    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(null),
    });
    expect(await store.getReadyTimers()).toEqual([]);

    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, null]]),
    });
    expect(await store.getReadyTimers()).toEqual([]);
  });

  it("manages schedules", async () => {
    const sched: Schedule = {
      id: "s1",
      taskId: "t",
      type: "interval",
      pattern: "1000",
      input: undefined,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await store.createSchedule(sched);
    expect(redisMock.hset).toHaveBeenCalledWith(
      "durable:schedules",
      "s1",
      expect.any(String),
    );

    redisMock.hget.mockResolvedValue(serializer.stringify(sched));
    await store.updateSchedule("s1", { status: "paused" });

    redisMock.hgetall.mockResolvedValue({ s1: serializer.stringify(sched) });
    expect((await store.listSchedules()).length).toBe(1);
    expect((await store.listActiveSchedules()).length).toBe(1);

    await store.deleteSchedule("s1");
    expect(redisMock.hdel).toHaveBeenCalledWith("durable:schedules", "s1");
  });

  it("returns empty schedules when Redis HGETALL returns a non-object", async () => {
    redisMock.hgetall.mockResolvedValue(null as any);
    await expect(store.listSchedules()).resolves.toEqual([]);
  });

  it("handles missing schedules", async () => {
    redisMock.hget.mockResolvedValue(null);
    expect(await store.getSchedule("missing")).toBeNull();
    await store.updateSchedule("missing", { status: "paused" });
  });

  it("handles locks and disposal", async () => {
    redisMock.set.mockResolvedValue("OK");
    const lockId = await store.acquireLock("res", 1000);
    expect(lockId).not.toBeNull();

    await store.releaseLock("res", lockId!);
    expect(redisMock.eval).toHaveBeenCalled();

    await store.dispose?.();
    expect(redisMock.quit).toHaveBeenCalled();
  });

  it("returns null lockId when Redis SET NX fails", async () => {
    redisMock.set.mockResolvedValue(null as any);
    const lockId = await store.acquireLock("res", 1000);
    expect(lockId).toBeNull();
  });

  it("claims timers via Redis NX", async () => {
    redisMock.set.mockResolvedValueOnce("OK");
    await expect(store.claimTimer("t1", "worker-1", 1000)).resolves.toBe(true);

    redisMock.set.mockResolvedValueOnce(null as any);
    await expect(store.claimTimer("t1", "worker-2", 1000)).resolves.toBe(false);
  });

  it("supports string redis url and default redis in constructor", async () => {
    (
      ioredisOptional.createIORedisClient as unknown as jest.Mock
    ).mockReturnValue(redisMock);

    const fromUrl = new RedisStore({ redis: "redis://localhost:6379" });
    expect(fromUrl).toBeDefined();

    const defaultRedis = new RedisStore({});
    expect(defaultRedis).toBeDefined();
  });
});
