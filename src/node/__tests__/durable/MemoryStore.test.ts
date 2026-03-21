import { MemoryStore } from "../../durable/store/MemoryStore";
import { type Execution } from "../../durable/core/types";

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

    await saveExecution(store, {
      id: "e1",
      taskId: "t",
      status: "compensation_failed",
      error: { message: "boom" },
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

    await saveExecution(store, {
      id: "e1",
      taskId: "t1",
      status: "pending",
      createdAt: new Date(now.getTime() - 10),
      updatedAt: now,
    });
    await saveExecution(store, {
      id: "e2",
      taskId: "t2",
      status: "compensation_failed",
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
});
