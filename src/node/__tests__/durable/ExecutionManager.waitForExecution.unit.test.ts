import { DurableService } from "../../durable/core/DurableService";
import { ExecutionStatus } from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { SpyQueue } from "./DurableService.unit.helpers";

describe("durable: ExecutionManager waitForExecution", () => {
  it("resolves waiting parent executions when the child execution completes", async () => {
    const store = new MemoryStore();
    const queue = new SpyQueue();
    const service = new DurableService({
      store,
      queue,
      tasks: [],
    });

    await store.saveExecution({
      id: "parent-execution",
      workflowKey: "parent-task",
      input: undefined,
      status: ExecutionStatus.Sleeping,
      attempt: 1,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.saveExecution({
      id: "child-execution",
      workflowKey: "child-task",
      input: undefined,
      status: ExecutionStatus.Completed,
      result: { ok: true },
      attempt: 2,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "parent-execution",
      stepId: "__execution:wait-child",
      result: {
        state: "waiting",
        targetExecutionId: "child-execution",
      },
      completedAt: new Date(),
    });
    await store.upsertExecutionWaiter({
      executionId: "parent-execution",
      targetExecutionId: "child-execution",
      stepId: "__execution:wait-child",
    });

    await service._executionManager.notifyExecutionFinished({
      id: "child-execution",
      workflowKey: "child-task",
      input: undefined,
      status: ExecutionStatus.Completed,
      result: { ok: true },
      attempt: 2,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    });

    await expect(
      store.getStepResult("parent-execution", "__execution:wait-child"),
    ).resolves.toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          state: "completed",
          targetExecutionId: "child-execution",
          workflowKey: "child-task",
          result: { ok: true },
        }),
      }),
    );
    await expect(
      store.listExecutionWaiters("child-execution"),
    ).resolves.toEqual([]);
    expect(queue.enqueued).toContainEqual({
      type: "execute",
      payload: { executionId: "parent-execution" },
    });
  });

  it("stores failed waiter state when the child ends in compensation_failed", async () => {
    const store = new MemoryStore();
    const service = new DurableService({
      store,
      tasks: [],
    });

    await store.saveExecution({
      id: "parent-execution",
      workflowKey: "parent-task",
      input: undefined,
      status: ExecutionStatus.Sleeping,
      attempt: 1,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "parent-execution",
      stepId: "__execution:wait-child",
      result: {
        state: "waiting",
        targetExecutionId: "child-execution",
      },
      completedAt: new Date(),
    });
    await store.upsertExecutionWaiter({
      executionId: "parent-execution",
      targetExecutionId: "child-execution",
      stepId: "__execution:wait-child",
    });

    await service._executionManager.notifyExecutionFinished({
      id: "child-execution",
      workflowKey: "child-task",
      input: undefined,
      status: ExecutionStatus.CompensationFailed,
      error: { message: "rollback blew up" },
      attempt: 2,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    });

    await expect(
      store.getStepResult("parent-execution", "__execution:wait-child"),
    ).resolves.toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          state: "failed",
          targetExecutionId: "child-execution",
          error: { message: "rollback blew up", stack: undefined },
        }),
      }),
    );
  });

  it("still resumes waiting parents during cooldown drain", async () => {
    const store = new MemoryStore();
    const queue = new SpyQueue();
    const service = new DurableService({
      store,
      queue,
      tasks: [],
    });

    await store.saveExecution({
      id: "parent-execution",
      workflowKey: "parent-task",
      input: undefined,
      status: ExecutionStatus.Sleeping,
      attempt: 1,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "parent-execution",
      stepId: "__execution:wait-child",
      result: {
        state: "waiting",
        targetExecutionId: "child-execution",
      },
      completedAt: new Date(),
    });
    await store.upsertExecutionWaiter({
      executionId: "parent-execution",
      targetExecutionId: "child-execution",
      stepId: "__execution:wait-child",
    });

    await service.cooldown();

    await service._executionManager.notifyExecutionFinished({
      id: "child-execution",
      workflowKey: "child-task",
      input: undefined,
      status: ExecutionStatus.Completed,
      result: { ok: true },
      attempt: 2,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    });

    await expect(
      store.getStepResult("parent-execution", "__execution:wait-child"),
    ).resolves.toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          state: "completed",
          targetExecutionId: "child-execution",
          workflowKey: "child-task",
          result: { ok: true },
        }),
      }),
    );
    expect(queue.enqueued).toContainEqual({
      type: "execute",
      payload: { executionId: "parent-execution" },
    });
  });

  it("skips stale waiters when atomic completion reports a race", async () => {
    const store = new MemoryStore();
    const queue = new SpyQueue();
    const customStore = Object.create(store) as MemoryStore & {
      commitExecutionWaiterCompletion: jest.MockedFunction<
        NonNullable<MemoryStore["commitExecutionWaiterCompletion"]>
      >;
    };
    customStore.commitExecutionWaiterCompletion = jest.fn(
      async (_params) => false,
    );
    const service = new DurableService({
      store: customStore,
      queue,
      tasks: [],
    });

    await store.upsertExecutionWaiter({
      executionId: "parent-execution",
      targetExecutionId: "child-execution",
      stepId: "__execution:wait-child",
    });

    await service._executionManager.notifyExecutionFinished({
      id: "child-execution",
      workflowKey: "child-task",
      input: undefined,
      status: ExecutionStatus.Completed,
      result: { ok: true },
      attempt: 1,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    });

    expect(customStore.commitExecutionWaiterCompletion).toHaveBeenCalled();
    expect(queue.enqueued).toEqual([]);
  });

  it("keeps completed waiter state even if fallback timer cleanup fails", async () => {
    class CleanupFailingStore extends MemoryStore {
      override async deleteTimer(): Promise<void> {
        throw new Error("timer cleanup failed");
      }
    }

    const store = new CleanupFailingStore();
    const queue = new SpyQueue();
    const service = new DurableService({
      store,
      queue,
      tasks: [],
    });

    Object.defineProperty(store, "commitExecutionWaiterCompletion", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    await store.saveStepResult({
      executionId: "parent-execution",
      stepId: "__execution:wait-child",
      result: {
        state: "waiting",
        targetExecutionId: "child-execution",
        timerId: "timer-1",
        timeoutAtMs: Date.now() + 5_000,
      },
      completedAt: new Date(),
    });
    await store.upsertExecutionWaiter({
      executionId: "parent-execution",
      targetExecutionId: "child-execution",
      stepId: "__execution:wait-child",
      timerId: "timer-1",
    });

    await service._executionManager.notifyExecutionFinished({
      id: "child-execution",
      workflowKey: "child-task",
      input: undefined,
      status: ExecutionStatus.Completed,
      result: { ok: true },
      attempt: 1,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    });

    expect(
      (await store.getStepResult("parent-execution", "__execution:wait-child"))
        ?.result,
    ).toEqual({
      state: "completed",
      targetExecutionId: "child-execution",
      workflowKey: "child-task",
      result: { ok: true },
    });
    expect(queue.enqueued).toContainEqual({
      type: "execute",
      payload: { executionId: "parent-execution" },
    });
  });

  it("uses fallback completion without timer cleanup when no timer is attached", async () => {
    const store = new MemoryStore();
    const queue = new SpyQueue();
    const service = new DurableService({
      store,
      queue,
      tasks: [],
    });

    Object.defineProperty(store, "commitExecutionWaiterCompletion", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    await store.saveStepResult({
      executionId: "parent-execution",
      stepId: "__execution:wait-child",
      result: {
        state: "waiting",
        targetExecutionId: "child-execution",
      },
      completedAt: new Date(),
    });
    await store.upsertExecutionWaiter({
      executionId: "parent-execution",
      targetExecutionId: "child-execution",
      stepId: "__execution:wait-child",
    });

    await service._executionManager.notifyExecutionFinished({
      id: "child-execution",
      workflowKey: "child-task",
      input: undefined,
      status: ExecutionStatus.Completed,
      result: { ok: true },
      attempt: 1,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
    });

    expect(
      (await store.getStepResult("parent-execution", "__execution:wait-child"))
        ?.result,
    ).toEqual({
      state: "completed",
      targetExecutionId: "child-execution",
      workflowKey: "child-task",
      result: { ok: true },
    });
  });
});
