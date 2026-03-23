import { DurableService } from "../../durable/core/DurableService";
import { DurableContext } from "../../durable/core/DurableContext";
import { SuspensionSignal } from "../../durable/core/interfaces/context";
import type { Execution } from "../../durable/core/types";
import { ExecutionStatus } from "../../durable/core/types";
import { MemoryStore } from "../../durable/store/MemoryStore";
import {
  SpyQueue,
  createBufferedLogger,
  createTaskExecutor,
  okTask,
  pendingExecution,
} from "./DurableService.unit.helpers";

type TestExecutionManager = {
  assertStoreLockOwnership: (lockState: {
    lost: boolean;
    lossError: Error | null;
    triggerLoss: (error: Error) => void;
    waitForLoss: Promise<never>;
    lockId?: string | "no-lock";
    lockResource?: string;
    lockTtlMs?: number;
  }) => Promise<void>;
  assertTaskExecutorConfigured: () => void;
  completeExecutionAttempt: (
    runningExecution: Execution,
    result: unknown,
    canPersistOutcome?: () => Promise<boolean>,
  ) => Promise<void>;
  createExecutionContext: (
    runningExecution: Execution,
    taskDef: ReturnType<typeof okTask>,
    assertLockOwnership: () => void,
  ) => DurableContext;
  failExecutionDeliveryExhausted: (
    executionId: string,
    details: {
      messageId: string;
      attempts: number;
      maxAttempts: number;
      errorMessage: string;
    },
  ) => Promise<void>;
  kickoffExecution: (executionId: string) => Promise<void>;
  notifyExecutionFinished: (execution: Execution) => Promise<void>;
  processExecution: (executionId: string) => Promise<void>;
  resolveTaskReference: (
    taskRef: string | ReturnType<typeof okTask>,
    apiMethod: string,
  ) => ReturnType<typeof okTask>;
  runExecutionAttempt: (
    execution: Execution,
    taskDef: ReturnType<typeof okTask>,
    lockState: {
      lost: boolean;
      lossError: Error | null;
      triggerLoss: (error: Error) => void;
      waitForLoss: Promise<never>;
      lockId?: string | "no-lock";
      lockResource?: string;
      lockTtlMs?: number;
    },
  ) => Promise<void>;
  runTaskAttempt: (params: {
    task: ReturnType<typeof okTask>;
    input: unknown;
    context: DurableContext;
    execution: Execution;
    raceWithLockLoss: <T>(promise: Promise<T>) => Promise<T>;
    canPersistOutcome: () => Promise<boolean>;
  }) => Promise<
    { kind: "completed"; result: unknown } | { kind: "already-finalized" }
  >;
  scheduleExecutionRetry: (params: {
    runningExecution: Execution;
    error: { message: string; stack?: string };
    canPersistOutcome?: () => Promise<boolean>;
  }) => Promise<void>;
  suspendExecutionAttempt: (
    runningExecution: Execution,
    reason: string,
    canPersistOutcome?: () => Promise<boolean>,
  ) => Promise<void>;
  toExecutionErrorInfo: (error: unknown) => { message: string; stack?: string };
  transitionExecutionToFailed: (params: {
    execution: Execution;
    from: ExecutionStatus;
    reason:
      | "failed"
      | "timed_out"
      | "task_not_registered"
      | "delivery_attempts_exhausted";
    error: { message: string; stack?: string };
  }) => Promise<void>;
  transitionExecutionToRunning: (
    execution: Execution,
  ) => Promise<Execution | null>;
  isCompensationFailure: (error: unknown) => boolean;
  isExecutionTerminal: (status: ExecutionStatus) => boolean;
};

function getManager(service: DurableService): TestExecutionManager {
  return service._executionManager as unknown as TestExecutionManager;
}

function createLockState(
  overrides?: Partial<
    Parameters<TestExecutionManager["assertStoreLockOwnership"]>[0]
  >,
) {
  return {
    lost: false,
    lossError: null,
    triggerLoss: jest.fn(),
    waitForLoss: new Promise<never>(() => {}),
    ...overrides,
  };
}

