import type {
  ExpectedExecutionStatuses,
  IDurableStore,
  ListExecutionsOptions,
  ScheduleUpdate,
} from "../../core/interfaces/store";
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
import { createTieredCapabilities } from "./tieredCapabilities";
import {
  listStepResultsThroughTiers,
  readExecutionThroughTiers,
  readSignalStateThroughTiers,
  readStepResultThroughTiers,
} from "./tieredReads";
import type { TieredDurableStoreConfig } from "./tieredTypes";

/**
 * One uniform durable store backed by a hot (live) and a cold (archive)
 * tier, both plain `IDurableStore` implementations.
 *
 * Routing rules:
 * - All writes, timers, schedules, locks, waiters, live signal operations,
 *   and listings stay on hot. Hot owns live state.
 * - Execution, step, audit, and signal-journal reads consult cold only for
 *   executions unknown to hot, so live traffic never pays for cold reads.
 * - Operator mutations restore archived executions to hot first, so recovery
 *   tooling keeps working after archival without knowing about tiers.
 * - Optional capabilities mirror hot exactly (`undefined` stays `undefined`),
 *   except audit/signal reads which exist when either tier supports them.
 */
export class TieredDurableStore implements IDurableStore {
  private readonly hot: IDurableStore;
  private readonly cold: IDurableStore;

  // Optional capabilities, conditionally assigned from
  // `createTieredCapabilities` so `undefined` stays observable as `undefined`.
  // Indexed access keeps signatures declared once, in `IDurableStore`.
  appendAuditEntry?: IDurableStore["appendAuditEntry"];
  listAuditEntries?: IDurableStore["listAuditEntries"];
  retryRollback?: IDurableStore["retryRollback"];
  skipStep?: IDurableStore["skipStep"];
  forceFail?: IDurableStore["forceFail"];
  editStepResult?: IDurableStore["editStepResult"];
  listSignalStates?: IDurableStore["listSignalStates"];
  commitSignalDelivery?: IDurableStore["commitSignalDelivery"];
  commitExecutionWaiterCompletion?: IDurableStore["commitExecutionWaiterCompletion"];
  claimTimer?: IDurableStore["claimTimer"];
  renewTimerClaim?: IDurableStore["renewTimerClaim"];
  releaseTimerClaim?: IDurableStore["releaseTimerClaim"];
  finalizeClaimedTimer?: IDurableStore["finalizeClaimedTimer"];
  listStuckExecutions?: IDurableStore["listStuckExecutions"];
  init?: IDurableStore["init"];
  dispose?: IDurableStore["dispose"];
  acquireLock?: IDurableStore["acquireLock"];
  renewLock?: IDurableStore["renewLock"];
  releaseLock?: IDurableStore["releaseLock"];

  constructor(config: TieredDurableStoreConfig) {
    this.hot = config.hot;
    this.cold = config.cold;
    Object.assign(this, createTieredCapabilities(config.hot, config.cold));
  }

  async saveExecution(execution: Execution): Promise<void> {
    await this.hot.saveExecution(execution);
  }

  async saveExecutionIfStatus(
    execution: Execution,
    expectedStatuses: ExpectedExecutionStatuses,
  ): Promise<boolean> {
    return await this.hot.saveExecutionIfStatus(execution, expectedStatuses);
  }

  async getExecution(id: string): Promise<Execution | null> {
    return await readExecutionThroughTiers(this.hot, this.cold, id);
  }

  async updateExecution(
    id: string,
    updates: Partial<Execution>,
  ): Promise<void> {
    await this.hot.updateExecution(id, updates);
  }

  async listIncompleteExecutions(): Promise<Execution[]> {
    return await this.hot.listIncompleteExecutions();
  }

  async createExecutionWithIdempotencyKey(params: {
    execution: Execution;
    workflowKey: string;
    idempotencyKey: string;
  }): Promise<
    | { created: true; executionId: string }
    | { created: false; executionId: string }
  > {
    return await this.hot.createExecutionWithIdempotencyKey(params);
  }

  async listExecutions(options?: ListExecutionsOptions): Promise<Execution[]> {
    return await this.hot.listExecutions(options);
  }

  async listStepResults(executionId: string): Promise<StepResult[]> {
    return await listStepResultsThroughTiers(this.hot, this.cold, executionId);
  }

  async getStepResult(
    executionId: string,
    stepId: string,
  ): Promise<StepResult | null> {
    return await readStepResultThroughTiers(
      this.hot,
      this.cold,
      executionId,
      stepId,
    );
  }

