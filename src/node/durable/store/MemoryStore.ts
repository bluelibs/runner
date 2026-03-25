import {
  type DurableSignalRecord,
  type DurableQueuedSignalRecord,
  type DurableExecutionWaiter,
  type DurableSignalState,
  type DurableSignalWaiter,
  ExecutionStatus,
  ScheduleStatus,
  TimerStatus,
  type Execution,
  type Schedule,
  type StepResult,
  type Timer,
} from "../core/types";
import type {
  IDurableStore,
  ListExecutionsOptions,
  ExpectedExecutionStatuses,
} from "../core/interfaces/store";
import type { DurableAuditEntry } from "../core/audit";
import { randomUUID } from "node:crypto";
import { getSignalIdFromStepId } from "../core/signalWaiters";
import { parseExecutionWaitState, parseSignalState } from "../core/utils";
import { durableExecutionInvariantError } from "../../../errors";
import { Semaphore } from "../../../models/Semaphore";

const createEmptySignalState = (
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

function cloneDurableValue<T>(
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

const cloneSignalPayload = <TPayload>(payload: TPayload): TPayload =>
  cloneDurableValue(payload);

const cloneSignalRecord = <TPayload>(
  record: DurableSignalRecord<TPayload>,
): DurableSignalRecord<TPayload> => ({
  id: record.id,
  payload: cloneSignalPayload(record.payload),
  receivedAt: record.receivedAt,
});

const cloneQueuedSignalRecord = (
  record: DurableQueuedSignalRecord,
): DurableQueuedSignalRecord => ({
  ...record,
  payload: cloneSignalPayload(record.payload),
});

const cloneSignalState = (
  signalState: DurableSignalState,
): DurableSignalState => ({
  executionId: signalState.executionId,
  signalId: signalState.signalId,
  queued: signalState.queued.map(cloneQueuedSignalRecord),
  history: signalState.history.map(cloneSignalRecord),
});

const cloneSignalWaiter = (waiter: DurableSignalWaiter): DurableSignalWaiter =>
  cloneDurableValue(waiter);

const cloneExecutionWaiter = (
  waiter: DurableExecutionWaiter,
): DurableExecutionWaiter => cloneDurableValue(waiter);

const cloneExecution = (execution: Execution): Execution =>
  cloneDurableValue(execution);

const cloneStepResult = <T>(result: StepResult<T>): StepResult<T> => ({
  ...result,
});

const cloneAuditEntry = (entry: DurableAuditEntry): DurableAuditEntry => ({
  ...entry,
});

const cloneTimer = (timer: Timer): Timer => ({ ...timer });

const cloneSchedule = (schedule: Schedule): Schedule => ({ ...schedule });

/**
 * Serializable snapshot of the in-memory durable state.
 *
 * This intentionally excludes ephemeral lock ownership because lock recovery is
 * rebuilt on boot and must not resurrect stale claims from a prior process.
 */
export interface MemoryStoreSnapshot {
  version: 1;
  executions: Execution[];
  executionIdByIdempotencyKey: Array<readonly [string, string]>;
  stepResults: StepResult[];
  signalStates: DurableSignalState[];
  signalWaiters: DurableSignalWaiter[];
  executionWaiters: DurableExecutionWaiter[];
  auditEntries: DurableAuditEntry[];
  timers: Timer[];
  schedules: Schedule[];
}

type DurableMutationResult<T> = {
  result: T;
  changed: boolean;
};

const compareTimersByReadyOrder = (left: Timer, right: Timer): number => {
  const fireAtDiff = left.fireAt.getTime() - right.fireAt.getTime();
  if (fireAtDiff !== 0) {
    return fireAtDiff;
  }

  return left.id.localeCompare(right.id);
};

function getSignalIdFromStepResult(result: StepResult): string {
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

export class MemoryStore implements IDurableStore {
  private executions = new Map<string, Execution>();
  private executionIdByIdempotencyKey = new Map<string, string>();
  private stepResults = new Map<string, Map<string, StepResult>>();
  private signalStates = new Map<string, Map<string, DurableSignalState>>();
  private signalWaiters = new Map<
    string,
    Map<string, Map<string, DurableSignalWaiter>>
  >();
  private executionWaiters = new Map<
    string,
    Map<string, DurableExecutionWaiter>
  >();
  // Keep signal queue/history/waiter transitions serialized so the in-memory
  // store matches the atomic durability contract expected from other stores.
  private readonly signalStateSemaphore = new Semaphore(1);
  private readonly executionWaiterSemaphore = new Semaphore(1);
  private auditEntries = new Map<string, DurableAuditEntry[]>();
  private timers = new Map<string, Timer>();
  private schedules = new Map<string, Schedule>();
  private locks = new Map<string, { id: string; expires: number }>();

  /**
   * Hook for subclasses that need to persist durable state changes.
   *
   * MemoryStore itself is intentionally volatile, so the default implementation
   * is a no-op.
   */
  protected async afterDurableMutation(
    _snapshot: MemoryStoreSnapshot,
  ): Promise<void> {}

  protected captureDurableMutationSnapshot(): MemoryStoreSnapshot {
    return this.exportSnapshot();
  }

  private withSignalStatePermit<T>(fn: () => T | Promise<T>): Promise<T> {
    return this.signalStateSemaphore.withPermit(async () => await fn());
  }

  private withExecutionWaiterPermit<T>(fn: () => T | Promise<T>): Promise<T> {
    return this.executionWaiterSemaphore.withPermit(async () => await fn());
  }

  private async persistDurableMutation(): Promise<void> {
    await this.afterDurableMutation(this.captureDurableMutationSnapshot());
  }

  private async withSignalStateMutation<T>(
    fn: () => DurableMutationResult<T> | Promise<DurableMutationResult<T>>,
  ): Promise<T> {
    const { result, snapshot } = await this.withSignalStatePermit(async () => {
      const mutation = await fn();
      return {
        result: mutation.result,
        snapshot: mutation.changed
          ? this.captureDurableMutationSnapshot()
          : null,
      };
    });

    if (snapshot) {
      await this.afterDurableMutation(snapshot);
    }

    return result;
  }

  private async withExecutionWaiterMutation<T>(
    fn: () => DurableMutationResult<T> | Promise<DurableMutationResult<T>>,
  ): Promise<T> {
    const { result, snapshot } = await this.withExecutionWaiterPermit(
      async () => {
        const mutation = await fn();
        return {
          result: mutation.result,
          snapshot: mutation.changed
            ? this.captureDurableMutationSnapshot()
            : null,
        };
      },
    );

    if (snapshot) {
      await this.afterDurableMutation(snapshot);
    }

    return result;
  }

  private pruneExpiredLocks(now: number): void {
    for (const [resource, lock] of this.locks.entries()) {
      if (lock.expires <= now) {
        this.locks.delete(resource);
      }
    }
  }

  private getIdempotencyMapKey(
    workflowKey: string,
    idempotencyKey: string,
  ): string {
    return `${workflowKey}::${idempotencyKey}`;
  }

  async createExecutionWithIdempotencyKey(params: {
    execution: Execution;
    workflowKey: string;
    idempotencyKey: string;
  }): Promise<
    | { created: true; executionId: string }
    | { created: false; executionId: string }
  > {
    const key = this.getIdempotencyMapKey(
      params.workflowKey,
      params.idempotencyKey,
    );
    const existingExecutionId = this.executionIdByIdempotencyKey.get(key);
    if (existingExecutionId) {
      return { created: false, executionId: existingExecutionId };
    }

    this.executionIdByIdempotencyKey.set(key, params.execution.id);
    this.executions.set(params.execution.id, cloneExecution(params.execution));
    await this.persistDurableMutation();
    return { created: true, executionId: params.execution.id };
  }

  async saveExecution(execution: Execution): Promise<void> {
    this.executions.set(execution.id, cloneExecution(execution));
    await this.persistDurableMutation();
  }

  async saveExecutionIfStatus(
    execution: Execution,
    expectedStatuses: ExpectedExecutionStatuses,
  ): Promise<boolean> {
    const current = this.executions.get(execution.id);
    if (!current) return false;
    if (!expectedStatuses.includes(current.status)) return false;

    this.executions.set(execution.id, cloneExecution(execution));
    await this.persistDurableMutation();
    return true;
  }

  async getExecution(id: string): Promise<Execution | null> {
    const e = this.executions.get(id);
    return e ? cloneExecution(e) : null;
  }

  async updateExecution(
    id: string,
    updates: Partial<Execution>,
  ): Promise<void> {
    const e = this.executions.get(id);
    if (!e) return;
    this.executions.set(
      id,
      cloneExecution({ ...e, ...updates, updatedAt: new Date() }),
    );
    await this.persistDurableMutation();
  }

  async listIncompleteExecutions(): Promise<Execution[]> {
    return Array.from(this.executions.values())
      .filter(
        (e) =>
          e.status !== ExecutionStatus.Completed &&
          e.status !== ExecutionStatus.Failed &&
          e.status !== ExecutionStatus.CompensationFailed &&
          e.status !== ExecutionStatus.Cancelled,
      )
      .map(cloneExecution);
  }

  async listStuckExecutions(): Promise<Execution[]> {
    return Array.from(this.executions.values())
      .filter((e) => e.status === ExecutionStatus.CompensationFailed)
      .map(cloneExecution);
  }

  // Dashboard query API
  async listExecutions(
    options: ListExecutionsOptions = {},
  ): Promise<Execution[]> {
    let results = Array.from(this.executions.values());

    // Filter by status
    if (options.status && options.status.length > 0) {
      results = results.filter((e) => options.status!.includes(e.status));
    }

    // Filter by workflowKey
    if (options.workflowKey) {
      results = results.filter((e) => e.workflowKey === options.workflowKey);
    }

    // Sort by createdAt desc (most recent first)
    results.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    // Pagination
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 100;
    results = results.slice(offset, offset + limit);

    return results.map(cloneExecution);
  }

  async listStepResults(executionId: string): Promise<StepResult[]> {
    const results = this.stepResults.get(executionId);
    if (!results) return [];
    return Array.from(results.values())
      .sort(
        (a, b) =>
          new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime(),
      )
      .map((r) => ({ ...r }));
  }

  async appendAuditEntry(entry: DurableAuditEntry): Promise<void> {
    const list = this.auditEntries.get(entry.executionId) ?? [];
    list.push(cloneAuditEntry(entry));
    this.auditEntries.set(entry.executionId, list);
    await this.persistDurableMutation();
  }

  async listAuditEntries(
    executionId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<DurableAuditEntry[]> {
    const list = this.auditEntries.get(executionId) ?? [];
    const offset = options.offset ?? 0;
    const limit = options.limit ?? list.length;
    return list.slice(offset, offset + limit).map((entry) => ({ ...entry }));
  }

  // Operator API
  async retryRollback(executionId: string): Promise<void> {
    const e = this.executions.get(executionId);
    if (!e) return;
    this.executions.set(executionId, {
      ...e,
      status: ExecutionStatus.Pending,
      error: undefined,
      updatedAt: new Date(),
    });
    await this.persistDurableMutation();
  }

  async skipStep(executionId: string, stepId: string): Promise<void> {
    await this.saveStepResult({
      executionId,
      stepId,
      result: { skipped: true, manual: true },
      completedAt: new Date(),
    });
  }

  async forceFail(
    executionId: string,
    error: { message: string; stack?: string },
  ): Promise<void> {
    const e = this.executions.get(executionId);
    if (!e) return;
    this.executions.set(executionId, {
      ...e,
      status: ExecutionStatus.Failed,
      error,
      updatedAt: new Date(),
    });
    await this.persistDurableMutation();
  }

  async editStepResult(
    executionId: string,
    stepId: string,
    newResult: unknown,
  ): Promise<void> {
    await this.saveStepResult({
      executionId,
      stepId,
      result: newResult,
      completedAt: new Date(),
    });
  }

  async getStepResult(
    executionId: string,
    stepId: string,
  ): Promise<StepResult | null> {
    const results = this.stepResults.get(executionId);
    if (!results) return null;
    const r = results.get(stepId);
    return r ? { ...r } : null;
  }

  private setStepResult(result: StepResult): void {
    let results = this.stepResults.get(result.executionId);
    if (!results) {
      results = new Map();
      this.stepResults.set(result.executionId, results);
    }

    results.set(result.stepId, cloneStepResult(result));
  }

  async saveStepResult(result: StepResult): Promise<void> {
    this.setStepResult(result);
    await this.persistDurableMutation();
  }

  private getOrCreateSignalState(
    executionId: string,
    signalId: string,
  ): DurableSignalState {
    let executionSignals = this.signalStates.get(executionId);
    if (!executionSignals) {
      executionSignals = new Map();
      this.signalStates.set(executionId, executionSignals);
    }

    let signalState = executionSignals.get(signalId);
    if (!signalState) {
      signalState = createEmptySignalState(executionId, signalId);
      executionSignals.set(signalId, signalState);
    }

    return signalState;
  }

  async getSignalState(
    executionId: string,
    signalId: string,
  ): Promise<DurableSignalState | null> {
    return this.withSignalStatePermit(() => {
      const signalState = this.signalStates.get(executionId)?.get(signalId);
      if (!signalState) return null;

      return cloneSignalState(signalState);
    });
  }

  async appendSignalRecord(
    executionId: string,
    signalId: string,
    record: DurableSignalRecord,
  ): Promise<void> {
    await this.withSignalStateMutation(() => {
      const signalState = this.getOrCreateSignalState(executionId, signalId);
      signalState.history.push(cloneSignalRecord(record));
      return { result: undefined, changed: true };
    });
  }

  async bufferSignalRecord(
    executionId: string,
    signalId: string,
    record: DurableQueuedSignalRecord,
  ): Promise<void> {
    await this.withSignalStateMutation(() => {
      const signalState = this.getOrCreateSignalState(executionId, signalId);
      signalState.history.push(cloneSignalRecord(record));
      signalState.queued.push(cloneQueuedSignalRecord(record));
      return { result: undefined, changed: true };
    });
  }

  async enqueueQueuedSignalRecord(
    executionId: string,
    signalId: string,
    record: DurableQueuedSignalRecord,
  ): Promise<void> {
    await this.withSignalStateMutation(() => {
      const signalState = this.getOrCreateSignalState(executionId, signalId);
      signalState.queued.push(cloneQueuedSignalRecord(record));
      return { result: undefined, changed: true };
    });
  }

  async consumeQueuedSignalRecord(
    executionId: string,
    signalId: string,
  ): Promise<DurableSignalRecord | null> {
    return await this.withSignalStateMutation(() => {
      const signalState = this.signalStates.get(executionId)?.get(signalId);
      const record = signalState?.queued.shift();
      if (!record) {
        return { result: null, changed: false };
      }

      return {
        result: cloneSignalRecord(record),
        changed: true,
      };
    });
  }

  async consumeBufferedSignalForStep(
    stepResult: StepResult,
  ): Promise<DurableSignalRecord | null> {
    return await this.withSignalStateMutation(() => {
      const signalId = getSignalIdFromStepResult(stepResult);
      const signalState = this.signalStates
        .get(stepResult.executionId)
        ?.get(signalId);
      const record = signalState?.queued.shift();
      if (!record) {
        return { result: null, changed: false };
      }

      const nextResult =
        typeof stepResult.result === "object" && stepResult.result !== null
          ? {
              ...stepResult.result,
              payload: cloneSignalPayload(record.payload),
            }
          : stepResult.result;
      this.setStepResult({
        ...stepResult,
        result: nextResult,
      });
      return {
        result: cloneSignalRecord(record),
        changed: true,
      };
    });
  }

  private getOrCreateSignalWaiters(
    executionId: string,
    signalId: string,
  ): Map<string, DurableSignalWaiter> {
    let executionWaiters = this.signalWaiters.get(executionId);
    if (!executionWaiters) {
      executionWaiters = new Map();
      this.signalWaiters.set(executionId, executionWaiters);
    }

    let signalWaiters = executionWaiters.get(signalId);
    if (!signalWaiters) {
      signalWaiters = new Map();
      executionWaiters.set(signalId, signalWaiters);
    }

    return signalWaiters;
  }

  private pruneEmptySignalWaiterBuckets(
    executionId: string,
    signalId: string,
  ): void {
    const executionWaiters = this.signalWaiters.get(executionId)!;
    const signalWaiters = executionWaiters.get(signalId);
    if (signalWaiters && signalWaiters.size === 0) {
      executionWaiters.delete(signalId);
    }

    if (executionWaiters.size === 0) {
      this.signalWaiters.delete(executionId);
    }
  }

  private deleteSignalWaiterUnsafe(
    executionId: string,
    signalId: string,
    stepId: string,
  ): boolean {
    const signalWaiters = this.signalWaiters.get(executionId)?.get(signalId);
    if (!signalWaiters) return false;

    const changed = signalWaiters.delete(stepId);
    if (!changed) {
      return false;
    }
    this.pruneEmptySignalWaiterBuckets(executionId, signalId);
    return true;
  }

  async upsertSignalWaiter(waiter: DurableSignalWaiter): Promise<void> {
    await this.withSignalStateMutation(() => {
      const signalWaiters = this.getOrCreateSignalWaiters(
        waiter.executionId,
        waiter.signalId,
      );
      signalWaiters.set(waiter.stepId, cloneSignalWaiter(waiter));
      return { result: undefined, changed: true };
    });
  }

  private peekNextSignalWaiterUnsafe(
    executionId: string,
    signalId: string,
  ): DurableSignalWaiter | null {
    const signalWaiters = this.signalWaiters.get(executionId)?.get(signalId);
    if (!signalWaiters || signalWaiters.size === 0) return null;

    let nextWaiter: DurableSignalWaiter | null = null;
    for (const waiter of signalWaiters.values()) {
      if (
        nextWaiter === null ||
        waiter.sortKey.localeCompare(nextWaiter.sortKey) < 0
      ) {
        nextWaiter = waiter;
      }
    }

    return nextWaiter ? cloneSignalWaiter(nextWaiter) : null;
  }

  async peekNextSignalWaiter(
    executionId: string,
    signalId: string,
  ): Promise<DurableSignalWaiter | null> {
    return this.withSignalStatePermit(() =>
      this.peekNextSignalWaiterUnsafe(executionId, signalId),
    );
  }

  async commitSignalDelivery(params: {
    executionId: string;
    signalId: string;
    stepId: string;
    stepResult: StepResult;
    signalRecord: DurableSignalRecord;
    timerId?: string;
  }): Promise<boolean> {
    return await this.withSignalStateMutation(() => {
      const currentStep = this.stepResults
        .get(params.executionId)
        ?.get(params.stepId);
      if (!currentStep) {
        return { result: false, changed: false };
      }

      const signalState = parseSignalState(currentStep.result);
      if (
        signalState?.state !== "waiting" ||
        (signalState.signalId !== undefined &&
          signalState.signalId !== params.signalId)
      ) {
        return { result: false, changed: false };
      }

      const signalWaiters = this.signalWaiters
        .get(params.executionId)
        ?.get(params.signalId);
      if (!signalWaiters?.has(params.stepId)) {
        return { result: false, changed: false };
      }

      this.setStepResult(params.stepResult);
      this.getOrCreateSignalState(
        params.executionId,
        params.signalId,
      ).history.push(cloneSignalRecord(params.signalRecord));
      this.deleteSignalWaiterUnsafe(
        params.executionId,
        params.signalId,
        params.stepId,
      );

      if (params.timerId) {
        this.timers.delete(params.timerId);
      }

      return { result: true, changed: true };
    });
  }

  async takeNextSignalWaiter(
    executionId: string,
    signalId: string,
  ): Promise<DurableSignalWaiter | null> {
    return await this.withSignalStateMutation(() => {
      const nextWaiter = this.peekNextSignalWaiterUnsafe(executionId, signalId);
      if (!nextWaiter) {
        return { result: null, changed: false };
      }

      const signalWaiters = this.signalWaiters.get(executionId)?.get(signalId);
      if (!signalWaiters) {
        return { result: null, changed: false };
      }
      this.deleteSignalWaiterUnsafe(executionId, signalId, nextWaiter.stepId);

      return {
        result: cloneSignalWaiter(nextWaiter),
        changed: true,
      };
    });
  }

  async deleteSignalWaiter(
    executionId: string,
    signalId: string,
    stepId: string,
  ): Promise<void> {
    await this.withSignalStateMutation(() => {
      const changed = this.deleteSignalWaiterUnsafe(
        executionId,
        signalId,
        stepId,
      );
      return { result: undefined, changed };
    });
  }

  async upsertExecutionWaiter(waiter: DurableExecutionWaiter): Promise<void> {
    await this.withExecutionWaiterMutation(() => {
      const executionWaiters =
        this.executionWaiters.get(waiter.targetExecutionId) ?? new Map();
      executionWaiters.set(
        `${waiter.executionId}:${waiter.stepId}`,
        cloneExecutionWaiter(waiter),
      );
      this.executionWaiters.set(waiter.targetExecutionId, executionWaiters);
      return { result: undefined, changed: true };
    });
  }

  async listExecutionWaiters(
    targetExecutionId: string,
  ): Promise<DurableExecutionWaiter[]> {
    return await this.withExecutionWaiterPermit(() => {
      const waiters = this.executionWaiters.get(targetExecutionId);
      if (!waiters) return [];
      return Array.from(waiters.values()).map(cloneExecutionWaiter);
    });
  }

  async commitExecutionWaiterCompletion(params: {
    targetExecutionId: string;
    executionId: string;
    stepId: string;
    stepResult: StepResult;
    timerId?: string;
  }): Promise<boolean> {
    return await this.withExecutionWaiterMutation(() => {
      const waiterKey = `${params.executionId}:${params.stepId}`;
      const waiters = this.executionWaiters.get(params.targetExecutionId);
      if (!waiters?.has(waiterKey)) {
        return { result: false, changed: false };
      }

      const currentStep = this.stepResults
        .get(params.executionId)
        ?.get(params.stepId);
      if (!currentStep) {
        return { result: false, changed: false };
      }

      const waitState = parseExecutionWaitState(currentStep.result);
      if (
        waitState?.state !== "waiting" ||
        waitState.targetExecutionId !== params.targetExecutionId
      ) {
        return { result: false, changed: false };
      }

      this.setStepResult(params.stepResult);
      waiters.delete(waiterKey);
      if (waiters.size === 0) {
        this.executionWaiters.delete(params.targetExecutionId);
      }

      if (params.timerId) {
        this.timers.delete(params.timerId);
      }

      return { result: true, changed: true };
    });
  }

  private deleteExecutionWaiterUnsafe(
    targetExecutionId: string,
    executionId: string,
    stepId: string,
  ): boolean {
    const waiters = this.executionWaiters.get(targetExecutionId);
    if (!waiters) return false;

    const changed = waiters.delete(`${executionId}:${stepId}`);
    if (!changed) {
      return false;
    }

    if (waiters.size === 0) {
      this.executionWaiters.delete(targetExecutionId);
    }

    return true;
  }

  async deleteExecutionWaiter(
    targetExecutionId: string,
    executionId: string,
    stepId: string,
  ): Promise<void> {
    await this.withExecutionWaiterMutation(() => {
      const changed = this.deleteExecutionWaiterUnsafe(
        targetExecutionId,
        executionId,
        stepId,
      );
      return { result: undefined, changed };
    });
  }

  async createTimer(timer: Timer): Promise<void> {
    this.timers.set(timer.id, cloneTimer(timer));
    await this.persistDurableMutation();
  }

  private listReadyPendingTimers(now: Date): Timer[] {
    return Array.from(this.timers.values())
      .filter(
        (timer) => timer.status === TimerStatus.Pending && timer.fireAt <= now,
      )
      .sort(compareTimersByReadyOrder);
  }

  async getReadyTimers(now: Date = new Date()): Promise<Timer[]> {
    return this.listReadyPendingTimers(now).map((timer) => ({ ...timer }));
  }

  async claimReadyTimers(
    now: Date,
    limit: number,
    workerId: string,
    ttlMs: number,
  ): Promise<Timer[]> {
    if (limit <= 0) {
      return [];
    }

    const claimedTimers: Timer[] = [];

    for (const timer of this.listReadyPendingTimers(now)) {
      if (claimedTimers.length >= limit) {
        break;
      }

      const claimed = await this.claimTimer(timer.id, workerId, ttlMs);
      if (!claimed) {
        continue;
      }

      const current = this.timers.get(timer.id);
      if (
        !current ||
        current.status !== TimerStatus.Pending ||
        current.fireAt > now
      ) {
        await this.releaseTimerClaim(timer.id, workerId);
        continue;
      }

      claimedTimers.push({ ...current });
    }

    return claimedTimers;
  }

  async markTimerFired(timerId: string): Promise<void> {
    const t = this.timers.get(timerId);
    if (t) {
      this.timers.set(timerId, {
        ...t,
        status: TimerStatus.Fired,
      });
      await this.persistDurableMutation();
    }
  }

  async deleteTimer(timerId: string): Promise<void> {
    if (!this.timers.delete(timerId)) {
      return;
    }

    await this.persistDurableMutation();
  }

  async claimTimer(
    timerId: string,
    workerId: string,
    ttlMs: number,
  ): Promise<boolean> {
    const claimKey = `timer:claim:${timerId}`;
    const now = Date.now();
    this.pruneExpiredLocks(now);
    const existing = this.locks.get(claimKey);
    if (existing && existing.expires > now) {
      return false; // Already claimed by another worker
    }
    this.locks.set(claimKey, { id: workerId, expires: now + ttlMs });
    return true;
  }

  async renewTimerClaim(
    timerId: string,
    workerId: string,
    ttlMs: number,
  ): Promise<boolean> {
    const claimKey = `timer:claim:${timerId}`;
    const now = Date.now();
    this.pruneExpiredLocks(now);
    const existing = this.locks.get(claimKey);
    if (!existing) return false;
    if (existing.id !== workerId) return false;
    this.locks.set(claimKey, { id: workerId, expires: now + ttlMs });
    return true;
  }

  async releaseTimerClaim(timerId: string, workerId: string): Promise<boolean> {
    const claimKey = `timer:claim:${timerId}`;
    const now = Date.now();
    this.pruneExpiredLocks(now);
    const existing = this.locks.get(claimKey);
    if (!existing || existing.id !== workerId || existing.expires <= now) {
      return false;
    }

    this.locks.delete(claimKey);
    return true;
  }

  async finalizeClaimedTimer(
    timerId: string,
    workerId: string,
  ): Promise<boolean> {
    const claimKey = `timer:claim:${timerId}`;
    const now = Date.now();
    this.pruneExpiredLocks(now);
    const existing = this.locks.get(claimKey);
    if (!existing || existing.id !== workerId || existing.expires <= now) {
      return false;
    }

    const timer = this.timers.get(timerId);
    if (!timer) {
      this.locks.delete(claimKey);
      return true;
    }

    this.timers.delete(timerId);
    this.locks.delete(claimKey);
    await this.persistDurableMutation();
    return true;
  }

  async createSchedule(schedule: Schedule): Promise<void> {
    this.schedules.set(schedule.id, cloneSchedule(schedule));
    await this.persistDurableMutation();
  }

  async getSchedule(id: string): Promise<Schedule | null> {
    const s = this.schedules.get(id);
    return s ? { ...s } : null;
  }

  async updateSchedule(id: string, updates: Partial<Schedule>): Promise<void> {
    const s = this.schedules.get(id);
    if (!s) return;
    this.schedules.set(id, cloneSchedule({ ...s, ...updates }));
    await this.persistDurableMutation();
  }

  async saveScheduleWithTimer(schedule: Schedule, timer: Timer): Promise<void> {
    this.schedules.set(schedule.id, cloneSchedule(schedule));
    this.timers.set(timer.id, cloneTimer(timer));
    await this.persistDurableMutation();
  }

  async deleteSchedule(id: string): Promise<void> {
    if (!this.schedules.delete(id)) {
      return;
    }

    await this.persistDurableMutation();
  }

  async listSchedules(): Promise<Schedule[]> {
    return Array.from(this.schedules.values()).map((schedule) => ({
      ...schedule,
    }));
  }

  async listActiveSchedules(): Promise<Schedule[]> {
    return Array.from(this.schedules.values())
      .filter((s) => s.status === ScheduleStatus.Active)
      .map((schedule) => ({ ...schedule }));
  }

  async acquireLock(resource: string, ttlMs: number): Promise<string | null> {
    const now = Date.now();
    this.pruneExpiredLocks(now);
    const lock = this.locks.get(resource);
    if (lock && lock.expires > now) return null;
    const lockId = randomUUID();
    this.locks.set(resource, { id: lockId, expires: now + ttlMs });
    return lockId;
  }

  async renewLock(
    resource: string,
    lockId: string,
    ttlMs: number,
  ): Promise<boolean> {
    const now = Date.now();
    this.pruneExpiredLocks(now);

    const lock = this.locks.get(resource);
    if (!lock) return false;
    if (lock.id !== lockId) return false;

    this.locks.set(resource, { id: lockId, expires: now + ttlMs });
    return true;
  }

  async releaseLock(resource: string, lockId: string): Promise<void> {
    const lock = this.locks.get(resource);
    if (lock && lock.id === lockId) {
      this.locks.delete(resource);
    }
  }

  /**
   * Exports the current durable truth as a serializable snapshot.
   *
   * The snapshot excludes ephemeral lock ownership so rehydrated stores can
   * recover work without inheriting stale claims from prior processes.
   */
  exportSnapshot(): MemoryStoreSnapshot {
    return {
      version: 1,
      executions: Array.from(this.executions.values()).map(cloneExecution),
      executionIdByIdempotencyKey: Array.from(
        this.executionIdByIdempotencyKey.entries(),
      ),
      stepResults: Array.from(this.stepResults.values()).flatMap((results) =>
        Array.from(results.values()).map(cloneStepResult),
      ),
      signalStates: Array.from(this.signalStates.values()).flatMap((signals) =>
        Array.from(signals.values()).map(cloneSignalState),
      ),
      signalWaiters: Array.from(this.signalWaiters.values()).flatMap(
        (executionWaiters) =>
          Array.from(executionWaiters.values()).flatMap((signalWaiters) =>
            Array.from(signalWaiters.values()).map(cloneSignalWaiter),
          ),
      ),
      executionWaiters: Array.from(this.executionWaiters.values()).flatMap(
        (waiters) => Array.from(waiters.values()).map(cloneExecutionWaiter),
      ),
      auditEntries: Array.from(this.auditEntries.values()).flatMap((entries) =>
        entries.map(cloneAuditEntry),
      ),
      timers: Array.from(this.timers.values()).map(cloneTimer),
      schedules: Array.from(this.schedules.values()).map(cloneSchedule),
    };
  }

  /**
   * Replaces the current in-memory durable truth from a previously exported snapshot.
   *
   * Rehydration intentionally starts with a clean lock table so recovery and
   * polling can establish fresh ownership in the new process.
   */
  restoreSnapshot(snapshot: MemoryStoreSnapshot): void {
    this.executions = new Map(
      snapshot.executions.map((execution) => [
        execution.id,
        cloneExecution(execution),
      ]),
    );
    this.executionIdByIdempotencyKey = new Map(
      snapshot.executionIdByIdempotencyKey,
    );

    const stepResults = new Map<string, Map<string, StepResult>>();
    for (const result of snapshot.stepResults) {
      const executionResults = stepResults.get(result.executionId) ?? new Map();
      executionResults.set(result.stepId, cloneStepResult(result));
      stepResults.set(result.executionId, executionResults);
    }
    this.stepResults = stepResults;

    const signalStates = new Map<string, Map<string, DurableSignalState>>();
    for (const signalState of snapshot.signalStates) {
      const executionSignals =
        signalStates.get(signalState.executionId) ?? new Map();
      executionSignals.set(signalState.signalId, cloneSignalState(signalState));
      signalStates.set(signalState.executionId, executionSignals);
    }
    this.signalStates = signalStates;

    const signalWaiters = new Map<
      string,
      Map<string, Map<string, DurableSignalWaiter>>
    >();
    for (const waiter of snapshot.signalWaiters) {
      const executionWaiters =
        signalWaiters.get(waiter.executionId) ?? new Map();
      const signalBucket = executionWaiters.get(waiter.signalId) ?? new Map();
      signalBucket.set(waiter.stepId, cloneSignalWaiter(waiter));
      executionWaiters.set(waiter.signalId, signalBucket);
      signalWaiters.set(waiter.executionId, executionWaiters);
    }
    this.signalWaiters = signalWaiters;

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
    this.executionWaiters = executionWaiters;

    const auditEntries = new Map<string, DurableAuditEntry[]>();
    for (const entry of snapshot.auditEntries) {
      const executionEntries = auditEntries.get(entry.executionId) ?? [];
      executionEntries.push(cloneAuditEntry(entry));
      auditEntries.set(entry.executionId, executionEntries);
    }
    this.auditEntries = auditEntries;

    this.timers = new Map(
      snapshot.timers.map((timer) => [timer.id, cloneTimer(timer)]),
    );
    this.schedules = new Map(
      snapshot.schedules.map((schedule) => [
        schedule.id,
        cloneSchedule(schedule),
      ]),
    );
    this.locks = new Map();
  }
}
