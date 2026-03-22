import type { WaitForExecutionOptions } from "../interfaces/context";
import type { IDurableStore } from "../interfaces/store";
import { DurableExecutionError, parseExecutionWaitState } from "../utils";
import { TimerType, type Execution } from "../types";
import {
  createExecutionWaitCompletionState,
  isExecutionWaitTerminal,
  type DurableExecutionWaitCompletionState,
} from "../executionWaitState";
import { withExecutionWaitLock } from "../executionWaiters";
import {
  commitDurableWaitCompletion,
  createTimedWaitState,
  ensureDurableWaitTimer,
  suspendDurableWait,
} from "../waiterCore";
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

function assertExpectedTaskId(params: {
  expectedTaskId: string;
  actualTaskId: string;
  targetExecutionId: string;
}): void {
  if (params.expectedTaskId !== params.actualTaskId) {
    durableExecutionInvariantError.throw({
      message:
        `Cannot wait for execution '${params.targetExecutionId}' as task '${params.expectedTaskId}': ` +
        `the stored durable execution belongs to '${params.actualTaskId}'.`,
    });
  }
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
  expectedTaskId: string;
  stepId: string;
  timerId?: string;
}): Promise<ExecutionTerminalState<TResult>> {
  assertExpectedTaskId({
    expectedTaskId: params.expectedTaskId,
    actualTaskId: params.targetExecution.taskId,
    targetExecutionId: params.targetExecution.id,
  });

  const terminalState = createExecutionWaitCompletionState<TResult>(
    params.targetExecution,
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
  expectedTaskId: string;
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
          const taskId = state.taskId!;
          assertExpectedTaskId({
            expectedTaskId: params.expectedTaskId,
            actualTaskId: taskId,
            targetExecutionId: state.targetExecutionId,
          });
          return resolveTerminalState<TResult>(
            {
              state: "completed",
              targetExecutionId: state.targetExecutionId,
              taskId,
              result: state.result as TResult,
            },
            hasTimeout,
          ) as TResult | WaitForExecutionOutcome<TResult>;
        }

        if (state.state === "failed" || state.state === "cancelled") {
          assertExpectedTaskId({
            expectedTaskId: params.expectedTaskId,
            actualTaskId: state.taskId!,
            targetExecutionId: state.targetExecutionId,
          });
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

        const waitingState = state as Extract<
          typeof state,
          { state: "waiting" }
        >;

        const targetExecution = await params.store.getExecution(
          params.targetExecutionId,
        );
        if (!targetExecution) {
          return durableExecutionInvariantError.throw({
            message: `Cannot wait for execution '${params.targetExecutionId}': target execution does not exist.`,
          });
        }

        assertExpectedTaskId({
          expectedTaskId: params.expectedTaskId,
          actualTaskId: targetExecution.taskId,
          targetExecutionId: targetExecution.id,
        });

        if (isExecutionWaitTerminal(targetExecution)) {
          const terminalState = await finalizeTerminalState<TResult>({
            store: params.store,
            executionId: params.executionId,
            targetExecution,
            expectedTaskId: params.expectedTaskId,
            stepId,
            timerId: waitingState.timerId,
          });

          return resolveTerminalState<TResult>(terminalState, hasTimeout) as
            | TResult
            | WaitForExecutionOutcome<TResult>;
        }

        const timeout = await ensureDurableWaitTimer({
          store: params.store,
          executionId: params.executionId,
          stepId,
          timerType: TimerType.Timeout,
          timeoutMs: params.options?.timeoutMs,
          existing: waitingState,
          createTimerId: () =>
            `execution_timeout:${params.executionId}:${stepId}`,
          persistWaitingState: async (timeoutAtMs, timerId) => {
            await params.store.saveStepResult({
              executionId: params.executionId,
              stepId,
              result: createTimedWaitState(
                {
                  state: "waiting" as const,
                  targetExecutionId: params.targetExecutionId,
                },
                timeoutAtMs,
                timerId,
              ),
              completedAt: new Date(),
            });
          },
        });

        return await suspendDurableWait({
          store: params.store,
          executionId: params.executionId,
          stepId,
          registerWaiter: async () => {
            await params.store.upsertExecutionWaiter({
              executionId: params.executionId,
              targetExecutionId: params.targetExecutionId,
              stepId,
              timerId: timeout.timerId,
            });
          },
        });
      }

      const targetExecution = await params.store.getExecution(
        params.targetExecutionId,
      );
      if (!targetExecution) {
        return durableExecutionInvariantError.throw({
          message: `Cannot wait for execution '${params.targetExecutionId}': target execution does not exist.`,
        });
      }

      assertExpectedTaskId({
        expectedTaskId: params.expectedTaskId,
        actualTaskId: targetExecution.taskId,
        targetExecutionId: targetExecution.id,
      });

      if (isExecutionWaitTerminal(targetExecution)) {
        const terminalState = await finalizeTerminalState<TResult>({
          store: params.store,
          executionId: params.executionId,
          targetExecution,
          expectedTaskId: params.expectedTaskId,
          stepId,
        });

        return resolveTerminalState<TResult>(terminalState, hasTimeout) as
          | TResult
          | WaitForExecutionOutcome<TResult>;
      }

      const timeout = await ensureDurableWaitTimer({
        store: params.store,
        executionId: params.executionId,
        stepId,
        timerType: TimerType.Timeout,
        timeoutMs: params.options?.timeoutMs,
        createTimerId: () =>
          `execution_timeout:${params.executionId}:${stepId}`,
        persistWaitingState: async (timeoutAtMs, timerId) => {
          await params.store.saveStepResult({
            executionId: params.executionId,
            stepId,
            result: createTimedWaitState(
              {
                state: "waiting" as const,
                targetExecutionId: params.targetExecutionId,
              },
              timeoutAtMs,
              timerId,
            ),
            completedAt: new Date(),
          });
        },
      });

      return await suspendDurableWait({
        store: params.store,
        executionId: params.executionId,
        stepId,
        waitingState: timeout.persistedWaitingState
          ? undefined
          : createTimedWaitState(
              {
                state: "waiting" as const,
                targetExecutionId: params.targetExecutionId,
              },
              timeout.timeoutAtMs,
              timeout.timerId,
            ),
        registerWaiter: async () => {
          await params.store.upsertExecutionWaiter({
            executionId: params.executionId,
            targetExecutionId: params.targetExecutionId,
            stepId,
            timerId: timeout.timerId,
          });
        },
      });
    },
  });
}
