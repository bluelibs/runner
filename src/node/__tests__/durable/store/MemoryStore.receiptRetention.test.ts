import { MemoryStore } from "../../../durable/store/MemoryStore";
import { assertChildRetentionAfterParentExpiry } from "./receiptRetentionParent.helpers";
import {
  ExecutionStatus,
  TimerStatus,
  TimerType,
  type Execution,
} from "../../../durable/core/types";

const t0 = new Date("2025-01-01T00:00:00.000Z");

function completedExecution(
  id: string,
  at: Date,
  overrides: Partial<Execution> = {},
): Execution {
  return {
    id,
    workflowKey: "wf",
    input: { secret: id },
    result: { ok: id },
    status: ExecutionStatus.Completed,
    attempt: 1,
    maxAttempts: 1,
    createdAt: at,
    updatedAt: at,
    completedAt: at,
    retention: { onComplete: { afterMs: 1_000 }, receipts: { afterMs: 5_000 } },
    ...overrides,
  };
}

describe("durable: MemoryStore receipt retention", () => {
  it("collects a local child after its parent's receipt expires", async () => {
    await assertChildRetentionAfterParentExpiry(new MemoryStore());
  });

  it("supports two-stage cleanup and releases idempotency keys after expiry", async () => {
    const store = new MemoryStore();
    await expect(
      store.createExecutionWithIdempotencyKey({
        execution: completedExecution("exec-1", t0),
        workflowKey: "wf",
        idempotencyKey: "k-1",
      }),
    ).resolves.toEqual({ created: true, executionId: "exec-1" });
    await store.saveStepResult({
      executionId: "exec-1",
      stepId: "s1",
      result: 42,
      completedAt: t0,
    });

    expect(
      await store.collectExpiredReceipts(new Date(t0.getTime() + 1_500), 10),
    ).toBe(0);
    expect(
      await store.collectCompletedHistory(new Date(t0.getTime() + 1_500), 10),
    ).toBe(1);
    expect(await store.listStepResults("exec-1")).toEqual([]);
    expect((await store.getExecution("exec-1"))?.result).toEqual({
      ok: "exec-1",
    });

    await expect(
      store.createExecutionWithIdempotencyKey({
        execution: completedExecution("exec-1-dup", t0),
        workflowKey: "wf",
        idempotencyKey: "k-1",
      }),
    ).resolves.toEqual({ created: false, executionId: "exec-1" });

    expect(
      await store.collectExpiredReceipts(new Date(t0.getTime() + 5_000), 10),
    ).toBe(1);
    expect(await store.getExecution("exec-1")).toBeNull();
    expect(await store.getExecutionState("exec-1")).toBeNull();
    expect(await store.listExecutions()).toEqual([]);

    await expect(
      store.createExecutionWithIdempotencyKey({
        execution: completedExecution("exec-2", t0),
        workflowKey: "wf",
        idempotencyKey: "k-1",
      }),
    ).resolves.toEqual({ created: true, executionId: "exec-2" });
  });

  it("supports one-stage deletion with commands, timers, and rebound idempotency keys", async () => {
    const store = new MemoryStore();
    const running: Execution = {
      id: "exec-cmd",
      workflowKey: "wf",
      input: { a: 1 },
      status: ExecutionStatus.Running,
      workflowVersion: 1,
      attempt: 1,
      maxAttempts: 1,
      createdAt: t0,
      updatedAt: t0,
    };
    await store.createExecutionWithIdempotencyKey({
      execution: running,
      workflowKey: "wf",
      idempotencyKey: "rebound",
    });
    await store.saveExecution({ ...running, id: "other-exec" });
    const cmd = {
      id: "cmd-1",
      requestedExecutionId: "exec-cmd",
      executionId: "exec-cmd",
      taskKey: "cmd.task",
      workflowVersion: 1,
      input: undefined,
      status: "pending" as const,
      createdAt: t0,
    };
    await store.enqueueCommand(cmd);
    await store.enqueueCommand({
      ...cmd,
      id: "cmd-other",
      requestedExecutionId: "other-exec",
      executionId: "other-exec",
    });
    await store.completeCommand(
      { ...cmd, status: "completed", completedAt: t0 },
      running,
    );
    await store.saveExecution(
      completedExecution("exec-cmd", t0, {
        retention: { onComplete: "retain", receipts: "delete" },
      }),
    );
    await store.createTimer({
      id: "t-exp",
      executionId: "exec-cmd",
      type: TimerType.Sleep,
      fireAt: t0,
      status: TimerStatus.Pending,
    });
    await store.createTimer({
      id: "t-keep",
      executionId: "other-exec",
      type: TimerType.Sleep,
      fireAt: t0,
      status: TimerStatus.Pending,
    });
    const internals = store as unknown as {
      runtime: {
        executionIdByIdempotencyKey: Map<string, string>;
        recordIdempotencyKey: (k: string, id: string) => void;
      };
    };
    internals.runtime.recordIdempotencyKey("wf::extra", "exec-cmd");
    internals.runtime.executionIdByIdempotencyKey.set(
      "wf::rebound",
      "other-exec",
    );

    expect(await store.collectCompletedHistory(t0, 10)).toBe(0);
    expect(await store.collectExpiredReceipts(t0, 10)).toBe(1);
    expect(await store.getExecution("exec-cmd")).toBeNull();
    expect(await store.getCommand("cmd-1")).toBeNull();
    expect(await store.getReadyTimers(t0)).toHaveLength(1);
    expect(
      internals.runtime.executionIdByIdempotencyKey.get("wf::rebound"),
    ).toBe("other-exec");
  });

  it("enforces guards, limit, policy changes, and expired locks", async () => {
    const store = new MemoryStore();
    await store.saveExecution(
      completedExecution("parent", t0, {
        status: ExecutionStatus.Running,
        retention: { onComplete: "retain", receipts: "delete" },
      }),
    );
    await store.saveExecution(
      completedExecution("child", t0, {
        parentExecutionId: "parent",
        retention: { onComplete: "retain", receipts: "delete" },
      }),
    );
    await store.saveExecution(
      completedExecution("queued", t0, {
        status: ExecutionStatus.Running,
        workflowVersion: 1,
        retention: { onComplete: "retain", receipts: "delete" },
      }),
    );
    await store.enqueueCommand({
      id: "cmd-q",
      requestedExecutionId: "queued",
      executionId: "queued",
      taskKey: "cmd.task",
      workflowVersion: 1,
      input: undefined,
      status: "pending",
      createdAt: t0,
    });
    await store.saveExecution(
      completedExecution("queued", t0, {
        retention: { onComplete: "retain", receipts: "delete" },
      }),
    );
    await store.saveExecution(
      completedExecution("stale-history", t0, {
        retention: { onComplete: "delete" },
      }),
    );
    await store.saveExecution(
      completedExecution("stale-deadline", t0, {
        retention: { onComplete: "retain", receipts: "delete" },
      }),
    );
    const internals = store as unknown as {
      runtime: {
        executions: Map<string, Execution>;
        locks: Map<string, { id: string; expires: number }>;
      };
    };
    internals.runtime.executions.set(
      "stale-history",
      completedExecution("stale-history", t0, {
        retention: { onComplete: "retain" },
      }),
    );
    internals.runtime.executions.set(
      "stale-deadline",
      completedExecution("stale-deadline", t0, {
        retention: { onComplete: "retain" },
      }),
    );
    internals.runtime.locks.set("execution:stale-deadline", {
      id: "l1",
      expires: t0.getTime() - 1,
    });

    await store.saveExecution(
      completedExecution("limit-1", t0, {
        retention: { onComplete: "retain", receipts: "delete" },
      }),
    );
    await store.saveExecution(
      completedExecution("limit-2", t0, {
        retention: { onComplete: "retain", receipts: "delete" },
      }),
    );
    expect(await store.collectCompletedHistory(t0, 10)).toBe(0);
    expect(await store.collectExpiredReceipts(t0, 1)).toBe(1);
    expect(await store.collectExpiredReceipts(t0, 10)).toBe(1);
    expect(await store.getExecution("child")).not.toBeNull();
    expect(await store.getExecution("queued")).not.toBeNull();
  });
});
