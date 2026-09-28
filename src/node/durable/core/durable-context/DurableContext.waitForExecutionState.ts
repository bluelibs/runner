import type { WaitForExecutionOptions } from "../interfaces/context";
import type { IDurableStore } from "../interfaces/store";
import { clearExecutionCurrent } from "../current";
import { DurableExecutionError, parseExecutionWaitState } from "../utils";
import type { Execution } from "../types";
import {
  createExecutionWaitCompletionState,
  isExecutionWaitTerminal,
  type DurableExecutionWaitCompletionState,
} from "../executionWaitState";
import { commitDurableWaitCompletion } from "../waiterCore";
import { durableExecutionInvariantError } from "../../../../errors";
import type {
  ExecutionWaitHopOutcome,
  WaitForExecutionOutcome,
} from "./DurableContext.waitForExecutionTypes";

type ExecutionTerminalState<TResult> =
  DurableExecutionWaitCompletionState<TResult>;

export function createExecutionStepId(
  targetExecutionId: string,
  options?: WaitForExecutionOptions,
): string {
  return options?.stepId
    ? `__execution:${options.stepId}`
    : `__execution:${targetExecutionId}`;
}

export function createExecutionWaitingState(
  targetExecutionId: string,
  timeoutMs: number | undefined,
) {
  return {
    state: "waiting" as const,
    targetExecutionId,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
}

export function assertExpectedWorkflowKey(params: {
  expectedWorkflowKey: string;
  actualWorkflowKey: string;
  targetExecutionId: string;
}): void {
  if (params.expectedWorkflowKey !== params.actualWorkflowKey) {
    durableExecutionInvariantError.throw({
      message:
        `Cannot wait for execution '${params.targetExecutionId}' as workflow '${params.expectedWorkflowKey}': ` +
        `the stored durable execution belongs to '${params.actualWorkflowKey}'.`,
    });
  }
}

function throwTerminalState(state: {
  state: "failed" | "cancelled";
  targetExecutionId: string;
  error: { message: string; stack?: string };
  workflowKey: string;
  attempt: number;
}): never {
  throw new DurableExecutionError(
    state.error.message,
    state.targetExecutionId,
    state.workflowKey,
    state.attempt,
    state.error,
  );
}

export function resolveTerminalState<TResult>(
  state: ExecutionTerminalState<TResult>,
  hasTimeout: boolean,
): TResult | WaitForExecutionOutcome<TResult> {
  if (state.state === "completed") {
    return hasTimeout
      ? { kind: "completed", data: state.result }
      : state.result;
  }

  return throwTerminalState(state);
}

export async function finalizeTerminalState<TResult>(params: {
  store: IDurableStore;
  executionId: string;
  targetExecution: Execution<unknown, unknown>;
  targetExecutionId: string;
  expectedWorkflowKey: string;
  stepId: string;
  timerId?: string;
}): Promise<ExecutionTerminalState<TResult>> {
  assertExpectedWorkflowKey({
    expectedWorkflowKey: params.expectedWorkflowKey,
    actualWorkflowKey: params.targetExecution.workflowKey,
    targetExecutionId: params.targetExecution.id,
  });

  const terminalState = createExecutionWaitCompletionState<TResult>(
    params.targetExecution,
    params.targetExecutionId,
  );
  await commitDurableWaitCompletion({
    store: params.store,
    stepResult: {
      executionId: params.executionId,
      stepId: params.stepId,
      result: terminalState,
      completedAt: new Date(),
    },
    timerId: params.timerId,
    onFallbackCommitted: async () => {
      await params.store.deleteExecutionWaiter(
        params.targetExecution.id,
        params.executionId,
        params.stepId,
      );
    },
  });

  return terminalState as ExecutionTerminalState<TResult>;
}

export function resolveTimedOut<TResult>(
  hasTimeout: boolean,
): WaitForExecutionOutcome<TResult> {
  if (!hasTimeout) {
    return durableExecutionInvariantError.throw({
      message:
        "Encountered a timed out waitForExecution() state without timeout-enabled options.",
    });
  }

  return { kind: "timeout" };
}

/**
 * Resolves a replayed terminal wait step (`completed`, `failed`,
 * `cancelled`, `timed_out`), or returns null when the step still needs to
 * wait (or follow a continuation marker).
 */
export async function resolveReplayedTerminalWait<TResult>(params: {
  store: IDurableStore;
  executionId: string;
  state: NonNullable<ReturnType<typeof parseExecutionWaitState>>;
  hasTimeout: boolean;
  expectedWorkflowKey: string;
}): Promise<ExecutionWaitHopOutcome<TResult> | null> {
  const state = params.state;

  if (state.state === "completed") {
    const workflowKey = state.workflowKey;
    assertExpectedWorkflowKey({
      expectedWorkflowKey: params.expectedWorkflowKey,
      actualWorkflowKey: workflowKey,
      targetExecutionId: state.targetExecutionId,
    });
    await clearExecutionCurrent(params.store, params.executionId);
    return {
      kind: "done",
      value: resolveTerminalState<TResult>(
        {
          state: "completed",
          targetExecutionId: state.targetExecutionId,
          workflowKey,
          result: state.result as TResult,
        },
        params.hasTimeout,
      ) as TResult | WaitForExecutionOutcome<TResult>,
    };
  }

  if (state.state === "failed" || state.state === "cancelled") {
    assertExpectedWorkflowKey({
      expectedWorkflowKey: params.expectedWorkflowKey,
      actualWorkflowKey: state.workflowKey,
      targetExecutionId: state.targetExecutionId,
    });
    await clearExecutionCurrent(params.store, params.executionId);
    return {
      kind: "done",
      value: resolveTerminalState<TResult>(
        {
          state: state.state,
          targetExecutionId: state.targetExecutionId,
          error: state.error!,
          workflowKey: state.workflowKey,
          attempt: state.attempt!,
        },
        params.hasTimeout,
      ) as TResult | WaitForExecutionOutcome<TResult>,
    };
  }

  if (state.state === "timed_out") {
    await clearExecutionCurrent(params.store, params.executionId);
    return {
      kind: "done",
      value: resolveTimedOut<TResult>(params.hasTimeout),
    };
  }

  return null;
}

export function getReplayedExecutionTimeoutState(params: {
  executionId: string;
  completedAt: Date;
  stepId: string;
  state: Extract<
    ReturnType<typeof parseExecutionWaitState>,
    { state: "waiting" | "continued"; targetExecutionId: string }
  >;
}): { timeoutAtMs: number; timerId: string } | undefined {
  if (
    typeof params.state.timeoutAtMs === "number" &&
    typeof params.state.timerId === "string"
  ) {
    return {
      timeoutAtMs: params.state.timeoutAtMs,
      timerId: params.state.timerId,
    };
  }

  if (typeof params.state.timeoutMs !== "number") {
    return undefined;
  }

  return {
    timeoutAtMs: params.completedAt.getTime() + params.state.timeoutMs,
    timerId: `execution_timeout:${params.executionId}:${params.stepId}`,
  };
}

/**
 * Resolves immediately when the tip is already wait-terminal, or returns
 * null when the caller must register and suspend on it.
 */
export async function resolveTerminalTip<TResult>(params: {
  store: IDurableStore;
  executionId: string;
  targetExecutionId: string;
  tipExecutionId: string;
  expectedWorkflowKey: string;
  stepId: string;
  hasTimeout: boolean;
  timerId?: string;
}): Promise<ExecutionWaitHopOutcome<TResult> | null> {
  const targetExecution = await params.store.getExecution(
    params.tipExecutionId,
  );
  if (!targetExecution) {
    return durableExecutionInvariantError.throw({
      message: `Cannot wait for execution '${params.tipExecutionId}': target execution does not exist.`,
    });
  }

  assertExpectedWorkflowKey({
    expectedWorkflowKey: params.expectedWorkflowKey,
    actualWorkflowKey: targetExecution.workflowKey,
    targetExecutionId: targetExecution.id,
  });

  if (!isExecutionWaitTerminal(targetExecution)) {
    return null;
  }

  const terminalState = await finalizeTerminalState<TResult>({
    store: params.store,
    executionId: params.executionId,
    targetExecution,
    targetExecutionId: params.targetExecutionId,
    expectedWorkflowKey: params.expectedWorkflowKey,
    stepId: params.stepId,
    timerId: params.timerId,
  });

  await clearExecutionCurrent(params.store, params.executionId);
  return {
    kind: "done",
    value: resolveTerminalState<TResult>(terminalState, params.hasTimeout) as
      | TResult
      | WaitForExecutionOutcome<TResult>,
  };
}
