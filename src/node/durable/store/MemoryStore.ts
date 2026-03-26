import type { DurableAuditEntry } from "../core/audit";
import type {
  ExpectedExecutionStatuses,
  IDurableStore,
  ListExecutionsOptions,
} from "../core/interfaces/store";
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
} from "../core/types";
import { TimerStatus } from "../core/types";
import * as executionStateOps from "./memory-store/executionState";
import * as executionViewOps from "./memory-store/executionViews";
import * as executionWaiterOps from "./memory-store/executionWaiters";
import { MemoryStoreRuntime } from "./memory-store/runtime";
import * as schedulingOps from "./memory-store/scheduling";
import * as signalStateOps from "./memory-store/signalState";
import * as signalWaiterOps from "./memory-store/signalWaiters";
import * as snapshotOps from "./memory-store/snapshot";
import * as timerOps from "./memory-store/timers";
import type { MemoryStoreSnapshot } from "./memory-store/types";

export type { MemoryStoreSnapshot } from "./memory-store/types";

export class MemoryStore implements IDurableStore {
  private readonly runtime = new MemoryStoreRuntime({
    captureSnapshot: () => this.captureDurableMutationSnapshot(),
    afterDurableMutation: async (snapshot) =>
      await this.afterDurableMutation(snapshot),
  });

  protected get executions(): Map<string, Execution> {
    return this.runtime.executions;
  }

  protected set executions(value: Map<string, Execution>) {
    this.runtime.executions = value;
  }

  protected get executionIdByIdempotencyKey(): Map<string, string> {
    return this.runtime.executionIdByIdempotencyKey;
  }

  protected set executionIdByIdempotencyKey(value: Map<string, string>) {
    this.runtime.executionIdByIdempotencyKey = value;
  }

  protected get stepResults(): Map<string, Map<string, StepResult>> {
    return this.runtime.stepResults;
  }

  protected set stepResults(value: Map<string, Map<string, StepResult>>) {
    this.runtime.stepResults = value;
  }

  protected get signalStates(): Map<string, Map<string, DurableSignalState>> {
    return this.runtime.signalStates;
  }

  protected set signalStates(
    value: Map<string, Map<string, DurableSignalState>>,
  ) {
    this.runtime.signalStates = value;
  }

  protected get signalWaiters(): Map<
    string,
    Map<string, Map<string, DurableSignalWaiter>>
  > {
    return this.runtime.signalWaiters;
  }

  protected set signalWaiters(
    value: Map<string, Map<string, Map<string, DurableSignalWaiter>>>,
  ) {
    this.runtime.signalWaiters = value;
  }

  protected get executionWaiters(): Map<
    string,
    Map<string, DurableExecutionWaiter>
  > {
    return this.runtime.executionWaiters;
  }

  protected set executionWaiters(
    value: Map<string, Map<string, DurableExecutionWaiter>>,
  ) {
    this.runtime.executionWaiters = value;
  }

  protected get auditEntries(): Map<string, DurableAuditEntry[]> {
    return this.runtime.auditEntries;
  }

  protected set auditEntries(value: Map<string, DurableAuditEntry[]>) {
    this.runtime.auditEntries = value;
  }

  protected get timers(): Map<string, Timer> {
    return this.runtime.timers;
  }

  protected set timers(value: Map<string, Timer>) {
    this.runtime.timers = value;
  }

  protected get schedules(): Map<string, Schedule> {
    return this.runtime.schedules;
  }

  protected set schedules(value: Map<string, Schedule>) {
    this.runtime.schedules = value;
  }

  protected get locks(): Map<string, { id: string; expires: number }> {
    return this.runtime.locks;
  }

  protected set locks(value: Map<string, { id: string; expires: number }>) {
    this.runtime.locks = value;
  }

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

  async createExecutionWithIdempotencyKey(params: {
    execution: Execution;
    workflowKey: string;
    idempotencyKey: string;
  }): Promise<
    | { created: true; executionId: string }
    | { created: false; executionId: string }
  > {
    return await executionStateOps.createExecutionWithIdempotencyKey(
      this.runtime,
      params,
    );
  }

  async saveExecution(execution: Execution): Promise<void> {
    await executionStateOps.saveExecution(this.runtime, execution);
  }

  async saveExecutionIfStatus(
    execution: Execution,
    expectedStatuses: ExpectedExecutionStatuses,
  ): Promise<boolean> {
    return await executionStateOps.saveExecutionIfStatus(
      this.runtime,
      execution,
      expectedStatuses,
    );
  }

