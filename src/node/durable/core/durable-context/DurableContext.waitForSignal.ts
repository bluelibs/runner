import type { SignalOptions } from "../interfaces/context";
import { SuspensionSignal } from "../interfaces/context";
import type { IDurableStore } from "../interfaces/store";
import type { IEventDefinition } from "../../../../types/event";
import { DurableAuditEntryKind, type DurableAuditEntryInput } from "../audit";
import { TimerStatus, TimerType } from "../types";
import { isRecord, sleepMs } from "../utils";
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
  | { state: "completed"; payload: unknown }
  | { state: "timed_out" };

type SignalInput<TPayload> = IEventDefinition<TPayload>;

function getSignalId(signal: SignalInput<unknown>): string {
  return signal.id;
}

function parseSignalStepState(value: unknown): SignalStepState | null {
  if (!isRecord(value)) return null;
  const state = value.state;
  if (state === "waiting") {
    const signalId = value.signalId;
    const timeoutAtMs = value.timeoutAtMs;
    const timerId = value.timerId;
    if (signalId !== undefined && typeof signalId !== "string") return null;
    if (typeof timeoutAtMs === "number" && typeof timerId === "string") {
      return { state: "waiting", signalId, timeoutAtMs, timerId };
    }
    return { state: "waiting", signalId };
  }
  if (state === "completed") {
    return { state: "completed", payload: value.payload };
  }
  if (state === "timed_out") {
    return { state: "timed_out" };
  }
  return null;
}

function nextIndex(counter: Map<string, number>, key: string): number {
  const current = counter.get(key) ?? 0;
  counter.set(key, current + 1);
  return current;
}

async function withSignalLock<TPayload>(params: {
  store: IDurableStore;
  executionId: string;
  signalId: string;
  fn: () => Promise<TPayload>;
}): Promise<TPayload> {
  if (!params.store.acquireLock || !params.store.releaseLock) {
    return params.fn();
  }

  const lockResource = `signal:${params.executionId}:${params.signalId}`;
  const lockTtlMs = 10_000;
  const maxAttempts = 20;

  let lockId: string | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    lockId = await params.store.acquireLock(lockResource, lockTtlMs);
    if (lockId !== null) break;
    await sleepMs(5);
  }

  if (lockId === null) {
    return durableExecutionInvariantError.throw({
      message: `Failed to acquire signal lock for '${params.signalId}' on execution '${params.executionId}'`,
    });
  }

  const acquiredLockId = lockId;

  try {
    return await params.fn();
  } finally {
    try {
      await params.store.releaseLock(lockResource, acquiredLockId);
    } catch {
      // best-effort cleanup; ignore
    }
  }
}

export async function waitForSignalDurably<TPayload>(params: {
  store: IDurableStore;
  executionId: string;
  assertNotCancelled: () => Promise<void>;
  appendAuditEntry: (entry: DurableAuditEntryInput) => Promise<void>;
  assertUniqueStepId: (stepId: string) => void;
  assertOrWarnImplicitInternalStepId: (
    kind: "sleep" | "emit" | "waitForSignal",
  ) => void;
  signalIndexes: Map<string, number>;
  signal: SignalInput<TPayload>;
  options?: SignalOptions;
}): Promise<TPayload | WaitForSignalOutcome<TPayload>> {
  await params.assertNotCancelled();

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
        if (!params.store.listStepResults) {
          durableExecutionInvariantError.throw({
            message:
              "waitForSignal({ stepId }) requires a store that implements listStepResults()",
          });
        }
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
        if (parsedState.state === "completed") {
          const payload = parsedState.payload as TPayload;
          return resolveCompleted(payload);
        }
        if (parsedState.state === "timed_out") {
          return resolveTimedOut();
        }
        // Remaining valid parsed state is "waiting" (completed/timed_out returned above).
        if (
          parsedState.signalId !== undefined &&
          parsedState.signalId !== signalId
        ) {
          return durableExecutionInvariantError.throw({
            message: `Invalid signal step state for '${signalId}' at '${stepId}'`,
          });
        }
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
          }
        }
        throw new SuspensionSignal("yield");
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
