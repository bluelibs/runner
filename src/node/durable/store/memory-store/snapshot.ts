import type {
  DurableExecutionWaiter,
  DurableSignalState,
  DurableSignalWaiter,
  StepResult,
} from "../../core/types";
import type { DurableAuditEntry } from "../../core/audit";
import {
  cloneAuditEntry,
  cloneExecution,
  cloneExecutionWaiter,
  cloneSchedule,
  cloneSignalState,
  cloneSignalWaiter,
  cloneStepResult,
  cloneTimer,
} from "./shared";
import type { MemoryStoreRuntime } from "./runtime";
import type { MemoryStoreSnapshot } from "./types";

function restoreStepResults(
  snapshot: MemoryStoreSnapshot,
): Map<string, Map<string, StepResult>> {
  const stepResults = new Map<string, Map<string, StepResult>>();
  for (const result of snapshot.stepResults) {
    const executionResults = stepResults.get(result.executionId) ?? new Map();
    executionResults.set(result.stepId, cloneStepResult(result));
    stepResults.set(result.executionId, executionResults);
  }

  return stepResults;
}

function restoreSignalStates(
  snapshot: MemoryStoreSnapshot,
): Map<string, Map<string, DurableSignalState>> {
  const signalStates = new Map<string, Map<string, DurableSignalState>>();
  for (const signalState of snapshot.signalStates) {
    const executionSignals =
      signalStates.get(signalState.executionId) ?? new Map();
    executionSignals.set(signalState.signalId, cloneSignalState(signalState));
    signalStates.set(signalState.executionId, executionSignals);
  }

  return signalStates;
}

function restoreSignalWaiters(
  snapshot: MemoryStoreSnapshot,
): Map<string, Map<string, Map<string, DurableSignalWaiter>>> {
  const signalWaiters = new Map<
    string,
    Map<string, Map<string, DurableSignalWaiter>>
  >();
  for (const waiter of snapshot.signalWaiters) {
    const executionWaiters = signalWaiters.get(waiter.executionId) ?? new Map();
    const signalBucket = executionWaiters.get(waiter.signalId) ?? new Map();
    signalBucket.set(waiter.stepId, cloneSignalWaiter(waiter));
    executionWaiters.set(waiter.signalId, signalBucket);
    signalWaiters.set(waiter.executionId, executionWaiters);
  }

  return signalWaiters;
}

function restoreExecutionWaiters(
  snapshot: MemoryStoreSnapshot,
): Map<string, Map<string, DurableExecutionWaiter>> {
  const executionWaiters = new Map<
    string,
    Map<string, DurableExecutionWaiter>
  >();
  for (const waiter of snapshot.executionWaiters) {
    const targetWaiters =
      executionWaiters.get(waiter.targetExecutionId) ?? new Map();
    targetWaiters.set(
      `${waiter.executionId}:${waiter.stepId}`,
      cloneExecutionWaiter(waiter),
    );
    executionWaiters.set(waiter.targetExecutionId, targetWaiters);
  }

  return executionWaiters;
}

function restoreAuditEntries(
  snapshot: MemoryStoreSnapshot,
): Map<string, DurableAuditEntry[]> {
  const auditEntries = new Map<string, DurableAuditEntry[]>();
  for (const entry of snapshot.auditEntries) {
    const executionEntries = auditEntries.get(entry.executionId) ?? [];
    executionEntries.push(cloneAuditEntry(entry));
    auditEntries.set(entry.executionId, executionEntries);
  }

  return auditEntries;
}

export function exportSnapshot(
  runtime: MemoryStoreRuntime,
): MemoryStoreSnapshot {
  return {
    version: 1,
    executions: Array.from(runtime.executions.values()).map(cloneExecution),
    executionIdByIdempotencyKey: Array.from(
      runtime.executionIdByIdempotencyKey.entries(),
    ),
    stepResults: Array.from(runtime.stepResults.values()).flatMap((results) =>
      Array.from(results.values()).map(cloneStepResult),
    ),
    signalStates: Array.from(runtime.signalStates.values()).flatMap((signals) =>
      Array.from(signals.values()).map(cloneSignalState),
    ),
    signalWaiters: Array.from(runtime.signalWaiters.values()).flatMap(
      (executionWaiters) =>
        Array.from(executionWaiters.values()).flatMap((signalWaiters) =>
          Array.from(signalWaiters.values()).map(cloneSignalWaiter),
        ),
    ),
    executionWaiters: Array.from(runtime.executionWaiters.values()).flatMap(
      (waiters) => Array.from(waiters.values()).map(cloneExecutionWaiter),
    ),
    auditEntries: Array.from(runtime.auditEntries.values()).flatMap((entries) =>
      entries.map(cloneAuditEntry),
    ),
    timers: Array.from(runtime.timers.values()).map(cloneTimer),
    schedules: Array.from(runtime.schedules.values()).map(cloneSchedule),
  };
}

export function restoreSnapshot(
  runtime: MemoryStoreRuntime,
  snapshot: MemoryStoreSnapshot,
): void {
  runtime.executions = new Map(
    snapshot.executions.map((execution) => [
      execution.id,
      cloneExecution(execution),
    ]),
  );
  runtime.executionIdByIdempotencyKey = new Map(
    snapshot.executionIdByIdempotencyKey,
  );
  runtime.stepResults = restoreStepResults(snapshot);
  runtime.signalStates = restoreSignalStates(snapshot);
  runtime.signalWaiters = restoreSignalWaiters(snapshot);
  runtime.executionWaiters = restoreExecutionWaiters(snapshot);
  runtime.auditEntries = restoreAuditEntries(snapshot);
  runtime.timers = new Map(
    snapshot.timers.map((timer) => [timer.id, cloneTimer(timer)]),
  );
  runtime.schedules = new Map(
    snapshot.schedules.map((schedule) => [
      schedule.id,
      cloneSchedule(schedule),
    ]),
  );
  runtime.locks = new Map();
}
