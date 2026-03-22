import type { SignalOptions } from "../interfaces/context";
import type { IDurableStore } from "../interfaces/store";
import type { IEventDefinition } from "../../../../types/event";
import { DurableAuditEntryKind, type DurableAuditEntryInput } from "../audit";
import {
  clearExecutionCurrent,
  createSignalWaitCurrent,
  setExecutionCurrent,
} from "../current";
import { TimerType } from "../types";
import { isRecord, shouldPersistStableSignalId } from "../utils";
import { upsertSignalWaiter, withSignalLock } from "../signalWaiters";
import {
  createTimedWaitState,
  deleteWaitTimerBestEffort,
  ensureDurableWaitTimer,
  suspendDurableWait,
} from "../waiterCore";
import {
  durableExecutionInvariantError,
  durableSignalTimeoutError,
} from "../../../../errors";

export type WaitForSignalOutcome<TPayload> =
  | { kind: "signal"; payload: TPayload }
  | { kind: "timeout" };

type SignalStepState =
  | { state: "waiting"; signalId?: string; timeoutMs?: number }
  | {
      state: "waiting";
      signalId?: string;
      timeoutMs?: number;
      timeoutAtMs: number;
      timerId: string;
    }
  | { state: "completed"; payload: unknown; signalId?: string }
  | { state: "timed_out"; signalId?: string };

type SignalInput<TPayload> = IEventDefinition<TPayload>;

function getSignalId(signal: SignalInput<unknown>): string {
  return signal.id;
}