describe("durable: ExecutionManager coverage", () => {
  it("covers store lock rechecks across success and failure cases", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });
    const manager = getManager(service);

    await expect(
      manager.assertStoreLockOwnership(
        createLockState({
          lost: true,
          lossError: new Error("known-loss"),
        }),
      ),
    ).rejects.toThrow("known-loss");

    await expect(
      manager.assertStoreLockOwnership(createLockState()),
    ).resolves.toBeUndefined();

    await expect(
      manager.assertStoreLockOwnership(
        createLockState({
          lockId: "no-lock",
          lockResource: "execution:no-lock",
          lockTtlMs: 1_000,
        }),
      ),
    ).resolves.toBeUndefined();

    const noRenewStore = new MemoryStore();
    Object.defineProperty(noRenewStore, "renewLock", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const noRenewService = new DurableService({
      store: noRenewStore,
      tasks: [],
    });
    await expect(
      getManager(noRenewService).assertStoreLockOwnership(
        createLockState({
          lockId: "lock-no-renew",
          lockResource: "execution:no-renew",
          lockTtlMs: 1_000,
        }),
      ),
    ).resolves.toBeUndefined();

    const renewSuccessStore = new MemoryStore();
    const renewSuccessSpy = jest
      .spyOn(renewSuccessStore, "renewLock")
      .mockResolvedValue(true);
    const renewSuccessService = new DurableService({
      store: renewSuccessStore,
      tasks: [],
    });
    await expect(
      getManager(renewSuccessService).assertStoreLockOwnership(
        createLockState({
          lockId: "lock-success",
          lockResource: "execution:success",
          lockTtlMs: 1_000,
        }),
      ),
    ).resolves.toBeUndefined();
    expect(renewSuccessSpy).toHaveBeenCalledWith(
      "execution:success",
      "lock-success",
      1_000,
    );

    const renewFailureStore = new MemoryStore();
    jest.spyOn(renewFailureStore, "renewLock").mockResolvedValue(false);
    const renewFailureService = new DurableService({
      store: renewFailureStore,
      tasks: [],
    });
    const failingState = createLockState({
      lockId: "lock-failed",
      lockResource: "execution:failed",
      lockTtlMs: 1_000,
    });
    await expect(
      getManager(renewFailureService).assertStoreLockOwnership(failingState),
    ).rejects.toThrow("Execution lock lost for 'execution:failed'");
    expect(failingState.lost).toBe(true);
    expect(failingState.lossError).toBeInstanceOf(Error);
    expect(failingState.triggerLoss).toHaveBeenCalledTimes(1);
  });

  it("covers queue delivery exhaustion, kickoff behavior, and notification failures", async () => {
    const queue = new SpyQueue();
    const { logger, logs } = createBufferedLogger();
    const eventBus = {
      publish: jest.fn(async () => {
        throw new Error("publish-failed");
      }),
      subscribe: jest.fn(async () => undefined),
      unsubscribe: jest.fn(async () => undefined),
    };
    const service = new DurableService({
      store: new MemoryStore(),
      queue,
      eventBus,
      logger,
      tasks: [],
    });
    const manager = getManager(service);

    await manager.kickoffExecution("e-queue");
    expect(queue.enqueued).toEqual([
      { type: "execute", payload: { executionId: "e-queue" } },
    ]);

    const directService = new DurableService({
      store: new MemoryStore(),
      tasks: [],
    });
    const directManager = getManager(directService);
    const processSpy = jest
      .spyOn(
        directManager as unknown as { processExecution: () => Promise<void> },
        "processExecution",
      )
      .mockResolvedValue(undefined);
    await directManager.kickoffExecution("e-direct");
    expect(processSpy).toHaveBeenCalledWith("e-direct");

    const store = new MemoryStore();
    await store.saveExecution(
      pendingExecution({ id: "e-active", workflowKey: "t-active" }),
    );
    await store.saveExecution({
      ...pendingExecution({ id: "e-terminal", workflowKey: "t-terminal" }),
      status: ExecutionStatus.Completed,
      completedAt: new Date(),
    });
    const deliveryService = new DurableService({ store, tasks: [] });
    await getManager(deliveryService).failExecutionDeliveryExhausted(
      "missing",
      {
        messageId: "m0",
        attempts: 1,
        maxAttempts: 1,
        errorMessage: "missing",
      },
    );
    await getManager(deliveryService).failExecutionDeliveryExhausted(
      "e-terminal",
      {
        messageId: "m1",
        attempts: 2,
        maxAttempts: 2,
        errorMessage: "ignored",
      },
    );
    await getManager(deliveryService).failExecutionDeliveryExhausted(
      "e-active",
      {
        messageId: "m2",
        attempts: 3,
        maxAttempts: 3,
        errorMessage: "broker rejected message",
      },
    );
    expect((await store.getExecution("e-terminal"))?.status).toBe(
      ExecutionStatus.Completed,
    );
    expect((await store.getExecution("e-active"))?.status).toBe(
      ExecutionStatus.Failed,
    );
    expect((await store.getExecution("e-active"))?.error?.message).toContain(
      "m2",
    );

    await manager.notifyExecutionFinished(
      pendingExecution({ id: "e-finished", workflowKey: "t-finished" }),
    );
    expect(
      logs.some((log) => {
        const message = (log as { message?: string }).message;
        return message?.includes("notification failed") ?? false;
      }),
    ).toBe(true);
  });

  it("covers extracted attempt helpers and task execution paths", async () => {
    const task = okTask("t-helper-coverage");
    const store = new MemoryStore();
    const service = new DurableService({
      store,
      tasks: [task],
      taskExecutor: createTaskExecutor({
        [task.id]: async (input) => ({ input }),
      }),
    });
    const manager = getManager(service);

    expect(() => manager.assertTaskExecutorConfigured()).not.toThrow();
    expect(manager.resolveTaskReference(task.id, "start")).toBe(task);
    expect(() => manager.resolveTaskReference("missing", "start")).toThrow(
      'DurableService.start() could not resolve task id "missing"',
    );
    expect(manager.isExecutionTerminal(ExecutionStatus.Completed)).toBe(true);
    expect(manager.isExecutionTerminal(ExecutionStatus.Pending)).toBe(false);
    expect(
      manager.isCompensationFailure(new Error("Compensation failed: x")),
    ).toBe(true);
    expect(manager.isCompensationFailure(new Error("boom"))).toBe(false);
    expect(manager.toExecutionErrorInfo("boom")).toEqual({
      message: "boom",
      stack: undefined,
    });

    const alreadyRunning = {
      ...pendingExecution({ id: "e-helper-running", workflowKey: task.id }),
      status: ExecutionStatus.Running,
    };
    expect(await manager.transitionExecutionToRunning(alreadyRunning)).toBe(
      alreadyRunning,
    );

    const pending = pendingExecution({
      id: "e-helper-pending",
      workflowKey: task.id,
    });
    await store.saveExecution(pending);
    const running = await manager.transitionExecutionToRunning(pending);
    expect(running?.status).toBe(ExecutionStatus.Running);

    const context = manager.createExecutionContext(
      running!,
      task,
      () => undefined,
    );

    await expect(
      manager.runTaskAttempt({
        task,
        input: { paidAt: 1 },
        context,
        execution: running!,
        raceWithLockLoss: async (promise) => await promise,
        canPersistOutcome: async () => true,
      }),
    ).resolves.toEqual({
      kind: "completed",
      result: { input: { paidAt: 1 } },
    });

    const timeoutRunning = {
      ...running!,
      id: "e-helper-timeout",
      timeout: 5_000,
      createdAt: new Date(),
    };
    await store.saveExecution(timeoutRunning);
    await expect(
      manager.runTaskAttempt({
        task,
        input: { paidAt: 2 },
        context: manager.createExecutionContext(
          timeoutRunning,
          task,
          () => undefined,
        ),
        execution: timeoutRunning,
        raceWithLockLoss: async (promise) => await promise,
        canPersistOutcome: async () => true,
      }),
    ).resolves.toEqual({
      kind: "completed",
      result: { input: { paidAt: 2 } },
    });

    const expiredRunning = {
      ...running!,
      id: "e-helper-expired",
      timeout: 1,
      createdAt: new Date(Date.now() - 1_000),
    };
    await store.saveExecution(expiredRunning);
    await expect(
      manager.runTaskAttempt({
        task,
        input: { paidAt: 3 },
        context: manager.createExecutionContext(
          expiredRunning,
          task,
          () => undefined,
        ),
        execution: expiredRunning,
        raceWithLockLoss: async (promise) => await promise,
        canPersistOutcome: async () => true,
      }),
    ).resolves.toEqual({ kind: "already-finalized" });
    expect((await store.getExecution("e-helper-expired"))?.status).toBe(
      ExecutionStatus.Failed,
    );

    const expiredBlockedByRecheck = {
      ...running!,
      id: "e-helper-expired-recheck",
      timeout: 1,
      createdAt: new Date(Date.now() - 1_000),
    };
    await store.saveExecution(expiredBlockedByRecheck);
    const timedOutRecheck = jest.fn(async () => false);
    await expect(
      manager.runTaskAttempt({
        task,
        input: { paidAt: 4 },
        context: manager.createExecutionContext(
          expiredBlockedByRecheck,
          task,
          () => undefined,
        ),
        execution: expiredBlockedByRecheck,
        raceWithLockLoss: async (promise) => await promise,
        canPersistOutcome: timedOutRecheck,
      }),
    ).resolves.toEqual({ kind: "already-finalized" });
    expect(timedOutRecheck).toHaveBeenCalledTimes(1);
    expect((await store.getExecution(expiredBlockedByRecheck.id))?.status).toBe(
      ExecutionStatus.Running,
    );
  });

  it("covers extracted outcome helpers for completion, suspension, and retry", async () => {
    const task = okTask("t-outcome-coverage");
    const eventBus = {
      publish: jest.fn(async () => undefined),
      subscribe: jest.fn(async () => undefined),
      unsubscribe: jest.fn(async () => undefined),
    };
    const store = new MemoryStore();
    const service = new DurableService({
      store,
      eventBus,
      tasks: [task],
      taskExecutor: createTaskExecutor({
        [task.id]: async () => "ok",
      }),
    });
    const manager = getManager(service);

    const running = {
      ...pendingExecution({ id: "e-helper-complete", workflowKey: task.id }),
      status: ExecutionStatus.Running,
    };
    await store.saveExecution(running);
    await manager.completeExecutionAttempt(running, "done");
    expect((await store.getExecution(running.id))?.status).toBe(
      ExecutionStatus.Completed,
    );
    expect(eventBus.publish).toHaveBeenCalled();

    const staleRunning = {
      ...pendingExecution({
        id: "e-helper-stale-complete",
        workflowKey: task.id,
      }),
      status: ExecutionStatus.Running,
    };
    await manager.completeExecutionAttempt(staleRunning, "ignored");
    expect(await store.getExecution(staleRunning.id)).toBeNull();

    const sleeping = {
      ...pendingExecution({ id: "e-helper-suspend", workflowKey: task.id }),
      status: ExecutionStatus.Running,
    };
    await store.saveExecution(sleeping);
    await manager.suspendExecutionAttempt(sleeping, "wait_for_signal");
    expect((await store.getExecution(sleeping.id))?.status).toBe(
      ExecutionStatus.Sleeping,
    );

    const suspendedWithFailedRecheck = {
      ...pendingExecution({
        id: "e-helper-suspend-recheck",
        workflowKey: task.id,
      }),
      status: ExecutionStatus.Running,
    };
    await store.saveExecution(suspendedWithFailedRecheck);
    const suspendRecheck = jest.fn(async () => false);
    await manager.suspendExecutionAttempt(
      suspendedWithFailedRecheck,
      "wait_for_signal",
      suspendRecheck,
    );
    expect(suspendRecheck).toHaveBeenCalledTimes(1);
    expect(
      (await store.getExecution(suspendedWithFailedRecheck.id))?.status,
    ).toBe(ExecutionStatus.Running);

    const retrying = {
      ...pendingExecution({ id: "e-helper-retry", workflowKey: task.id }),
      status: ExecutionStatus.Running,
      attempt: 2,
      maxAttempts: 4,
    };
    await store.saveExecution(retrying);
    await manager.scheduleExecutionRetry({
      runningExecution: retrying,
      error: { message: "boom" },
    });
    expect((await store.getExecution(retrying.id))?.status).toBe(
      ExecutionStatus.Retrying,
    );

    const retryBlockedByRecheck = {
      ...pendingExecution({
        id: "e-helper-retry-recheck",
        workflowKey: task.id,
      }),
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 3,
    };
    await store.saveExecution(retryBlockedByRecheck);
    const retryRecheck = jest.fn(async () => false);
    await manager.scheduleExecutionRetry({
      runningExecution: retryBlockedByRecheck,
      error: { message: "boom" },
      canPersistOutcome: retryRecheck,
    });
    expect(retryRecheck).toHaveBeenCalledTimes(1);
    expect((await store.getExecution(retryBlockedByRecheck.id))?.status).toBe(
      ExecutionStatus.Running,
    );
    expect(
      await store.getReadyTimers(new Date(Date.now() + 10_000)),
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          executionId: retryBlockedByRecheck.id,
        }),
      ]),
    );

    const completedWithFailedRecheck = {
      ...pendingExecution({
        id: "e-helper-complete-recheck",
        workflowKey: task.id,
      }),
      status: ExecutionStatus.Running,
    };
    await store.saveExecution(completedWithFailedRecheck);
    const completeRecheck = jest.fn(async () => false);
    await manager.completeExecutionAttempt(
      completedWithFailedRecheck,
      "done",
      completeRecheck,
    );
    expect(completeRecheck).toHaveBeenCalledTimes(1);
    expect(
      (await store.getExecution(completedWithFailedRecheck.id))?.status,
    ).toBe(ExecutionStatus.Running);

    const retryCleanup = {
      ...pendingExecution({
        id: "e-helper-retry-cleanup",
        workflowKey: task.id,
      }),
      status: ExecutionStatus.Running,
      attempt: 1,
      maxAttempts: 3,
    };
    await manager.scheduleExecutionRetry({
      runningExecution: retryCleanup,
      error: { message: "boom" },
    });
    expect(
      await store.getReadyTimers(new Date(Date.now() + 10_000)),
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          executionId: retryCleanup.id,
        }),
      ]),
    );
  });

  it("covers helper-driven error branches through runExecutionAttempt", async () => {
    const noExecutorService = new DurableService({
      store: new MemoryStore(),
      tasks: [],
    });
    expect(() =>
      getManager(noExecutorService).assertTaskExecutorConfigured(),
    ).toThrow(
      "DurableService cannot run executions without `taskExecutor` in config.",
    );

    const task = okTask("t-error-coverage");
    const cancelledStore = new MemoryStore();
    const cancelledService = new DurableService({
      store: cancelledStore,
      tasks: [task],
      taskExecutor: createTaskExecutor({
        [task.id]: async () => "ok",
      }),
    });
    await cancelledStore.saveExecution({
      ...pendingExecution({ id: "e-cancelled", workflowKey: task.id }),
      status: ExecutionStatus.Cancelled,
      completedAt: new Date(),
    });
    await expect(
      getManager(cancelledService).runExecutionAttempt(
        {
          ...pendingExecution({ id: "e-cancelled", workflowKey: task.id }),
          status: ExecutionStatus.Cancelled,
        },
        task,
        createLockState(),
      ),
    ).resolves.toBeUndefined();

    const suspendedStore = new MemoryStore();
    const suspendedService = new DurableService({
      store: suspendedStore,
      tasks: [task],
      taskExecutor: createTaskExecutor({
        [task.id]: async () => {
          throw new SuspensionSignal("sleep");
        },
      }),
    });
    const suspendedExecution = {
      ...pendingExecution({ id: "e-suspend-branch", workflowKey: task.id }),
      status: ExecutionStatus.Running,
    };
    await suspendedStore.saveExecution(suspendedExecution);
    await getManager(suspendedService).runExecutionAttempt(
      suspendedExecution,
      task,
      createLockState(),
    );
    expect(
      (await suspendedStore.getExecution(suspendedExecution.id))?.status,
    ).toBe(ExecutionStatus.Sleeping);
  });

  it("covers failed-transition no-op branches when compare-and-save loses", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });
    const manager = getManager(service);
    const execution = pendingExecution({
      id: "e-failed-noop",
      workflowKey: "t-failed-noop",
    });

    await store.saveExecution(execution);
    jest.spyOn(store, "saveExecutionIfStatus").mockResolvedValue(false);

    await expect(
      manager.transitionExecutionToFailed({
        execution,
        from: ExecutionStatus.Pending,
        reason: "failed",
        error: { message: "boom" },
      }),
    ).resolves.toBeUndefined();
  });

  it("fails executions that cannot be resumed because they are missing a workflow key", async () => {
    const store = new MemoryStore();
    const service = new DurableService({ store, tasks: [] });
    const manager = getManager(service);

    await store.saveExecution({
      id: "e-missing-workflow-key",
      input: undefined,
      status: ExecutionStatus.Pending,
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    await manager.processExecution("e-missing-workflow-key");

    expect(await store.getExecution("e-missing-workflow-key")).toEqual(
      expect.objectContaining({
        status: ExecutionStatus.Failed,
        error: expect.objectContaining({
          message: "Execution is missing its durable workflow key.",
        }),
      }),
    );
  });
});
