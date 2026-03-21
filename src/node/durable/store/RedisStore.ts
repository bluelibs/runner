import { createIORedisClient } from "../optionalDeps/ioredis";
import type {
  DurableQueuedSignalRecord,
  DurableSignalRecord,
  DurableSignalState,
  DurableSignalWaiter,
  Execution,
  Schedule,
  StepResult,
  Timer,
} from "../core/types";
import type {
  ExpectedExecutionStatuses,
  IDurableStore,
  ListExecutionsOptions,
} from "../core/interfaces/store";
import type { DurableAuditEntry } from "../core/audit";
import {
  RedisStoreRuntime,
  type RedisClient,
  type RedisPipeline,
  type RedisStoreConfig,
} from "./RedisStore.runtime";
import * as executionStateOps from "./RedisStore.executionState";
import * as executionViewOps from "./RedisStore.executionViews";
import * as signalStateOps from "./RedisStore.signalState";
import * as signalWaiterOps from "./RedisStore.signalWaiters";
import * as timerOps from "./RedisStore.timers";
import * as schedulingOps from "./RedisStore.scheduling";

export type { RedisClient, RedisPipeline, RedisStoreConfig };

export class RedisStore implements IDurableStore {
  private readonly runtime: RedisStoreRuntime;

  constructor(config: RedisStoreConfig) {
    const ownsRedisClient =
      typeof config.redis === "string" ||
      config.redis === undefined ||
      config.disposeProvidedClient === true;
    const redis =
      typeof config.redis === "string" || config.redis === undefined
        ? (createIORedisClient(config.redis) as RedisClient)
        : config.redis;

    this.runtime = new RedisStoreRuntime(
      redis,
      config.prefix || "durable:",
      ownsRedisClient,
    );
  }

  async createExecutionWithIdempotencyKey(params: {
    execution: Execution;
    taskId: string;
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

  async retryRollback(executionId: string): Promise<void> {
    await executionStateOps.retryRollback(this.runtime, executionId);
  }

  async skipStep(executionId: string, stepId: string): Promise<void> {
    await executionStateOps.skipStep(this.runtime, executionId, stepId);
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
    await executionStateOps.editStepResult(
      this.runtime,
      executionId,
      stepId,
      newResult,
    );
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

  async createTimer(timer: Timer): Promise<void> {
    await timerOps.createTimer(this.runtime, timer);
  }

  async getReadyTimers(now: Date = new Date()): Promise<Timer[]> {
    return await timerOps.getReadyTimers(this.runtime, now);
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

  async releaseLock(resource: string, lockId: string): Promise<void> {
    await schedulingOps.releaseLock(this.runtime, resource, lockId);
  }

  async renewLock(
    resource: string,
    lockId: string,
    ttlMs: number,
  ): Promise<boolean> {
    return await schedulingOps.renewLock(this.runtime, resource, lockId, ttlMs);
  }

  async dispose(): Promise<void> {
    if (this.runtime.ownsRedisClient) {
      await this.runtime.redis.quit();
    }
  }
}
