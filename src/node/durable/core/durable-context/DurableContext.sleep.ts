import type { SleepOptions } from "../interfaces/context";
import { SuspensionSignal } from "../interfaces/context";
import type { IDurableStore } from "../interfaces/store";
import { DurableAuditEntryKind, type DurableAuditEntryInput } from "../audit";
import { TimerStatus, TimerType } from "../types";

export async function sleepDurably(params: {
  store: IDurableStore;
  executionId: string;
  assertNotCancelled: () => Promise<void>;
  appendAuditEntry: (entry: DurableAuditEntryInput) => Promise<void>;
  assertUniqueStepId: (stepId: string) => void;
  assertOrWarnImplicitInternalStepId: (
    kind: "sleep" | "emit" | "waitForSignal",
  ) => void;
  sleepIndexRef: { current: number };
  durationMs: number;
  options?: SleepOptions;
}): Promise<void> {
  await params.assertNotCancelled();

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
    | { state: "sleeping"; timerId: string; fireAtMs: number }
    | { state: "completed" }
    | undefined;

  if (existingState?.state === "completed") {
    return;
  }

  if (existingState?.state === "sleeping") {
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
    result: { state: "sleeping", timerId, fireAtMs },
    completedAt: new Date(),
  });

  await params.appendAuditEntry({
    kind: DurableAuditEntryKind.SleepScheduled,
    stepId: sleepStepId,
    timerId,
    durationMs: params.durationMs,
    fireAt: new Date(fireAtMs),
  });

  throw new SuspensionSignal("sleep");
}
