import { SuspensionSignal } from "../../../../durable/core/interfaces/context";
import type { IDurableStore } from "../../../../durable/core/interfaces/store";
import { waitForExecutionDurably } from "../../../../durable/core/durable-context/DurableContext.waitForExecution";
import { ExecutionStatus } from "../../../../durable/core/types";

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

function continuedRoot(next?: string) {
  return {
    id: "child",
    workflowKey: "child-task",
    input: undefined,
    status: ExecutionStatus.ContinuedAsNew,
    continuedAsExecutionId: next,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function runningTip() {
  return {
    id: "tip",
    workflowKey: "child-task",
    input: undefined,
    status: ExecutionStatus.Running,
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("durable: waitForExecutionDurably continuation", () => {
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

  it("moves the waiter to the successor when the tip continued", async () => {
    const store = createStoreMock({
      getStepResult: jest.fn().mockResolvedValue(null),
      getExecution: jest.fn(async (id: string) =>
        id === "child" ? continuedRoot("tip") : runningTip(),
      ),
    });

    await expect(
      waitForExecutionDurably({ ...baseParams, store }),
    ).rejects.toBeInstanceOf(SuspensionSignal);

    expect(store.upsertExecutionWaiter).toHaveBeenCalledTimes(2);
    expect(store.upsertExecutionWaiter).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ targetExecutionId: "child" }),
    );
    expect(store.upsertExecutionWaiter).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ targetExecutionId: "tip" }),
    );
    expect(store.deleteExecutionWaiter).toHaveBeenCalledWith(
      "child",
      "parent",
      "__execution:child",
    );
  });

  it("settles immediately against an already-terminal tip", async () => {
    const completedTip = {
      ...runningTip(),
      status: ExecutionStatus.Completed,
      result: { ok: true },
    };
    const store = createStoreMock({
      getStepResult: jest.fn().mockResolvedValue(null),
      getExecution: jest.fn(async (id: string) =>
        id === "child" ? continuedRoot("tip") : completedTip,
      ),
    });

    await expect(
      waitForExecutionDurably({ ...baseParams, store }),
    ).resolves.toEqual({ ok: true });

    expect(store.saveStepResult).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: "parent",
        stepId: "__execution:child",
        result: expect.objectContaining({
          state: "completed",
          targetExecutionId: "child",
          result: { ok: true },
        }),
      }),
    );
    expect(store.upsertExecutionWaiter).toHaveBeenCalledTimes(1);
    expect(store.upsertExecutionWaiter).toHaveBeenCalledWith(
      expect.objectContaining({ targetExecutionId: "child" }),
    );
    expect(store.deleteExecutionWaiter).toHaveBeenCalledWith(
      "child",
      "parent",
      "__execution:child",
    );
  });

  it("fails fast when the re-checked tip has no successor link", async () => {
    const store = createStoreMock({
      getStepResult: jest.fn().mockResolvedValue(null),
      getExecution: jest.fn().mockResolvedValue(continuedRoot(undefined)),
    });

    await expect(
      waitForExecutionDurably({ ...baseParams, store }),
    ).rejects.toThrow(
      "Continuation chain for execution 'child' is broken: " +
        "status is continued_as_new without a successor link.",
    );
  });

  it("replays a follow marker by re-registering on its tip", async () => {
    const store = createStoreMock({
      getStepResult: jest.fn().mockResolvedValue({
        executionId: "parent",
        stepId: "__execution:child",
        result: {
          state: "continued",
          targetExecutionId: "child",
          continuedAsExecutionId: "tip",
          workflowKey: "child-task",
        },
        completedAt: new Date(),
      }),
      getExecution: jest.fn().mockResolvedValue(runningTip()),
    });

    await expect(
      waitForExecutionDurably({ ...baseParams, store }),
    ).rejects.toBeInstanceOf(SuspensionSignal);

    expect(store.upsertExecutionWaiter).toHaveBeenCalledTimes(1);
    expect(store.upsertExecutionWaiter).toHaveBeenCalledWith(
      expect.objectContaining({ targetExecutionId: "tip" }),
    );
    expect(store.deleteExecutionWaiter).not.toHaveBeenCalled();
  });

  it("does not follow a stale marker backwards after the marked tip continued again", async () => {
    const store = createStoreMock({
      getStepResult: jest.fn().mockResolvedValue({
        executionId: "parent",
        stepId: "__execution:child",
        result: {
          state: "continued",
          targetExecutionId: "child",
          continuedAsExecutionId: "middle",
          workflowKey: "child-task",
        },
        completedAt: new Date(),
      }),
      getExecution: jest.fn(async (id: string) =>
        id === "middle"
          ? {
              ...continuedRoot("tip"),
              id: "middle",
            }
          : runningTip(),
      ),
    });

    await expect(
      waitForExecutionDurably({ ...baseParams, store }),
    ).rejects.toBeInstanceOf(SuspensionSignal);

    expect(store.upsertExecutionWaiter).toHaveBeenCalledWith(
      expect.objectContaining({ targetExecutionId: "tip" }),
    );
  });

  it("rejects a follow marker for a different workflow", async () => {
    const store = createStoreMock({
      getStepResult: jest.fn().mockResolvedValue({
        executionId: "parent",
        stepId: "__execution:child",
        result: {
          state: "continued",
          targetExecutionId: "child",
          continuedAsExecutionId: "tip",
          workflowKey: "other-task",
        },
        completedAt: new Date(),
      }),
    });

    await expect(
      waitForExecutionDurably({ ...baseParams, store }),
    ).rejects.toThrow(
      "Cannot wait for execution 'child' as workflow 'child-task': " +
        "the stored durable execution belongs to 'other-task'.",
    );
  });

  it("fails fast when follow markers cycle", async () => {
    const store = createStoreMock({
      getStepResult: jest
        .fn()
        .mockResolvedValueOnce({
          executionId: "parent",
          stepId: "__execution:child",
          result: {
            state: "continued",
            targetExecutionId: "child",
            continuedAsExecutionId: "tip",
            workflowKey: "child-task",
          },
          completedAt: new Date(),
        })
        .mockResolvedValue({
          executionId: "parent",
          stepId: "__execution:child",
          result: {
            state: "continued",
            targetExecutionId: "child",
            continuedAsExecutionId: "child",
            workflowKey: "child-task",
          },
          completedAt: new Date(),
        }),
    });

    await expect(
      waitForExecutionDurably({ ...baseParams, store }),
    ).rejects.toThrow(
      "Continuation chain for execution 'child' is cyclic at 'child'.",
    );
    expect(store.getExecution).not.toHaveBeenCalled();
  });
});