  async saveStepResult(result: StepResult): Promise<void> {
    await this.hot.saveStepResult(result);
  }

  async getSignalState(
    executionId: string,
    signalId: string,
  ): Promise<DurableSignalState | null> {
    return await readSignalStateThroughTiers(
      this.hot,
      this.cold,
      executionId,
      signalId,
    );
  }

  async appendSignalRecord(
    executionId: string,
    signalId: string,
    record: DurableSignalRecord,
  ): Promise<void> {
    await this.hot.appendSignalRecord(executionId, signalId, record);
  }

  async bufferSignalRecord(
    executionId: string,
    signalId: string,
    record: DurableQueuedSignalRecord,
  ): Promise<void> {
    await this.hot.bufferSignalRecord(executionId, signalId, record);
  }

  async enqueueQueuedSignalRecord(
    executionId: string,
    signalId: string,
    record: DurableQueuedSignalRecord,
  ): Promise<void> {
    await this.hot.enqueueQueuedSignalRecord(executionId, signalId, record);
  }

  async consumeQueuedSignalRecord(
    executionId: string,
    signalId: string,
  ): Promise<DurableSignalRecord | null> {
    return await this.hot.consumeQueuedSignalRecord(executionId, signalId);
  }

  async consumeBufferedSignalForStep(
    stepResult: StepResult,
  ): Promise<DurableSignalRecord | null> {
    return await this.hot.consumeBufferedSignalForStep(stepResult);
  }

  async upsertSignalWaiter(waiter: DurableSignalWaiter): Promise<void> {
    await this.hot.upsertSignalWaiter(waiter);
  }

  async peekNextSignalWaiter(
    executionId: string,
    signalId: string,
  ): Promise<DurableSignalWaiter | null> {
    return await this.hot.peekNextSignalWaiter(executionId, signalId);
  }

  async takeNextSignalWaiter(
    executionId: string,
    signalId: string,
  ): Promise<DurableSignalWaiter | null> {
    return await this.hot.takeNextSignalWaiter(executionId, signalId);
  }

  async deleteSignalWaiter(
    executionId: string,
    signalId: string,
    stepId: string,
  ): Promise<void> {
    await this.hot.deleteSignalWaiter(executionId, signalId, stepId);
  }

  async upsertExecutionWaiter(waiter: DurableExecutionWaiter): Promise<void> {
    await this.hot.upsertExecutionWaiter(waiter);
  }

  async listExecutionWaiters(
    targetExecutionId: string,
  ): Promise<DurableExecutionWaiter[]> {
    return await this.hot.listExecutionWaiters(targetExecutionId);
  }

  async deleteExecutionWaiter(
    targetExecutionId: string,
    executionId: string,
    stepId: string,
  ): Promise<void> {
    await this.hot.deleteExecutionWaiter(
      targetExecutionId,
      executionId,
      stepId,
    );
  }

  async createTimer(timer: Timer): Promise<void> {
    await this.hot.createTimer(timer);
  }

  async getReadyTimers(now?: Date): Promise<Timer[]> {
    return await this.hot.getReadyTimers(now);
  }

  async claimReadyTimers(
    now: Date,
    limit: number,
    workerId: string,
    ttlMs: number,
  ): Promise<Timer[]> {
    return await this.hot.claimReadyTimers(now, limit, workerId, ttlMs);
  }

  async markTimerFired(timerId: string): Promise<void> {
    await this.hot.markTimerFired(timerId);
  }

  async deleteTimer(timerId: string): Promise<void> {
    await this.hot.deleteTimer(timerId);
  }

  async createSchedule(schedule: Schedule): Promise<void> {
    await this.hot.createSchedule(schedule);
  }

  async getSchedule(id: string): Promise<Schedule | null> {
    return await this.hot.getSchedule(id);
  }

  async updateSchedule(id: string, updates: ScheduleUpdate): Promise<void> {
    await this.hot.updateSchedule(id, updates);
  }

  async saveScheduleWithTimer(schedule: Schedule, timer: Timer): Promise<void> {
    await this.hot.saveScheduleWithTimer(schedule, timer);
  }

  async deleteSchedule(id: string): Promise<void> {
    await this.hot.deleteSchedule(id);
  }

  async listSchedules(): Promise<Schedule[]> {
    return await this.hot.listSchedules();
  }

  async listActiveSchedules(): Promise<Schedule[]> {
    return await this.hot.listActiveSchedules();
  }
}
