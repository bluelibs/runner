import type { DurableAuditEntry } from "../../../../durable/core/audit";
import type { IDurableStore } from "../../../../durable/core/interfaces/store";
import {
  ExecutionStatus,
  type DurableQueuedSignalRecord,
  type DurableSignalRecord,
  type Execution,
  type StepResult,
} from "../../../../durable/core/types";
import { MemoryStore } from "../../../../durable/store/MemoryStore";

export const STUB_NOW = new Date("2024-06-01T12:00:00.000Z");

/**
 * Creates a memory-backed store with selected capabilities removed and/or
 * methods overridden with scripted implementations.
 */
export function createStubStore(options?: {
  without?: Array<keyof IDurableStore>;
  overrides?: Partial<IDurableStore>;
}): IDurableStore {
  const store = new MemoryStore() as unknown as Record<string, unknown>;
  for (const key of options?.without ?? []) {
    store[key] = undefined;
  }
  Object.assign(store, options?.overrides ?? {});
  return store as unknown as IDurableStore;
}

/**
 * Creates a jest.fn-driven store for interaction assertions. Reads resolve
 * empty values and every method records its calls.
 */
export function createFnStore(): jest.Mocked<IDurableStore> {
  const store: Record<string, jest.Mock> = {};
  const methods: Array<keyof IDurableStore> = [
    "saveExecution",
    "saveExecutionIfStatus",
    "getExecution",
    "updateExecution",
    "listIncompleteExecutions",
    "createExecutionWithIdempotencyKey",
    "listExecutions",
    "listStepResults",
    "getStepResult",
    "saveStepResult",
    "getSignalState",
    "appendSignalRecord",
    "bufferSignalRecord",
    "enqueueQueuedSignalRecord",
    "consumeQueuedSignalRecord",
    "consumeBufferedSignalForStep",
    "upsertSignalWaiter",
    "peekNextSignalWaiter",
    "takeNextSignalWaiter",
    "deleteSignalWaiter",
    "upsertExecutionWaiter",
    "listExecutionWaiters",
    "deleteExecutionWaiter",
    "createTimer",
    "getReadyTimers",
    "claimReadyTimers",
    "markTimerFired",
    "deleteTimer",
    "createSchedule",
    "getSchedule",
    "updateSchedule",
    "saveScheduleWithTimer",
    "deleteSchedule",
    "listSchedules",
    "listActiveSchedules",
  ];
  for (const method of methods) {
    store[method] = jest.fn();
  }
  store.getExecution.mockResolvedValue(null);
  store.listExecutions.mockResolvedValue([]);
  store.listIncompleteExecutions.mockResolvedValue([]);
  store.listStepResults.mockResolvedValue([]);
  store.getStepResult.mockResolvedValue(null);
  store.getSignalState.mockResolvedValue(null);
  store.listExecutionWaiters.mockResolvedValue([]);
  store.getReadyTimers.mockResolvedValue([]);
  store.claimReadyTimers.mockResolvedValue([]);
  store.getSchedule.mockResolvedValue(null);
  store.listSchedules.mockResolvedValue([]);
  store.listActiveSchedules.mockResolvedValue([]);
  store.consumeQueuedSignalRecord.mockResolvedValue(null);
  store.consumeBufferedSignalForStep.mockResolvedValue(null);
  store.peekNextSignalWaiter.mockResolvedValue(null);
  store.takeNextSignalWaiter.mockResolvedValue(null);
  store.createExecutionWithIdempotencyKey.mockResolvedValue({
    created: true,
    executionId: "exec-fn",
  });
  return store as unknown as jest.Mocked<IDurableStore>;
}

export function createStubExecution(overrides?: Partial<Execution>): Execution {
  return {
    id: "exec-1",
    workflowKey: "workflow-1",
    input: undefined,
    status: ExecutionStatus.Completed,
    attempt: 1,
    maxAttempts: 3,
    createdAt: STUB_NOW,
    updatedAt: STUB_NOW,
    completedAt: STUB_NOW,
    ...overrides,
  };
}

export function createStubStep(overrides?: Partial<StepResult>): StepResult {
  return {
    executionId: "exec-1",
    stepId: "step-1",
    result: { ok: true },
    completedAt: STUB_NOW,
    ...overrides,
  };
}

export function createStubAuditEntry(
  overrides?: Partial<DurableAuditEntry>,
): DurableAuditEntry {
  return {
    id: "audit-1",
    executionId: "exec-1",
    at: STUB_NOW,
    attempt: 1,
    kind: "note",
    message: "note",
    ...overrides,
  } as DurableAuditEntry;
}

export function createStubSignalRecord(
  overrides?: Partial<DurableSignalRecord>,
): DurableSignalRecord {
  return {
    id: "signal-record-1",
    payload: { ping: true },
    receivedAt: STUB_NOW,
    ...overrides,
  };
}

export function createStubQueuedSignalRecord(
  overrides?: Partial<DurableQueuedSignalRecord>,
): DurableQueuedSignalRecord {
  return {
    id: "queued-record-1",
    payload: { ping: true },
    receivedAt: STUB_NOW,
    ...overrides,
  };
}
