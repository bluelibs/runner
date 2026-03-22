import type { SleepOptions } from "../interfaces/context";
import { SuspensionSignal } from "../interfaces/context";
import {
  clearExecutionCurrent,
  createSleepCurrent,
  setExecutionCurrent,
} from "../current";
import type { IDurableStore } from "../interfaces/store";
import { DurableAuditEntryKind, type DurableAuditEntryInput } from "../audit";
import { TimerStatus, TimerType } from "../types";

export async function sleepDurably(params: {
  store: IDurableStore;
  executionId: string;
  assertCanContinue: () => Promise<void>;
  appendAuditEntry: (entry: DurableAuditEntryInput) => Promise<void>;
  assertUniqueStepId: (stepId: string) => void;
  assertOrWarnImplicitInternalStepId: (
    kind: "sleep" | "emit" | "waitForSignal",
  ) => void;
  sleepIndexRef: { current: number };
  durationMs: number;
  options?: SleepOptions;
}): Promise<void> {
  await params.assertCanContinue();

  let sleepStepId: string;

  if (params.options?.stepId) {
    sleepStepId = `__sleep:${params.options.stepId}`;
  } else {
    params.assertOrWarnImplicitInternalStepId("sleep");
    const sleepStepIndex = params.sleepIndexRef.current;
    params.sleepIndexRef.current += 1;
    sleepStepId = `__sleep:${sleepStepIndex}`;
  }

  params.assertUniqueStepId(sleepStepId);

  const existing = await params.store.getStepResult(
    params.executionId,
    sleepStepId,
  );

  const existingState = existing?.result as
    | {
        state: "sleeping";
        timerId: string;
        fireAtMs: number;
        durationMs?: number;
      }
    | { state: "completed" }
    | undefined;

  if (existingState?.state === "completed") {
    await clearExecutionCurrent(params.store, params.executionId);
    return;
  }

  if (existingState?.state === "sleeping") {
    await setExecutionCurrent(
      params.store,
      params.executionId,
      createSleepCurrent({
        stepId: sleepStepId,
        durationMs: existingState.durationMs,
        fireAtMs: existingState.fireAtMs,
        timerId: existingState.timerId,
        startedAt: existing!.completedAt,
      }),
    );
    await params.store.createTimer({
      id: existingState.timerId,
      executionId: params.executionId,
      stepId: sleepStepId,
      type: TimerType.Sleep,
      fireAt: new Date(existingState.fireAtMs),
      status: TimerStatus.Pending,
    });
    throw new SuspensionSignal("sleep");
  }

  const timerId = `sleep:${params.executionId}:${sleepStepId}`;
  const fireAtMs = Date.now() + params.durationMs;
  const recordedAt = new Date();

  await params.store.createTimer({
    id: timerId,
    executionId: params.executionId,
    stepId: sleepStepId,
    type: TimerType.Sleep,
    fireAt: new Date(fireAtMs),
    status: TimerStatus.Pending,
  });

  await params.store.saveStepResult({
    executionId: params.executionId,
    stepId: sleepStepId,
    result: {
      state: "sleeping",
      timerId,
      fireAtMs,
      durationMs: params.durationMs,
    },
    completedAt: recordedAt,
  });

  await setExecutionCurrent(
    params.store,
    params.executionId,
    createSleepCurrent({
      stepId: sleepStepId,
      durationMs: params.durationMs,
      fireAtMs,
      timerId,
      startedAt: recordedAt,
    }),
  );

  await params.appendAuditEntry({
    kind: DurableAuditEntryKind.SleepScheduled,
    stepId: sleepStepId,
    timerId,
    durationMs: params.durationMs,
    fireAt: new Date(fireAtMs),
  });

  throw new SuspensionSignal("sleep");
}
