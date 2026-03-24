import { ExecutionManager } from "../../durable/core/managers/ExecutionManager";
import { AuditLogger } from "../../durable/core/managers/AuditLogger";
import { TaskRegistry } from "../../durable/core/managers/TaskRegistry";
import { WaitManager } from "../../durable/core/managers/WaitManager";
import { NoopEventBus } from "../../durable/bus/NoopEventBus";
import { SuspensionSignal } from "../../durable/core/interfaces/context";
import { ExecutionStatus, type Execution } from "../../durable/core/types";
import type {
  IDurableStore,
  ExpectedExecutionStatuses,
} from "../../durable/core/interfaces/store";
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

  type SaveExecutionIfStatusMock = jest.MockedFunction<
    IDurableStore["saveExecutionIfStatus"]
  >;

  const createSaveExecutionIfStatusMock = (
    result: boolean,
  ): SaveExecutionIfStatusMock =>
    jest.fn(
      async (
        _execution: Execution,
        _expectedStatuses: ExpectedExecutionStatuses,
      ) => result,
    ) as SaveExecutionIfStatusMock;

  const createExecution = (overrides: Partial<Execution> = {}): Execution => ({
    id: "e-test",
    workflowKey: TaskId.T,
    input: undefined,
    status: ExecutionStatus.Running,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  it("returns null cancellation state for active or missing executions", () => {
    const manager = createManager({
      store: createStore({
        saveExecution: async () => {},
        getExecution: async () => null,
        updateExecution: async () => undefined,
        listIncompleteExecutions: async () => [],
      }),
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    expect((manager as any).getCancellationState(null)).toBeNull();
    expect(
      (manager as any).getCancellationState(
        createExecution({ status: ExecutionStatus.Running }),
      ),
    ).toBeNull();
  });

  it("does not re-abort missing or already-aborted active attempts", () => {
    const manager = createManager({
      store: createStore({
        saveExecution: async () => {},
        getExecution: async () => null,
        updateExecution: async () => undefined,
        listIncompleteExecutions: async () => [],
      }),
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    expect(() =>
      (manager as any).abortActiveAttempt("missing", "ignored"),
    ).not.toThrow();

    const controller = new AbortController();
    controller.abort("already-aborted");
    (manager as any).activeAttemptControllers.set("e-aborted", controller);

    (manager as any).abortActiveAttempt("e-aborted", "ignored");

    expect(controller.signal.reason).toBe("already-aborted");
  });

  it("returns the existing execution when the idempotency key is already claimed", async () => {
    const store = createStore({
      saveExecution: async () => {
        throw genericError.new({ message: "should not save execution" });
      },
      getExecution: async () => ({
        id: "existing",
        workflowKey: TaskId.T,
        input: undefined,
        status: ExecutionStatus.Pending,
        attempt: 1,
        maxAttempts: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      updateExecution: async () => {},
      listIncompleteExecutions: async () => [],
      createExecutionWithIdempotencyKey: async () => ({
        created: false as const,
        executionId: "existing",
      }),
    });
    const queueEnqueue = jest.fn(async () => "queued");

    const manager = createManager({
      store,
      queue: {
        enqueue: queueEnqueue,
      } as any,
    });

    await expect(
      manager.start(task, undefined, {
        idempotencyKey: IdempotencyKey.K,
      }),
    ).resolves.toBe("existing");
    expect(queueEnqueue).toHaveBeenCalledWith({
      type: "execute",
      payload: { executionId: "existing" },
      maxAttempts: 3,
    });
  });

  it("re-kicks retrying executions returned by idempotent start", async () => {
    const store = createStore({
      saveExecution: async () => {
        throw genericError.new({ message: "should not save execution" });
      },
      getExecution: async () => ({
        id: "existing",
        workflowKey: TaskId.T,
        input: undefined,
        status: ExecutionStatus.Retrying,
        attempt: 1,
        maxAttempts: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
      createExecutionWithIdempotencyKey: async () => ({
        created: false as const,
        executionId: "existing",
      }),
    });

    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor({ ok: true }),
    });
    const processExecution = jest
      .spyOn(manager, "processExecution")
      .mockResolvedValue(undefined);

    await expect(
      manager.start(task, undefined, {
        idempotencyKey: IdempotencyKey.K,
      }),
    ).resolves.toBe("existing");

    expect(processExecution).toHaveBeenCalledWith("existing");
    expect(processExecution).toHaveBeenCalledTimes(1);
  });

  it.each([
    ExecutionStatus.Running,
    ExecutionStatus.Cancelling,
    ExecutionStatus.Sleeping,
  ])(
    "does not re-kick %s executions returned by idempotent start",
    async (status) => {
      const store = createStore({
        saveExecution: async () => {
          throw genericError.new({ message: "should not save execution" });
        },
        getExecution: async () =>
          createExecution({
            id: "existing",
            status,
          }),
        updateExecution: async () => undefined,
        listIncompleteExecutions: async () => [],
        createExecutionWithIdempotencyKey: async () => ({
          created: false as const,
          executionId: "existing",
        }),
      });

      const manager = createManager({
        store,
        taskExecutor: createFixedTaskExecutor({ ok: true }),
      });
      const processExecution = jest
        .spyOn(manager, "processExecution")
        .mockResolvedValue(undefined);

      await expect(
        manager.start(task, undefined, {
          idempotencyKey: IdempotencyKey.K,
        }),
      ).resolves.toBe("existing");

      expect(processExecution).not.toHaveBeenCalled();
    },
  );

  it("does not re-kick terminal executions returned by idempotent start", async () => {
    const store = createStore({
      saveExecution: async () => {
        throw genericError.new({ message: "should not save execution" });
      },
      getExecution: async () => ({
        id: "existing",
        workflowKey: TaskId.T,
        input: undefined,
        status: ExecutionStatus.Completed,
        attempt: 1,
        maxAttempts: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: new Date(),
        result: { ok: true },
      }),
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
      createExecutionWithIdempotencyKey: async () => ({
        created: false as const,
        executionId: "existing",
      }),
    });

    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor({ ok: true }),
    });
    const processExecution = jest
      .spyOn(manager, "processExecution")
      .mockResolvedValue(undefined);

    await expect(
      manager.start(task, undefined, {
        idempotencyKey: IdempotencyKey.K,
      }),
    ).resolves.toBe("existing");

    expect(processExecution).not.toHaveBeenCalled();
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
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(false);
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
      workflowKey: TaskId.T,
      input: undefined,
      status: ExecutionStatus.Completed,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
      result: { ok: true },
    };

    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(false);

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

  it("cancelExecution is a no-op when execution is already cancelling", async () => {
    const exec = createExecution({
      id: "e-already-cancelling",
      status: ExecutionStatus.Cancelling,
      cancelRequestedAt: new Date(),
      error: { message: "already cancelling" },
    });
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(false);
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
      workflowKey: TaskId.T,
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
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(false)
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
      workflowKey: TaskId.T,
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
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(false);
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

  it("cancelExecution preserves existing cancelRequestedAt and marks running attempts as cancelling", async () => {
    const requestedAt = new Date("2024-01-01T00:00:00.000Z");

    const exec: Execution = {
      id: "e-cancel-defaults",
      workflowKey: TaskId.T,
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      cancelRequestedAt: requestedAt,
    };

    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(true);

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
        status: ExecutionStatus.Cancelling,
        cancelRequestedAt: requestedAt,
        error: { message: "Execution cancelled" },
      }),
      [ExecutionStatus.Running],
    );
  });

  it("defaults the running cancellation reason when no request exists yet", async () => {
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(true);
    const execution = createExecution({ id: "e-cancel-default-running" });
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
    await manager.cancelExecution(execution.id);

    expect(saveExecutionIfStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ExecutionStatus.Cancelling,
        error: { message: "Execution cancelled" },
      }),
      [ExecutionStatus.Running],
    );
  });

  it("preserves the original cancelRequestedAt when finalizing running cancellation", async () => {
    const requestedAt = new Date("2024-01-01T00:00:00.000Z");
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(true);
    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () =>
        createExecution({
          id: "e-finalize-cancel",
          status: ExecutionStatus.Cancelling,
          cancelRequestedAt: requestedAt,
          error: { message: "cancel me" },
        }),
      saveExecutionIfStatus,
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
    });
    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    await (manager as any).transitionRunningExecutionToCancelled({
      execution: createExecution({
        id: "e-finalize-cancel",
        cancelRequestedAt: new Date("2024-02-01T00:00:00.000Z"),
      }),
      reason: "cancel me",
      canPersistOutcome: async () => true,
    });

    expect(saveExecutionIfStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ExecutionStatus.Cancelled,
        cancelRequestedAt: requestedAt,
      }),
      [ExecutionStatus.Cancelling],
    );
  });

  it("finalizes legacy running cancellation records using the running status CAS", async () => {
    const requestedAt = new Date("2024-01-01T00:00:00.000Z");
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(true);
    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () =>
        createExecution({
          id: "e-legacy-running-cancel",
          status: ExecutionStatus.Running,
          cancelRequestedAt: requestedAt,
          error: { message: "cancel me" },
        }),
      saveExecutionIfStatus,
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
    });
    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    await (manager as any).transitionRunningExecutionToCancelled({
      execution: createExecution({ id: "e-legacy-running-cancel" }),
      reason: "cancel me",
      canPersistOutcome: async () => true,
    });

    expect(saveExecutionIfStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ExecutionStatus.Cancelled,
        cancelRequestedAt: requestedAt,
      }),
      [ExecutionStatus.Running],
    );
  });

  it("fills cancelRequestedAt when finalizing a cancelling record that lacks it", async () => {
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(true);
    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () =>
        createExecution({
          id: "e-missing-requested-at",
          status: ExecutionStatus.Cancelling,
          error: { message: "cancel me" },
        }),
      saveExecutionIfStatus,
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
    });
    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    await (manager as any).transitionRunningExecutionToCancelled({
      execution: createExecution({ id: "e-missing-requested-at" }),
      reason: "cancel me",
      canPersistOutcome: async () => true,
    });

    expect(saveExecutionIfStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ExecutionStatus.Cancelled,
        cancelRequestedAt: expect.any(Date),
      }),
      [ExecutionStatus.Cancelling],
    );
  });

  it("finalizes cancellation instead of silently losing to a failed completion save", async () => {
    const requestedAt = new Date("2024-01-01T00:00:00.000Z");
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const store = createStore({
      saveExecution: async () => {},
      getExecution: async (id: string) =>
        id === "e-complete-cancel-race"
          ? createExecution({
              id,
              status: ExecutionStatus.Cancelling,
              cancelRequestedAt: requestedAt,
              error: { message: "cancel me" },
            })
          : null,
      saveExecutionIfStatus,
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
    });
    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    await (manager as any).completeExecutionAttempt(
      createExecution({ id: "e-complete-cancel-race" }),
      { ok: true },
      async () => true,
    );

    expect(saveExecutionIfStatus).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        status: ExecutionStatus.Completed,
      }),
      [ExecutionStatus.Running],
    );
    expect(saveExecutionIfStatus).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        status: ExecutionStatus.Cancelled,
        cancelRequestedAt: requestedAt,
      }),
      [ExecutionStatus.Cancelling],
    );
  });

  it("returns early when cancellation finalization cannot load an execution", async () => {
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(true);
    const manager = createManager({
      store: createStore({
        saveExecution: async () => {},
        getExecution: async () => null,
        saveExecutionIfStatus,
        updateExecution: async () => undefined,
        listIncompleteExecutions: async () => [],
      }),
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    await (manager as any).transitionRunningExecutionToCancelled({
      execution: createExecution({ id: "e-missing-cancel" }),
      reason: "cancel me",
      canPersistOutcome: async () => true,
    });

    expect(saveExecutionIfStatus).not.toHaveBeenCalled();
  });

  it("returns early when the final cancellation CAS loses", async () => {
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(false);
    const manager = createManager({
      store: createStore({
        saveExecution: async () => {},
        getExecution: async () =>
          createExecution({
            id: "e-cancel-cas-lost",
            status: ExecutionStatus.Cancelling,
            cancelRequestedAt: new Date(),
            error: { message: "cancel me" },
          }),
        saveExecutionIfStatus,
        updateExecution: async () => undefined,
        listIncompleteExecutions: async () => [],
      }),
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    await (manager as any).transitionRunningExecutionToCancelled({
      execution: createExecution({ id: "e-cancel-cas-lost" }),
      reason: "cancel me",
      canPersistOutcome: async () => true,
    });

    expect(saveExecutionIfStatus).toHaveBeenCalledTimes(1);
  });

  it("returns early when cancellation finalization sees no cancellation request", async () => {
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(true);
    const manager = createManager({
      store: createStore({
        saveExecution: async () => {},
        getExecution: async () => createExecution({ id: "e-no-cancel" }),
        saveExecutionIfStatus,
        updateExecution: async () => undefined,
        listIncompleteExecutions: async () => [],
      }),
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    await (manager as any).transitionRunningExecutionToCancelled({
      execution: createExecution({ id: "e-no-cancel" }),
      reason: "cancel me",
      canPersistOutcome: async () => true,
    });

    expect(saveExecutionIfStatus).not.toHaveBeenCalled();
  });

  it("returns false when cancellation finalization finds no request", async () => {
    const manager = createManager({
      store: createStore({
        saveExecution: async () => {},
        getExecution: async () =>
          createExecution({ id: "e-no-cancel-request" }),
        updateExecution: async () => undefined,
        listIncompleteExecutions: async () => [],
      }),
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    await expect(
      (manager as any).finalizeCancellationIfRequested(
        createExecution({ id: "e-no-cancel-request" }),
      ),
    ).resolves.toBe(false);
  });

  it("returns true when cancellation finalization sees an already cancelled execution", async () => {
    const manager = createManager({
      store: createStore({
        saveExecution: async () => {},
        getExecution: async () =>
          createExecution({
            id: "e-already-cancelled",
            status: ExecutionStatus.Cancelled,
            cancelRequestedAt: new Date(),
            cancelledAt: new Date(),
            completedAt: new Date(),
            error: { message: "done" },
          }),
        updateExecution: async () => undefined,
        listIncompleteExecutions: async () => [],
      }),
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    await expect(
      (manager as any).finalizeCancellationIfRequested(
        createExecution({ id: "e-already-cancelled" }),
      ),
    ).resolves.toBe(true);
  });

  it("falls back to cancellation finalization when a failure CAS loses to cancellation", async () => {
    const requestedAt = new Date("2024-01-01T00:00:00.000Z");
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () =>
        createExecution({
          id: "e-failed-cancel-race",
          status: ExecutionStatus.Cancelling,
          cancelRequestedAt: requestedAt,
          error: { message: "cancel me" },
        }),
      saveExecutionIfStatus,
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
    });
    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    await (manager as any).transitionExecutionToFailed({
      execution: createExecution({ id: "e-failed-cancel-race" }),
      from: ExecutionStatus.Running,
      reason: "failed",
      error: { message: "boom" },
    });

    expect(saveExecutionIfStatus).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        status: ExecutionStatus.Failed,
      }),
      [ExecutionStatus.Running],
    );
    expect(saveExecutionIfStatus).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        status: ExecutionStatus.Cancelled,
        cancelRequestedAt: requestedAt,
      }),
      [ExecutionStatus.Cancelling],
    );
  });

  it("skips running cancellation finalization when the attempt can no longer persist", async () => {
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(true);
    const manager = createManager({
      store: createStore({
        saveExecution: async () => {},
        getExecution: async () => null,
        saveExecutionIfStatus,
        updateExecution: async () => undefined,
        listIncompleteExecutions: async () => [],
      }),
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    await (manager as any).transitionRunningExecutionToCancelled({
      execution: createExecution({ id: "e-no-persist" }),
      reason: "late-cancel",
      canPersistOutcome: async () => false,
    });

    expect(saveExecutionIfStatus).not.toHaveBeenCalled();
  });

  it("retries cancellation when compare-and-save loses the first race", async () => {
    const exec: Execution = {
      id: "e-cancel-retry",
      workflowKey: TaskId.T,
      input: undefined,
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(false)
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
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(true)
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
            workflowKey: TaskId.T,
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
          workflowKey: TaskId.T,
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

    expect(saveExecutionIfStatus).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ status: ExecutionStatus.Running }),
      [ExecutionStatus.Pending],
    );
    expect(saveExecutionIfStatus).toHaveBeenCalledTimes(1);
  });

  it("finalizes running executions that were already cancellation-requested before the attempt body runs", async () => {
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(true);
    const execution = createExecution({
      id: "e-running-cancel-requested",
      cancelRequestedAt: new Date(),
      error: { message: "Already requested" },
    });
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
    await manager.processExecution(execution.id);

    expect(saveExecutionIfStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ExecutionStatus.Cancelled,
        error: { message: "Already requested" },
      }),
      [ExecutionStatus.Running],
    );
  });

  it("bails out early when the execution is already cancelled before attempting", async () => {
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(false);

    let getCalls = 0;
    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => {
        getCalls += 1;
        if (getCalls <= 2) {
          return {
            id: "e0",
            workflowKey: TaskId.T,
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
          workflowKey: TaskId.T,
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
            workflowKey: TaskId.T,
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
            workflowKey: TaskId.T,
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
          workflowKey: TaskId.T,
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
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(false);
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
          workflowKey: TaskId.T,
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
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(true)
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
            workflowKey: TaskId.T,
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
          workflowKey: TaskId.T,
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

    expect(saveExecutionIfStatus).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ status: ExecutionStatus.Running }),
      [ExecutionStatus.Pending],
    );
    expect(saveExecutionIfStatus).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite cancellation when cancellation happens after a failure", async () => {
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(true);
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
            workflowKey: TaskId.T,
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
          workflowKey: TaskId.T,
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

    expect(saveExecutionIfStatus).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ status: ExecutionStatus.Running }),
      [ExecutionStatus.Pending],
    );
    expect(createTimer).not.toHaveBeenCalled();
    expect(saveExecutionIfStatus).toHaveBeenCalledTimes(1);
  });

  it("fails executions when attempts are exhausted", async () => {
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);

    const execution: Execution = {
      id: "e-fail-patch",
      workflowKey: TaskId.T,
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
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    const createTimer = jest.fn(async () => undefined);

    const execution: Execution = {
      id: "e-timeout-mid-attempt",
      workflowKey: TaskId.T,
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
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => ({
        id: "e-complete-race",
        workflowKey: TaskId.T,
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
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => ({
        id: "e-suspend-race",
        workflowKey: TaskId.T,
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
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(true)
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
        workflowKey: TaskId.T,
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
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(true);

    const execution: Execution = {
      id: "e-exhausted",
      workflowKey: TaskId.T,
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
      | [Execution, ExpectedExecutionStatuses]
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

  it("throws without notifying when the failed transition keeps losing the compare-and-save race", async () => {
    const published: string[] = [];
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(false);

    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => ({
        id: "e-failed-race",
        workflowKey: TaskId.T,
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

    await expect(
      manager.failExecutionDeliveryExhausted("e-failed-race", {
        messageId: "m-failed-race",
        attempts: 3,
        maxAttempts: 3,
        errorMessage: "broker rejected message",
      }),
    ).rejects.toThrow(
      "Failed to transition durable execution 'e-failed-race' to failed",
    );
    expect(published).toEqual([]);
  });

  it("retries exhausted delivery failure transitions when the first compare-and-save loses the race", async () => {
    const published: string[] = [];
    let saveAttempts = 0;
    const storeExecution: Execution = {
      id: "e-failed-retry",
      workflowKey: TaskId.T,
      input: undefined,
      status: ExecutionStatus.Retrying,
      attempt: 2,
      maxAttempts: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => ({ ...storeExecution }),
      saveExecutionIfStatus: jest.fn(async (execution) => {
        saveAttempts += 1;
        if (saveAttempts === 1) {
          return false;
        }

        storeExecution.status = execution.status;
        storeExecution.completedAt = execution.completedAt;
        storeExecution.updatedAt = execution.updatedAt;
        storeExecution.error = execution.error;
        return true;
      }),
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

    await manager.failExecutionDeliveryExhausted(storeExecution.id, {
      messageId: "m-failed-retry",
      attempts: 3,
      maxAttempts: 3,
      errorMessage: "broker rejected message",
    });

    expect(saveAttempts).toBe(2);
    expect(storeExecution.status).toBe(ExecutionStatus.Failed);
    expect(published).toEqual([`execution:${storeExecution.id}`]);
  });

  it("throws when exhausted delivery cannot transition the execution after repeated races", async () => {
    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => ({
        id: "e-failed-stuck",
        workflowKey: TaskId.T,
        input: undefined,
        status: ExecutionStatus.Retrying,
        attempt: 2,
        maxAttempts: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      saveExecutionIfStatus: jest.fn(async () => false),
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
    });

    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    await expect(
      manager.failExecutionDeliveryExhausted("e-failed-stuck", {
        messageId: "m-failed-stuck",
        attempts: 3,
        maxAttempts: 3,
        errorMessage: "broker rejected message",
      }),
    ).rejects.toThrow(
      "Failed to transition durable execution 'e-failed-stuck' to failed",
    );
  });

  it("returns quietly when exhausted delivery loses repeated races but the execution is gone by the final recheck", async () => {
    let reads = 0;
    const store = createStore({
      saveExecution: async () => {},
      getExecution: async () => {
        reads += 1;
        if (reads > 5) {
          return null;
        }

        return {
          id: "e-failed-missing-after-races",
          workflowKey: TaskId.T,
          input: undefined,
          status: ExecutionStatus.Retrying,
          attempt: 2,
          maxAttempts: 3,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
      saveExecutionIfStatus: jest.fn(async () => false),
      updateExecution: async () => undefined,
      listIncompleteExecutions: async () => [],
    });

    const manager = createManager({
      store,
      taskExecutor: createFixedTaskExecutor(undefined),
    });

    await expect(
      manager.failExecutionDeliveryExhausted("e-failed-missing-after-races", {
        messageId: "m-failed-missing",
        attempts: 3,
        maxAttempts: 3,
        errorMessage: "broker rejected message",
      }),
    ).resolves.toBeUndefined();
  });

  it("ignores exhausted delivery notifications for missing executions", async () => {
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(false);

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
    const saveExecutionIfStatus = createSaveExecutionIfStatusMock(false);

    const execution: Execution = {
      id: "e-terminal",
      workflowKey: TaskId.T,
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
    const published: Array<{
      channel: string;
      type: string;
      payload: unknown;
    }> = [];

    const eventBus = {
      publish: async (channel: string, event: any) => {
        published.push({
          channel,
          type: event.type,
          payload: event.payload,
        });
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
      workflowKey: TaskId.T,
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
      {
        channel: "execution:e-notify",
        type: "finished",
        payload: {
          executionId: "e-notify",
          status: ExecutionStatus.Completed,
        },
      },
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
      workflowKey: TaskId.T,
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
        workflowKey: TaskId.T,
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