function createWaitingSignalState(
  signalId: string,
  timeoutMs: number | undefined,
) {
  return {
    state: "waiting" as const,
    signalId,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
}

function parseSignalStepState(value: unknown): SignalStepState | null {
  if (!isRecord(value)) return null;
  const signalId = value.signalId;
  if (signalId !== undefined && typeof signalId !== "string") return null;
  const state = value.state;
  if (state === "waiting") {
    const timeoutMs = value.timeoutMs;
    const timeoutAtMs = value.timeoutAtMs;
    const timerId = value.timerId;
    if (typeof timeoutAtMs === "number" && typeof timerId === "string") {
      return {
        state: "waiting",
        signalId,
        timeoutMs: typeof timeoutMs === "number" ? timeoutMs : undefined,
        timeoutAtMs,
        timerId,
      };
    }
    void timeoutMs;
    return { state: "waiting", signalId };
  }
  if (state === "completed") {
    return { state: "completed", payload: value.payload, signalId };
  }
  if (state === "timed_out") {
    return { state: "timed_out", signalId };
  }
  return null;
}

function nextIndex(counter: Map<string, number>, key: string): number {
  const current = counter.get(key) ?? 0;
  counter.set(key, current + 1);
  return current;
}

function createCompletedSignalState(stepId: string, signalId: string) {
  return shouldPersistStableSignalId(stepId, signalId)
    ? {
        state: "completed" as const,
        signalId,
        payload: undefined as unknown,
      }
    : { state: "completed" as const, payload: undefined as unknown };
}

export async function waitForSignalDurably<TPayload>(params: {
  store: IDurableStore;
  executionId: string;
  assertCanContinue: () => Promise<void>;
  appendAuditEntry: (entry: DurableAuditEntryInput) => Promise<void>;
  assertUniqueStepId: (stepId: string) => void;
  assertOrWarnImplicitInternalStepId: (
    kind: "sleep" | "emit" | "waitForSignal",
  ) => void;
  signalIndexes: Map<string, number>;
  signal: SignalInput<TPayload>;
  options?: SignalOptions;
}): Promise<TPayload | WaitForSignalOutcome<TPayload>> {
  await params.assertCanContinue();

  const signalId = getSignalId(params.signal);
  const hasTimeout = params.options?.timeoutMs !== undefined;

  const resolveCompleted = (
    payload: TPayload,
  ): TPayload | WaitForSignalOutcome<TPayload> => {
    return hasTimeout ? { kind: "signal", payload } : payload;
  };

  const resolveTimedOut = (): WaitForSignalOutcome<TPayload> => {
    if (!hasTimeout) {
      durableSignalTimeoutError.throw({ signalId });
    }
    return { kind: "timeout" };
  };

  const writeSignalWaitCurrent = async (options: {
    stepId: string;
    timeoutMs?: number;
    timeoutAtMs?: number;
    timerId?: string;
    startedAt: Date;
  }): Promise<void> =>
    await setExecutionCurrent(
      params.store,
      params.executionId,
      createSignalWaitCurrent({
        stepId: options.stepId,
        signalId,
        timeoutMs: options.timeoutMs,
        timeoutAtMs: options.timeoutAtMs,
        timerId: options.timerId,
        startedAt: options.startedAt,
      }),
    );

  return await withSignalLock({
    store: params.store,
    executionId: params.executionId,
    signalId,
    fn: async () => {
      let stepId: string;
      if (params.options?.stepId) {
        stepId = `__signal:${params.options.stepId}`;
      } else {
        params.assertOrWarnImplicitInternalStepId("waitForSignal");
        const signalStepIndex = nextIndex(params.signalIndexes, signalId);
        stepId =
          signalStepIndex === 0
            ? `__signal:${signalId}`
            : `__signal:${signalId}:${signalStepIndex}`;
      }

      params.assertUniqueStepId(stepId);

      const existing = await params.store.getStepResult(
        params.executionId,
        stepId,
      );
      if (existing) {
        const state = parseSignalStepState(existing.result);
        if (!state) {
          return durableExecutionInvariantError.throw({
            message: `Invalid signal step state for '${signalId}' at '${stepId}'`,
          });
        }
        if (state.signalId !== undefined && state.signalId !== signalId) {
          return durableExecutionInvariantError.throw({
            message: `Invalid signal step state for '${signalId}' at '${stepId}'`,
          });
        }
        if (state.state === "completed") {
          await clearExecutionCurrent(params.store, params.executionId);
          return resolveCompleted(state.payload as TPayload);
        }
        if (state.state === "timed_out") {
          await clearExecutionCurrent(params.store, params.executionId);
          return resolveTimedOut();
        }

        const queuedSignal = await params.store.consumeBufferedSignalForStep({
          executionId: params.executionId,
          stepId,
          result: createCompletedSignalState(stepId, signalId),
          completedAt: new Date(),
        });
        if (queuedSignal) {
          if ("timerId" in state) {
            await deleteWaitTimerBestEffort(params.store, state.timerId);
          }
          await clearExecutionCurrent(params.store, params.executionId);
          return resolveCompleted(queuedSignal.payload as TPayload);
        }

        let waitingRecordedAt: Date | undefined;
        const timeout = await ensureDurableWaitTimer({
          store: params.store,
          executionId: params.executionId,
          stepId,
          timerType: TimerType.SignalTimeout,
          timeoutMs: params.options?.timeoutMs,
          existing:
            "timeoutAtMs" in state && "timerId" in state ? state : undefined,
          createTimerId: () => `signal_timeout:${params.executionId}:${stepId}`,
          persistWaitingState: async (timeoutAtMs, timerId) => {
            waitingRecordedAt = new Date();
            await params.store.saveStepResult({
              executionId: params.executionId,
              stepId,
              result: createTimedWaitState(
                createWaitingSignalState(signalId, params.options?.timeoutMs),
                timeoutAtMs,
                timerId,
              ),
              completedAt: waitingRecordedAt,
            });
          },
          onTimerCreated: async (timeoutAtMs, timerId) => {
            await params.appendAuditEntry({
              kind: DurableAuditEntryKind.SignalWaiting,
              stepId,
              signalId,
              timeoutMs: params.options?.timeoutMs,
              timeoutAtMs,
              timerId,
              reason: "timeout_armed",
            });
          },
        });

        await writeSignalWaitCurrent({
          stepId,
          timeoutMs: timeout.persistedWaitingState
            ? params.options?.timeoutMs
            : state.timeoutMs,
          timeoutAtMs: timeout.timeoutAtMs,
          timerId: timeout.timerId,
          startedAt: waitingRecordedAt ?? existing.completedAt,
        });

        return await suspendDurableWait({
          store: params.store,
          executionId: params.executionId,
          stepId,
          registerWaiter: async () => {
            await upsertSignalWaiter({
              store: params.store,
              executionId: params.executionId,
              signalId,
              stepId,
              timerId: timeout.timerId,
            });
          },
        });
      }

      const queuedSignal = await params.store.consumeBufferedSignalForStep({
        executionId: params.executionId,
        stepId,
        result: createCompletedSignalState(stepId, signalId),
        completedAt: new Date(),
      });
      if (queuedSignal) {
        await clearExecutionCurrent(params.store, params.executionId);
        return resolveCompleted(queuedSignal.payload as TPayload);
      }

      let waitingRecordedAt: Date | undefined =
        params.options?.timeoutMs === undefined ? new Date() : undefined;
      const timeout = await ensureDurableWaitTimer({
        store: params.store,
        executionId: params.executionId,
        stepId,
        timerType: TimerType.SignalTimeout,
        timeoutMs: params.options?.timeoutMs,
        createTimerId: () => `signal_timeout:${params.executionId}:${stepId}`,
        persistWaitingState: async (timeoutAtMs, timerId) => {
          waitingRecordedAt = new Date();
          await params.store.saveStepResult({
            executionId: params.executionId,
            stepId,
            result: createTimedWaitState(
              createWaitingSignalState(signalId, params.options?.timeoutMs),
              timeoutAtMs,
              timerId,
            ),
            completedAt: waitingRecordedAt,
          });
        },
        onTimerCreated: async (timeoutAtMs, timerId) => {
          await params.appendAuditEntry({
            kind: DurableAuditEntryKind.SignalWaiting,
            stepId,
            signalId,
            timeoutMs: params.options?.timeoutMs,
            timeoutAtMs,
            timerId,
            reason: "initial",
          });
        },
      });

      if (params.options?.timeoutMs === undefined) {
        await params.appendAuditEntry({
          kind: DurableAuditEntryKind.SignalWaiting,
          stepId,
          signalId,
          reason: "initial",
        });
      }

      await writeSignalWaitCurrent({
        stepId,
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
          : createWaitingSignalState(signalId, params.options?.timeoutMs),
        registerWaiter: async () => {
          await upsertSignalWaiter({
            store: params.store,
            executionId: params.executionId,
            signalId,
            stepId,
            timerId: timeout.timerId,
          });
        },
      });
    },
  });
}
