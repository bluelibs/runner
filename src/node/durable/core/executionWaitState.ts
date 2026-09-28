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

/**
 * Follow marker persisted when an execution wait resolves against a run that
 * continued-as-new: the waiting step is not terminal, it must re-register on
 * the successor. `targetExecutionId` stays the waited-on root so replay
 * validation is hop-independent; the timeout triple preserves the original
 * deadline across hops.
 */
export type DurableExecutionWaitContinuedState = {
  state: "continued";
  targetExecutionId: string;
  continuedAsExecutionId: string;
  workflowKey: string;
  timeoutMs?: number;
  timeoutAtMs?: number;
  timerId?: string;
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
  /**
   * The waited-on execution the completion resolves. Follows keep the root
   * here while resolving against the tip, so replay validation stays
   * hop-independent; defaults to the resolving execution itself.
   */
  targetExecutionId: string = execution.id,
): DurableExecutionWaitCompletionState<TResult> {
  if (!execution.workflowKey) {
    return durableExecutionInvariantError.throw({
      message: `Execution '${execution.id}' is missing its durable workflow key.`,
    });
  }

  if (execution.status === ExecutionStatus.Completed) {
    return {
      state: "completed",
      targetExecutionId,
      workflowKey: execution.workflowKey,
      result: execution.result as TResult,
    };
  }

  if (execution.status === ExecutionStatus.Failed) {
    return {
      state: "failed",
      targetExecutionId,
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
      targetExecutionId,
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
      targetExecutionId,
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

/**
 * Builds the follow marker for an execution wait resolving against a
 * continued-as-new run. The caller supplies the waited-on root (read back
 * from the waiting step) and the preserved timeout triple, if any.
 */
export function createExecutionWaitContinuedState(params: {
  continuedExecution: Execution<unknown, unknown>;
  targetExecutionId: string;
  timeoutMs?: number;
  timeoutAtMs?: number;
  timerId?: string;
}): DurableExecutionWaitContinuedState {
  const continuedAsExecutionId =
    params.continuedExecution.continuedAsExecutionId;
  if (
    params.continuedExecution.status !== ExecutionStatus.ContinuedAsNew ||
    !continuedAsExecutionId
  ) {
    return durableExecutionInvariantError.throw({
      message: `Execution '${params.continuedExecution.id}' did not continue as new and cannot resolve execution waits with a follow marker.`,
    });
  }

  if (!params.continuedExecution.workflowKey) {
    return durableExecutionInvariantError.throw({
      message: `Execution '${params.continuedExecution.id}' is missing its durable workflow key.`,
    });
  }

  return {
    state: "continued",
    targetExecutionId: params.targetExecutionId,
    continuedAsExecutionId,
    workflowKey: params.continuedExecution.workflowKey,
    timeoutMs: params.timeoutMs,
    timeoutAtMs: params.timeoutAtMs,
    timerId: params.timerId,
  };
}
