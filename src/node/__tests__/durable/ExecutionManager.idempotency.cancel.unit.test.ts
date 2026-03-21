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
import * as durableUtils from "../../durable/core/utils";
import { genericError } from "../../../errors";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { createBareStore } from "./DurableService.unit.helpers";

enum TaskId {
  T = "durable-tests-executionManager-t",
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

  const createStore = (overrides: Partial<IDurableStore>): IDurableStore =>
    createBareStore(new MemoryStore(), overrides);

  it("throws when idempotencyKey is used with a store that lacks support", async () => {
    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => null,
      updateExecution: async () => {},
      listIncompleteExecutions: async () => [],
    });

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

  it("returns the existing execution when the idempotency key is already claimed", async () => {
    const store = createStore({
      saveExecution: async () => {
        throw genericError.new({ message: "should not save execution" });
      },
      getExecution: async () => {
        throw genericError.new({ message: "should not load execution" });
      },
      updateExecution: async () => {},
      listIncompleteExecutions: async () => [],
      createExecutionWithIdempotencyKey: async () => ({
        created: false as const,
        executionId: "existing",
      }),
    });

    const manager = createManager({
      store,
      taskExecutor: {
        run: async () => {
          throw genericError.new({ message: "should not execute" });
        },
      },
    });

    await expect(
      manager.start(task, undefined, {
        idempotencyKey: IdempotencyKey.K,
      }),
    ).resolves.toBe("existing");
  });

  it("does not persist twice after an atomic idempotent create succeeds", async () => {
    const store = createStore({
      saveExecution: async () => {
        throw genericError.new({
          message: "should not save execution separately",
        });
      },
      getExecution: async () => null,
      updateExecution: async () => {},
      listIncompleteExecutions: async () => [],
      createExecutionWithIdempotencyKey: async ({ execution }) => ({
        created: true as const,
        executionId: execution.id,
      }),
    });
    const queue: IDurableQueue = {
      enqueue: async () => "queued",
      consume: async () => undefined,
      ack: async () => undefined,
      nack: async () => undefined,
    };
    const manager = createManager({ store, queue });

    await expect(
      manager.start(task, undefined, {
        idempotencyKey: IdempotencyKey.K,
      }),
    ).resolves.toEqual(expect.any(String));
  });

