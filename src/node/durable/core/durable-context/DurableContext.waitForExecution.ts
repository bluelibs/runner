import type { WaitForExecutionOptions } from "../interfaces/context";
import type { IDurableStore } from "../interfaces/store";
import {
  clearExecutionCurrent,
  createExecutionWaitCurrent,
  setExecutionCurrent,
} from "../current";
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

function createExecutionWaitingState(
  targetExecutionId: string,
  timeoutMs: number | undefined,
) {
  return {
    state: "waiting" as const,
    targetExecutionId,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
}

function assertExpectedWorkflowKey(params: {
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

function getReplayedExecutionTimeoutState(params: {
  executionId: string;
  completedAt: Date;
  stepId: string;
  state: Extract<
    ReturnType<typeof parseExecutionWaitState>,
    { state: "waiting"; targetExecutionId: string }
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

export async function waitForExecutionDurably<TResult>(params: {
  store: IDurableStore;
  executionId: string;
  targetExecutionId: string;
  expectedWorkflowKey: string;
  assertCanContinue: () => Promise<void>;
  assertUniqueStepId: (stepId: string) => void;
  options?: WaitForExecutionOptions;
}): Promise<TResult | WaitForExecutionOutcome<TResult>> {
  await params.assertCanContinue();

  if (params.executionId === params.targetExecutionId) {
    return durableExecutionInvariantError.throw({
      message:
        `Cannot wait for execution '${params.targetExecutionId}': ` +
        "an execution cannot wait for itself because it would deadlock.",
    });
  }

  const hasTimeout = params.options?.timeoutMs !== undefined;
  const stepId = createExecutionStepId(
    params.targetExecutionId,
    params.options,
  );
  const writeExecutionWaitCurrent = async (options: {
    timeoutMs?: number;
    timeoutAtMs?: number;
    timerId?: string;
    startedAt: Date;
  }): Promise<void> =>
    await setExecutionCurrent(
      params.store,
      params.executionId,
      createExecutionWaitCurrent({
        stepId,
        targetExecutionId: params.targetExecutionId,
        targetWorkflowKey: params.expectedWorkflowKey,
        timeoutMs: options.timeoutMs,
        timeoutAtMs: options.timeoutAtMs,
        timerId: options.timerId,
        startedAt: options.startedAt,
      }),
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
          const workflowKey = state.workflowKey;
          assertExpectedWorkflowKey({
            expectedWorkflowKey: params.expectedWorkflowKey,
            actualWorkflowKey: workflowKey,
            targetExecutionId: state.targetExecutionId,
          });
          await clearExecutionCurrent(params.store, params.executionId);
          return resolveTerminalState<TResult>(
            {
              state: "completed",
              targetExecutionId: state.targetExecutionId,
              workflowKey,
              result: state.result as TResult,
            },
            hasTimeout,
          ) as TResult | WaitForExecutionOutcome<TResult>;
        }

        if (state.state === "failed" || state.state === "cancelled") {
          assertExpectedWorkflowKey({
            expectedWorkflowKey: params.expectedWorkflowKey,
            actualWorkflowKey: state.workflowKey,
            targetExecutionId: state.targetExecutionId,
          });
          await clearExecutionCurrent(params.store, params.executionId);
          return resolveTerminalState<TResult>(
            {
              state: state.state,
              targetExecutionId: state.targetExecutionId,
              error: state.error!,
              workflowKey: state.workflowKey,
              attempt: state.attempt!,
            },
            hasTimeout,
          ) as TResult | WaitForExecutionOutcome<TResult>;
        }

        if (state.state === "timed_out") {
          await clearExecutionCurrent(params.store, params.executionId);
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

        assertExpectedWorkflowKey({
          expectedWorkflowKey: params.expectedWorkflowKey,
          actualWorkflowKey: targetExecution.workflowKey,
          targetExecutionId: targetExecution.id,
        });

        if (isExecutionWaitTerminal(targetExecution)) {
          const terminalState = await finalizeTerminalState<TResult>({
            store: params.store,
            executionId: params.executionId,
            targetExecution,
            expectedWorkflowKey: params.expectedWorkflowKey,
            stepId,
            timerId: waitingState.timerId,
          });

          await clearExecutionCurrent(params.store, params.executionId);
          return resolveTerminalState<TResult>(terminalState, hasTimeout) as
            | TResult
            | WaitForExecutionOutcome<TResult>;
        }

        let waitingRecordedAt: Date | undefined;
        const replayedTimeout = getReplayedExecutionTimeoutState({
          executionId: params.executionId,
          completedAt: existing.completedAt,
          stepId,
          state: waitingState,
        });
        const timeout = await ensureDurableWaitTimer({
          store: params.store,
          executionId: params.executionId,
          stepId,
          timerType: TimerType.Timeout,
          timeoutMs: params.options?.timeoutMs,
          existing: replayedTimeout,
          createTimerId: () =>
            `execution_timeout:${params.executionId}:${stepId}`,
          persistWaitingState: async (timeoutAtMs, timerId) => {
            waitingRecordedAt = new Date();
            await params.store.saveStepResult({
              executionId: params.executionId,
              stepId,
              result: createTimedWaitState(
                createExecutionWaitingState(
                  params.targetExecutionId,
                  params.options?.timeoutMs,
                ),
                timeoutAtMs,
                timerId,
              ),
              completedAt: waitingRecordedAt,
            });
          },
        });

        await writeExecutionWaitCurrent({
          timeoutMs: timeout.persistedWaitingState
            ? params.options?.timeoutMs
            : waitingState.timeoutMs,
          timeoutAtMs: timeout.timeoutAtMs,
          timerId: timeout.timerId,
          startedAt: waitingRecordedAt ?? existing.completedAt,
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

      assertExpectedWorkflowKey({
        expectedWorkflowKey: params.expectedWorkflowKey,
        actualWorkflowKey: targetExecution.workflowKey,
        targetExecutionId: targetExecution.id,
      });

      if (isExecutionWaitTerminal(targetExecution)) {
        const terminalState = await finalizeTerminalState<TResult>({
          store: params.store,
          executionId: params.executionId,
          targetExecution,
          expectedWorkflowKey: params.expectedWorkflowKey,
          stepId,
        });

        await clearExecutionCurrent(params.store, params.executionId);
        return resolveTerminalState<TResult>(terminalState, hasTimeout) as
          | TResult
          | WaitForExecutionOutcome<TResult>;
      }

      let waitingRecordedAt: Date | undefined =
        params.options?.timeoutMs === undefined ? new Date() : undefined;
      const timeout = await ensureDurableWaitTimer({
        store: params.store,
        executionId: params.executionId,
        stepId,
        timerType: TimerType.Timeout,
        timeoutMs: params.options?.timeoutMs,
        createTimerId: () =>
          `execution_timeout:${params.executionId}:${stepId}`,
        persistWaitingState: async (timeoutAtMs, timerId) => {
          waitingRecordedAt = new Date();
          await params.store.saveStepResult({
            executionId: params.executionId,
            stepId,
            result: createTimedWaitState(
              createExecutionWaitingState(
                params.targetExecutionId,
                params.options?.timeoutMs,
              ),
              timeoutAtMs,
              timerId,
            ),
            completedAt: waitingRecordedAt,
          });
        },
      });
      await writeExecutionWaitCurrent({
        timeoutMs: params.options?.timeoutMs,
        timeoutAtMs: timeout.timeoutAtMs,
        timerId: timeout.timerId,
        startedAt: waitingRecordedAt!,
      });

      return await suspendDurableWait({
        store: params.store,
        executionId: params.executionId,
        stepId,
        recordedAt: waitingRecordedAt!,
        waitingState: timeout.persistedWaitingState
          ? undefined
          : createTimedWaitState(
              createExecutionWaitingState(
                params.targetExecutionId,
                params.options?.timeoutMs,
              ),
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
