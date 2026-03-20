import { RedisStore } from "../../durable/store/RedisStore";
import type { RedisClient } from "../../durable/store/RedisStore";
import type {
  Execution,
  Schedule,
  StepResult,
  Timer,
} from "../../durable/core/types";
import { ExecutionStatus } from "../../durable/core/types";
import { createSignalWaiterSortKey } from "../../durable/core/signalWaiters";
import { Serializer } from "../../../serializer";
import type { DurableAuditEntry } from "../../durable/core/audit";
import * as ioredisOptional from "../../durable/optionalDeps/ioredis";

const serializer = new Serializer();

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
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("set", KEYS[1], ARGV[1])'),
      4,
      "durable:exec:1",
      "durable:all_executions",
      "durable:active_executions",
      "durable:stuck_executions",
      expect.any(String),
      "1",
      "1",
      "0",
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

    expect(redisMock.eval).toHaveBeenLastCalledWith(
      expect.stringContaining('redis.call("set", KEYS[1], ARGV[1])'),
      4,
      "durable:exec:c1",
      "durable:all_executions",
      "durable:active_executions",
      "durable:stuck_executions",
      expect.any(String),
      "c1",
      "0",
      "0",
    );
  });

  it("tracks compensation-failed executions as stuck", async () => {
    const exec: Execution = {
      id: "stuck-1",
      taskId: "t",
      input: undefined,
      status: ExecutionStatus.CompensationFailed,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await store.saveExecution(exec);

    expect(redisMock.eval).toHaveBeenLastCalledWith(
      expect.stringContaining('redis.call("set", KEYS[1], ARGV[1])'),
      4,
      "durable:exec:stuck-1",
      "durable:all_executions",
      "durable:active_executions",
      "durable:stuck_executions",
      expect.any(String),
      "stuck-1",
      "0",
      "1",
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

    redisMock.get.mockResolvedValue(null);
    redisMock.eval.mockResolvedValueOnce(null);
    await store.updateExecution("ghost", { status: "failed" });
    expect(redisMock.eval).toHaveBeenCalledTimes(1);
  });

  it("updates execution without touching status indexes when status is unchanged", async () => {
    const exec: Execution = {
      id: "no-status",
      taskId: "t",
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    redisMock.get.mockResolvedValue(serializer.stringify(exec));
    redisMock.eval.mockResolvedValueOnce("OK");

    await store.updateExecution("no-status", { timeout: 1234 });

    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("set", KEYS[1], ARGV[1])'),
      4,
      "durable:exec:no-status",
      "durable:all_executions",
      "durable:active_executions",
      "durable:stuck_executions",
      expect.any(String),
      "no-status",
      "1",
      "0",
    );
  });

  it("throws a durable store error when a Lua script reports corrupted signal state", async () => {
    redisMock.eval.mockResolvedValueOnce(
      "__error__:Corrupted durable signal state",
    );

    await expect(
      store.appendSignalRecord("e1", "paid", {
        id: "sig-1",
        payload: { paidAt: 1 },
        receivedAt: new Date("2024-01-01T00:00:00.000Z"),
      }),
    ).rejects.toThrow("Corrupted durable signal state");
  });

  it("preserves serializer marker payloads through updateExecution merge roundtrips", async () => {
    const initialExecution: Execution = {
      id: "lua-safe-1",
      taskId: "task-lua-safe",
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 3,
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    };

    const redisState = new Map<string, string>([
      ["durable:exec:lua-safe-1", serializer.stringify(initialExecution)],
    ]);

    redisMock.get.mockImplementation(async (key: unknown) => {
      if (typeof key !== "string") return null;
      return redisState.get(key) ?? null;
    });

    redisMock.eval.mockImplementationOnce(
      async (
        scriptUnknown: unknown,
        _numKeysUnknown: unknown,
        keyUnknown: unknown,
        _allExecutionsKeyUnknown: unknown,
        _activeExecutionsKeyUnknown: unknown,
        _stuckExecutionsKeyUnknown: unknown,
        executionPayloadUnknown: unknown,
      ) => {
        const script = typeof scriptUnknown === "string" ? scriptUnknown : "";
        const key = typeof keyUnknown === "string" ? keyUnknown : "";
        const executionPayload =
          typeof executionPayloadUnknown === "string"
            ? executionPayloadUnknown
            : "";

        if (
          !script.includes('redis.call("set", KEYS[1], ARGV[1])') ||
          key.length === 0 ||
          executionPayload.length === 0
        ) {
          return null;
        }

        redisState.set(key, executionPayload);
        return "OK";
      },
    );

    await store.updateExecution("lua-safe-1", {
      status: ExecutionStatus.Completed,
      completedAt: new Date("2024-01-02T03:04:05.000Z"),
      cancelledAt: new Date("2024-01-02T04:05:06.000Z"),
    });

    const updatedExecution = await store.getExecution("lua-safe-1");
    expect(updatedExecution).not.toBeNull();
    expect(updatedExecution?.createdAt).toBeInstanceOf(Date);
    expect(updatedExecution?.updatedAt).toBeInstanceOf(Date);
    expect(updatedExecution?.completedAt).toBeInstanceOf(Date);
    expect(updatedExecution?.cancelledAt).toBeInstanceOf(Date);
    expect(updatedExecution?.status).toBe(ExecutionStatus.Completed);
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

  it("lists executions from the indexed execution set without SCAN fallback", async () => {
    redisMock.sscan.mockResolvedValueOnce(["0", ["1"]]);
    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [
          null,
          serializer.stringify({
            id: "1",
            taskId: "t-indexed",
            input: undefined,
            status: "pending",
            attempt: 1,
            maxAttempts: 1,
            createdAt: new Date("2024-01-01T00:00:00.000Z"),
            updatedAt: new Date("2024-01-01T00:00:00.000Z"),
          }),
        ],
      ]),
    } as any);

    await expect(store.listExecutions()).resolves.toEqual([
      expect.objectContaining({ id: "1", taskId: "t-indexed" }),
    ]);
    expect(redisMock.scan).not.toHaveBeenCalled();
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

  it("prefers indexed step buckets and filters non-string hash entries", async () => {
    redisMock.hgetall.mockResolvedValue({
      s2: serializer.stringify({
        executionId: "e1",
        stepId: "s2",
        result: 2,
        completedAt: new Date("2024-01-02T00:00:00.000Z"),
      }),
      ignored: 123,
      s1: serializer.stringify({
        executionId: "e1",
        stepId: "s1",
        result: 1,
        completedAt: new Date("2024-01-01T00:00:00.000Z"),
      }),
    } as any);

    await expect(store.listStepResults("e1")).resolves.toEqual([
      expect.objectContaining({ stepId: "s1" }),
      expect.objectContaining({ stepId: "s2" }),
    ]);
    expect(redisMock.scan).not.toHaveBeenCalled();
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

  it("lists audit entries from the indexed audit bucket without SCAN fallback", async () => {
    const entry = {
      id: "audit-1",
      executionId: "e1",
      at: new Date("2024-01-01T00:00:00.000Z"),
      attempt: 1,
      kind: "note",
      message: "hello",
    } as DurableAuditEntry;

    redisMock.hgetall.mockResolvedValueOnce({
      [entry.id]: serializer.stringify(entry),
    });

    await expect(store.listAuditEntries("e1")).resolves.toEqual([entry]);
    expect(redisMock.scan).not.toHaveBeenCalled();
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

  it("reads step results from the indexed step bucket before legacy keys", async () => {
    const step = {
      executionId: "e1",
      stepId: "s-indexed",
      result: { ok: true },
      completedAt: new Date("2024-01-01T00:00:00.000Z"),
    };
    redisMock.hget.mockResolvedValueOnce(serializer.stringify(step));

    await expect(store.getStepResult("e1", "s-indexed")).resolves.toEqual(step);
    expect(redisMock.get).not.toHaveBeenCalled();
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
    expect(redisMock.srem).toHaveBeenNthCalledWith(
      1,
      "durable:active_executions",
      "3",
    );
    expect(redisMock.srem).toHaveBeenNthCalledWith(
      2,
      "durable:active_executions",
      "2",
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

  it("lists stuck executions from the indexed stuck set", async () => {
    redisMock.sscan.mockResolvedValueOnce(["0", ["stuck-1"]]);
    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [
          null,
          serializer.stringify({
            id: "stuck-1",
            taskId: "t-stuck",
            input: undefined,
            status: ExecutionStatus.CompensationFailed,
            attempt: 1,
            maxAttempts: 1,
            createdAt: new Date("2024-01-01T00:00:00.000Z"),
            updatedAt: new Date("2024-01-01T00:00:00.000Z"),
          }),
        ],
      ]),
    } as any);

    await expect(store.listStuckExecutions()).resolves.toEqual([
      expect.objectContaining({ id: "stuck-1" }),
    ]);
    expect(redisMock.scan).not.toHaveBeenCalled();
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
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("set", KEYS[1], ARGV[1])'),
      4,
      "durable:exec:1",
      "durable:all_executions",
      "durable:active_executions",
      "durable:stuck_executions",
      expect.any(String),
      "1",
      "1",
      "0",
    );

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

  it("returns [] from listStepResults when the indexed hash is null", async () => {
    redisMock.hgetall.mockResolvedValueOnce(null as any);
    redisMock.scan.mockResolvedValueOnce(["0", []]);

    await expect(store.listStepResults("e1")).resolves.toEqual([]);
  });

  it("stores retained signal history and queued signal records", async () => {
    const redisState = new Map<string, string>();

    redisMock.get.mockImplementation(async (key: unknown) => {
      if (typeof key !== "string") return null;
      return redisState.get(key) ?? null;
    });
    redisMock.set.mockImplementation(
      async (key: unknown, value: unknown): Promise<unknown> => {
        if (typeof key === "string" && typeof value === "string") {
          redisState.set(key, value);
        }
        return "OK";
      },
    );
    redisMock.eval.mockImplementation(
      async (
        scriptUnknown: unknown,
        _keyCountUnknown: unknown,
        keyUnknown: unknown,
        defaultStateUnknown?: unknown,
        recordUnknown?: unknown,
      ) => {
        const script = String(scriptUnknown);
        const key = typeof keyUnknown === "string" ? keyUnknown : "";
        const storedState = redisState.get(key);

        if (script.includes("table.insert(state.history, record)")) {
          const state = storedState
            ? (serializer.parse(storedState) as {
                history: unknown[];
                queued: unknown[];
              })
            : (serializer.parse(String(defaultStateUnknown)) as {
                history: unknown[];
                queued: unknown[];
              });
          state.history.push(serializer.parse(String(recordUnknown)));
          redisState.set(key, serializer.stringify(state));
          return "OK";
        }

        if (
          script.includes("queuedRecord.serializedPayload") &&
          script.includes('return "deduped"')
        ) {
          const state = storedState
            ? (serializer.parse(storedState) as {
                history: unknown[];
                queued: Array<{ serializedPayload: string }>;
              })
            : (serializer.parse(String(defaultStateUnknown)) as {
                history: unknown[];
                queued: Array<{ serializedPayload: string }>;
              });
          const record = serializer.parse(String(recordUnknown)) as {
            serializedPayload: string;
          };
          if (
            state.queued.some(
              (queuedRecord) =>
                queuedRecord.serializedPayload === record.serializedPayload,
            )
          ) {
            return "deduped";
          }
          state.queued.push(record);
          redisState.set(key, serializer.stringify(state));
          return "enqueued";
        }

        if (script.includes("table.remove(state.queued, 1)")) {
          if (!storedState) return null;
          const state = serializer.parse(storedState) as {
            history: unknown[];
            queued: Array<Record<string, unknown>>;
          };
          const record = state.queued.shift() ?? null;
          redisState.set(key, serializer.stringify(state));
          if (!record) return null;
          const { serializedPayload: _ignored, ...strippedRecord } = record;
          return serializer.stringify(strippedRecord);
        }

        return 1;
      },
    );

    const record = {
      id: "sig-1",
      payload: { paidAt: 1 },
      receivedAt: new Date("2024-01-01T00:00:00.000Z"),
    };
    const queuedRecord = {
      ...record,
      serializedPayload: JSON.stringify(record.payload),
    };

    await expect(
      store.getSignalState("e1", "paid/with spaces"),
    ).resolves.toBeNull();

    await expect(
      store.enqueueQueuedSignalRecord("e1", "empty-first", queuedRecord),
    ).resolves.toBe("enqueued");
    await expect(store.getSignalState("e1", "empty-first")).resolves.toEqual({
      executionId: "e1",
      signalId: "empty-first",
      queued: [queuedRecord],
      history: [],
    });

    await store.appendSignalRecord("e1", "paid/with spaces", record);
    await expect(
      store.enqueueQueuedSignalRecord("e1", "paid/with spaces", queuedRecord),
    ).resolves.toBe("enqueued");

    await expect(
      store.getSignalState("e1", "paid/with spaces"),
    ).resolves.toEqual({
      executionId: "e1",
      signalId: "paid/with spaces",
      queued: [queuedRecord],
      history: [record],
    });

    await expect(
      store.consumeQueuedSignalRecord("e1", "paid/with spaces"),
    ).resolves.toEqual(record);
    expect(await store.getSignalState("e1", "paid/with spaces")).toEqual({
      executionId: "e1",
      signalId: "paid/with spaces",
      queued: [],
      history: [record],
    });
    expect(redisMock.get).toHaveBeenCalledWith(
      "durable:signal:e1:paid%2Fwith%20spaces",
    );
    await expect(
      store.enqueueQueuedSignalRecord("e1", "paid/with spaces", queuedRecord),
    ).resolves.toBe("enqueued");
    await expect(
      store.enqueueQueuedSignalRecord("e1", "paid/with spaces", queuedRecord),
    ).resolves.toBe("deduped");
    await expect(
      store.consumeQueuedSignalRecord("e1", "missing-signal"),
    ).resolves.toBeNull();
  });

  it("dedupes queued redis signal records with the same serialized payload", async () => {
    const redisState = new Map<string, string>();

    redisMock.get.mockImplementation(async (key: unknown) => {
      if (typeof key !== "string") return null;
      return redisState.get(key) ?? null;
    });
    redisMock.set.mockImplementation(
      async (key: unknown, value: unknown): Promise<unknown> => {
        if (typeof key === "string" && typeof value === "string") {
          redisState.set(key, value);
        }
        return "OK";
      },
    );
    redisMock.eval.mockImplementation(
      async (
        scriptUnknown: unknown,
        _keyCountUnknown: unknown,
        keyUnknown: unknown,
        defaultStateUnknown?: unknown,
        recordUnknown?: unknown,
      ) => {
        const script = String(scriptUnknown);
        if (!script.includes("queuedRecord.serializedPayload")) {
          return 1;
        }

        const key = typeof keyUnknown === "string" ? keyUnknown : "";
        const storedState = redisState.get(key);
        const state = storedState
          ? (serializer.parse(storedState) as {
              history: unknown[];
              queued: Array<{ serializedPayload: string }>;
            })
          : (serializer.parse(String(defaultStateUnknown)) as {
              history: unknown[];
              queued: Array<{ serializedPayload: string }>;
            });
        const record = serializer.parse(String(recordUnknown)) as {
          serializedPayload: string;
        };

        if (
          state.queued.some(
            (queuedRecord) =>
              queuedRecord.serializedPayload === record.serializedPayload,
          )
        ) {
          return "deduped";
        }

        state.queued.push(record);
        redisState.set(key, serializer.stringify(state));
        return "enqueued";
      },
    );

    const queuedRecord = {
      id: "sig-1",
      payload: { paidAt: 1 },
      receivedAt: new Date("2024-01-01T00:00:00.000Z"),
      serializedPayload: JSON.stringify({ paidAt: 1 }),
    };

    await expect(
      store.enqueueQueuedSignalRecord("e1", "paid", queuedRecord),
    ).resolves.toBe("enqueued");
    await expect(
      store.enqueueQueuedSignalRecord("e1", "paid", {
        ...queuedRecord,
        id: "sig-2",
      }),
    ).resolves.toBe("deduped");
    expect((await store.getSignalState("e1", "paid"))?.queued).toHaveLength(1);
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
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("hset"'),
      2,
      "durable:timers",
      "durable:timers_schedule",
      "t1",
      expect.any(String),
      timer.fireAt.getTime(),
    );

    redisMock.zrangebyscore.mockResolvedValue(["t1"]);
    redisMock.pipeline.mockReturnValue({
      get: jest.fn().mockReturnThis(),
      hget: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, serializer.stringify(timer)]]),
    });

    expect((await store.getReadyTimers()).length).toBe(1);

    redisMock.hget.mockResolvedValue(serializer.stringify(timer));
    await store.markTimerFired("t1");
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining("timer.status = ARGV[2]"),
      2,
      "durable:timers",
      "durable:timers_schedule",
      "t1",
      "fired",
    );

    await store.markTimerFired("missing");

    await store.deleteTimer("t1");
    expect(redisMock.eval).toHaveBeenLastCalledWith(
      expect.stringContaining('redis.call("hdel", KEYS[1], ARGV[1])'),
      2,
      "durable:timers",
      "durable:timers_schedule",
      "t1",
    );
  });

  it("creates timers atomically to avoid ghost timer entries", async () => {
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

  it("stores, takes, and deletes signal waiters atomically", async () => {
    const waiter = {
      executionId: "e1",
      signalId: "paid/with spaces",
      stepId: "__signal:stable-paid",
      sortKey: createSignalWaiterSortKey(
        "paid/with spaces",
        "__signal:stable-paid",
      ),
      timerId: "timer-1",
    };

    await store.upsertSignalWaiter?.(waiter);
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("zadd"'),
      3,
      "durable:signal_waiters:e1:paid%2Fwith%20spaces:order",
      "durable:signal_waiters:e1:paid%2Fwith%20spaces:payloads",
      "durable:signal_waiters:e1:paid%2Fwith%20spaces:steps",
      "__signal:stable-paid",
      `${waiter.sortKey}\n__signal:stable-paid`,
      expect.any(String),
    );

    redisMock.eval.mockResolvedValueOnce(serializer.stringify(waiter));
    await expect(
      store.takeNextSignalWaiter?.("e1", "paid/with spaces"),
    ).resolves.toEqual(waiter);

    redisMock.eval.mockResolvedValueOnce(null);
    await expect(
      store.takeNextSignalWaiter?.("e1", "paid/with spaces"),
    ).resolves.toBeNull();

    await store.deleteSignalWaiter?.(
      "e1",
      "paid/with spaces",
      "__signal:stable-paid",
    );
    expect(redisMock.eval).toHaveBeenLastCalledWith(
      expect.stringContaining('redis.call("hget", KEYS[3], ARGV[1])'),
      3,
      "durable:signal_waiters:e1:paid%2Fwith%20spaces:order",
      "durable:signal_waiters:e1:paid%2Fwith%20spaces:payloads",
      "durable:signal_waiters:e1:paid%2Fwith%20spaces:steps",
      "__signal:stable-paid",
    );
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

  it("saves recurring schedules and timers atomically", async () => {
    const schedule: Schedule = {
      id: "s-atomic",
      taskId: "t",
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
      taskId: "t",
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

    redisMock.eval.mockResolvedValueOnce(1 as any);
    await expect(store.renewLock("res", lockId!, 1000)).resolves.toBe(true);

    redisMock.eval.mockResolvedValueOnce(0 as any);
    await expect(store.renewLock("res", lockId!, 1000)).resolves.toBe(false);

    await store.releaseLock("res", lockId!);
    expect(redisMock.eval).toHaveBeenCalled();

    await store.dispose?.();
    expect(redisMock.quit).not.toHaveBeenCalled();
  });

  it("disposes injected Redis clients only when explicitly configured", async () => {
    await store.dispose?.();
    expect(redisMock.quit).not.toHaveBeenCalled();

    const ownedStore = new RedisStore({
      redis: redisMock,
      disposeProvidedClient: true,
    });
    await ownedStore.dispose?.();

    expect(redisMock.quit).toHaveBeenCalledTimes(1);
  });

  it("renews timer claims via Redis scripts", async () => {
    redisMock.eval.mockResolvedValueOnce(1 as any);
    await expect(
      store.renewTimerClaim("timer-1", "worker-1", 5000),
    ).resolves.toBe(true);

    redisMock.eval.mockResolvedValueOnce(0 as any);
    await expect(
      store.renewTimerClaim("timer-1", "worker-1", 5000),
    ).resolves.toBe(false);
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

  it("renews lock TTL only when Redis script confirms ownership", async () => {
    redisMock.eval.mockResolvedValueOnce(1);
    await expect(store.renewLock("res", "lock-1", 5000)).resolves.toBe(true);

    redisMock.eval.mockResolvedValueOnce(0);
    await expect(store.renewLock("res", "lock-1", 5000)).resolves.toBe(false);
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
