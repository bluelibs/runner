import { handleExecutionAttemptError } from "../../../../durable/core/managers/ExecutionManager.attempt";
import {
  ContinuationSignal,
  type ContinueAsNewOptions,
} from "../../../../durable/core/interfaces/context";
import {
  ExecutionStatus,
  type Execution,
} from "../../../../durable/core/types";

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

function createGuards(
  overrides: {
    getCancellationState?: () => Promise<{ reason: string } | null>;
  } = {},
) {
  return {
    assertLockOwnership: () => undefined,
    raceWithLockLoss: async <T>(promise: Promise<T>) => await promise,
    canPersistOutcome: async () => true,
    getCancellationState: async () => null,
    ...overrides,
  };
}

function createTransitions() {
  return {
    transitionToCancelled: jest.fn(async () => undefined),
    transitionToFailed: jest.fn(async () => undefined),
    suspendAttempt: jest.fn(async () => undefined),
    scheduleRetry: jest.fn(async () => undefined),
    continueAsNew: jest.fn(async () => undefined),
  };
}

describe("durable: handleExecutionAttemptError continuation", () => {
  it("routes a ContinuationSignal to continue-as-new with its input", async () => {
    const transitions = createTransitions();
    const runningExecution = createRunningExecution();
    const options: ContinueAsNewOptions = { state: { page: 2 } };

    await handleExecutionAttemptError({
      error: new ContinuationSignal({ orderId: "o1" }, options),
      runningExecution,
      guards: createGuards(),
      executionLockState: createLockState(),
      getShutdownInterruptionReason: () => null,
      ...transitions,
    });

    expect(transitions.continueAsNew).toHaveBeenCalledTimes(1);
    expect(transitions.continueAsNew).toHaveBeenCalledWith({
      runningExecution,
      nextInput: { orderId: "o1" },
      options,
      canPersistOutcome: expect.any(Function),
    });
    expect(transitions.transitionToCancelled).not.toHaveBeenCalled();
    expect(transitions.transitionToFailed).not.toHaveBeenCalled();
    expect(transitions.suspendAttempt).not.toHaveBeenCalled();
    expect(transitions.scheduleRetry).not.toHaveBeenCalled();
  });

  it("passes undefined options through when the signal carries none", async () => {
    const transitions = createTransitions();

    await handleExecutionAttemptError({
      error: new ContinuationSignal(null),
      runningExecution: createRunningExecution(),
      guards: createGuards(),
      executionLockState: createLockState(),
      getShutdownInterruptionReason: () => null,
      ...transitions,
    });

    expect(transitions.continueAsNew).toHaveBeenCalledWith(
      expect.objectContaining({
        nextInput: null,
        options: undefined,
      }),
    );
  });

  it("lets a racing cancellation win over the continuation", async () => {
    const transitions = createTransitions();
    const runningExecution = createRunningExecution();

    await handleExecutionAttemptError({
      error: new ContinuationSignal({ orderId: "o1" }),
      runningExecution,
      guards: createGuards({
        getCancellationState: async () => ({ reason: "operator-cancel" }),
      }),
      executionLockState: createLockState(),
      getShutdownInterruptionReason: () => null,
      ...transitions,
    });

    expect(transitions.transitionToCancelled).toHaveBeenCalledTimes(1);
    expect(transitions.transitionToCancelled).toHaveBeenCalledWith({
      execution: runningExecution,
      reason: "operator-cancel",
      canPersistOutcome: expect.any(Function),
    });
    expect(transitions.continueAsNew).not.toHaveBeenCalled();
  });
});
