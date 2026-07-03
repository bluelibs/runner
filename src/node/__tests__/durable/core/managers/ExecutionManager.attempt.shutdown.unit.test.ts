import { cancellationError } from "../../../../../errors";
import { handleExecutionAttemptError } from "../../../../durable/core/managers/ExecutionManager.attempt";
import {
  ExecutionStatus,
  type Execution,
} from "../../../../durable/core/types";
import { withTimeout } from "../../../../durable/core/utils";
import { runtimeShutdownAbortReason } from "../../../../../tools/runtimeShutdownAbortReason";

function createRunningExecution(): Execution {
  return {
    id: "execution-1",
    workflowKey: "workflow-1",
    input: undefined,
    status: ExecutionStatus.Running,
    attempt: 1,
    maxAttempts: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createLockState() {
  return {
    lost: false,
    lossError: null,
    lockId: undefined,
    lockResource: undefined,
    lockTtlMs: undefined,
    triggerLoss: jest.fn(),
    waitForLoss: new Promise<never>(() => {}),
  };
}

describe("durable: handleExecutionAttemptError shutdown interruption", () => {
  it("keeps shutdown interruption resumable instead of retrying or failing", async () => {
    const transitionToCancelled = jest.fn(async () => undefined);
    const transitionToFailed = jest.fn(async () => undefined);
    const suspendAttempt = jest.fn(async () => undefined);
    const scheduleRetry = jest.fn(async () => undefined);

    await handleExecutionAttemptError({
      error: cancellationError.new({
        reason: runtimeShutdownAbortReason,
      }),
      runningExecution: createRunningExecution(),
      guards: {
        assertLockOwnership: () => undefined,
        raceWithLockLoss: async <T>(promise: Promise<T>) => await promise,
        canPersistOutcome: async () => true,
        getCancellationState: async () => null,
      },
      executionLockState: createLockState(),
      getShutdownInterruptionReason: () => runtimeShutdownAbortReason,
      transitionToCancelled,
      transitionToFailed,
      suspendAttempt,
      scheduleRetry,
    });

    expect(transitionToCancelled).not.toHaveBeenCalled();
    expect(transitionToFailed).not.toHaveBeenCalled();
    expect(suspendAttempt).not.toHaveBeenCalled();
    expect(scheduleRetry).not.toHaveBeenCalled();
  });

  it("still prioritizes explicit cancellation over shutdown interruption", async () => {
    const transitionToCancelled = jest.fn(async () => undefined);

    await handleExecutionAttemptError({
      error: cancellationError.new({
        reason: runtimeShutdownAbortReason,
      }),
      runningExecution: createRunningExecution(),
      guards: {
        assertLockOwnership: () => undefined,
        raceWithLockLoss: async <T>(promise: Promise<T>) => await promise,
        canPersistOutcome: async () => true,
        getCancellationState: async () => ({ reason: "User requested" }),
      },
      executionLockState: createLockState(),
      getShutdownInterruptionReason: () => runtimeShutdownAbortReason,
      transitionToCancelled,
      transitionToFailed: jest.fn(async () => undefined),
      suspendAttempt: jest.fn(async () => undefined),
      scheduleRetry: jest.fn(async () => undefined),
    });

    expect(transitionToCancelled).toHaveBeenCalledTimes(1);
    expect(transitionToCancelled).toHaveBeenCalledWith({
      execution: expect.objectContaining({ id: "execution-1" }),
      reason: "User requested",
      canPersistOutcome: expect.any(Function),
    });
  });

  it("does not treat unrelated cancellations as shutdown interruptions", async () => {
    const scheduleRetry = jest.fn(async () => undefined);

    await handleExecutionAttemptError({
      error: cancellationError.new({
        reason: "Client Closed Request",
      }),
      runningExecution: createRunningExecution(),
      guards: {
        assertLockOwnership: () => undefined,
        raceWithLockLoss: async <T>(promise: Promise<T>) => await promise,
        canPersistOutcome: async () => true,
        getCancellationState: async () => null,
      },
      executionLockState: createLockState(),
      getShutdownInterruptionReason: () => runtimeShutdownAbortReason,
      transitionToCancelled: jest.fn(async () => undefined),
      transitionToFailed: jest.fn(async () => undefined),
      suspendAttempt: jest.fn(async () => undefined),
      scheduleRetry,
    });

    expect(scheduleRetry).toHaveBeenCalledTimes(1);
  });

  it("marks timeout failures with the timed_out reason", async () => {
    jest.useFakeTimers();

    try {
      const transitionToFailed = jest.fn(async () => undefined);
      const timeoutPromise = withTimeout(
        new Promise<never>(() => undefined),
        1,
        "Execution execution-1 timed out",
      );

      jest.advanceTimersByTime(1);
      const timeoutError = await timeoutPromise.catch((error) => error);

      await handleExecutionAttemptError({
        error: timeoutError,
        runningExecution: createRunningExecution(),
        guards: {
          assertLockOwnership: () => undefined,
          raceWithLockLoss: async <T>(promise: Promise<T>) => await promise,
          canPersistOutcome: async () => true,
          getCancellationState: async () => null,
        },
        executionLockState: createLockState(),
        getShutdownInterruptionReason: () => null,
        transitionToCancelled: jest.fn(async () => undefined),
        transitionToFailed,
        suspendAttempt: jest.fn(async () => undefined),
        scheduleRetry: jest.fn(async () => undefined),
      });

      expect(transitionToFailed).toHaveBeenCalledWith({
        execution: expect.objectContaining({ id: "execution-1" }),
        from: ExecutionStatus.Running,
        reason: "timed_out",
        error: expect.objectContaining({
          message: "Execution execution-1 timed out",
        }),
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
