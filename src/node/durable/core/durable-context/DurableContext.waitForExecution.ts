import type { WaitForExecutionOptions } from "../interfaces/context";
import { SuspensionSignal } from "../interfaces/context";
import type { IDurableStore } from "../interfaces/store";
import { DurableExecutionError, parseExecutionWaitState } from "../utils";
import { TimerStatus, TimerType, type Execution } from "../types";
import {
  createExecutionWaitCompletionState,
  isExecutionWaitTerminal,
  type DurableExecutionWaitCompletionState,
} from "../executionWaitState";
import { withExecutionWaitLock } from "../executionWaiters";
import { durableExecutionInvariantError } from "../../../../errors";

export type WaitForExecutionOutcome<TResult> =
  | { kind: "completed"; data: TResult }
  | { kind: "timeout" };

type ExecutionTerminalState<TResult> =
  DurableExecutionWaitCompletionState<TResult>;

function createExecutionStepId(
  targetExecutionId: string,
  options?: WaitForExecutionOptions,
): string {
  return options?.stepId
    ? `__execution:${options.stepId}`
    : `__execution:${targetExecutionId}`;
}

function createWaitingState(
  targetExecutionId: string,
  timeoutAtMs?: number,
  timerId?: string,
) {
  if (timeoutAtMs !== undefined && timerId !== undefined) {
    return {
      state: "waiting" as const,
      targetExecutionId,
      timeoutAtMs,
      timerId,
    };
  }

  return { state: "waiting" as const, targetExecutionId };
}

function throwTerminalState(state: {
  state: "failed" | "cancelled";
  targetExecutionId: string;
  error: { message: string; stack?: string };
  taskId: string;
  attempt: number;
}): never {
  throw new DurableExecutionError(
    state.error.message,
    state.targetExecutionId,
    state.taskId,
    state.attempt,
    state.error,
  );
}

