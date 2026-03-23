import { DurableService } from "../../durable/core/DurableService";
import { createExecutionWaitCurrent } from "../../durable/core/current";
import { ExecutionStatus } from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { createBufferedLogger, SpyQueue } from "./DurableService.unit.helpers";

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

  it("still kicks the parent if suspended-current cleanup fails after completion commits", async () => {
    class CleanupFailingStore extends MemoryStore {
      override async saveExecutionIfStatus(
        execution: Parameters<MemoryStore["saveExecutionIfStatus"]>[0],
        expectedStatuses: Parameters<MemoryStore["saveExecutionIfStatus"]>[1],
      ): Promise<boolean> {
        if (
          execution.id === "parent-execution" &&
          expectedStatuses.includes(ExecutionStatus.Sleeping) &&
          execution.current === undefined
        ) {
          throw new Error("transient CAS failure");
        }

        return await super.saveExecutionIfStatus(execution, expectedStatuses);
      }
    }

    const store = new CleanupFailingStore();
    const queue = new SpyQueue();
    const { logger, logs } = createBufferedLogger();
    const service = new DurableService({
      store,
      queue,
      logger,
      tasks: [],
    });

    await store.saveExecution({
      id: "parent-execution",
      workflowKey: "parent-task",
      input: undefined,
      status: ExecutionStatus.Sleeping,
      current: createExecutionWaitCurrent({
        stepId: "__execution:wait-child",
        targetExecutionId: "child-execution",
        targetWorkflowKey: "child-task",
        startedAt: new Date(),
      }),
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
    await expect(
      store.listExecutionWaiters("child-execution"),
    ).resolves.toEqual([]);
    expect(queue.enqueued).toContainEqual({
      type: "execute",
      payload: { executionId: "parent-execution" },
    });
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          message:
            "Durable waitForExecution current cleanup failed; resuming parent execution anyway.",
          error: expect.objectContaining({
            message: "transient CAS failure",
          }),
        }),
      ]),
    );
  });

  it("continues waking later parents when one embedded kickoff fails", async () => {
    const store = new MemoryStore();
    const { logger, logs } = createBufferedLogger();
    const service = new DurableService({
      store,
      logger,
      tasks: [],
    });
    const processExecution = jest
      .spyOn(service._executionManager, "processExecution")
      .mockRejectedValueOnce(new Error("transient parent kickoff failure"))
      .mockResolvedValue(undefined);

    for (const parentId of ["parent-a", "parent-b"]) {
      await store.saveExecution({
        id: parentId,
        workflowKey: `${parentId}-task`,
        input: undefined,
        status: ExecutionStatus.Sleeping,
        current: createExecutionWaitCurrent({
          stepId: "__execution:wait-child",
          targetExecutionId: "child-execution",
          targetWorkflowKey: "child-task",
          startedAt: new Date(),
        }),
        attempt: 1,
        maxAttempts: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await store.saveStepResult({
        executionId: parentId,
        stepId: "__execution:wait-child",
        result: {
          state: "waiting",
          targetExecutionId: "child-execution",
        },
        completedAt: new Date(),
      });
      await store.upsertExecutionWaiter({
        executionId: parentId,
        targetExecutionId: "child-execution",
        stepId: "__execution:wait-child",
      });
    }

    await expect(
      service._executionManager.notifyExecutionFinished({
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
      }),
    ).resolves.toBeUndefined();

    expect(
      (await store.getStepResult("parent-a", "__execution:wait-child"))?.result,
    ).toEqual({
      state: "completed",
      targetExecutionId: "child-execution",
      workflowKey: "child-task",
      result: { ok: true },
    });
    expect(
      (await store.getStepResult("parent-b", "__execution:wait-child"))?.result,
    ).toEqual({
      state: "completed",
      targetExecutionId: "child-execution",
      workflowKey: "child-task",
      result: { ok: true },
    });
    await expect(
      store.listExecutionWaiters("child-execution"),
    ).resolves.toEqual([]);

    const retryTimer = (
      await store.getReadyTimers(new Date(Date.now() + 1_000))
    ).find(
      (timer) =>
        timer.id === "wait_execution_resume:parent-a:__execution:wait-child",
    );
    expect(retryTimer).toEqual(
      expect.objectContaining({
        executionId: "parent-a",
        type: "retry",
      }),
    );
    expect(processExecution).toHaveBeenNthCalledWith(1, "parent-a");
    expect(processExecution).toHaveBeenNthCalledWith(2, "parent-b");
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          message:
            "Durable waitForExecution parent kickoff failed; relying on retry handling instead.",
          error: expect.objectContaining({
            message: "transient parent kickoff failure",
          }),
        }),
      ]),
    );

    await service.handleTimer(retryTimer!);
    expect(processExecution).toHaveBeenCalledWith("parent-a");
    expect(processExecution).toHaveBeenCalledTimes(3);
  });

  it("re-arms the waiter retry timer if the first timer write fails before kickoff does", async () => {
    class FirstTimerWriteFailingStore extends MemoryStore {
      private failedTimerIds = new Set<string>();

      override async createTimer(
        timer: Parameters<MemoryStore["createTimer"]>[0],
      ): Promise<void> {
        if (
          timer.id ===
            "wait_execution_resume:parent-a:__execution:wait-child" &&
          !this.failedTimerIds.has(timer.id)
        ) {
          this.failedTimerIds.add(timer.id);
          throw new Error("initial timer write failed");
        }

        await super.createTimer(timer);
      }
    }

    const store = new FirstTimerWriteFailingStore();
    const { logger, logs } = createBufferedLogger();
    const service = new DurableService({
      store,
      logger,
      tasks: [],
    });
    jest
      .spyOn(service._executionManager, "processExecution")
      .mockRejectedValueOnce(new Error("embedded kickoff failed"))
      .mockResolvedValue(undefined);

    await store.saveExecution({
      id: "parent-a",
      workflowKey: "parent-a-task",
      input: undefined,
      status: ExecutionStatus.Sleeping,
      current: createExecutionWaitCurrent({
        stepId: "__execution:wait-child",
        targetExecutionId: "child-execution",
        targetWorkflowKey: "child-task",
        startedAt: new Date(),
      }),
      attempt: 1,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "parent-a",
      stepId: "__execution:wait-child",
      result: {
        state: "waiting",
        targetExecutionId: "child-execution",
      },
      completedAt: new Date(),
    });
    await store.upsertExecutionWaiter({
      executionId: "parent-a",
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
      (await store.getReadyTimers(new Date(Date.now() + 1_000))).map(
        (timer) => timer.id,
      ),
    ).toContain("wait_execution_resume:parent-a:__execution:wait-child");
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          message:
            "Durable waitForExecution parent kickoff failed; relying on retry handling instead.",
          context: expect.objectContaining({
            retryTimerArmed: true,
            retryTimerError: undefined,
          }),
        }),
      ]),
    );
  });

  it("logs and continues even when waiter retry timer writes fail before and after kickoff", async () => {
    class TimerWriteFailingStore extends MemoryStore {
      override async createTimer(): Promise<void> {
        throw new Error("retry timer write failed");
      }
    }

    const store = new TimerWriteFailingStore();
    const { logger, logs } = createBufferedLogger();
    const service = new DurableService({
      store,
      logger,
      tasks: [],
    });
    const processExecution = jest
      .spyOn(service._executionManager, "processExecution")
      .mockRejectedValueOnce(new Error("parent-a kickoff failed"))
      .mockResolvedValue(undefined);

    for (const parentId of ["parent-a", "parent-b"]) {
      await store.saveExecution({
        id: parentId,
        workflowKey: `${parentId}-task`,
        input: undefined,
        status: ExecutionStatus.Sleeping,
        current: createExecutionWaitCurrent({
          stepId: "__execution:wait-child",
          targetExecutionId: "child-execution",
          targetWorkflowKey: "child-task",
          startedAt: new Date(),
        }),
        attempt: 1,
        maxAttempts: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await store.saveStepResult({
        executionId: parentId,
        stepId: "__execution:wait-child",
        result: {
          state: "waiting",
          targetExecutionId: "child-execution",
        },
        completedAt: new Date(),
      });
      await store.upsertExecutionWaiter({
        executionId: parentId,
        targetExecutionId: "child-execution",
        stepId: "__execution:wait-child",
      });
    }

    await expect(
      service._executionManager.notifyExecutionFinished({
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
      }),
    ).resolves.toBeUndefined();

    expect(processExecution).toHaveBeenNthCalledWith(1, "parent-a");
    expect(processExecution).toHaveBeenNthCalledWith(2, "parent-b");
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          message:
            "Durable waitForExecution parent kickoff failed; relying on retry handling instead.",
          error: expect.objectContaining({
            message: "parent-a kickoff failed",
          }),
          context: expect.objectContaining({
            retryTimerArmed: false,
            retryTimerError: expect.objectContaining({
              message: "retry timer write failed",
            }),
          }),
        }),
      ]),
    );
  });

  it("keeps the second timer-write error when the first timer failure is nullish", async () => {
    class NullishThenErrorTimerStore extends MemoryStore {
      private timerAttempts = 0;

      override async createTimer(): Promise<void> {
        this.timerAttempts += 1;
        if (this.timerAttempts === 1) {
          throw undefined;
        }

        throw new Error("second retry timer failure");
      }
    }

    const store = new NullishThenErrorTimerStore();
    const { logger, logs } = createBufferedLogger();
    const service = new DurableService({
      store,
      logger,
      tasks: [],
    });
    jest
      .spyOn(service._executionManager, "processExecution")
      .mockRejectedValueOnce(new Error("parent-a kickoff failed"));

    await store.saveExecution({
      id: "parent-a",
      workflowKey: "parent-a-task",
      input: undefined,
      status: ExecutionStatus.Sleeping,
      current: createExecutionWaitCurrent({
        stepId: "__execution:wait-child",
        targetExecutionId: "child-execution",
        targetWorkflowKey: "child-task",
        startedAt: new Date(),
      }),
      attempt: 1,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await store.saveStepResult({
      executionId: "parent-a",
      stepId: "__execution:wait-child",
      result: {
        state: "waiting",
        targetExecutionId: "child-execution",
      },
      completedAt: new Date(),
    });
    await store.upsertExecutionWaiter({
      executionId: "parent-a",
      targetExecutionId: "child-execution",
      stepId: "__execution:wait-child",
    });

    await expect(
      service._executionManager.notifyExecutionFinished({
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
      }),
    ).resolves.toBeUndefined();

    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          message:
            "Durable waitForExecution parent kickoff failed; relying on retry handling instead.",
          context: expect.objectContaining({
            retryTimerArmed: false,
            retryTimerError: expect.objectContaining({
              message: "second retry timer failure",
            }),
          }),
        }),
      ]),
    );
  });
});
