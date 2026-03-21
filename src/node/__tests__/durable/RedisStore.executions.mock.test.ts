import type { Execution } from "../../durable/core/types";
import { ExecutionStatus } from "../../durable/core/types";
import { serializer, setupRedisStoreMock } from "./RedisStore.mock.helpers";

const harness = setupRedisStoreMock();

describe("durable: RedisStore executions (mock)", () => {
  it("creates idempotent executions transactionally", async () => {
    const { redisMock, store } = harness;
    redisMock.eval
      .mockResolvedValueOnce("__created__")
      .mockResolvedValueOnce("exec-1");

    const execution: Execution = {
      id: "exec-1",
      taskId: "t",
      input: undefined,
      status: "pending",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await expect(
      store.createExecutionWithIdempotencyKey({
        execution,
        taskId: "t",
        idempotencyKey: "k",
      }),
    ).resolves.toEqual({ created: true, executionId: "exec-1" });

    await expect(
      store.createExecutionWithIdempotencyKey({
        execution: { ...execution, id: "exec-2" },
        taskId: "t",
        idempotencyKey: "k",
      }),
    ).resolves.toEqual({ created: false, executionId: "exec-1" });
  });

  it("only replaces executions when the expected status still matches", async () => {
    const { redisMock, store } = harness;
    const execution: Execution = {
      id: "exec-cas",
      taskId: "t",
      input: undefined,
      status: "running",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    redisMock.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(
      store.saveExecutionIfStatus(
        { ...execution, status: "completed", result: "ok" },
        ["running"],
      ),
    ).resolves.toBe(true);
    await expect(
      store.saveExecutionIfStatus(execution, ["pending"]),
    ).resolves.toBe(false);
  });

  it("validates idempotent create responses and encoded keys", async () => {
    const { redisMock, store } = harness;
    redisMock.eval.mockResolvedValueOnce("__created__");

    await store.createExecutionWithIdempotencyKey({
      execution: {
        id: "exec-encoded",
        taskId: "task/with spaces",
        input: undefined,
        status: "pending",
        attempt: 1,
        maxAttempts: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      taskId: "task/with spaces",
      idempotencyKey: "key:with?chars",
    });

    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.any(String),
      5,
      "durable:idem:task%2Fwith%20spaces:key%3Awith%3Fchars",
      "durable:exec:exec-encoded",
      "durable:all_executions",
      "durable:active_executions",
      "durable:stuck_executions",
      expect.any(String),
      "exec-encoded",
      "1",
      "0",
    );

    redisMock.eval.mockResolvedValueOnce(123 as any);
    await expect(
      store.createExecutionWithIdempotencyKey({
        execution: {
          id: "exec-invalid",
          taskId: "t",
          input: undefined,
          status: "pending",
          attempt: 1,
          maxAttempts: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        taskId: "t",
        idempotencyKey: "k",
      }),
    ).rejects.toThrow("Unexpected Redis idempotent execution create response");
  });

  it("saves, fetches, and updates execution state", async () => {
    const { redisMock, store } = harness;
    const execution: Execution = {
      id: "1",
      taskId: "t",
      input: undefined,
      status: "pending",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await store.saveExecution(execution);
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

    redisMock.get.mockResolvedValue(serializer.stringify(execution));
    await expect(store.getExecution("1")).resolves.toEqual(execution);

    redisMock.get.mockResolvedValue(serializer.stringify(execution));
    redisMock.eval.mockResolvedValueOnce("OK");
    await store.updateExecution("1", { status: "failed" });

    redisMock.get.mockResolvedValue(null);
    redisMock.eval.mockResolvedValueOnce(null);
    await store.updateExecution("ghost", { status: "failed" });
    expect(redisMock.eval).toHaveBeenCalledTimes(2);
  });

  it("keeps status indexes aligned across execution writes", async () => {
    const { redisMock, store } = harness;
    await store.saveExecution({
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
    });
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

    await store.saveExecution({
      id: "stuck-1",
      taskId: "t",
      input: undefined,
      status: ExecutionStatus.CompensationFailed,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
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

  it("merges updates without corrupting serializer markers or indexes", async () => {
    const { redisMock, store } = harness;
    const running: Execution = {
      id: "no-status",
      taskId: "t",
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    redisMock.get.mockResolvedValue(serializer.stringify(running));
    redisMock.eval.mockResolvedValueOnce("OK");
    await store.updateExecution("no-status", { timeout: 1234 });

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
      return typeof key === "string" ? (redisState.get(key) ?? null) : null;
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
        const payload =
          typeof executionPayloadUnknown === "string"
            ? executionPayloadUnknown
            : "";
        if (
          !script.includes('redis.call("set", KEYS[1], ARGV[1])') ||
          key.length === 0 ||
          payload.length === 0
        ) {
          return null;
        }
        redisState.set(key, payload);
        return "OK";
      },
    );

    await store.updateExecution("lua-safe-1", {
      status: ExecutionStatus.Completed,
      completedAt: new Date("2024-01-02T03:04:05.000Z"),
      cancelledAt: new Date("2024-01-02T04:05:06.000Z"),
    });

    await expect(store.getExecution("lua-safe-1")).resolves.toEqual(
      expect.objectContaining({
        status: ExecutionStatus.Completed,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
        completedAt: expect.any(Date),
        cancelledAt: expect.any(Date),
      }),
    );
  });

  it("returns null when Redis GET returns a non-string", async () => {
    const { redisMock, store } = harness;
    redisMock.get.mockResolvedValueOnce(123 as any);
    await expect(store.getExecution("e1")).resolves.toBeNull();
  });
});
