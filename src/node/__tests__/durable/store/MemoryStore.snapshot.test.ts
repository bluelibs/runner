import { DurableAuditEntryKind } from "../../../durable/core/audit";
import { MemoryStore } from "../../../durable/store/MemoryStore";
import { TimerStatus } from "../../../durable/core/types";

describe("durable: MemoryStore snapshot", () => {
  it("exports and restores the full durable truth while resetting locks", async () => {
    const store = new MemoryStore();
    const executionId = "snapshot-execution";
    const targetExecutionId = "snapshot-child";
    const signalId = "approved";
    const signalRecord = {
      id: "signal-1",
      payload: { approvedBy: "ada" },
      receivedAt: new Date("2026-03-25T10:00:03.000Z"),
    };
    const timer = {
      id: "timer-1",
      executionId,
      stepId: "sleep",
      type: "sleep" as const,
      fireAt: new Date("2026-03-25T10:01:00.000Z"),
      status: TimerStatus.Pending,
    };
    const schedule = {
      id: "schedule-1",
      workflowKey: "workflow.snapshot",
      type: "cron" as const,
      pattern: "*/5 * * * *",
      input: { tenantId: "tenant-1" },
      status: "active" as const,
      createdAt: new Date("2026-03-25T10:00:00.000Z"),
      updatedAt: new Date("2026-03-25T10:00:01.000Z"),
      nextRun: new Date("2026-03-25T10:05:00.000Z"),
    };

    await store.saveExecution({
      id: executionId,
      workflowKey: "workflow.snapshot",
      input: { requestId: "req-1" },
      status: "running",
      attempt: 1,
      maxAttempts: 3,
      createdAt: new Date("2026-03-25T10:00:00.000Z"),
      updatedAt: new Date("2026-03-25T10:00:00.000Z"),
    });
    await store.saveStepResult({
      executionId,
      stepId: "step-1",
      result: { ok: true },
      completedAt: new Date("2026-03-25T10:00:02.000Z"),
    });
    await store.bufferSignalRecord(executionId, signalId, signalRecord);
    await store.upsertSignalWaiter({
      executionId,
      signalId,
      stepId: "wait-signal",
      sortKey: "0001",
      timerId: "signal-timeout-1",
    });
    await store.upsertExecutionWaiter({
      executionId,
      targetExecutionId,
      stepId: "wait-child",
      timerId: "wait-exec-timeout-1",
    });
    await store.appendAuditEntry({
      id: "audit-1",
      executionId,
      at: new Date("2026-03-25T10:00:04.000Z"),
      kind: DurableAuditEntryKind.Note,
      attempt: 1,
      workflowKey: "workflow.snapshot",
      message: "remember this",
      meta: { source: "snapshot-test" },
    });
    await store.createTimer(timer);
    await store.createSchedule(schedule);
    const heldLockId = await store.acquireLock("snapshot-lock", 10_000);
    expect(heldLockId).not.toBeNull();

    const snapshot = store.exportSnapshot();
    expect(snapshot.executions).toHaveLength(1);
    expect(snapshot.stepResults).toHaveLength(1);
    expect(snapshot.signalStates).toHaveLength(1);
    expect(snapshot.signalWaiters).toHaveLength(1);
    expect(snapshot.executionWaiters).toHaveLength(1);
    expect(snapshot.auditEntries).toHaveLength(1);
    expect(snapshot.timers).toHaveLength(1);
    expect(snapshot.schedules).toHaveLength(1);

    const restored = new MemoryStore();
    restored.restoreSnapshot(snapshot);

    expect(await restored.getExecution(executionId)).toEqual(
      await store.getExecution(executionId),
    );
    expect(await restored.getStepResult(executionId, "step-1")).toEqual(
      await store.getStepResult(executionId, "step-1"),
    );
    expect(await restored.getSignalState(executionId, signalId)).toEqual(
      await store.getSignalState(executionId, signalId),
    );
    expect(await restored.peekNextSignalWaiter(executionId, signalId)).toEqual({
      executionId,
      signalId,
      stepId: "wait-signal",
      sortKey: "0001",
      timerId: "signal-timeout-1",
    });
    expect(await restored.listExecutionWaiters(targetExecutionId)).toEqual([
      {
        executionId,
        targetExecutionId,
        stepId: "wait-child",
        timerId: "wait-exec-timeout-1",
      },
    ]);
    expect(await restored.listAuditEntries(executionId)).toEqual([
      {
        id: "audit-1",
        executionId,
        at: new Date("2026-03-25T10:00:04.000Z"),
        kind: DurableAuditEntryKind.Note,
        attempt: 1,
        workflowKey: "workflow.snapshot",
        message: "remember this",
        meta: { source: "snapshot-test" },
      },
    ]);
    expect(
      await restored.getReadyTimers(new Date("2026-03-25T10:02:00.000Z")),
    ).toEqual([timer]);
    expect(await restored.getSchedule(schedule.id)).toEqual(schedule);

    const restoredLockId = await restored.acquireLock("snapshot-lock", 10_000);
    expect(restoredLockId).not.toBeNull();
  });
});
