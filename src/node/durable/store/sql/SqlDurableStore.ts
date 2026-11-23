import type { DurableExecutionOwnership } from "../../core/interfaces/ownership";
import type {
  IDurableStore,
  ScheduleUpdate,
} from "../../core/interfaces/store";
import type {
  DurableExecutionWaiter,
  DurableQueuedSignalRecord,
  DurableSignalRecord,
  DurableSignalState,
  DurableSignalWaiter,
  Schedule,
  StepResult,
  Timer,
} from "../../core/types";
import { scopeExecutionStore } from "../ownership";
import * as waiterOps from "./executionWaiters";
import * as lockOps from "./locks";
import * as scheduleOps from "./scheduling";
import * as signalStateOps from "./signalState";
import * as signalWaiterOps from "./signalWaiters";
import { SqlDurableStoreBase } from "./SqlDurableStoreBase";
import * as timerOps from "./timers";

/** Shared SQL implementation backing both SQLite and PostgreSQL durable stores. */
export class SqlDurableStore
  extends SqlDurableStoreBase
  implements IDurableStore
{
  withExecutionOwnership(ownership: DurableExecutionOwnership): IDurableStore {
    return scopeExecutionStore(this, (operation) =>
      this.runtime.withOwnership(ownership, operation),
    );
  }

  async getSignalState(
    executionId: string,
    signalId: string,
  ): Promise<DurableSignalState | null> {
    return signalStateOps.getSignalState(this.runtime, executionId, signalId);
  }

  async listSignalStates(executionId: string): Promise<DurableSignalState[]> {
    return signalStateOps.listSignalStates(this.runtime, executionId);
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
    return signalStateOps.consumeQueuedSignalRecord(
      this.runtime,
      executionId,
      signalId,
    );
  }

  async consumeBufferedSignalForStep(
    stepResult: StepResult,
  ): Promise<DurableSignalRecord | null> {
    return signalStateOps.consumeBufferedSignalForStep(
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
    return signalWaiterOps.peekNextSignalWaiter(
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
    return signalWaiterOps.commitSignalDelivery(this.runtime, params);
  }

  async takeNextSignalWaiter(
    executionId: string,
    signalId: string,
  ): Promise<DurableSignalWaiter | null> {
    return signalWaiterOps.takeNextSignalWaiter(
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
    await waiterOps.upsertExecutionWaiter(this.runtime, waiter);
  }

  async listExecutionWaiters(
    targetExecutionId: string,
  ): Promise<DurableExecutionWaiter[]> {
    return waiterOps.listExecutionWaiters(this.runtime, targetExecutionId);
  }

  async commitExecutionWaiterCompletion(params: {
    targetExecutionId: string;
    executionId: string;
    stepId: string;
    stepResult: StepResult;
    timerId?: string;
    waitTargetExecutionId?: string;
  }): Promise<boolean> {
    return waiterOps.commitExecutionWaiterCompletion(this.runtime, params);
  }

  async deleteExecutionWaiter(
    targetExecutionId: string,
    executionId: string,
    stepId: string,
  ): Promise<void> {
    await waiterOps.deleteExecutionWaiter(
      this.runtime,
      targetExecutionId,
      executionId,
      stepId,
    );
  }

  async createTimer(timer: Timer): Promise<void> {
    await timerOps.createTimer(this.runtime, timer);
  }

  async getReadyTimers(now?: Date): Promise<Timer[]> {
    return timerOps.getReadyTimers(this.runtime, now);
  }

  async claimReadyTimers(
    now: Date,
    limit: number,
    workerId: string,
    ttlMs: number,
  ): Promise<Timer[]> {
    return this.runtime.withoutOwnership(() =>
      timerOps.claimReadyTimers(this.runtime, now, limit, workerId, ttlMs),
    );
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
    return timerOps.claimTimer(this.runtime, timerId, workerId, ttlMs);
  }

  async renewTimerClaim(
    timerId: string,
    workerId: string,
    ttlMs: number,
  ): Promise<boolean> {
    return timerOps.renewTimerClaim(this.runtime, timerId, workerId, ttlMs);
  }

  async releaseTimerClaim(timerId: string, workerId: string): Promise<boolean> {
    return timerOps.releaseTimerClaim(this.runtime, timerId, workerId);
  }

  async finalizeClaimedTimer(
    timerId: string,
    workerId: string,
  ): Promise<boolean> {
    return timerOps.finalizeClaimedTimer(this.runtime, timerId, workerId);
  }

  async createSchedule(schedule: Schedule): Promise<void> {
    await scheduleOps.createSchedule(this.runtime, schedule);
  }

  async getSchedule(id: string): Promise<Schedule | null> {
    return scheduleOps.getSchedule(this.runtime, id);
  }

  async updateSchedule(id: string, updates: ScheduleUpdate): Promise<void> {
    await scheduleOps.updateSchedule(this.runtime, id, updates);
  }

  async saveScheduleWithTimer(schedule: Schedule, timer: Timer): Promise<void> {
    await scheduleOps.saveScheduleWithTimer(this.runtime, schedule, timer);
  }

  async deleteSchedule(id: string): Promise<void> {
    await scheduleOps.deleteSchedule(this.runtime, id);
  }

  async listSchedules(): Promise<Schedule[]> {
    return scheduleOps.listSchedules(this.runtime);
  }

  async listActiveSchedules(): Promise<Schedule[]> {
    return scheduleOps.listActiveSchedules(this.runtime);
  }

  async acquireLock(resource: string, ttlMs: number): Promise<string | null> {
    return this.runtime.withoutOwnership(() =>
      lockOps.acquireLock(this.runtime, resource, ttlMs),
    );
  }

  async renewLock(
    resource: string,
    lockId: string,
    ttlMs: number,
  ): Promise<boolean> {
    return this.runtime.withoutOwnership(() =>
      lockOps.renewLock(this.runtime, resource, lockId, ttlMs),
    );
  }

  async releaseLock(resource: string, lockId: string): Promise<void> {
    await this.runtime.withoutOwnership(() =>
      lockOps.releaseLock(this.runtime, resource, lockId),
    );
  }
}