  async getExecution(id: string): Promise<Execution | null> {
    return await executionStateOps.getExecution(this.runtime, id);
  }

  async updateExecution(
    id: string,
    updates: Partial<Execution>,
  ): Promise<void> {
    await executionStateOps.updateExecution(this.runtime, id, updates);
  }

  async listIncompleteExecutions(): Promise<Execution[]> {
    return await executionStateOps.listIncompleteExecutions(this.runtime);
  }

  async listStuckExecutions(): Promise<Execution[]> {
    return await executionStateOps.listStuckExecutions(this.runtime);
  }

  async listExecutions(
    options: ListExecutionsOptions = {},
  ): Promise<Execution[]> {
    return await executionViewOps.listExecutions(this.runtime, options);
  }

  async listStepResults(executionId: string): Promise<StepResult[]> {
    return await executionViewOps.listStepResults(this.runtime, executionId);
  }

  async appendAuditEntry(entry: DurableAuditEntry): Promise<void> {
    await executionViewOps.appendAuditEntry(this.runtime, entry);
  }

  async listAuditEntries(
    executionId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<DurableAuditEntry[]> {
    return await executionViewOps.listAuditEntries(
      this.runtime,
      executionId,
      options,
    );
  }

  async retryRollback(executionId: string): Promise<void> {
    await executionStateOps.retryRollback(this.runtime, executionId);
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
    await executionStateOps.forceFail(this.runtime, executionId, error);
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
    return await executionViewOps.getStepResult(
      this.runtime,
      executionId,
      stepId,
    );
  }

  async saveStepResult(result: StepResult): Promise<void> {
    await executionViewOps.saveStepResult(this.runtime, result);
  }

  async getSignalState(
    executionId: string,
    signalId: string,
  ): Promise<DurableSignalState | null> {
    return await signalStateOps.getSignalState(
      this.runtime,
      executionId,
      signalId,
    );
  }

  async appendSignalRecord(
    executionId: string,
    signalId: string,
    record: DurableSignalRecord,
  ): Promise<void> {
    await signalStateOps.appendSignalRecord(
      this.runtime,
      executionId,
      signalId,
      record,
    );
  }

  async bufferSignalRecord(
    executionId: string,
    signalId: string,
    record: DurableQueuedSignalRecord,
  ): Promise<void> {
    await signalStateOps.bufferSignalRecord(
      this.runtime,
      executionId,
      signalId,
      record,
    );
  }

  async enqueueQueuedSignalRecord(
    executionId: string,
    signalId: string,
    record: DurableQueuedSignalRecord,
  ): Promise<void> {
    await signalStateOps.enqueueQueuedSignalRecord(
      this.runtime,
      executionId,
      signalId,
      record,
    );
  }

  async consumeQueuedSignalRecord(
    executionId: string,
    signalId: string,
  ): Promise<DurableSignalRecord | null> {
    return await signalStateOps.consumeQueuedSignalRecord(
      this.runtime,
      executionId,
      signalId,
    );
  }

  async consumeBufferedSignalForStep(
    stepResult: StepResult,
  ): Promise<DurableSignalRecord | null> {
    return await signalStateOps.consumeBufferedSignalForStep(
      this.runtime,
      stepResult,
    );
  }

  async upsertSignalWaiter(waiter: DurableSignalWaiter): Promise<void> {
    await signalWaiterOps.upsertSignalWaiter(this.runtime, waiter);
  }

  async peekNextSignalWaiter(
    executionId: string,
    signalId: string,
  ): Promise<DurableSignalWaiter | null> {
    return await signalWaiterOps.peekNextSignalWaiter(
      this.runtime,
      executionId,
      signalId,
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
    return await signalWaiterOps.commitSignalDelivery(this.runtime, params);
  }

  async takeNextSignalWaiter(
    executionId: string,
    signalId: string,
  ): Promise<DurableSignalWaiter | null> {
    return await signalWaiterOps.takeNextSignalWaiter(
      this.runtime,
      executionId,
      signalId,
    );
  }

  async deleteSignalWaiter(
    executionId: string,
    signalId: string,
    stepId: string,
  ): Promise<void> {
    await signalWaiterOps.deleteSignalWaiter(
      this.runtime,
      executionId,
      signalId,
      stepId,
    );
  }

  async upsertExecutionWaiter(waiter: DurableExecutionWaiter): Promise<void> {
    await executionWaiterOps.upsertExecutionWaiter(this.runtime, waiter);
  }

  async listExecutionWaiters(
    targetExecutionId: string,
  ): Promise<DurableExecutionWaiter[]> {
    return await executionWaiterOps.listExecutionWaiters(
      this.runtime,
      targetExecutionId,
    );
  }

  async commitExecutionWaiterCompletion(params: {
    targetExecutionId: string;
    executionId: string;
    stepId: string;
    stepResult: StepResult;
    timerId?: string;
  }): Promise<boolean> {
    return await executionWaiterOps.commitExecutionWaiterCompletion(
      this.runtime,
      params,
    );
  }

  async deleteExecutionWaiter(
    targetExecutionId: string,
    executionId: string,
    stepId: string,
  ): Promise<void> {
    await executionWaiterOps.deleteExecutionWaiter(
      this.runtime,
      targetExecutionId,
      executionId,
      stepId,
    );
  }

  async createTimer(timer: Timer): Promise<void> {
    await timerOps.createTimer(this.runtime, timer);
  }

  async getReadyTimers(now: Date = new Date()): Promise<Timer[]> {
    return await timerOps.getReadyTimers(this.runtime, now);
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
    for (const timer of await timerOps.getReadyTimers(this.runtime, now)) {
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
    await timerOps.markTimerFired(this.runtime, timerId);
  }

  async deleteTimer(timerId: string): Promise<void> {
    await timerOps.deleteTimer(this.runtime, timerId);
  }

  async claimTimer(
    timerId: string,
    workerId: string,
    ttlMs: number,
  ): Promise<boolean> {
    return await timerOps.claimTimer(this.runtime, timerId, workerId, ttlMs);
  }

  async renewTimerClaim(
    timerId: string,
    workerId: string,
    ttlMs: number,
  ): Promise<boolean> {
    return await timerOps.renewTimerClaim(
      this.runtime,
      timerId,
      workerId,
      ttlMs,
    );
  }

  async releaseTimerClaim(timerId: string, workerId: string): Promise<boolean> {
    return await timerOps.releaseTimerClaim(this.runtime, timerId, workerId);
  }

  async finalizeClaimedTimer(
    timerId: string,
    workerId: string,
  ): Promise<boolean> {
    return await timerOps.finalizeClaimedTimer(this.runtime, timerId, workerId);
  }

  async createSchedule(schedule: Schedule): Promise<void> {
    await schedulingOps.createSchedule(this.runtime, schedule);
  }

  async getSchedule(id: string): Promise<Schedule | null> {
    return await schedulingOps.getSchedule(this.runtime, id);
  }

  async updateSchedule(id: string, updates: Partial<Schedule>): Promise<void> {
    await schedulingOps.updateSchedule(this.runtime, id, updates);
  }

  async saveScheduleWithTimer(schedule: Schedule, timer: Timer): Promise<void> {
    await schedulingOps.saveScheduleWithTimer(this.runtime, schedule, timer);
  }

  async deleteSchedule(id: string): Promise<void> {
    await schedulingOps.deleteSchedule(this.runtime, id);
  }

  async listSchedules(): Promise<Schedule[]> {
    return await schedulingOps.listSchedules(this.runtime);
  }

  async listActiveSchedules(): Promise<Schedule[]> {
    return await schedulingOps.listActiveSchedules(this.runtime);
  }

  async acquireLock(resource: string, ttlMs: number): Promise<string | null> {
    return await schedulingOps.acquireLock(this.runtime, resource, ttlMs);
  }

  async renewLock(
    resource: string,
    lockId: string,
    ttlMs: number,
  ): Promise<boolean> {
    return await schedulingOps.renewLock(this.runtime, resource, lockId, ttlMs);
  }

  async releaseLock(resource: string, lockId: string): Promise<void> {
    await schedulingOps.releaseLock(this.runtime, resource, lockId);
  }

  /**
   * Exports the current durable truth as a serializable snapshot.
   *
   * The snapshot excludes ephemeral lock ownership so rehydrated stores can
   * recover work without inheriting stale claims from prior processes.
   */
  exportSnapshot(): MemoryStoreSnapshot {
    return snapshotOps.exportSnapshot(this.runtime);
  }

  /**
   * Replaces the current in-memory durable truth from a previously exported snapshot.
   *
   * Rehydration intentionally starts with a clean lock table so recovery and
   * polling can establish fresh ownership in the new process.
   */
  restoreSnapshot(snapshot: MemoryStoreSnapshot): void {
    snapshotOps.restoreSnapshot(this.runtime, snapshot);
  }
}
