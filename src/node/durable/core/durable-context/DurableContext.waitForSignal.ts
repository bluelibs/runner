import type { SignalOptions } from "../interfaces/context";
import { SuspensionSignal } from "../interfaces/context";
import type { IDurableStore } from "../interfaces/store";
import type { IEventDefinition } from "../../../../types/event";
import { DurableAuditEntryKind, type DurableAuditEntryInput } from "../audit";
import { TimerStatus, TimerType } from "../types";
import { isRecord, shouldPersistStableSignalId } from "../utils";
import { upsertSignalWaiter, withSignalLock } from "../signalWaiters";
import {
  durableExecutionInvariantError,
  durableSignalTimeoutError,
} from "../../../../errors";

export type WaitForSignalOutcome<TPayload> =
  | { kind: "signal"; payload: TPayload }
  | { kind: "timeout" };

type SignalStepState =
  | { state: "waiting"; signalId?: string }
  | {
      state: "waiting";
      signalId?: string;
      timeoutAtMs: number;
      timerId: string;
    }
  | { state: "completed"; payload: unknown; signalId?: string }
  | { state: "timed_out"; signalId?: string };

type SignalInput<TPayload> = IEventDefinition<TPayload>;

function getSignalId(signal: SignalInput<unknown>): string {
  return signal.id;
}

function parseSignalStepState(value: unknown): SignalStepState | null {
  if (!isRecord(value)) return null;
  const signalId = value.signalId;
  if (signalId !== undefined && typeof signalId !== "string") return null;
  const state = value.state;
  if (state === "waiting") {
    const timeoutAtMs = value.timeoutAtMs;
    const timerId = value.timerId;
    if (typeof timeoutAtMs === "number" && typeof timerId === "string") {
      return { state: "waiting", signalId, timeoutAtMs, timerId };
    }
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
  ): TPayload | WaitForSignalOutcome<TPayload> =>
    hasTimeout ? { kind: "signal", payload } : payload;

  const resolveTimedOut = (): WaitForSignalOutcome<TPayload> => {
    if (!hasTimeout) {
      durableSignalTimeoutError.throw({ signalId });
    }
    return { kind: "timeout" };
  };

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
        const parsedState = state;
        if (
          parsedState.signalId !== undefined &&
          parsedState.signalId !== signalId
        ) {
          return durableExecutionInvariantError.throw({
            message: `Invalid signal step state for '${signalId}' at '${stepId}'`,
          });
        }
        if (parsedState.state === "completed") {
          const payload = parsedState.payload as TPayload;
          return resolveCompleted(payload);
        }
        if (parsedState.state === "timed_out") {
          return resolveTimedOut();
        }
        // Remaining valid parsed state is "waiting" (completed/timed_out returned above).
        const queuedSignal = await params.store.consumeBufferedSignalForStep({
          executionId: params.executionId,
          stepId,
          result: createCompletedSignalState(stepId, signalId),
          completedAt: new Date(),
        });
        if (queuedSignal) {
          if ("timerId" in parsedState) {
            try {
              await params.store.deleteTimer(parsedState.timerId);
            } catch {
              // Durable completion already won; stale timer cleanup stays best-effort.
            }
          }
          return resolveCompleted(queuedSignal.payload as TPayload);
        }

        let waiterTimerId: string | undefined;
        if (params.options?.timeoutMs !== undefined) {
          if ("timeoutAtMs" in parsedState && "timerId" in parsedState) {
            await params.store.createTimer({
              id: parsedState.timerId,
              executionId: params.executionId,
              stepId,
              type: TimerType.SignalTimeout,
              fireAt: new Date(parsedState.timeoutAtMs),
              status: TimerStatus.Pending,
            });
            waiterTimerId = parsedState.timerId;
          } else {
            const timerId = `signal_timeout:${params.executionId}:${stepId}`;
            const timeoutAtMs = Date.now() + params.options.timeoutMs;

            await params.store.createTimer({
              id: timerId,
              executionId: params.executionId,
              stepId,
              type: TimerType.SignalTimeout,
              fireAt: new Date(timeoutAtMs),
              status: TimerStatus.Pending,
            });

            await params.store.saveStepResult({
              executionId: params.executionId,
              stepId,
              result: { state: "waiting", signalId, timeoutAtMs, timerId },
              completedAt: new Date(),
            });

            await params.appendAuditEntry({
              kind: DurableAuditEntryKind.SignalWaiting,
              stepId,
              signalId,
              timeoutMs: params.options.timeoutMs,
              timeoutAtMs,
              timerId,
              reason: "timeout_armed",
            });
            waiterTimerId = timerId;
          }
        }

        await upsertSignalWaiter({
          store: params.store,
          executionId: params.executionId,
          signalId,
          stepId,
          timerId: waiterTimerId,
        });
        throw new SuspensionSignal("yield");
      }

      const queuedSignal = await params.store.consumeBufferedSignalForStep({
        executionId: params.executionId,
        stepId,
        result: createCompletedSignalState(stepId, signalId),
        completedAt: new Date(),
      });
      if (queuedSignal) {
        return resolveCompleted(queuedSignal.payload as TPayload);
      }

      if (params.options?.timeoutMs !== undefined) {
        const timerId = `signal_timeout:${params.executionId}:${stepId}`;
        const timeoutAtMs = Date.now() + params.options.timeoutMs;

        await params.store.createTimer({
          id: timerId,
          executionId: params.executionId,
          stepId,
          type: TimerType.SignalTimeout,
          fireAt: new Date(timeoutAtMs),
          status: TimerStatus.Pending,
        });

        await params.store.saveStepResult({
          executionId: params.executionId,
          stepId,
          result: { state: "waiting", signalId, timeoutAtMs, timerId },
          completedAt: new Date(),
        });

        await upsertSignalWaiter({
          store: params.store,
          executionId: params.executionId,
          signalId,
          stepId,
          timerId,
        });

        await params.appendAuditEntry({
          kind: DurableAuditEntryKind.SignalWaiting,
          stepId,
          signalId,
          timeoutMs: params.options.timeoutMs,
          timeoutAtMs,
          timerId,
          reason: "initial",
        });

        throw new SuspensionSignal("yield");
      }

      await params.store.saveStepResult({
        executionId: params.executionId,
        stepId,
        result: { state: "waiting", signalId },
        completedAt: new Date(),
      });

      await upsertSignalWaiter({
        store: params.store,
        executionId: params.executionId,
        signalId,
        stepId,
      });

      await params.appendAuditEntry({
        kind: DurableAuditEntryKind.SignalWaiting,
        stepId,
        signalId,
        reason: "initial",
      });

      throw new SuspensionSignal("yield");
    },
  });
}
