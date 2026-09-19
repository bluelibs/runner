import { MemoryStore } from "../../../durable/store/MemoryStore";
import type { MemoryStoreSnapshot } from "../../../durable/store/memory-store/types";
import { ExecutionStatus, type Execution } from "../../../durable/core/types";

function runningExecution(id: string): Execution {
  return {
    id,
    workflowKey: "continue-task",
    input: undefined,
    status: ExecutionStatus.Running,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function closedPrior(successorId: string): Execution {
  return {
    ...runningExecution("root"),
    status: ExecutionStatus.ContinuedAsNew,
    continuedAsExecutionId: successorId,
    completedAt: new Date(),
  };
}

function successor(id: string): Execution {
  return {
    ...runningExecution(id),
    status: ExecutionStatus.Pending,
    continuedFromExecutionId: "root",
  };
}

describe("durable: MemoryStore continuation", () => {
  it("commits the close-and-create atomically", async () => {
    const store = new MemoryStore();
    await store.saveExecution(runningExecution("root"));

    const committed = await store.createContinuedExecution({
      priorExecution: closedPrior("tip"),
      successorExecution: successor("tip"),
    });

    expect(committed).toBe(true);
    expect(await store.getExecution("root")).toMatchObject({
      status: ExecutionStatus.ContinuedAsNew,
      continuedAsExecutionId: "tip",
    });
    expect(await store.getExecution("tip")).toMatchObject({
      status: ExecutionStatus.Pending,
      continuedFromExecutionId: "root",
    });
  });

  it("drops the commit when the prior run is missing", async () => {
    const store = new MemoryStore();

    const committed = await store.createContinuedExecution({
      priorExecution: closedPrior("tip"),
      successorExecution: successor("tip"),
    });

    expect(committed).toBe(false);
    expect(await store.getExecution("tip")).toBeNull();
  });

  it("drops the commit when the prior run is no longer running", async () => {
    const store = new MemoryStore();
    await store.saveExecution(runningExecution("root") as Execution);
    await store.updateExecution("root", {
      status: ExecutionStatus.Paused,
    });

    const committed = await store.createContinuedExecution({
      priorExecution: closedPrior("tip"),
      successorExecution: successor("tip"),
    });

    expect(committed).toBe(false);
    expect(await store.getExecution("root")).toMatchObject({
      status: ExecutionStatus.Paused,
    });
    expect(await store.getExecution("tip")).toBeNull();
  });

  it("commits a followed wait against the accepted step target", async () => {
    const store = new MemoryStore();
    await store.saveStepResult({
      executionId: "parent",
      stepId: "__execution:child",
      result: { state: "waiting", targetExecutionId: "child" },
      completedAt: new Date(),
    });
    await store.upsertExecutionWaiter({
      executionId: "parent",
      targetExecutionId: "tip",
      stepId: "__execution:child",
    });

    const committed = await store.commitExecutionWaiterCompletion({
      targetExecutionId: "tip",
      executionId: "parent",
      stepId: "__execution:child",
      stepResult: {
        executionId: "parent",
        stepId: "__execution:child",
        result: {
          state: "completed",
          targetExecutionId: "child",
          workflowKey: "child-task",
          result: { ok: true },
        },
        completedAt: new Date(),
      },
      waitTargetExecutionId: "child",
    });

    expect(committed).toBe(true);
    expect(await store.listExecutionWaiters("tip")).toEqual([]);
  });

  it("still rejects commits for steps waiting on another target", async () => {
    const store = new MemoryStore();
    await store.saveStepResult({
      executionId: "parent",
      stepId: "__execution:child",
      result: { state: "waiting", targetExecutionId: "other" },
      completedAt: new Date(),
    });
    await store.upsertExecutionWaiter({
      executionId: "parent",
      targetExecutionId: "tip",
      stepId: "__execution:child",
    });

    const committed = await store.commitExecutionWaiterCompletion({
      targetExecutionId: "tip",
      executionId: "parent",
      stepId: "__execution:child",
      stepResult: {
        executionId: "parent",
        stepId: "__execution:child",
        result: {
          state: "completed",
          targetExecutionId: "child",
          workflowKey: "child-task",
          result: { ok: true },
        },
        completedAt: new Date(),
      },
      waitTargetExecutionId: "child",
    });

    expect(committed).toBe(false);
    expect(await store.listExecutionWaiters("tip")).toHaveLength(1);
  });

  it("resolves workflow state to null until first saved", async () => {
    const store = new MemoryStore();

    await expect(store.getWorkflowState("root")).resolves.toBeNull();
  });

  it("round-trips workflow state with replace semantics", async () => {
    const store = new MemoryStore();

    await store.saveWorkflowState({
      executionId: "root",
      state: { page: 1 },
      updatedAt: new Date(),
    });
    expect(await store.getWorkflowState("root")).toMatchObject({
      executionId: "root",
      state: { page: 1 },
    });

    await store.saveWorkflowState({
      executionId: "root",
      state: { page: 2 },
      updatedAt: new Date(),
    });
    expect(await store.getWorkflowState("root")).toMatchObject({
      state: { page: 2 },
    });
  });

  it("exports and restores workflow states in snapshots", async () => {
    const store = new MemoryStore();
    await store.saveWorkflowState({
      executionId: "root",
      state: { page: 1 },
      updatedAt: new Date(),
    });

    const snapshot = store.exportSnapshot();
    expect(snapshot.workflowStates).toEqual([
      expect.objectContaining({ executionId: "root", state: { page: 1 } }),
    ]);

    const restored = new MemoryStore();
    restored.restoreSnapshot(snapshot);
    expect(await restored.getWorkflowState("root")).toMatchObject({
      state: { page: 1 },
    });
  });

  it("restores snapshots written before workflow state existed", async () => {
    const store = new MemoryStore();
    const snapshot = store.exportSnapshot();
    const legacy = { ...snapshot };
    delete (legacy as Partial<MemoryStoreSnapshot>).workflowStates;

    const restored = new MemoryStore();
    restored.restoreSnapshot(legacy as MemoryStoreSnapshot);

    await expect(restored.getWorkflowState("root")).resolves.toBeNull();
  });
});
