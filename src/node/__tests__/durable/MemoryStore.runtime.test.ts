import { MemoryStore } from "../../durable/store/MemoryStore";
import { ExecutionStatus, type Execution } from "../../durable/core/types";

function createExecution(
  overrides: Partial<Execution> & {
    id: string;
    taskId: string;
    status: Execution["status"];
  },
): Execution {
  const { id, taskId, status, ...rest } = overrides;

  return {
    input: undefined,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...rest,
    id,
    taskId,
    status,
  };
}

async function saveExecution(
  store: MemoryStore,
  overrides: Parameters<typeof createExecution>[0],
): Promise<void> {
  await store.saveExecution(createExecution(overrides));
}

describe("durable: MemoryStore runtime surfaces", () => {
  it("supports timers, schedules, locks, and audit pagination", async () => {
    const store = new MemoryStore();
    const now = new Date();

    await saveExecution(store, {
      id: "e1",
      taskId: "t1",
      status: "running",
      createdAt: now,
      updatedAt: now,
    });
    await saveExecution(store, {
      id: "e2",
      taskId: "t2",
      status: "completed",
      createdAt: now,
      updatedAt: now,
    });
    await saveExecution(store, {
      id: "e3",
      taskId: "t3",
      status: "compensation_failed",
      createdAt: now,
      updatedAt: now,
    });
    await saveExecution(store, {
      id: "e4",
      taskId: "t4",
      status: ExecutionStatus.Cancelled,
      error: { message: "cancelled" },
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
});
