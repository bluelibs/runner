import { createExecutionWaitContinuedState } from "../../../durable/core/executionWaitState";
import { ExecutionStatus, type Execution } from "../../../durable/core/types";

function continuedExecution(overrides: Partial<Execution> = {}): Execution {
  return {
    id: "root",
    workflowKey: "chain-task",
    input: undefined,
    status: ExecutionStatus.ContinuedAsNew,
    continuedAsExecutionId: "tip",
    attempt: 1,
    maxAttempts: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("durable: createExecutionWaitContinuedState", () => {
  it("builds a follow marker preserving the timeout triple", () => {
    expect(
      createExecutionWaitContinuedState({
        continuedExecution: continuedExecution(),
        targetExecutionId: "root",
        timeoutMs: 1000,
        timeoutAtMs: 2000,
        timerId: "execution_timeout:parent:__execution:root",
      }),
    ).toEqual({
      state: "continued",
      targetExecutionId: "root",
      continuedAsExecutionId: "tip",
      workflowKey: "chain-task",
      timeoutMs: 1000,
      timeoutAtMs: 2000,
      timerId: "execution_timeout:parent:__execution:root",
    });
  });

  it("builds a follow marker without timeouts", () => {
    expect(
      createExecutionWaitContinuedState({
        continuedExecution: continuedExecution(),
        targetExecutionId: "root",
      }),
    ).toEqual({
      state: "continued",
      targetExecutionId: "root",
      continuedAsExecutionId: "tip",
      workflowKey: "chain-task",
      timeoutMs: undefined,
      timeoutAtMs: undefined,
      timerId: undefined,
    });
  });

  it("rejects runs that did not continue as new", () => {
    expect(() =>
      createExecutionWaitContinuedState({
        continuedExecution: continuedExecution({
          status: ExecutionStatus.Completed,
        }),
        targetExecutionId: "root",
      }),
    ).toThrow(
      "Execution 'root' did not continue as new and cannot resolve " +
        "execution waits with a follow marker.",
    );
  });

  it("rejects continued runs without a successor link", () => {
    expect(() =>
      createExecutionWaitContinuedState({
        continuedExecution: continuedExecution({
          continuedAsExecutionId: undefined,
        }),
        targetExecutionId: "root",
      }),
    ).toThrow(
      "Execution 'root' did not continue as new and cannot resolve " +
        "execution waits with a follow marker.",
    );
  });

  it("rejects continued runs missing their workflow key", () => {
    expect(() =>
      createExecutionWaitContinuedState({
        continuedExecution: continuedExecution({ workflowKey: "" }),
        targetExecutionId: "root",
      }),
    ).toThrow("Execution 'root' is missing its durable workflow key.");
  });
});
