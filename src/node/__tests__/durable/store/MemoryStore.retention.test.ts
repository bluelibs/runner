import { requireRestartable } from "../../../durable/core/managers/ExecutionManager.restartGuards";
import { MemoryStore } from "../../../durable/store/MemoryStore";
import { PersistentMemoryStore } from "../../../durable/store/PersistentMemoryStore";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Execution } from "../../../durable/core/types";

const now = new Date("2024-01-01T12:00:00Z");
function completed(id: string, extra: Partial<Execution> = {}): Execution {
  return {
    id,
    workflowKey: "workflow",
    status: "completed",
    attempt: 1,
    maxAttempts: 1,
    input: { large: "payload" },
    result: "receipt",
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    retention: { onComplete: "delete" },
    ...extra,
  };
}

describe("successful execution history collection", () => {
  it("retains defaults, failures, and history before its deadline", async () => {
    const store = new MemoryStore();
    await store.saveExecution(completed("default", { retention: undefined }));
    await store.saveExecution(
      completed("retain", { retention: { onComplete: "retain" } }),
    );
    await store.saveExecution(completed("failed", { status: "failed" }));
    await store.saveExecution(
      completed("later", { retention: { onComplete: { afterMs: 1000 } } }),
    );
    expect(await store.collectCompletedHistory(now, 100)).toBe(0);
    expect(
      await store.collectCompletedHistory(new Date(now.getTime() + 1000), 100),
    ).toBe(1);
    expect((await store.getExecution("later"))!.historyCollectedAt).toEqual(
      new Date(now.getTime() + 1000),
    );
  });

  it("removes history in bounded batches while preserving results and idempotency claims", async () => {
    const store = new MemoryStore();
    await store.createExecutionWithIdempotencyKey({
      execution: completed("one"),
      workflowKey: "workflow",
      idempotencyKey: "domain",
    });
    await store.saveExecution(completed("two"));
    await store.saveStepResult({
      executionId: "one",
      stepId: "effect",
      result: "large",
      completedAt: now,
    });
    expect(await store.collectCompletedHistory(now, 1)).toBe(1);
    expect(await store.listStepResults("one")).toEqual([]);
    expect(await store.getExecution("one")).toMatchObject({
      result: "receipt",
      input: undefined,
    });
    expect(
      await store.createExecutionWithIdempotencyKey({
        execution: completed("duplicate"),
        workflowKey: "workflow",
        idempotencyKey: "domain",
      }),
    ).toEqual({ created: false, executionId: "one" });
    expect(await store.collectCompletedHistory(now, 1)).toBe(1);
    expect(await store.collectCompletedHistory(now, 100)).toBe(0);
  });

  it("protects active parents, outstanding waiters, and completion ownership", async () => {
    const store = new MemoryStore();
    await store.saveExecution(completed("parent", { status: "running" }));
    await store.saveExecution(
      completed("child", { parentExecutionId: "parent" }),
    );
    await store.saveExecution(
      completed("unknownParent", { parentExecutionId: "missing" }),
    );
    await store.saveExecution(completed("locked"));
    const token = await store.acquireLock("execution:locked", 30_000);
    await store.saveExecution(completed("waited"));
    await store.upsertExecutionWaiter({
      targetExecutionId: "waited",
      executionId: "parent",
      stepId: "wait",
    });
    expect(await store.collectCompletedHistory(new Date(), 100)).toBe(0);
    await store.saveExecution(completed("parent"));
    await store.releaseLock("execution:locked", token!);
    await store.deleteExecutionWaiter("waited", "parent", "wait");
    expect(await store.collectCompletedHistory(new Date(), 100)).toBe(4);
  });

  it("removes owned timers and rejects restarting compacted history", async () => {
    const store = new MemoryStore();
    await store.saveExecution(completed("one"));
    await store.createTimer({
      id: "owned",
      executionId: "one",
      type: "sleep",
      status: "pending",
      fireAt: now,
    });
    await store.createTimer({
      id: "other",
      executionId: "other",
      type: "sleep",
      status: "pending",
      fireAt: now,
    });
    expect(await store.collectCompletedHistory(now, 100)).toBe(1);
    expect((await store.getReadyTimers(now)).map((timer) => timer.id)).toEqual([
      "other",
    ]);
    await expect(
      requireRestartable(store, "one", await store.getExecution("one")),
    ).rejects.toThrow("history collected");
  });

  it("does not collect an execution changed by an operator", async () => {
    const store = new MemoryStore();
    await store.saveExecution(completed("one"));
    await store.forceFail("one", { message: "operator action" });
    expect(await store.collectCompletedHistory(now, 100)).toBe(0);
  });

  it("persists collection and completion receipts across file-store restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "runner-retention-"));
    try {
      const filePath = join(directory, "state.json");
      const store = new PersistentMemoryStore({ filePath });
      await store.init();
      await store.saveExecution(completed("one"));
      await store.saveStepResult({
        executionId: "one",
        stepId: "effect",
        result: 1,
        completedAt: now,
      });
      await store.collectCompletedHistory(now, 100);
      await store.dispose();
      const restored = new PersistentMemoryStore({ filePath });
      await restored.init();
      expect(await restored.listStepResults("one")).toEqual([]);
      expect(await restored.getExecution("one")).toMatchObject({
        result: "receipt",
        historyCollectedAt: now,
      });
      expect(await restored.collectCompletedHistory(now, 100)).toBe(0);
      await restored.dispose();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