function resolveTerminalState<TResult>(
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

async function finalizeTerminalState<TResult>(params: {
  store: IDurableStore;
  executionId: string;
  targetExecution: Execution<unknown, unknown>;
  stepId: string;
  timerId?: string;
}): Promise<ExecutionTerminalState<TResult>> {
  const terminalState = createExecutionWaitCompletionState<TResult>(
    params.targetExecution,
  );

  await params.store.saveStepResult({
    executionId: params.executionId,
    stepId: params.stepId,
    result: terminalState,
    completedAt: new Date(),
  });

  await params.store.deleteExecutionWaiter(
    params.targetExecution.id,
    params.executionId,
    params.stepId,
  );

  if (params.timerId) {
    try {
      await params.store.deleteTimer(params.timerId);
    } catch {
      // Durable completion already won; timer cleanup stays best-effort.
    }
  }

  return terminalState as ExecutionTerminalState<TResult>;
}

function resolveTimedOut<TResult>(
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

export async function waitForExecutionDurably<TResult>(params: {
  store: IDurableStore;
  executionId: string;
  targetExecutionId: string;
  assertCanContinue: () => Promise<void>;
  assertUniqueStepId: (stepId: string) => void;
  options?: WaitForExecutionOptions;
}): Promise<TResult | WaitForExecutionOutcome<TResult>> {
  await params.assertCanContinue();

  const hasTimeout = params.options?.timeoutMs !== undefined;
  const stepId = createExecutionStepId(
    params.targetExecutionId,
    params.options,
  );

  return await withExecutionWaitLock<
    TResult | WaitForExecutionOutcome<TResult>
  >({
    store: params.store,
    targetExecutionId: params.targetExecutionId,
    fn: async (): Promise<TResult | WaitForExecutionOutcome<TResult>> => {
      params.assertUniqueStepId(stepId);

      const existing = await params.store.getStepResult(
        params.executionId,
        stepId,
      );
      if (existing) {
        const state = parseExecutionWaitState(existing.result);
        if (!state || state.targetExecutionId !== params.targetExecutionId) {
          return durableExecutionInvariantError.throw({
            message: `Invalid execution wait state for '${params.targetExecutionId}' at '${stepId}'.`,
          });
        }

        if (state.state === "completed") {
          return resolveTerminalState<TResult>(
            {
              state: "completed",
              targetExecutionId: state.targetExecutionId,
              result: state.result as TResult,
            },
            hasTimeout,
          ) as TResult | WaitForExecutionOutcome<TResult>;
        }

        if (state.state === "failed" || state.state === "cancelled") {
          return resolveTerminalState<TResult>(
            {
              state: state.state,
              targetExecutionId: state.targetExecutionId,
              error: state.error!,
              taskId: state.taskId!,
              attempt: state.attempt!,
            },
            hasTimeout,
          ) as TResult | WaitForExecutionOutcome<TResult>;
        }

        if (state.state === "timed_out") {
          return resolveTimedOut<TResult>(hasTimeout);
        }

        const targetExecution = await params.store.getExecution(
          params.targetExecutionId,
        );
        if (!targetExecution) {
          return durableExecutionInvariantError.throw({
            message: `Cannot wait for execution '${params.targetExecutionId}': target execution does not exist.`,
          });
        }

        if (isExecutionWaitTerminal(targetExecution)) {
          const terminalState = await finalizeTerminalState<TResult>({
            store: params.store,
            executionId: params.executionId,
            targetExecution,
            stepId,
            timerId: state.timerId,
          });

          return resolveTerminalState<TResult>(terminalState, hasTimeout) as
            | TResult
            | WaitForExecutionOutcome<TResult>;
        }

        let timerId = state.timerId;
        if (params.options?.timeoutMs !== undefined) {
          if (state.timeoutAtMs !== undefined && state.timerId) {
            await params.store.createTimer({
              id: state.timerId,
              executionId: params.executionId,
              stepId,
              type: TimerType.Timeout,
              fireAt: new Date(state.timeoutAtMs),
              status: TimerStatus.Pending,
            });
            timerId = state.timerId;
          } else {
            timerId = `execution_timeout:${params.executionId}:${stepId}`;
            const timeoutAtMs = Date.now() + params.options.timeoutMs;

            await params.store.createTimer({
              id: timerId,
              executionId: params.executionId,
              stepId,
              type: TimerType.Timeout,
              fireAt: new Date(timeoutAtMs),
              status: TimerStatus.Pending,
            });

            await params.store.saveStepResult({
              executionId: params.executionId,
              stepId,
              result: createWaitingState(
                params.targetExecutionId,
                timeoutAtMs,
                timerId,
              ),
              completedAt: new Date(),
            });
          }
        }

        await params.store.upsertExecutionWaiter({
          executionId: params.executionId,
          targetExecutionId: params.targetExecutionId,
          stepId,
          timerId,
        });

        throw new SuspensionSignal("yield");
      }

      const targetExecution = await params.store.getExecution(
        params.targetExecutionId,
      );
      if (!targetExecution) {
        return durableExecutionInvariantError.throw({
          message: `Cannot wait for execution '${params.targetExecutionId}': target execution does not exist.`,
        });
      }

      if (isExecutionWaitTerminal(targetExecution)) {
        const terminalState = await finalizeTerminalState<TResult>({
          store: params.store,
          executionId: params.executionId,
          targetExecution,
          stepId,
        });

        return resolveTerminalState<TResult>(terminalState, hasTimeout) as
          | TResult
          | WaitForExecutionOutcome<TResult>;
      }

      let timerId: string | undefined;
      let timeoutAtMs: number | undefined;
      if (params.options?.timeoutMs !== undefined) {
        timerId = `execution_timeout:${params.executionId}:${stepId}`;
        timeoutAtMs = Date.now() + params.options.timeoutMs;

        await params.store.createTimer({
          id: timerId,
          executionId: params.executionId,
          stepId,
          type: TimerType.Timeout,
          fireAt: new Date(timeoutAtMs),
          status: TimerStatus.Pending,
        });
      }

      await params.store.saveStepResult({
        executionId: params.executionId,
        stepId,
        result: createWaitingState(
          params.targetExecutionId,
          timeoutAtMs,
          timerId,
        ),
        completedAt: new Date(),
      });

      await params.store.upsertExecutionWaiter({
        executionId: params.executionId,
        targetExecutionId: params.targetExecutionId,
        stepId,
        timerId,
      });

      throw new SuspensionSignal("yield");
    },
  });
}
