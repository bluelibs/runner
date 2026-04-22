import { SuspensionSignal } from "../../../../durable/core/interfaces/context";
import type { IDurableStore } from "../../../../durable/core/interfaces/store";
import { ExecutionStatus } from "../../../../durable/core/types";
import { waitForExecutionDurably } from "../../../../durable/core/durable-context/DurableContext.waitForExecution";
import { DurableExecutionError } from "../../../../durable/core/DurableService";
import { genericError } from "../../../../../errors";

function createStoreMock(
  overrides: Partial<IDurableStore> = {},
): jest.Mocked<IDurableStore> {
  return {
    saveExecution: jest.fn(),
    saveExecutionIfStatus: jest.fn(),
    getExecution: jest.fn(),
    updateExecution: jest.fn(),
    listIncompleteExecutions: jest.fn(),
    listStepResults: jest.fn(),
    getStepResult: jest.fn(),
    saveStepResult: jest.fn(),
    getSignalState: jest.fn(),
    appendSignalRecord: jest.fn(),
    bufferSignalRecord: jest.fn(),
    enqueueQueuedSignalRecord: jest.fn(),
    consumeQueuedSignalRecord: jest.fn(),
    consumeBufferedSignalForStep: jest.fn(),
    upsertSignalWaiter: jest.fn(),
    peekNextSignalWaiter: jest.fn(),
    takeNextSignalWaiter: jest.fn(),
    deleteSignalWaiter: jest.fn(),
    upsertExecutionWaiter: jest.fn(),
    listExecutionWaiters: jest.fn(),
    commitExecutionWaiterCompletion: jest.fn(),
    deleteExecutionWaiter: jest.fn(),
    createTimer: jest.fn(),
    getReadyTimers: jest.fn(),
    markTimerFired: jest.fn(),
    deleteTimer: jest.fn(),
    createSchedule: jest.fn(),
    getSchedule: jest.fn(),
    updateSchedule: jest.fn(),
    saveScheduleWithTimer: jest.fn(),
    deleteSchedule: jest.fn(),
    listSchedules: jest.fn(),
    listActiveSchedules: jest.fn(),
    ...overrides,
  } as jest.Mocked<IDurableStore>;
}