  it("cancelExecution is a no-op when the execution does not exist", async () => {
    const saveExecutionIfStatus = jest.fn(async () => false);
    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => null,
      saveExecutionIfStatus,
      updateExecution: async () => {
        throw genericError.new({ message: "should not update" });
      },
      listIncompleteExecutions: async () => [],
    });

    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor(undefined),
    });
    await expect(manager.cancelExecution("missing")).resolves.toBeUndefined();
    expect(saveExecutionIfStatus).not.toHaveBeenCalled();
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

    const saveExecutionIfStatus = jest.fn(async () => false);

    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => exec,
      saveExecutionIfStatus,
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
    });

    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor(undefined),
    });
    await expect(manager.cancelExecution(exec.id)).resolves.toBeUndefined();
    expect(saveExecutionIfStatus).not.toHaveBeenCalled();
  });

  it("cancelExecution backs off between conflicting retries", async () => {
    const exec: Execution = {
      id: "e-cancel-retries",
      taskId: TaskId.T,
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const sleepSpy = jest
      .spyOn(durableUtils, "sleepMs")
      .mockResolvedValue(undefined);
    const saveExecutionIfStatus = jest
      .fn<Promise<boolean>, [Execution, ExecutionStatus[]]>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => ({ ...exec }),
      saveExecutionIfStatus,
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
    });

    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    try {
      await expect(manager.cancelExecution(exec.id)).resolves.toBeUndefined();
      expect(saveExecutionIfStatus).toHaveBeenCalledTimes(4);
      expect(sleepSpy.mock.calls.map(([ms]) => ms)).toEqual([1, 2, 4]);
    } finally {
      sleepSpy.mockRestore();
    }
  });

  it("cancelExecution throws after exhausting conflicting retries", async () => {
    const exec: Execution = {
      id: "e-cancel-exhausted",
      taskId: TaskId.T,
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const sleepSpy = jest
      .spyOn(durableUtils, "sleepMs")
      .mockResolvedValue(undefined);
    const saveExecutionIfStatus = jest.fn(async () => false);
    const getExecution = jest.fn(async () => ({ ...exec }));
    const store = createStore({
      saveExecution: async () => {},
      getExecution,
      saveExecutionIfStatus,
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
    });

    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    try {
      await expect(manager.cancelExecution(exec.id)).rejects.toThrow(
        "Failed to cancel durable execution",
      );
      expect(saveExecutionIfStatus).toHaveBeenCalledTimes(10);
      expect(getExecution).toHaveBeenCalledTimes(11);
      expect(sleepSpy.mock.calls.map(([ms]) => ms)).toEqual([
        1, 2, 4, 8, 16, 25, 25, 25, 25,
      ]);
    } finally {
      sleepSpy.mockRestore();
    }
  });

  it("cancelExecution preserves existing cancelRequestedAt and defaults the reason", async () => {
    const requestedAt = new Date("2024-01-01T00:00:00.000Z");

    const exec: Execution = {
      id: "e-cancel-defaults",
      taskId: TaskId.T,
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      cancelRequestedAt: requestedAt,
    };

    const saveExecutionIfStatus = jest.fn(async () => true);

    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => exec,
      saveExecutionIfStatus,
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
    });

    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor(undefined),
    });
    await manager.cancelExecution(exec.id);

    expect(saveExecutionIfStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ExecutionStatus.Cancelled,
        cancelRequestedAt: requestedAt,
        error: { message: "Execution cancelled" },
      }),
      [ExecutionStatus.Running],
    );
  });

  it("retries cancellation when compare-and-save loses the first race", async () => {
    const exec: Execution = {
      id: "e-cancel-retry",
      taskId: TaskId.T,
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const saveExecutionIfStatus = jest
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => exec,
      saveExecutionIfStatus,
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
    });

    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    await expect(manager.cancelExecution(exec.id)).resolves.toBeUndefined();
    expect(saveExecutionIfStatus).toHaveBeenCalledTimes(2);
  });

  it("does not overwrite cancellation when cancellation happens after work completes", async () => {
    const saveExecutionIfStatus = jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    let getCalls = 0;
    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => {
        getCalls += 1;

        // 1) processExecution initial load
        // 2) processExecution reload after lock
        // 3) runExecutionAttempt isCancelled() at start
        if (getCalls <= 3) {
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
      saveExecutionIfStatus,
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
    });

    const taskExecutor = createFixedTaskExecutor({ ok: true });

    const manager = createManager({ store, taskExecutor });
    await manager.processExecution("e1");

    expect(saveExecutionIfStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: ExecutionStatus.Running }),
      [ExecutionStatus.Pending],
    );
    expect(saveExecutionIfStatus).toHaveBeenCalledTimes(1);
  });

  it("bails out early when the execution is already cancelled before attempting", async () => {
    const saveExecutionIfStatus = jest.fn(async () => false);

    let getCalls = 0;
    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => {
        getCalls += 1;
        if (getCalls <= 2) {
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
      saveExecutionIfStatus,
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
    });

    const taskExecutor = createFixedTaskExecutor({ ok: true });

    const manager = createManager({ store, taskExecutor });
    await manager.processExecution("e0");

    expect(saveExecutionIfStatus).not.toHaveBeenCalled();
  });

  it("bails out when the execution disappears after the lock is acquired", async () => {
    const taskExecutor: ITaskExecutor = {
      run: async () => {
        throw genericError.new({ message: "should not execute" });
      },
    };

    let getCalls = 0;
    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => {
        getCalls += 1;
        if (getCalls === 1) {
          return {
            id: "e-missing-after-lock",
            taskId: TaskId.T,
            input: undefined,
            status: ExecutionStatus.Pending,
            attempt: 1,
            maxAttempts: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          } satisfies Execution;
        }
        return null;
      },
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
    });

    const manager = createManager({ store, taskExecutor });
    await expect(
      manager.processExecution("e-missing-after-lock"),
    ).resolves.toBeUndefined();
  });

  it("bails out when the execution becomes terminal after the lock is acquired", async () => {
    const taskExecutor: ITaskExecutor = {
      run: async () => {
        throw genericError.new({ message: "should not execute" });
      },
    };

    let getCalls = 0;
    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => {
        getCalls += 1;
        if (getCalls === 1) {
          return {
            id: "e-terminal-after-lock",
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
          id: "e-terminal-after-lock",
          taskId: TaskId.T,
          input: undefined,
          status: ExecutionStatus.Completed,
          attempt: 1,
          maxAttempts: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: new Date(),
        } satisfies Execution;
      },
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
    });

    const manager = createManager({ store, taskExecutor });
    await expect(
      manager.processExecution("e-terminal-after-lock"),
    ).resolves.toBeUndefined();
  });

  it("bails out when the running transition loses the compare-and-save race", async () => {
    const saveExecutionIfStatus = jest.fn(async () => false);
    const taskExecutor: ITaskExecutor = {
      run: async () => {
        throw genericError.new({ message: "should not execute" });
      },
    };

    let getCalls = 0;
    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => {
        getCalls += 1;
        return {
          id: "e-running-race",
          taskId: TaskId.T,
          input: undefined,
          status: ExecutionStatus.Pending,
          attempt: 1,
          maxAttempts: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        } satisfies Execution;
      },
      saveExecutionIfStatus,
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
    });

    const manager = createManager({ store, taskExecutor });
    await manager.processExecution("e-running-race");
    expect(saveExecutionIfStatus).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite cancellation when cancellation happens after a suspension", async () => {
    const saveExecutionIfStatus = jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    let getCalls = 0;
    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => {
        getCalls += 1;

        // 1) processExecution initial load
        // 2) processExecution reload after lock
        // 3) runExecutionAttempt isCancelled() at start
        if (getCalls <= 3) {
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
      saveExecutionIfStatus,
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
    });

    const taskExecutor: ITaskExecutor = {
      run: async () => {
        throw new SuspensionSignal("yield");
      },
    };

    const manager = createManager({ store, taskExecutor });
    await manager.processExecution("e2");

    expect(saveExecutionIfStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: ExecutionStatus.Running }),
      [ExecutionStatus.Pending],
    );
    expect(saveExecutionIfStatus).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite cancellation when cancellation happens after a failure", async () => {
    const saveExecutionIfStatus = jest.fn(async () => true);
    const createTimer = jest.fn(async () => undefined);

    let getCalls = 0;
    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => {
        getCalls += 1;

        // 1) processExecution initial load
        // 2) processExecution reload after lock
        // 3) runExecutionAttempt isCancelled() at start
        if (getCalls <= 3) {
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
      saveExecutionIfStatus,
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
      createTimer,
    });

    const taskExecutor: ITaskExecutor = {
      run: async () => {
        throw genericError.new({ message: "boom" });
      },
    };

    const manager = createManager({ store, taskExecutor });
    await manager.processExecution("e3");

    expect(saveExecutionIfStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: ExecutionStatus.Running }),
      [ExecutionStatus.Pending],
    );
    expect(createTimer).not.toHaveBeenCalled();
    expect(saveExecutionIfStatus).toHaveBeenCalledTimes(1);
  });

  it("fails executions when attempts are exhausted", async () => {
    const saveExecutionIfStatus = jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    const execution: Execution = {
      id: "e-fail-patch",
      taskId: TaskId.T,
      input: { hello: "world" },
      status: ExecutionStatus.Pending,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => execution,
      saveExecutionIfStatus,
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
    });

    const taskExecutor: ITaskExecutor = {
      run: async () => {
        throw genericError.new({ message: "kaboom" });
      },
    };

    const manager = createManager({ store, taskExecutor });
    await manager.processExecution(execution.id);

    expect(saveExecutionIfStatus).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ status: ExecutionStatus.Running }),
      [ExecutionStatus.Pending],
    );

    const failedCall = saveExecutionIfStatus.mock.calls[1];
    expect(failedCall).toBeDefined();
    if (!failedCall) {
      throw new Error("Expected failure update call to be recorded");
    }
    const failedExecution = failedCall[0] as Execution;
    expect(failedExecution.status).toBe(ExecutionStatus.Failed);
    expect(failedExecution.error).toEqual(
      expect.objectContaining({ message: "kaboom" }),
    );
    expect(failedExecution.completedAt).toBeInstanceOf(Date);
    expect(failedCall[1]).toEqual([ExecutionStatus.Running]);
  });

  it("fails executions when an attempt times out", async () => {
    const saveExecutionIfStatus = jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    const createTimer = jest.fn(async () => undefined);

    const execution: Execution = {
      id: "e-timeout-mid-attempt",
      taskId: TaskId.T,
      input: undefined,
      status: ExecutionStatus.Pending,
      attempt: 1,
      maxAttempts: 3,
      timeout: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => execution,
      saveExecutionIfStatus,
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
      createTimer,
    });

    const taskExecutor: ITaskExecutor = {
      run: async () =>
        new Promise<never>(() => {
          // Intentionally unresolved so withTimeout drives the terminal path.
        }),
    };

    const manager = createManager({ store, taskExecutor });
    await manager.processExecution(execution.id);

    expect(saveExecutionIfStatus).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ status: ExecutionStatus.Running }),
      [ExecutionStatus.Pending],
    );

    const failedCall = saveExecutionIfStatus.mock.calls[1];
    expect(failedCall).toBeDefined();
    if (!failedCall) {
      throw new Error("Expected timeout failure update call to be recorded");
    }
    const failedExecution = failedCall[0] as Execution;
    expect(failedExecution.status).toBe(ExecutionStatus.Failed);
    expect(failedExecution.error).toEqual(
      expect.objectContaining({
        message: `Execution ${execution.id} timed out`,
      }),
    );
    expect(failedExecution.completedAt).toBeInstanceOf(Date);
    expect(createTimer).not.toHaveBeenCalled();
    expect(failedCall[1]).toEqual([ExecutionStatus.Running]);
  });

  it("does not notify completion when completion compare-and-save loses the race", async () => {
    const published: string[] = [];
    const saveExecutionIfStatus = jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => ({
        id: "e-complete-race",
        taskId: TaskId.T,
        input: undefined,
        status: ExecutionStatus.Pending,
        attempt: 1,
        maxAttempts: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      saveExecutionIfStatus,
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
    });

    const taskRegistry = new TaskRegistry();
    taskRegistry.register(task);
    const auditLogger = new AuditLogger({ enabled: false }, store);
    const waitManager = new WaitManager(store);
    const manager = new ExecutionManager(
      {
        store,
        taskExecutor: createFixedTaskExecutor("ok"),
        eventBus: {
          publish: async (channel) => {
            published.push(channel);
          },
          subscribe: async () => undefined,
          unsubscribe: async () => undefined,
        },
      },
      taskRegistry,
      auditLogger,
      waitManager,
    );

    await manager.processExecution("e-complete-race");
    expect(published).toEqual([]);
  });

  it("does not persist sleeping when the suspension compare-and-save loses the race", async () => {
    const saveExecutionIfStatus = jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => ({
        id: "e-suspend-race",
        taskId: TaskId.T,
        input: undefined,
        status: ExecutionStatus.Pending,
        attempt: 1,
        maxAttempts: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      saveExecutionIfStatus,
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
    });

    const manager = createManager({
      store,
      taskExecutor: {
        run: async () => {
          throw new SuspensionSignal("yield");
        },
      },
    });

    await manager.processExecution("e-suspend-race");
    expect(saveExecutionIfStatus).toHaveBeenCalledTimes(2);
  });

  it("best-effort cleans up retry timers when retry compare-and-save loses the race", async () => {
    const saveExecutionIfStatus = jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const createTimer = jest.fn(async () => undefined);
    const deleteTimer = jest.fn(async () => {
      throw genericError.new({ message: "cleanup-failed" });
    });

    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => ({
        id: "e-retry-race",
        taskId: TaskId.T,
        input: undefined,
        status: ExecutionStatus.Pending,
        attempt: 1,
        maxAttempts: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      saveExecutionIfStatus,
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
      createTimer,
      deleteTimer,
    });

    const manager = createManager({
      store,
      taskExecutor: {
        run: async () => {
          throw genericError.new({ message: "boom" });
        },
      },
    });

    await expect(
      manager.processExecution("e-retry-race"),
    ).resolves.toBeUndefined();
    expect(createTimer).toHaveBeenCalledTimes(1);
    expect(deleteTimer).toHaveBeenCalledTimes(1);
  });

  it("fails executions when queue delivery attempts are exhausted", async () => {
    const saveExecutionIfStatus = jest.fn(async () => true);

    const execution: Execution = {
      id: "e-exhausted",
      taskId: TaskId.T,
      input: undefined,
      status: ExecutionStatus.Retrying,
      attempt: 2,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => execution,
      saveExecutionIfStatus,
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
    });

    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    await manager.failExecutionDeliveryExhausted(execution.id, {
      messageId: "m-exhausted",
      attempts: 3,
      maxAttempts: 3,
      errorMessage: "broker rejected message",
    });

    const updateCall = saveExecutionIfStatus.mock.calls[0] as unknown as
      | [Execution, ExecutionStatus[]]
      | undefined;
    expect(updateCall).toBeDefined();
    if (!updateCall) {
      throw new Error("Expected exhausted delivery update call to exist");
    }
    const failedExecution = updateCall[0] as Execution;
    expect(saveExecutionIfStatus).toHaveBeenCalledTimes(1);
    expect(failedExecution.status).toBe(ExecutionStatus.Failed);
    expect(failedExecution.error).toEqual(
      expect.objectContaining({
        message: expect.stringContaining("m-exhausted"),
      }),
    );
    expect(updateCall[1]).toEqual([ExecutionStatus.Retrying]);
  });

  it("does not notify failure when the failed transition loses the compare-and-save race", async () => {
    const published: string[] = [];
    const saveExecutionIfStatus = jest.fn(async () => false);

    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => ({
        id: "e-failed-race",
        taskId: TaskId.T,
        input: undefined,
        status: ExecutionStatus.Retrying,
        attempt: 2,
        maxAttempts: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      saveExecutionIfStatus,
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
    });

    const taskRegistry = new TaskRegistry();
    taskRegistry.register(task);
    const auditLogger = new AuditLogger({ enabled: false }, store);
    const waitManager = new WaitManager(store);
    const manager = new ExecutionManager(
      {
        store,
        taskExecutor: createFixedTaskExecutor(undefined),
        eventBus: {
          publish: async (channel) => {
            published.push(channel);
          },
          subscribe: async () => undefined,
          unsubscribe: async () => undefined,
        },
      },
      taskRegistry,
      auditLogger,
      waitManager,
    );

    await manager.failExecutionDeliveryExhausted("e-failed-race", {
      messageId: "m-failed-race",
      attempts: 3,
      maxAttempts: 3,
      errorMessage: "broker rejected message",
    });
    expect(published).toEqual([]);
  });

  it("ignores exhausted delivery notifications for missing executions", async () => {
    const saveExecutionIfStatus = jest.fn(async () => false);

    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => null,
      saveExecutionIfStatus,
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
    });

    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    await expect(
      manager.failExecutionDeliveryExhausted("missing-execution", {
        messageId: "m-missing",
        attempts: 3,
        maxAttempts: 3,
        errorMessage: "broker rejected message",
      }),
    ).resolves.toBeUndefined();

    expect(saveExecutionIfStatus).not.toHaveBeenCalled();
  });

  it("ignores exhausted delivery notifications for terminal executions", async () => {
    const saveExecutionIfStatus = jest.fn(async () => false);

    const execution: Execution = {
      id: "e-terminal",
      taskId: TaskId.T,
      input: undefined,
      status: ExecutionStatus.Failed,
      attempt: 3,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
      error: { message: "already failed" },
    };

    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => execution,
      saveExecutionIfStatus,
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
    });

    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    await expect(
      manager.failExecutionDeliveryExhausted(execution.id, {
        messageId: "m-terminal",
        attempts: 3,
        maxAttempts: 3,
        errorMessage: "broker rejected message",
      }),
    ).resolves.toBeUndefined();

    expect(saveExecutionIfStatus).not.toHaveBeenCalled();
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

    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => null,
      updateExecution: async () => {},
      listIncompleteExecutions: async () => [],
    });

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
      id: "e-notify",
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
      { channel: "execution:e-notify", type: "finished" },
    ]);
  });

  it("keeps completed executions completed when terminal event publishing fails", async () => {
    const store = new MemoryStore();
    const taskRegistry = new TaskRegistry();
    taskRegistry.register(task);
    const auditLogger = new AuditLogger({ enabled: false }, store);
    const waitManager = new WaitManager(store);
    const logger = {
      with: () => logger,
      error: jest.fn(async () => {}),
    };

    const manager = new ExecutionManager(
      {
        store,
        taskExecutor: createFixedTaskExecutor("ok"),
        logger: logger as any,
        eventBus: {
          publish: async () => {
            throw genericError.new({ message: "bus-down" });
          },
          subscribe: async () => {},
          unsubscribe: async () => {},
        } as any,
      },
      taskRegistry,
      auditLogger,
      waitManager,
    );

    await store.saveExecution({
      id: "e-completed-publish-failure",
      taskId: TaskId.T,
      input: undefined,
      status: ExecutionStatus.Pending,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      manager.processExecution("e-completed-publish-failure"),
    ).resolves.toBeUndefined();

    await expect(
      store.getExecution("e-completed-publish-failure"),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "e-completed-publish-failure",
        status: ExecutionStatus.Completed,
        result: "ok",
      }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      "Durable execution finished notification failed.",
      expect.objectContaining({
        executionId: "e-completed-publish-failure",
        status: ExecutionStatus.Completed,
        error: expect.any(Error),
      }),
    );
  });

  it("falls back to NoopEventBus when eventBus is not provided", async () => {
    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => null,
      updateExecution: async () => {},
      listIncompleteExecutions: async () => [],
    });

    const taskRegistry = new TaskRegistry();
    const auditLogger = new AuditLogger({ enabled: false }, store);
    const waitManager = new WaitManager(store);

    const manager = new ExecutionManager(
      {
        store,
        taskExecutor: createFixedTaskExecutor(undefined),
      },
      taskRegistry,
      auditLogger,
      waitManager,
    );

    await expect(
      manager.notifyExecutionFinished({
        id: "e-notify-noop",
        taskId: TaskId.T,
        input: undefined,
        status: ExecutionStatus.Completed,
        attempt: 1,
        maxAttempts: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: new Date(),
        result: undefined,
      }),
    ).resolves.toBeUndefined();
  });
});
