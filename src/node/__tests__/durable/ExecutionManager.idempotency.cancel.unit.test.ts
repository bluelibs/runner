import { ExecutionManager } from "../../durable/core/managers/ExecutionManager";
import { AuditLogger } from "../../durable/core/managers/AuditLogger";
import { TaskRegistry } from "../../durable/core/managers/TaskRegistry";
import { WaitManager } from "../../durable/core/managers/WaitManager";
import { NoopEventBus } from "../../durable/bus/NoopEventBus";
import { SuspensionSignal } from "../../durable/core/interfaces/context";
import { ExecutionStatus, type Execution } from "../../durable/core/types";
import type { IDurableStore } from "../../durable/core/interfaces/store";
import type { ITaskExecutor } from "../../durable/core/interfaces/service";
import type { IDurableQueue } from "../../durable/core/interfaces/queue";
import type { ITask } from "../../../types/task";

enum TaskId {
  T = "durable.tests.executionManager.t",
}

enum IdempotencyKey {
  K = "idempotency:key",
}

describe("durable: ExecutionManager (idempotency & cancellation)", () => {
  const task: ITask<unknown, Promise<unknown>, any, any, any, any> = {
    id: TaskId.T,
  } as any;

  const createFixedTaskExecutor = <TValue>(value: TValue): ITaskExecutor => ({
    run: async <TInput, TResult>(
      _task: ITask<TInput, Promise<TResult>, any, any, any, any>,
      _input?: TInput,
    ): Promise<TResult> => value as unknown as TResult,
  });

  const createManager = (params: {
    store: IDurableStore;
    taskExecutor?: ITaskExecutor;
    queue?: IDurableQueue;
  }) => {
    const taskRegistry = new TaskRegistry();
    taskRegistry.register(task);

    const auditLogger = new AuditLogger({ enabled: false }, params.store);
    const waitManager = new WaitManager(params.store);

    return new ExecutionManager(
      {
        store: params.store,
        taskExecutor: params.taskExecutor,
        queue: params.queue,
        eventBus: new NoopEventBus(),
      },
      taskRegistry,
      auditLogger,
      waitManager,
    );
  };

  it("throws when idempotencyKey is used with a store that lacks support", async () => {
    const store: IDurableStore = {
      saveExecution: async () => {},
      getExecution: async () => null,
      updateExecution: async () => {},
      listIncompleteExecutions: async () => [],
      getStepResult: async () => null,
      saveStepResult: async () => {},
      createTimer: async () => {},
      getReadyTimers: async () => [],
      markTimerFired: async () => {},
      deleteTimer: async () => {},
      createSchedule: async () => {},
      getSchedule: async () => null,
      updateSchedule: async () => {},
      deleteSchedule: async () => {},
      listSchedules: async () => [],
      listActiveSchedules: async () => [],
    };

    const manager = createManager({
      store,
      queue: { enqueue: async () => "id" } as any,
    });

    await expect(
      manager.start(task, undefined, {
        idempotencyKey: IdempotencyKey.K,
      }),
    ).rejects.toThrow("does not support execution idempotency keys");
  });

  it("fails fast when idempotency lock cannot be acquired", async () => {
    const store: IDurableStore = {
      saveExecution: async () => {},
      getExecution: async () => null,
      updateExecution: async () => {},
      listIncompleteExecutions: async () => [],
      getStepResult: async () => null,
      saveStepResult: async () => {},
      createTimer: async () => {},
      getReadyTimers: async () => [],
      markTimerFired: async () => {},
      deleteTimer: async () => {},
      createSchedule: async () => {},
      getSchedule: async () => null,
      updateSchedule: async () => {},
      deleteSchedule: async () => {},
      listSchedules: async () => [],
      listActiveSchedules: async () => [],
      getExecutionIdByIdempotencyKey: async () => null,
      setExecutionIdByIdempotencyKey: async () => true,
      acquireLock: async () => null,
      releaseLock: async () => {},
    };

    const manager = createManager({
      store,
      queue: { enqueue: async () => "id" } as any,
    });

    await expect(
      manager.start(task, undefined, {
        idempotencyKey: IdempotencyKey.K,
      }),
    ).rejects.toThrow("Failed to acquire idempotency lock");
  });

  it("returns the raced mapping when setExecutionIdByIdempotencyKey fails", async () => {
    let getCalls = 0;

    const store: IDurableStore = {
      saveExecution: async () => {
        throw new Error("should not create execution");
      },
      getExecution: async () => null,
      updateExecution: async () => {},
      listIncompleteExecutions: async () => [],
      getStepResult: async () => null,
      saveStepResult: async () => {},
      createTimer: async () => {},
      getReadyTimers: async () => [],
      markTimerFired: async () => {},
      deleteTimer: async () => {},
      createSchedule: async () => {},
      getSchedule: async () => null,
      updateSchedule: async () => {},
      deleteSchedule: async () => {},
      listSchedules: async () => [],
      listActiveSchedules: async () => [],
      getExecutionIdByIdempotencyKey: async () => {
        getCalls += 1;
        if (getCalls === 1) return null;
        return "existing";
      },
      setExecutionIdByIdempotencyKey: async () => false,
    };

    const taskExecutor: ITaskExecutor = {
      run: async () => {
        throw new Error("should not execute");
      },
    };

    const manager = createManager({ store, taskExecutor });

    await expect(
      manager.start(task, undefined, {
        idempotencyKey: IdempotencyKey.K,
      }),
    ).resolves.toBe("existing");
  });

  it("throws if setExecutionIdByIdempotencyKey fails without an existing mapping", async () => {
    const store: IDurableStore = {
      saveExecution: async () => {
        throw new Error("should not create execution");
      },
      getExecution: async () => null,
      updateExecution: async () => {},
      listIncompleteExecutions: async () => [],
      getStepResult: async () => null,
      saveStepResult: async () => {},
      createTimer: async () => {},
      getReadyTimers: async () => [],
      markTimerFired: async () => {},
      deleteTimer: async () => {},
      createSchedule: async () => {},
      getSchedule: async () => null,
      updateSchedule: async () => {},
      deleteSchedule: async () => {},
      listSchedules: async () => [],
      listActiveSchedules: async () => [],
      getExecutionIdByIdempotencyKey: async () => null,
      setExecutionIdByIdempotencyKey: async () => false,
    };

    const taskExecutor: ITaskExecutor = {
      run: async () => {
        throw new Error("should not execute");
      },
    };

    const manager = createManager({ store, taskExecutor });

    await expect(
      manager.start(task, undefined, {
        idempotencyKey: IdempotencyKey.K,
      }),
    ).rejects.toThrow("Failed to set idempotency mapping");
  });

  it("cancelExecution is a no-op when the execution does not exist", async () => {
    const store: IDurableStore = {
      saveExecution: async () => {},
      getExecution: async () => null,
      updateExecution: async () => {
        throw new Error("should not update");
      },
      listIncompleteExecutions: async () => [],
      getStepResult: async () => null,
      saveStepResult: async () => {},
      createTimer: async () => {},
      getReadyTimers: async () => [],
      markTimerFired: async () => {},
      deleteTimer: async () => {},
      createSchedule: async () => {},
      getSchedule: async () => null,
      updateSchedule: async () => {},
      deleteSchedule: async () => {},
      listSchedules: async () => [],
      listActiveSchedules: async () => [],
    };

    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor(undefined),
    });
    await expect(manager.cancelExecution("missing")).resolves.toBeUndefined();
  });

  it("cancelExecution is a no-op when execution is already terminal", async () => {
    const exec: Execution = {
      id: "e1",
      taskId: TaskId.T,
      input: undefined,
      status: ExecutionStatus.Completed,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
      result: { ok: true },
    };

    const updateExecution = jest.fn(async () => undefined);

    const store: IDurableStore = {
      saveExecution: async () => {},
      getExecution: async () => exec,
      updateExecution,
      listIncompleteExecutions: async () => [],
      getStepResult: async () => null,
      saveStepResult: async () => {},
      createTimer: async () => {},
      getReadyTimers: async () => [],
      markTimerFired: async () => {},
      deleteTimer: async () => {},
      createSchedule: async () => {},
      getSchedule: async () => null,
      updateSchedule: async () => {},
      deleteSchedule: async () => {},
      listSchedules: async () => [],
      listActiveSchedules: async () => [],
    };

    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor(undefined),
    });
    await expect(manager.cancelExecution(exec.id)).resolves.toBeUndefined();
    expect(updateExecution).not.toHaveBeenCalled();
  });

  it("cancelExecution preserves existing cancelRequestedAt and defaults the reason", async () => {
    const requestedAt = new Date("2024-01-01T00:00:00.000Z");

    const exec: Execution = {
      id: "e.cancel.defaults",
      taskId: TaskId.T,
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      cancelRequestedAt: requestedAt,
    };

    const updateExecution = jest.fn(async () => undefined);

    const store: IDurableStore = {
      saveExecution: async () => {},
      getExecution: async () => exec,
      updateExecution,
      listIncompleteExecutions: async () => [],
      getStepResult: async () => null,
      saveStepResult: async () => {},
      createTimer: async () => {},
      getReadyTimers: async () => [],
      markTimerFired: async () => {},
      deleteTimer: async () => {},
      createSchedule: async () => {},
      getSchedule: async () => null,
      updateSchedule: async () => {},
      deleteSchedule: async () => {},
      listSchedules: async () => [],
      listActiveSchedules: async () => [],
    };

    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor(undefined),
    });
    await manager.cancelExecution(exec.id);

    expect(updateExecution).toHaveBeenCalledWith(
      exec.id,
      expect.objectContaining({
        status: ExecutionStatus.Cancelled,
        cancelRequestedAt: requestedAt,
        error: { message: "Execution cancelled" },
      }),
    );
  });

  it("does not overwrite cancellation when cancellation happens after work completes", async () => {
    const updateExecution = jest.fn(async () => undefined);

    let getCalls = 0;
    const store: IDurableStore = {
      saveExecution: async () => {},
      getExecution: async () => {
        getCalls += 1;

        // 1) processExecution initial load
        // 2) runExecutionAttempt isCancelled() at start
        // 3) runExecutionAttempt isCancelled() after the task resolves
        if (getCalls === 1 || getCalls === 2) {
          return {
            id: "e1",
            taskId: TaskId.T,
            input: undefined,
            status: ExecutionStatus.Pending,
            attempt: 1,
            maxAttempts: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          } satisfies Execution;
        }

        return {
          id: "e1",
          taskId: TaskId.T,
          input: undefined,
          status: ExecutionStatus.Cancelled,
          attempt: 1,
          maxAttempts: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          cancelledAt: new Date(),
          completedAt: new Date(),
        } satisfies Execution;
      },
      updateExecution,
      listIncompleteExecutions: async () => [],
      getStepResult: async () => null,
      saveStepResult: async () => {},
      createTimer: async () => {},
      getReadyTimers: async () => [],
      markTimerFired: async () => {},
      deleteTimer: async () => {},
      createSchedule: async () => {},
      getSchedule: async () => null,
      updateSchedule: async () => {},
      deleteSchedule: async () => {},
      listSchedules: async () => [],
      listActiveSchedules: async () => [],
    };

    const taskExecutor = createFixedTaskExecutor({ ok: true });

    const manager = createManager({ store, taskExecutor });
    await manager.processExecution("e1");

    expect(updateExecution).toHaveBeenCalledWith(
      "e1",
      expect.objectContaining({ status: ExecutionStatus.Running }),
    );
    expect(updateExecution).not.toHaveBeenCalledWith(
      "e1",
      expect.objectContaining({ status: ExecutionStatus.Completed }),
    );
  });

  it("bails out early when the execution is already cancelled before attempting", async () => {
    const updateExecution = jest.fn(async () => undefined);

    let getCalls = 0;
    const store: IDurableStore = {
      saveExecution: async () => {},
      getExecution: async () => {
        getCalls += 1;
        if (getCalls === 1) {
          return {
            id: "e0",
            taskId: TaskId.T,
            input: undefined,
            status: ExecutionStatus.Pending,
            attempt: 1,
            maxAttempts: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          } satisfies Execution;
        }
        return {
          id: "e0",
          taskId: TaskId.T,
          input: undefined,
          status: ExecutionStatus.Cancelled,
          attempt: 1,
          maxAttempts: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          cancelledAt: new Date(),
          completedAt: new Date(),
        } satisfies Execution;
      },
      updateExecution,
      listIncompleteExecutions: async () => [],
      getStepResult: async () => null,
      saveStepResult: async () => {},
      createTimer: async () => {},
      getReadyTimers: async () => [],
      markTimerFired: async () => {},
      deleteTimer: async () => {},
      createSchedule: async () => {},
      getSchedule: async () => null,
      updateSchedule: async () => {},
      deleteSchedule: async () => {},
      listSchedules: async () => [],
      listActiveSchedules: async () => [],
    };

    const taskExecutor = createFixedTaskExecutor({ ok: true });

    const manager = createManager({ store, taskExecutor });
    await manager.processExecution("e0");

    expect(updateExecution).not.toHaveBeenCalled();
  });

  it("does not overwrite cancellation when cancellation happens after a suspension", async () => {
    const updateExecution = jest.fn(async () => undefined);

    let getCalls = 0;
    const store: IDurableStore = {
      saveExecution: async () => {},
      getExecution: async () => {
        getCalls += 1;

        // 1) processExecution initial load
        // 2) runExecutionAttempt isCancelled() at start
        // 3) catch(SuspensionSignal) isCancelled()
        if (getCalls === 1 || getCalls === 2) {
          return {
            id: "e2",
            taskId: TaskId.T,
            input: undefined,
            status: ExecutionStatus.Pending,
            attempt: 1,
            maxAttempts: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          } satisfies Execution;
        }

        return {
          id: "e2",
          taskId: TaskId.T,
          input: undefined,
          status: ExecutionStatus.Cancelled,
          attempt: 1,
          maxAttempts: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          cancelledAt: new Date(),
          completedAt: new Date(),
        } satisfies Execution;
      },
      updateExecution,
      listIncompleteExecutions: async () => [],
      getStepResult: async () => null,
      saveStepResult: async () => {},
      createTimer: async () => {},
      getReadyTimers: async () => [],
      markTimerFired: async () => {},
      deleteTimer: async () => {},
      createSchedule: async () => {},
      getSchedule: async () => null,
      updateSchedule: async () => {},
      deleteSchedule: async () => {},
      listSchedules: async () => [],
      listActiveSchedules: async () => [],
    };

    const taskExecutor: ITaskExecutor = {
      run: async () => {
        throw new SuspensionSignal("yield");
      },
    };

    const manager = createManager({ store, taskExecutor });
    await manager.processExecution("e2");

    expect(updateExecution).toHaveBeenCalledWith(
      "e2",
      expect.objectContaining({ status: ExecutionStatus.Running }),
    );
    expect(updateExecution).not.toHaveBeenCalledWith(
      "e2",
      expect.objectContaining({ status: ExecutionStatus.Sleeping }),
    );
  });

  it("does not overwrite cancellation when cancellation happens after a failure", async () => {
    const updateExecution = jest.fn(async () => undefined);
    const createTimer = jest.fn(async () => undefined);

    let getCalls = 0;
    const store: IDurableStore = {
      saveExecution: async () => {},
      getExecution: async () => {
        getCalls += 1;

        // 1) processExecution initial load
        // 2) runExecutionAttempt isCancelled() at start
        // 3) catch(error) isCancelled()
        if (getCalls === 1 || getCalls === 2) {
          return {
            id: "e3",
            taskId: TaskId.T,
            input: undefined,
            status: ExecutionStatus.Pending,
            attempt: 1,
            maxAttempts: 3,
            createdAt: new Date(),
            updatedAt: new Date(),
          } satisfies Execution;
        }

        return {
          id: "e3",
          taskId: TaskId.T,
          input: undefined,
          status: ExecutionStatus.Cancelled,
          attempt: 1,
          maxAttempts: 3,
          createdAt: new Date(),
          updatedAt: new Date(),
          cancelledAt: new Date(),
          completedAt: new Date(),
        } satisfies Execution;
      },
      updateExecution,
      listIncompleteExecutions: async () => [],
      getStepResult: async () => null,
      saveStepResult: async () => {},
      createTimer,
      getReadyTimers: async () => [],
      markTimerFired: async () => {},
      deleteTimer: async () => {},
      createSchedule: async () => {},
      getSchedule: async () => null,
      updateSchedule: async () => {},
      deleteSchedule: async () => {},
      listSchedules: async () => [],
      listActiveSchedules: async () => [],
    };

    const taskExecutor: ITaskExecutor = {
      run: async () => {
        throw new Error("boom");
      },
    };

    const manager = createManager({ store, taskExecutor });
    await manager.processExecution("e3");

    expect(updateExecution).toHaveBeenCalledWith(
      "e3",
      expect.objectContaining({ status: ExecutionStatus.Running }),
    );
    expect(createTimer).not.toHaveBeenCalled();
    expect(updateExecution).not.toHaveBeenCalledWith(
      "e3",
      expect.objectContaining({ status: ExecutionStatus.Retrying }),
    );
    expect(updateExecution).not.toHaveBeenCalledWith(
      "e3",
      expect.objectContaining({ status: ExecutionStatus.Failed }),
    );
  });

  it("notifies finished executions via event bus", async () => {
    const published: Array<{ channel: string; type: string }> = [];

    const eventBus = {
      publish: async (channel: string, event: any) => {
        published.push({ channel, type: event.type });
      },
      subscribe: async () => {},
      unsubscribe: async () => {},
    };

    const store: IDurableStore = {
      saveExecution: async () => {},
      getExecution: async () => null,
      updateExecution: async () => {},
      listIncompleteExecutions: async () => [],
      getStepResult: async () => null,
      saveStepResult: async () => {},
      createTimer: async () => {},
      getReadyTimers: async () => [],
      markTimerFired: async () => {},
      deleteTimer: async () => {},
      createSchedule: async () => {},
      getSchedule: async () => null,
      updateSchedule: async () => {},
      deleteSchedule: async () => {},
      listSchedules: async () => [],
      listActiveSchedules: async () => [],
    };

    const taskRegistry = new TaskRegistry();
    const auditLogger = new AuditLogger({ enabled: false }, store);
    const waitManager = new WaitManager(store);

    const manager = new ExecutionManager(
      {
        store,
        taskExecutor: createFixedTaskExecutor(undefined),
        eventBus: eventBus as any,
      },
      taskRegistry,
      auditLogger,
      waitManager,
    );

    await manager.notifyExecutionFinished({
      id: "e.notify",
      taskId: TaskId.T,
      input: undefined,
      status: ExecutionStatus.Completed,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
      result: { ok: true },
    });

    expect(published).toEqual([
      { channel: "execution:e.notify", type: "finished" },
    ]);
  });
});