describe("durable: waitForExecutionDurably", () => {
  const baseParams = {
    executionId: "parent",
    targetExecutionId: "child",
    expectedWorkflowKey: "child-task",
    assertCanContinue: jest.fn(async () => undefined),
    assertUniqueStepId: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("persists a waiting state without timeout and suspends", async () => {
    const store = createStoreMock({
      getStepResult: jest.fn().mockResolvedValue(null),
      getExecution: jest.fn().mockResolvedValue({
        id: "child",
        workflowKey: "child-task",
        input: undefined,
        status: ExecutionStatus.Running,
        attempt: 1,
        maxAttempts: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    });

    await expect(
      waitForExecutionDurably({
        ...baseParams,
        store,
      }),
    ).rejects.toBeInstanceOf(SuspensionSignal);

    expect(store.saveStepResult).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: "parent",
        stepId: "__execution:child",
        result: { state: "waiting", targetExecutionId: "child" },
      }),
    );
    expect(store.upsertExecutionWaiter).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: "parent",
        targetExecutionId: "child",
        stepId: "__execution:child",
      }),
    );
  });

  it("throws when the target execution does not exist", async () => {
    const store = createStoreMock({
      getStepResult: jest.fn().mockResolvedValue(null),
      getExecution: jest.fn().mockResolvedValue(null),
    });

    await expect(
      waitForExecutionDurably({
        ...baseParams,
        store,
      }),
    ).rejects.toThrow("target execution does not exist");
  });

  it("returns completed timeout unions for terminal executions", async () => {
    const store = createStoreMock({
      getStepResult: jest.fn().mockResolvedValue(null),
      getExecution: jest.fn().mockResolvedValue({
        id: "child",
        workflowKey: "child-task",
        input: undefined,
        status: ExecutionStatus.Completed,
        result: 42,
        attempt: 1,
        maxAttempts: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: new Date(),
      }),
    });

    await expect(
      waitForExecutionDurably<number>({
        ...baseParams,
        store,
        options: { timeoutMs: 5 },
      }),
    ).resolves.toEqual({ kind: "completed", data: 42 });

    const replayStore = createStoreMock({
      getStepResult: jest.fn().mockResolvedValue({
        executionId: "parent",
        stepId: "__execution:child",
        result: {
          state: "completed",
          targetExecutionId: "child",
          workflowKey: "child-task",
          result: 99,
        },
        completedAt: new Date(),
      }),
    });

    await expect(
      waitForExecutionDurably<number>({
        ...baseParams,
        store: replayStore,
      }),
    ).resolves.toBe(99);
  });

  it("throws durable errors for failed and cancelled terminal executions", async () => {
    const failedStore = createStoreMock({
      getStepResult: jest.fn().mockResolvedValue(null),
      getExecution: jest.fn().mockResolvedValue({
        id: "child",
        workflowKey: "child-task",
        input: undefined,
        status: ExecutionStatus.Failed,
        error: { message: "boom" },
        attempt: 3,
        maxAttempts: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: new Date(),
      }),
    });

    await expect(
      waitForExecutionDurably({
        ...baseParams,
        store: failedStore,
      }),
    ).rejects.toBeInstanceOf(DurableExecutionError);

    const cancelledStore = createStoreMock({
      getStepResult: jest.fn().mockResolvedValue(null),
      getExecution: jest.fn().mockResolvedValue({
        id: "child",
        workflowKey: "child-task",
        input: undefined,
        status: ExecutionStatus.Cancelled,
        attempt: 2,
        maxAttempts: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: new Date(),
      }),
    });

    await expect(
      waitForExecutionDurably({
        ...baseParams,
        store: cancelledStore,
      }),
    ).rejects.toMatchObject({
      message: "Execution cancelled",
    });
  });

  it("rejects replayed completed wait states when the persisted workflow key does not match", async () => {
    const store = createStoreMock({
      getStepResult: jest.fn().mockResolvedValue({
        executionId: "parent",
        stepId: "__execution:child",
        result: {
          state: "completed",
          targetExecutionId: "child",
          workflowKey: "other-child-task",
          result: 99,
        },
        completedAt: new Date(),
      }),
    });

    await expect(
      waitForExecutionDurably<number>({
        ...baseParams,
        store,
      }),
    ).rejects.toThrow("stored durable execution belongs to 'other-child-task'");
  });

  it("rejects invalid persisted wait state payloads", async () => {
    const store = createStoreMock({
      getStepResult: jest.fn().mockResolvedValue({
        executionId: "parent",
        stepId: "__execution:child",
        result: { state: "waiting", nope: true },
        completedAt: new Date(),
      }),
    });

    await expect(
      waitForExecutionDurably({
        ...baseParams,
        store,
      }),
    ).rejects.toThrow("Invalid execution wait state");
  });

  it("throws when a persisted completed wait state belongs to a different workflow", async () => {
    const store = createStoreMock({
      getStepResult: jest.fn().mockResolvedValue({
        executionId: "parent",
        stepId: "__execution:child",
        result: {
          state: "completed",
          targetExecutionId: "child",
          workflowKey: "different-task",
          result: 99,
        },
        completedAt: new Date(),
      }),
    });

    await expect(
      waitForExecutionDurably<number>({
        ...baseParams,
        store,
      }),
    ).rejects.toThrow("belongs to 'different-task'");
  });

  it("throws when a replayed waiting state points to a missing target execution", async () => {
    const store = createStoreMock({
      getStepResult: jest.fn().mockResolvedValue({
        executionId: "parent",
        stepId: "__execution:child-step",
        result: {
          state: "waiting",
          targetExecutionId: "child",
        },
        completedAt: new Date(),
      }),
      getExecution: jest.fn().mockResolvedValue(null),
    });

    await expect(
      waitForExecutionDurably({
        ...baseParams,
        store,
        options: { stepId: "child-step" },
      }),
    ).rejects.toThrow("target execution does not exist");
  });

  it("rejects replayed waiting states when the live target execution workflow changes", async () => {
    const store = createStoreMock({
      getStepResult: jest.fn().mockResolvedValue({
        executionId: "parent",
        stepId: "__execution:child-step",
        result: {
          state: "waiting",
          targetExecutionId: "child",
        },
        completedAt: new Date(),
      }),
      getExecution: jest.fn().mockResolvedValue({
        id: "child",
        workflowKey: "other-child-task",
        input: undefined,
        status: ExecutionStatus.Running,
        attempt: 1,
        maxAttempts: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    });

    await expect(
      waitForExecutionDurably({
        ...baseParams,
        store,
        options: { stepId: "child-step" },
      }),
    ).rejects.toThrow("stored durable execution belongs to 'other-child-task'");
  });

  it("throws when an implicitly addressed replayed waiting state points to a missing target execution", async () => {
    const store = createStoreMock({
      getStepResult: jest.fn().mockResolvedValue({
        executionId: "parent",
        stepId: "__execution:child",
        result: {
          state: "waiting",
          targetExecutionId: "child",
        },
        completedAt: new Date(),
      }),
      getExecution: jest.fn().mockResolvedValue(null),
    });

    await expect(
      waitForExecutionDurably({
        ...baseParams,
        store,
      }),
    ).rejects.toThrow("target execution does not exist");
  });

  it("re-arms timers for persisted timeout waits and returns timeout unions", async () => {
    const waitingStore = createStoreMock({
      getStepResult: jest.fn().mockResolvedValue({
        executionId: "parent",
        stepId: "__execution:child-step",
        result: {
          state: "waiting",
          targetExecutionId: "child",
          timeoutAtMs: 10_000,
          timerId: "timer-1",
        },
        completedAt: new Date(),
      }),
      getExecution: jest.fn().mockResolvedValue({
        id: "child",
        workflowKey: "child-task",
        input: undefined,
        status: ExecutionStatus.Running,
        attempt: 1,
        maxAttempts: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    });

    await expect(
      waitForExecutionDurably({
        ...baseParams,
        store: waitingStore,
        options: { stepId: "child-step", timeoutMs: 5 },
      }),
    ).rejects.toBeInstanceOf(SuspensionSignal);
    expect(waitingStore.createTimer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "timer-1", type: "timeout" }),
    );

    const timedOutStore = createStoreMock({
      getStepResult: jest.fn().mockResolvedValue({
        executionId: "parent",
        stepId: "__execution:child-step",
        result: { state: "timed_out", targetExecutionId: "child" },
        completedAt: new Date(),
      }),
    });

    await expect(
      waitForExecutionDurably({
        ...baseParams,
        store: timedOutStore,
        options: { stepId: "child-step", timeoutMs: 5 },
      }),
    ).resolves.toEqual({ kind: "timeout" });

    await expect(
      waitForExecutionDurably({
        ...baseParams,
        store: timedOutStore,
        options: { stepId: "child-step" },
      }),
    ).rejects.toThrow("timed out waitForExecution");
  });

  it("creates a fresh timeout timer when replayed waiting state lacks timer metadata", async () => {
    const recordedAt = new Date("2026-01-01T00:00:00.000Z");
    const store = createStoreMock({
      getStepResult: jest.fn().mockResolvedValue({
        executionId: "parent",
        stepId: "__execution:child-step",
        result: {
          state: "waiting",
          targetExecutionId: "child",
          timeoutMs: 5,
        },
        completedAt: recordedAt,
      }),
      getExecution: jest.fn().mockResolvedValue({
        id: "child",
        workflowKey: "child-task",
        input: undefined,
        status: ExecutionStatus.Running,
        attempt: 1,
        maxAttempts: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    });

    await expect(
      waitForExecutionDurably({
        ...baseParams,
        store,
        options: { stepId: "child-step", timeoutMs: 5 },
      }),
    ).rejects.toBeInstanceOf(SuspensionSignal);

    expect(store.createTimer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "execution_timeout:parent:__execution:child-step",
        stepId: "__execution:child-step",
        type: "timeout",
        fireAt: new Date(recordedAt.getTime() + 5),
      }),
    );
    expect(store.saveStepResult).not.toHaveBeenCalled();
  });

  it("re-persists timeout metadata when a replayed waiting state has no persisted timeout details at all", async () => {
    const store = createStoreMock({
      getStepResult: jest.fn().mockResolvedValue({
        executionId: "parent",
        stepId: "__execution:child-step",
        result: {
          state: "waiting",
          targetExecutionId: "child",
        },
        completedAt: new Date(),
      }),
      getExecution: jest.fn().mockResolvedValue({
        id: "child",
        workflowKey: "child-task",
        input: undefined,
        status: ExecutionStatus.Running,
        attempt: 1,
        maxAttempts: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    });

    await expect(
      waitForExecutionDurably({
        ...baseParams,
        store,
        options: { stepId: "child-step", timeoutMs: 5 },
      }),
    ).rejects.toBeInstanceOf(SuspensionSignal);

    expect(store.saveStepResult).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          state: "waiting",
          targetExecutionId: "child",
          timerId: "execution_timeout:parent:__execution:child-step",
        }),
      }),
    );
  });

  it("re-suspends replayed waiting states without timeout options", async () => {
    const store = createStoreMock({
      getStepResult: jest.fn().mockResolvedValue({
        executionId: "parent",
        stepId: "__execution:child-step",
        result: {
          state: "waiting",
          targetExecutionId: "child",
        },
        completedAt: new Date(),
      }),
      getExecution: jest.fn().mockResolvedValue({
        id: "child",
        workflowKey: "child-task",
        input: undefined,
        status: ExecutionStatus.Running,
        attempt: 1,
        maxAttempts: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    });

    await expect(
      waitForExecutionDurably({
        ...baseParams,
        store,
        options: { stepId: "child-step" },
      }),
    ).rejects.toBeInstanceOf(SuspensionSignal);

    expect(store.createTimer).not.toHaveBeenCalled();
    expect(store.upsertExecutionWaiter).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: "parent",
        targetExecutionId: "child",
        stepId: "__execution:child-step",
        timerId: undefined,
      }),
    );
  });

  it("tolerates timer cleanup failures when finalizing a completed wait", async () => {
    const store = createStoreMock({
      getStepResult: jest.fn().mockResolvedValue({
        executionId: "parent",
        stepId: "__execution:child-step",
        result: {
          state: "waiting",
          targetExecutionId: "child",
          timeoutAtMs: 10_000,
          timerId: "timer-1",
        },
        completedAt: new Date(),
      }),
      getExecution: jest.fn().mockResolvedValue({
        id: "child",
        workflowKey: "child-task",
        input: undefined,
        status: ExecutionStatus.Completed,
        result: "ok",
        attempt: 1,
        maxAttempts: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: new Date(),
      }),
      deleteTimer: jest
        .fn()
        .mockRejectedValue(genericError.new({ message: "cleanup failed" })),
    });

    await expect(
      waitForExecutionDurably<string>({
        ...baseParams,
        store,
        options: { stepId: "child-step", timeoutMs: 5 },
      }),
    ).resolves.toEqual({ kind: "completed", data: "ok" });
  });
});
