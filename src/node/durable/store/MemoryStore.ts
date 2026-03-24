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

const cloneSignalPayload = <TPayload>(payload: TPayload): TPayload =>
  structuredClone(payload);

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
  structuredClone(waiter);

const cloneExecutionWaiter = (
  waiter: DurableExecutionWaiter,
): DurableExecutionWaiter => structuredClone(waiter);

const cloneExecution = (execution: Execution): Execution =>
  structuredClone(execution);

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

  private withSignalStatePermit<T>(fn: () => T | Promise<T>): Promise<T> {
    return this.signalStateSemaphore.withPermit(async () => await fn());
  }

  private withExecutionWaiterPermit<T>(fn: () => T | Promise<T>): Promise<T> {
    return this.executionWaiterSemaphore.withPermit(async () => await fn());
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
    return { created: true, executionId: params.execution.id };
  }

  async saveExecution(execution: Execution): Promise<void> {
    this.executions.set(execution.id, cloneExecution(execution));
  }

  async saveExecutionIfStatus(
    execution: Execution,
    expectedStatuses: ExpectedExecutionStatuses,
  ): Promise<boolean> {
    const current = this.executions.get(execution.id);
    if (!current) return false;
    if (!expectedStatuses.includes(current.status)) return false;

    this.executions.set(execution.id, cloneExecution(execution));
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
    list.push({ ...entry });
    this.auditEntries.set(entry.executionId, list);
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

    results.set(result.stepId, { ...result });
  }

  async saveStepResult(result: StepResult): Promise<void> {
    this.setStepResult(result);
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
    await this.withSignalStatePermit(() => {
      const signalState = this.getOrCreateSignalState(executionId, signalId);
      signalState.history.push(cloneSignalRecord(record));
    });
  }

  async bufferSignalRecord(
    executionId: string,
    signalId: string,
    record: DurableQueuedSignalRecord,
  ): Promise<void> {
    await this.withSignalStatePermit(() => {
      const signalState = this.getOrCreateSignalState(executionId, signalId);
      signalState.history.push(cloneSignalRecord(record));
      signalState.queued.push(cloneQueuedSignalRecord(record));
    });
  }

  async enqueueQueuedSignalRecord(
    executionId: string,
    signalId: string,
    record: DurableQueuedSignalRecord,
  ): Promise<void> {
    await this.withSignalStatePermit(() => {
      const signalState = this.getOrCreateSignalState(executionId, signalId);
      signalState.queued.push(cloneQueuedSignalRecord(record));
    });
  }

  async consumeQueuedSignalRecord(
    executionId: string,
    signalId: string,
  ): Promise<DurableSignalRecord | null> {
    return this.withSignalStatePermit(() => {
      const signalState = this.signalStates.get(executionId)?.get(signalId);
      const record = signalState?.queued.shift();
      if (!record) return null;

      return cloneSignalRecord(record);
    });
  }

  async consumeBufferedSignalForStep(
    stepResult: StepResult,
  ): Promise<DurableSignalRecord | null> {
    return this.withSignalStatePermit(() => {
      const signalId = getSignalIdFromStepResult(stepResult);
      const signalState = this.signalStates
        .get(stepResult.executionId)
        ?.get(signalId);
      const record = signalState?.queued.shift();
      if (!record) {
        return null;
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
      return cloneSignalRecord(record);
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
  ): void {
    const signalWaiters = this.signalWaiters.get(executionId)?.get(signalId);
    if (!signalWaiters) return;

    signalWaiters.delete(stepId);
    this.pruneEmptySignalWaiterBuckets(executionId, signalId);
  }

  async upsertSignalWaiter(waiter: DurableSignalWaiter): Promise<void> {
    await this.withSignalStatePermit(() => {
      const signalWaiters = this.getOrCreateSignalWaiters(
        waiter.executionId,
        waiter.signalId,
      );
      signalWaiters.set(waiter.stepId, cloneSignalWaiter(waiter));
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
    return this.withSignalStatePermit(() => {
      const currentStep = this.stepResults
        .get(params.executionId)
        ?.get(params.stepId);
      if (!currentStep) {
        return false;
      }

      const signalState = parseSignalState(currentStep.result);
      if (
        signalState?.state !== "waiting" ||
        (signalState.signalId !== undefined &&
          signalState.signalId !== params.signalId)
      ) {
        return false;
      }

      const signalWaiters = this.signalWaiters
        .get(params.executionId)
        ?.get(params.signalId);
      if (!signalWaiters?.has(params.stepId)) {
        return false;
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

      return true;
    });
  }

  async takeNextSignalWaiter(
    executionId: string,
    signalId: string,
  ): Promise<DurableSignalWaiter | null> {
    return this.withSignalStatePermit(() => {
      const nextWaiter = this.peekNextSignalWaiterUnsafe(executionId, signalId);
      if (!nextWaiter) return null;

      const signalWaiters = this.signalWaiters.get(executionId)?.get(signalId);
      if (!signalWaiters) return null;
      this.deleteSignalWaiterUnsafe(executionId, signalId, nextWaiter.stepId);

      return cloneSignalWaiter(nextWaiter);
    });
  }

  async deleteSignalWaiter(
    executionId: string,
    signalId: string,
    stepId: string,
  ): Promise<void> {
    await this.withSignalStatePermit(() => {
      this.deleteSignalWaiterUnsafe(executionId, signalId, stepId);
    });
  }

  async upsertExecutionWaiter(waiter: DurableExecutionWaiter): Promise<void> {
    await this.withExecutionWaiterPermit(() => {
      const executionWaiters =
        this.executionWaiters.get(waiter.targetExecutionId) ?? new Map();
      executionWaiters.set(
        `${waiter.executionId}:${waiter.stepId}`,
        cloneExecutionWaiter(waiter),
      );
      this.executionWaiters.set(waiter.targetExecutionId, executionWaiters);
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
    return await this.withExecutionWaiterPermit(() => {
      const waiterKey = `${params.executionId}:${params.stepId}`;
      const waiters = this.executionWaiters.get(params.targetExecutionId);
      if (!waiters?.has(waiterKey)) {
        return false;
      }

      const currentStep = this.stepResults
        .get(params.executionId)
        ?.get(params.stepId);
      if (!currentStep) {
        return false;
      }

      const waitState = parseExecutionWaitState(currentStep.result);
      if (
        waitState?.state !== "waiting" ||
        waitState.targetExecutionId !== params.targetExecutionId
      ) {
        return false;
      }

      this.setStepResult(params.stepResult);
      waiters.delete(waiterKey);
      if (waiters.size === 0) {
        this.executionWaiters.delete(params.targetExecutionId);
      }

      if (params.timerId) {
        this.timers.delete(params.timerId);
      }

      return true;
    });
  }

  async deleteExecutionWaiter(
    targetExecutionId: string,
    executionId: string,
    stepId: string,
  ): Promise<void> {
    await this.withExecutionWaiterPermit(() => {
      const waiters = this.executionWaiters.get(targetExecutionId);
      if (!waiters) return;

      waiters.delete(`${executionId}:${stepId}`);
      if (waiters.size === 0) {
        this.executionWaiters.delete(targetExecutionId);
      }
    });
  }

  async createTimer(timer: Timer): Promise<void> {
    this.timers.set(timer.id, { ...timer });
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
    }
  }

  async deleteTimer(timerId: string): Promise<void> {
    this.timers.delete(timerId);
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
    if (timer) {
      this.timers.set(timerId, {
        ...timer,
        status: TimerStatus.Fired,
      });
    }
    this.timers.delete(timerId);
    this.locks.delete(claimKey);
    return true;
  }

  async createSchedule(schedule: Schedule): Promise<void> {
    this.schedules.set(schedule.id, { ...schedule });
  }

  async getSchedule(id: string): Promise<Schedule | null> {
    const s = this.schedules.get(id);
    return s ? { ...s } : null;
  }

  async updateSchedule(id: string, updates: Partial<Schedule>): Promise<void> {
    const s = this.schedules.get(id);
    if (!s) return;
    this.schedules.set(id, { ...s, ...updates });
  }

  async saveScheduleWithTimer(schedule: Schedule, timer: Timer): Promise<void> {
    this.schedules.set(schedule.id, { ...schedule });
    this.timers.set(timer.id, { ...timer });
  }

  async deleteSchedule(id: string): Promise<void> {
    this.schedules.delete(id);
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
}
