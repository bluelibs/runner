import { durableExecutionInvariantError } from "../../../errors";
import { ExecutionStatus, type Execution } from "./types";

export type DurableExecutionWaitCompletionState<TResult> =
  | {
      state: "completed";
      targetExecutionId: string;
      workflowKey: string;
      result: TResult;
    }
  | {
      state: "failed" | "cancelled";
      targetExecutionId: string;
      error: { message: string; stack?: string };
      workflowKey: string;
      attempt: number;
    };

export function isExecutionWaitTerminal(
  execution: Execution<unknown, unknown>,
): boolean {
  return (
    execution.status === ExecutionStatus.Completed ||
    execution.status === ExecutionStatus.Failed ||
    execution.status === ExecutionStatus.Cancelled ||
    execution.status === ExecutionStatus.CompensationFailed
  );
}

export function createExecutionWaitCompletionState<TResult>(
  execution: Execution<unknown, unknown>,
): DurableExecutionWaitCompletionState<TResult> {
  if (!execution.workflowKey) {
    return durableExecutionInvariantError.throw({
      message: `Execution '${execution.id}' is missing its durable workflow key.`,
    });
  }

  if (execution.status === ExecutionStatus.Completed) {
    return {
      state: "completed",
      targetExecutionId: execution.id,
      workflowKey: execution.workflowKey,
      result: execution.result as TResult,
    };
  }

  if (execution.status === ExecutionStatus.Failed) {
    return {
      state: "failed",
      targetExecutionId: execution.id,
      error: {
        message: execution.error?.message || "Execution failed",
        stack: execution.error?.stack,
      },
      workflowKey: execution.workflowKey,
      attempt: execution.attempt,
    };
  }

  if (execution.status === ExecutionStatus.CompensationFailed) {
    return {
      state: "failed",
      targetExecutionId: execution.id,
      error: {
        message: execution.error?.message || "Compensation failed",
        stack: execution.error?.stack,
      },
      workflowKey: execution.workflowKey,
      attempt: execution.attempt,
    };
  }

  if (execution.status === ExecutionStatus.Cancelled) {
    return {
      state: "cancelled",
      targetExecutionId: execution.id,
      error: {
        message: execution.error?.message || "Execution cancelled",
        stack: execution.error?.stack,
      },
      workflowKey: execution.workflowKey,
      attempt: execution.attempt,
    };
  }

  return durableExecutionInvariantError.throw({
    message: `Execution '${execution.id}' is not terminal and cannot resolve execution waits.`,
  });
}
