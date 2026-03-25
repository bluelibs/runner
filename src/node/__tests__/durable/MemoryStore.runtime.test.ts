import { MemoryStore } from "../../durable/store/MemoryStore";
import { ExecutionStatus, type Execution } from "../../durable/core/types";

function createExecution(
  overrides: Partial<Execution> & {
    id: string;
    workflowKey: string;
    status: Execution["status"];
  },
): Execution {
  const { id, workflowKey, status, ...rest } = overrides;

  return {
    input: undefined,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...rest,
    id,
    workflowKey,
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
  it("lists incomplete and stuck executions", async () => {
    const store = new MemoryStore();
    const now = new Date();

    await saveExecution(store, {
      id: "e1",
      workflowKey: "t1",
      status: "running",
      createdAt: now,
      updatedAt: now,
    });
    await saveExecution(store, {
      id: "e2",
      workflowKey: "t2",
      status: "completed",
      createdAt: now,
      updatedAt: now,
    });
    await saveExecution(store, {
      id: "e3",
      workflowKey: "t3",
      status: "compensation_failed",
      createdAt: now,
      updatedAt: now,
    });
    await saveExecution(store, {
      id: "e4",
      workflowKey: "t4",
      status: ExecutionStatus.Cancelled,
      error: { message: "cancelled" },
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });

    await expect(store.listIncompleteExecutions()).resolves.toEqual([
      expect.objectContaining({ id: "e1" }),
    ]);
    await expect(store.listStuckExecutions()).resolves.toEqual([
      expect.objectContaining({ id: "e3" }),
    ]);
  });

  it("paginates audit entries", async () => {
    const store = new MemoryStore();
    const now = new Date();

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
  });

  it("preserves execution dates across reads and snapshots", async () => {
    const store = new MemoryStore();
    const nestedWhen = new Date("2026-03-25T10:00:00.000Z");
    const input = {
      nestedWhen,
      pattern: /memory/gi,
      bytes: new Uint8Array([1, 2, 3]),
      tags: new Set(["sticky", "durable"]),
      timeline: [nestedWhen],
      checkpoints: new Map([["wakeAt", new Date("2026-03-25T10:00:04.000Z")]]),
    };
    Object.defineProperty(input, "summary", {
      enumerable: true,
      get: () => "sticky",
    });

    const execution: Execution = {
      id: "dated",
      workflowKey: "workflow.dated",
      input,
      status: "running",
      attempt: 1,
      maxAttempts: 1,
      current: {
        kind: "step",
        stepId: "remember",
        startedAt: new Date("2026-03-25T10:00:01.000Z"),
      },
      createdAt: new Date("2026-03-25T10:00:02.000Z"),
      updatedAt: new Date("2026-03-25T10:00:03.000Z"),
    };

    await store.saveExecution(execution);

    const storedExecution = await store.getExecution(execution.id);
    expect(storedExecution).toEqual(execution);
    expect(storedExecution?.input).toMatchObject({ summary: "sticky" });
    expect(
      Object.getOwnPropertyDescriptor(
        storedExecution!.input as object,
        "summary",
      )?.get,
    ).toBeInstanceOf(Function);
    expect(store.exportSnapshot().executions).toEqual([execution]);
  });

  it("handles timer lifecycle and exclusive claims", async () => {
    const store = new MemoryStore();
    const now = new Date();

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
    await expect(store.releaseTimerClaim("t1", "worker-2")).resolves.toBe(
      false,
    );
    await expect(store.releaseTimerClaim("t1", "worker-1")).resolves.toBe(true);
    await expect(store.claimTimer("t1", "worker-2", 1000)).resolves.toBe(true);

    await expect(store.finalizeClaimedTimer("t1", "worker-2")).resolves.toBe(
      true,
    );
  });

  it("claims ready timers in bounded ready-order without duplicating leases", async () => {
    const store = new MemoryStore();
    const now = new Date();

    await store.createTimer({
      id: "t3",
      executionId: "e3",
      stepId: "s3",
      type: "sleep",
      fireAt: new Date(now.getTime() - 5),
      status: "pending",
    });
    await store.createTimer({
      id: "t1",
      executionId: "e1",
      stepId: "s1",
      type: "sleep",
      fireAt: new Date(now.getTime() - 20),
      status: "pending",
    });
    await store.createTimer({
      id: "t2",
      executionId: "e2",
      stepId: "s2",
      type: "sleep",
      fireAt: new Date(now.getTime() - 20),
      status: "pending",
    });
    await store.createTimer({
      id: "future",
      executionId: "ef",
      stepId: "sf",
      type: "sleep",
      fireAt: new Date(now.getTime() + 60_000),
      status: "pending",
    });

    const claimedByWorker1 = await store.claimReadyTimers(
      now,
      2,
      "worker-1",
      1_000,
    );
    expect(claimedByWorker1.map((timer) => timer.id)).toEqual(["t1", "t2"]);

    const claimedByWorker2 = await store.claimReadyTimers(
      now,
      2,
      "worker-2",
      1_000,
    );
    expect(claimedByWorker2.map((timer) => timer.id)).toEqual(["t3"]);
    await expect(
      store.claimReadyTimers(now, 0, "worker-3", 1_000),
    ).resolves.toEqual([]);
  });

  it("releases claims when a ready timer disappears during claimReadyTimers()", async () => {
    class VolatileClaimStore extends MemoryStore {
      override async claimTimer(
        timerId: string,
        workerId: string,
        ttlMs: number,
      ): Promise<boolean> {
        const claimed = await super.claimTimer(timerId, workerId, ttlMs);
        if (claimed) {
          await this.deleteTimer(timerId);
        }
        return claimed;
      }
    }

    const store = new VolatileClaimStore();
    const now = new Date();
    await store.createTimer({
      id: "volatile",
      executionId: "e1",
      stepId: "s1",
      type: "sleep",
      fireAt: new Date(now.getTime() - 10),
      status: "pending",
    });

    await expect(
      store.claimReadyTimers(now, 1, "worker-1", 1_000),
    ).resolves.toEqual([]);
    await expect(store.claimTimer("volatile", "worker-2", 1_000)).resolves.toBe(
      true,
    );
  });

  it("finalizes claimed timers even if the timer row was already removed", async () => {
    const store = new MemoryStore();
    const now = new Date();

    await store.createTimer({
      id: "t-missing",
      executionId: "e1",
      stepId: "s1",
      type: "sleep",
      fireAt: now,
      status: "pending",
    });

    await expect(store.claimTimer("t-missing", "worker-1", 1000)).resolves.toBe(
      true,
    );
    await store.deleteTimer("t-missing");

    await expect(
      store.finalizeClaimedTimer("t-missing", "worker-1"),
    ).resolves.toBe(true);
  });

  it("supports schedule CRUD helpers", async () => {
    const store = new MemoryStore();
    const now = new Date();

    await store.createSchedule({
      id: "s1",
      workflowKey: "t1",
      type: "interval",
      pattern: "1000",
      input: undefined,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await store.createSchedule({
      id: "s2",
      workflowKey: "t2",
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
    await store.deleteSchedule("missing");
    await store.updateSchedule("missing", { status: "paused" });
    await store.updateSchedule("s1", { status: "paused" });
    await store.deleteSchedule("s2");
  });

  it("acquires and releases locks", async () => {
    const store = new MemoryStore();
    const lockId = await store.acquireLock("res", 1000);
    expect(lockId).not.toBeNull();
    expect(await store.acquireLock("res", 1000)).toBeNull();
    await store.releaseLock("res", "wrong");
    await store.releaseLock("res", lockId!);
  });
});
