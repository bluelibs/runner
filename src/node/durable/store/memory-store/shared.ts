import type {
  DurableExecutionWaiter,
  DurableQueuedSignalRecord,
  DurableSignalRecord,
  DurableSignalState,
  DurableSignalWaiter,
  Execution,
  Schedule,
  StepResult,
  Timer,
} from "../../core/types";
import type { DurableAuditEntry } from "../../core/audit";
import { getSignalIdFromStepId } from "../../core/signalWaiters";
import { durableExecutionInvariantError } from "../../../../errors";

export const createEmptySignalState = (
  executionId: string,
  signalId: string,
): DurableSignalState => ({
  executionId,
  signalId,
  queued: [],
  history: [],
});

function isDateLike(value: unknown): value is Date {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.prototype.toString.call(value) === "[object Date]" &&
    typeof Reflect.get(value, "getTime") === "function"
  );
}

function isMapLike(value: unknown): value is Map<unknown, unknown> {
  return Object.prototype.toString.call(value) === "[object Map]";
}

function isSetLike(value: unknown): value is Set<unknown> {
  return Object.prototype.toString.call(value) === "[object Set]";
}

function isRegExpLike(value: unknown): value is RegExp {
  return Object.prototype.toString.call(value) === "[object RegExp]";
}

export function cloneDurableValue<T>(
  value: T,
  seen = new WeakMap<object, unknown>(),
): T {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const existing = seen.get(value);
  if (existing !== undefined) {
    return existing as T;
  }

  if (isDateLike(value)) {
    // Jest's vm-backed test runtime can flatten Date fields inside
    // structuredClone(...) results to plain objects, so we rebuild them here
    // in the current realm before persistence or equality checks depend on
    // instanceof Date.
    return new Date(value.getTime()) as T;
  }

  if (isRegExpLike(value)) {
    return new RegExp(value.source, value.flags) as T;
  }

  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return structuredClone(value);
  }

  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(value, clone);
    for (const item of value) {
      clone.push(cloneDurableValue(item, seen));
    }
    return clone as T;
  }

  if (isMapLike(value)) {
    const clone = new Map();
    seen.set(value, clone);
    for (const [key, mapValue] of value.entries()) {
      clone.set(
        cloneDurableValue(key, seen),
        cloneDurableValue(mapValue, seen),
      );
    }
    return clone as T;
  }

  if (isSetLike(value)) {
    const clone = new Set();
    seen.set(value, clone);
    for (const entry of value.values()) {
      clone.add(cloneDurableValue(entry, seen));
    }
    return clone as T;
  }

  const prototype = Object.getPrototypeOf(value);
  const clone = Object.create(prototype) as Record<PropertyKey, unknown>;
  seen.set(value, clone);

  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;

    if ("value" in descriptor) {
      descriptor.value = cloneDurableValue(descriptor.value, seen);
    }

    Object.defineProperty(clone, key, descriptor);
  }

  return clone as T;
}

export const cloneSignalPayload = <TPayload>(payload: TPayload): TPayload =>
  cloneDurableValue(payload);

export const cloneSignalRecord = <TPayload>(
  record: DurableSignalRecord<TPayload>,
): DurableSignalRecord<TPayload> => ({
  id: record.id,
  payload: cloneSignalPayload(record.payload),
  receivedAt: record.receivedAt,
});

export const cloneQueuedSignalRecord = (
  record: DurableQueuedSignalRecord,
): DurableQueuedSignalRecord => ({
  ...record,
  payload: cloneSignalPayload(record.payload),
});

export const cloneSignalState = (
  signalState: DurableSignalState,
): DurableSignalState => ({
  executionId: signalState.executionId,
  signalId: signalState.signalId,
  queued: signalState.queued.map(cloneQueuedSignalRecord),
  history: signalState.history.map(cloneSignalRecord),
});

export const cloneSignalWaiter = (
  waiter: DurableSignalWaiter,
): DurableSignalWaiter => cloneDurableValue(waiter);

export const cloneExecutionWaiter = (
  waiter: DurableExecutionWaiter,
): DurableExecutionWaiter => cloneDurableValue(waiter);

export const cloneExecution = (execution: Execution): Execution =>
  cloneDurableValue(execution);

export const cloneStepResult = <T>(result: StepResult<T>): StepResult<T> => ({
  ...result,
});

export const cloneAuditEntry = (
  entry: DurableAuditEntry,
): DurableAuditEntry => ({
  ...entry,
});

export const cloneTimer = (timer: Timer): Timer => ({ ...timer });

export const cloneSchedule = (schedule: Schedule): Schedule => ({
  ...schedule,
});

export const compareTimersByReadyOrder = (
  left: Timer,
  right: Timer,
): number => {
  const fireAtDiff = left.fireAt.getTime() - right.fireAt.getTime();
  if (fireAtDiff !== 0) {
    return fireAtDiff;
  }

  return left.id.localeCompare(right.id);
};

export function getSignalIdFromStepResult(result: StepResult): string {
  const state = result.result;
  if (
    typeof state === "object" &&
    state !== null &&
    "signalId" in state &&
    typeof state.signalId === "string"
  ) {
    return state.signalId;
  }

  const signalId = getSignalIdFromStepId(result.stepId);
  if (signalId) {
    return signalId;
  }

  return durableExecutionInvariantError.throw({
    message: `Unable to resolve signal id for buffered step '${result.stepId}' on execution '${result.executionId}'.`,
  });
}
