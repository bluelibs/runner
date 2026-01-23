import { MemoryStore } from "../../durable/store/MemoryStore";

describe("durable: MemoryStore", () => {
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

    const results = await store.listStepResults?.("e1");
    expect(results?.map((r) => r.stepId)).toEqual(["s1", "s2"]);

    expect(await store.listStepResults?.("missing")).toEqual([]);
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
});
