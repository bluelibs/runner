import {
  createExecutionWaitCompletionState,
  isExecutionWaitTerminal,
} from "../../durable/core/executionWaitState";
import { ExecutionStatus } from "../../durable/core/types";

describe("durable: execution wait state helpers", () => {
  it("detects terminal execution statuses", () => {
    expect(
      isExecutionWaitTerminal({
        id: "e1",
        taskId: "task",
        input: undefined,
        status: ExecutionStatus.Completed,
        attempt: 1,
        maxAttempts: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).toBe(true);

    expect(
      isExecutionWaitTerminal({
        id: "e1",
        taskId: "task",
        input: undefined,
        status: ExecutionStatus.CompensationFailed,
        attempt: 1,
        maxAttempts: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).toBe(true);

    expect(
      isExecutionWaitTerminal({
        id: "e1",
        taskId: "task",
        input: undefined,
        status: ExecutionStatus.Running,
        attempt: 1,
        maxAttempts: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).toBe(false);
  });

  it("maps failed, cancelled, and compensation_failed executions to durable wait states", () => {
    expect(
      createExecutionWaitCompletionState({
        id: "failed-child",
        taskId: "child-task",
        input: undefined,
        status: ExecutionStatus.Failed,
        error: { message: "boom", stack: "stack" },
        attempt: 2,
        maxAttempts: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).toEqual({
      state: "failed",
      targetExecutionId: "failed-child",
      error: { message: "boom", stack: "stack" },
      taskId: "child-task",
      attempt: 2,
    });

    expect(
      createExecutionWaitCompletionState({
        id: "cancelled-child",
        taskId: "child-task",
        input: undefined,
        status: ExecutionStatus.Cancelled,
        attempt: 4,
        maxAttempts: 4,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).toEqual({
      state: "cancelled",
      targetExecutionId: "cancelled-child",
      error: { message: "Execution cancelled", stack: undefined },
      taskId: "child-task",
      attempt: 4,
    });

    expect(
      createExecutionWaitCompletionState({
        id: "comp-child",
        taskId: "child-task",
        input: undefined,
        status: ExecutionStatus.CompensationFailed,
        attempt: 3,
        maxAttempts: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).toEqual({
      state: "failed",
      targetExecutionId: "comp-child",
      error: { message: "Compensation failed", stack: undefined },
      taskId: "child-task",
      attempt: 3,
    });

    expect(
      createExecutionWaitCompletionState({
        id: "failed-no-message",
        taskId: "child-task",
        input: undefined,
        status: ExecutionStatus.Failed,
        attempt: 1,
        maxAttempts: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).toEqual({
      state: "failed",
      targetExecutionId: "failed-no-message",
      error: { message: "Execution failed", stack: undefined },
      taskId: "child-task",
      attempt: 1,
    });
  });

  it("throws when asked to create a completion state for a non-terminal execution", () => {
    expect(() =>
      createExecutionWaitCompletionState({
        id: "running-child",
        taskId: "child-task",
        input: undefined,
        status: ExecutionStatus.Running,
        attempt: 1,
        maxAttempts: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).toThrow("cannot resolve execution waits");
  });
});
