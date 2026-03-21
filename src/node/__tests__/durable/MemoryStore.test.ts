import { MemoryStore } from "../../durable/store/MemoryStore";
import { ExecutionStatus } from "../../durable/core/types";
import { createSignalWaiterSortKey } from "../../durable/core/signalWaiters";

describe("durable: MemoryStore", () => {
  it("creates idempotent executions transactionally", async () => {
    const store = new MemoryStore();
    const execution = {
      id: "e1",
      taskId: "t",
      input: { ok: true },
      status: "pending" as const,
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
    ).resolves.toEqual({
      created: true,
      executionId: "e1",
    });

    await expect(
      store.createExecutionWithIdempotencyKey({
        execution: { ...execution, id: "e2" },
        taskId: "t",
        idempotencyKey: "k",
      }),
    ).resolves.toEqual({
      created: false,
      executionId: "e1",
    });

    await expect(store.getExecution("e1")).resolves.toEqual(execution);
    await expect(store.getExecution("e2")).resolves.toBeNull();
  });

  it("only replaces executions when the expected status still matches", async () => {
    const store = new MemoryStore();
    const execution = {
      id: "e1",
      taskId: "t",
      input: undefined,
      status: "pending" as const,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await store.saveExecution(execution);

    await expect(
      store.saveExecutionIfStatus(
        {
          ...execution,
          status: "running",
        },
        ["pending"],
      ),
    ).resolves.toBe(true);

    await expect(
      store.saveExecutionIfStatus(
        {
          ...execution,
          status: "completed",
          result: "done",
        },
        ["pending"],
      ),
    ).resolves.toBe(false);
    expect((await store.getExecution("e1"))?.status).toBe("running");
  });

  it("returns false when saveExecutionIfStatus targets a missing execution", async () => {
    const store = new MemoryStore();

    await expect(
      store.saveExecutionIfStatus(
        {
          id: "missing",
          taskId: "t",
          input: undefined,
          status: "running",
          attempt: 1,
          maxAttempts: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        ["pending"],
      ),
    ).resolves.toBe(false);
  });

  it("supports operator actions (and no-ops when execution is missing)", async () => {
    const store = new MemoryStore();

    await expect(store.retryRollback("missing")).resolves.toBeUndefined();
    await expect(
      store.forceFail("missing", { message: "x" }),
    ).resolves.toBeUndefined();

    await store.saveExecution({
      id: "e1",
      taskId: "t",
      input: undefined,
      status: "compensation_failed",
      error: { message: "boom" },
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await store.retryRollback("e1");
    const afterRetry = await store.getExecution("e1");
    expect(afterRetry?.status).toBe("pending");
    expect(afterRetry?.error).toBeUndefined();

    await store.forceFail("e1", { message: "manual", stack: "s" });
    const afterFail = await store.getExecution("e1");
    expect(afterFail?.status).toBe("failed");
    expect(afterFail?.error).toEqual({ message: "manual", stack: "s" });
  });

  it("supports skipping and editing step results", async () => {
    const store = new MemoryStore();

    await store.skipStep("e1", "s1");
    expect((await store.getStepResult("e1", "s1"))?.result).toEqual({
      skipped: true,
      manual: true,
    });

    await store.editStepResult("e1", "s2", { ok: true });
    expect((await store.getStepResult("e1", "s2"))?.result).toEqual({
      ok: true,
    });
  });

  it("supports dashboard listing APIs", async () => {
    const store = new MemoryStore();
    const now = new Date();

    await store.saveExecution({
      id: "e1",
      taskId: "t1",
      input: undefined,
      status: "pending",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(now.getTime() - 10),
      updatedAt: now,
    });
    await store.saveExecution({
      id: "e2",
      taskId: "t2",
      input: undefined,
      status: "compensation_failed",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(now.getTime() - 5),
      updatedAt: now,
    });

    await store.saveStepResult({
      executionId: "e1",
      stepId: "s2",
      result: "b",
      completedAt: new Date(now.getTime() + 2),
    });
    await store.saveStepResult({
      executionId: "e1",
      stepId: "s1",
      result: "a",
      completedAt: new Date(now.getTime() + 1),
    });

    const all = await store.listExecutions?.();
    expect(all?.map((e) => e.id)).toEqual(["e2", "e1"]);

    const onlyPending = await store.listExecutions?.({ status: ["pending"] });
    expect(onlyPending?.map((e) => e.id)).toEqual(["e1"]);

    const byTask = await store.listExecutions?.({ taskId: "t2" });
    expect(byTask?.map((e) => e.id)).toEqual(["e2"]);

    const paged = await store.listExecutions?.({ offset: 1, limit: 1 });
    expect(paged?.map((e) => e.id)).toEqual(["e1"]);

    const results = await store.listStepResults("e1");
    expect(results.map((r) => r.stepId)).toEqual(["s1", "s2"]);

    expect(await store.listStepResults("missing")).toEqual([]);
  });

  it("supports timers, schedules, locks, and audit pagination", async () => {
    const store = new MemoryStore();
    const now = new Date();

    await store.saveExecution({
      id: "e1",
      taskId: "t1",
      input: undefined,
      status: "running",
      attempt: 1,
      maxAttempts: 1,
      createdAt: now,
      updatedAt: now,
    });
    await store.saveExecution({
      id: "e2",
      taskId: "t2",
      input: undefined,
      status: "completed",
      attempt: 1,
      maxAttempts: 1,
      createdAt: now,
      updatedAt: now,
    });
    await store.saveExecution({
      id: "e3",
      taskId: "t3",
      input: undefined,
      status: "compensation_failed",
      attempt: 1,
      maxAttempts: 1,
      createdAt: now,
      updatedAt: now,
    });

    await store.saveExecution({
      id: "e4",
      taskId: "t4",
      input: undefined,
      status: ExecutionStatus.Cancelled,
      error: { message: "cancelled" },
      attempt: 1,
      maxAttempts: 1,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });

    expect((await store.listIncompleteExecutions()).map((e) => e.id)).toEqual([
      "e1",
    ]);
    expect((await store.listStuckExecutions()).map((e) => e.id)).toEqual([
      "e3",
    ]);

    await store.appendAuditEntry({
      id: "a1",
      executionId: "e1",
      at: new Date(now.getTime() - 10),
      attempt: 1,
      kind: "note",
      message: "first",
    });
    await store.appendAuditEntry({
      id: "a2",
      executionId: "e1",
      at: new Date(now.getTime() - 5),
      attempt: 1,
      kind: "note",
      message: "second",
    });
    const paged = await store.listAuditEntries("e1", { offset: 1, limit: 1 });
    expect(paged.map((e) => (e.kind === "note" ? e.message : "x"))).toEqual([
      "second",
    ]);

    await store.createTimer({
      id: "t1",
      executionId: "e1",
      stepId: "s1",
      type: "sleep",
      fireAt: new Date(now.getTime() - 1),
      status: "pending",
    });
    await store.createTimer({
      id: "t2",
      executionId: "e1",
      stepId: "s2",
      type: "sleep",
      fireAt: new Date(now.getTime() + 10_000),
      status: "pending",
    });

    const ready = await store.getReadyTimers(now);
    expect(ready.map((t) => t.id)).toEqual(["t1"]);
    await store.markTimerFired("t1");
    await store.deleteTimer("t2");

    const firstClaim = await store.claimTimer("t1", "worker-1", 1000);
    const secondClaim = await store.claimTimer("t1", "worker-2", 1000);
    expect(firstClaim).toBe(true);
    expect(secondClaim).toBe(false);

    await expect(
      store.renewTimerClaim("missing", "worker-1", 1000),
    ).resolves.toBe(false);
    await expect(store.renewTimerClaim("t1", "worker-1", 1000)).resolves.toBe(
      true,
    );
    await expect(store.renewTimerClaim("t1", "worker-2", 1000)).resolves.toBe(
      false,
    );

    await store.createSchedule({
      id: "s1",
      taskId: "t1",
      type: "interval",
      pattern: "1000",
      input: undefined,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await store.createSchedule({
      id: "s2",
      taskId: "t2",
      type: "cron",
      pattern: "0 0 * * *",
      input: undefined,
      status: "paused",
      createdAt: now,
      updatedAt: now,
    });
    expect((await store.listSchedules()).length).toBe(2);
    expect((await store.listActiveSchedules()).map((s) => s.id)).toEqual([
      "s1",
    ]);
    await store.updateSchedule("missing", { status: "paused" });
    await store.updateSchedule("s1", { status: "paused" });
    await store.deleteSchedule("s2");

    const lockId = await store.acquireLock("res", 1000);
    expect(lockId).not.toBeNull();
    expect(await store.acquireLock("res", 1000)).toBeNull();
    await store.releaseLock("res", "wrong");
    await store.releaseLock("res", lockId!);
  });

  it("returns null when no signal waiter exists", async () => {
    const store = new MemoryStore();

    await expect(store.takeNextSignalWaiter("e1", "paid")).resolves.toBeNull();
  });

  it("returns null when a waiter bucket exists but no waiter can be selected", async () => {
    const store = new MemoryStore();
    const emptyBucket = {
      size: 1,
      values: function* () {},
      delete: jest.fn(),
    };

    (
      store as unknown as {
        signalWaiters: Map<string, Map<string, typeof emptyBucket>>;
      }
    ).signalWaiters = new Map([["e1", new Map([["paid", emptyBucket]])]]);

    await expect(store.takeNextSignalWaiter("e1", "paid")).resolves.toBeNull();
  });

  it("ignores deleteSignalWaiter() when no waiter bucket exists", async () => {
    const store = new MemoryStore();

    await expect(
      store.deleteSignalWaiter("e1", "paid", "__signal:paid"),
    ).resolves.toBeUndefined();
  });

  it("keeps other signal buckets when deleting the final waiter for one signal", async () => {
    const store = new MemoryStore();

    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "shipped",
      stepId: "__signal:shipped",
      sortKey: createSignalWaiterSortKey("shipped", "__signal:shipped"),
    });

    await store.deleteSignalWaiter("e1", "paid", "__signal:paid");

    await expect(store.takeNextSignalWaiter("e1", "paid")).resolves.toBeNull();
    await expect(store.takeNextSignalWaiter("e1", "shipped")).resolves.toEqual({
      executionId: "e1",
      signalId: "shipped",
      stepId: "__signal:shipped",
      sortKey: createSignalWaiterSortKey("shipped", "__signal:shipped"),
    });
  });

  it("removes the execution waiter bucket when deleting the final waiter overall", async () => {
    const store = new MemoryStore();

    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    });

    await store.deleteSignalWaiter("e1", "paid", "__signal:paid");

    expect(
      (
        store as unknown as {
          signalWaiters: Map<string, Map<string, unknown>>;
        }
      ).signalWaiters.has("e1"),
    ).toBe(false);
  });

  it("removes the execution waiter bucket when taking the final waiter overall", async () => {
    const store = new MemoryStore();

    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    });

    await expect(store.takeNextSignalWaiter("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    });
    expect(
      (
        store as unknown as {
          signalWaiters: Map<string, Map<string, unknown>>;
        }
      ).signalWaiters.has("e1"),
    ).toBe(false);
  });

  it("keeps the execution waiter bucket when taking the final waiter for one of multiple signals", async () => {
    const store = new MemoryStore();

    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "shipped",
      stepId: "__signal:shipped",
      sortKey: createSignalWaiterSortKey("shipped", "__signal:shipped"),
    });

    await expect(store.takeNextSignalWaiter("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
    });
    expect(
      (
        store as unknown as {
          signalWaiters: Map<string, Map<string, unknown>>;
        }
      ).signalWaiters.has("e1"),
    ).toBe(true);
    await expect(store.takeNextSignalWaiter("e1", "shipped")).resolves.toEqual({
      executionId: "e1",
      signalId: "shipped",
      stepId: "__signal:shipped",
      sortKey: createSignalWaiterSortKey("shipped", "__signal:shipped"),
    });
  });

  it("stores signal history separately from the queued signal records", async () => {
    const store = new MemoryStore();
    const record = {
      id: "sig-1",
      payload: { paidAt: 1 },
      receivedAt: new Date(),
    };
    const queuedRecord = {
      ...record,
    };

    await expect(store.getSignalState("e1", "paid")).resolves.toBeNull();

    await store.appendSignalRecord("e1", "paid", record);
    await expect(
      store.enqueueQueuedSignalRecord("e1", "paid", queuedRecord),
    ).resolves.toBeUndefined();
    await expect(store.getSignalState("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      queued: [queuedRecord],
      history: [record],
    });

    await expect(
      store.enqueueQueuedSignalRecord("e1", "paid", queuedRecord),
    ).resolves.toBeUndefined();
    await expect(store.getSignalState("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      queued: [queuedRecord, queuedRecord],
      history: [record],
    });

    await expect(
      store.consumeQueuedSignalRecord("e1", "paid"),
    ).resolves.toEqual(record);
    await expect(
      store.consumeQueuedSignalRecord("e1", "paid"),
    ).resolves.toEqual(record);
    await expect(
      store.consumeQueuedSignalRecord("e1", "paid"),
    ).resolves.toBeNull();

    expect((await store.getSignalState("e1", "paid"))?.queued).toEqual([]);
  });

  it("keeps duplicate queued signal records in FIFO order", async () => {
    const store = new MemoryStore();
    const queuedRecord = {
      id: "sig-1",
      payload: { paidAt: 1 },
      receivedAt: new Date(),
    };

    await expect(
      store.enqueueQueuedSignalRecord("e1", "paid", queuedRecord),
    ).resolves.toBeUndefined();
    await expect(
      store.enqueueQueuedSignalRecord("e1", "paid", {
        ...queuedRecord,
        id: "sig-2",
      }),
    ).resolves.toBeUndefined();
    expect((await store.getSignalState("e1", "paid"))?.queued).toHaveLength(2);
  });

  it("orders and deletes signal waiters by sort key", async () => {
    const store = new MemoryStore();

    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:stable-paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:stable-paid"),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid:2",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid:2"),
    });
    await store.upsertSignalWaiter({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
      timerId: "timer-1",
    });

    await store.deleteSignalWaiter("e1", "paid", "__signal:paid:2");

    await expect(store.takeNextSignalWaiter("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:paid"),
      timerId: "timer-1",
    });
    await expect(store.takeNextSignalWaiter("e1", "paid")).resolves.toEqual({
      executionId: "e1",
      signalId: "paid",
      stepId: "__signal:stable-paid",
      sortKey: createSignalWaiterSortKey("paid", "__signal:stable-paid"),
    });
    await expect(store.takeNextSignalWaiter("e1", "paid")).resolves.toBeNull();
  });
});
