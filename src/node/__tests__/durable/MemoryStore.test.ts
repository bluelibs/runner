import { MemoryStore } from "../../durable/store/MemoryStore";
import { type Execution } from "../../durable/core/types";

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

describe("durable: MemoryStore", () => {
  it("creates idempotent executions transactionally", async () => {
    const store = new MemoryStore();
    const execution = {
      id: "e1",
      workflowKey: "t",
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
        workflowKey: "t",
        idempotencyKey: "k",
      }),
    ).resolves.toEqual({
      created: true,
      executionId: "e1",
    });

    await expect(
      store.createExecutionWithIdempotencyKey({
        execution: { ...execution, id: "e2" },
        workflowKey: "t",
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
      workflowKey: "t",
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

  it("returns deep-cloned executions so nested current state stays isolated", async () => {
    const store = new MemoryStore();
    const execution = createExecution({
      id: "e-current",
      workflowKey: "t",
      status: "running",
      current: {
        kind: "waitForSignal",
        stepId: "__signal:paid",
        startedAt: new Date(),
        waitingFor: {
          type: "signal",
          params: {
            signalId: "paid",
            timeoutMs: 1_000,
          },
        },
      },
    });

    await store.saveExecution(execution);

    const firstRead = await store.getExecution("e-current");
    expect(firstRead?.current?.kind).toBe("waitForSignal");
    if (!firstRead || firstRead.current?.kind !== "waitForSignal") {
      return;
    }
    firstRead.current.waitingFor.params.signalId = "mutated";

    const secondRead = await store.getExecution("e-current");
    expect(secondRead?.current).toMatchObject({
      kind: "waitForSignal",
      waitingFor: {
        type: "signal",
        params: {
          signalId: "paid",
        },
      },
    });
  });

  it("returns false when saveExecutionIfStatus targets a missing execution", async () => {
    const store = new MemoryStore();

    await expect(
      store.saveExecutionIfStatus(
        {
          id: "missing",
          workflowKey: "t",
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
      workflowKey: "t",
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
      workflowKey: "t1",
      status: "pending",
      createdAt: new Date(now.getTime() - 10),
      updatedAt: now,
    });
    await saveExecution(store, {
      id: "e2",
      workflowKey: "t2",
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

    const all = await store.listExecutions();
    expect(all.map((e) => e.id)).toEqual(["e2", "e1"]);

    const onlyPending = await store.listExecutions({ status: ["pending"] });
    expect(onlyPending.map((e) => e.id)).toEqual(["e1"]);

    const byTask = await store.listExecutions({ workflowKey: "t2" });
    expect(byTask.map((e) => e.id)).toEqual(["e2"]);

    const paged = await store.listExecutions({ offset: 1, limit: 1 });
    expect(paged.map((e) => e.id)).toEqual(["e1"]);

    const results = await store.listStepResults("e1");
    expect(results.map((r) => r.stepId)).toEqual(["s1", "s2"]);

    expect(await store.listStepResults("missing")).toEqual([]);
  });
});
