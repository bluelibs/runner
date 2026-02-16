import {
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
} from "../core/interfaces/store";
import type { DurableAuditEntry } from "../core/audit";

export class MemoryStore implements IDurableStore {
  private executions = new Map<string, Execution>();
  private executionIdByIdempotencyKey = new Map<string, string>();
  private stepResults = new Map<string, Map<string, StepResult>>();
  private auditEntries = new Map<string, DurableAuditEntry[]>();
  private timers = new Map<string, Timer>();
  private schedules = new Map<string, Schedule>();
  private locks = new Map<string, { id: string; expires: number }>();

  private pruneExpiredLocks(now: number): void {
    for (const [resource, lock] of this.locks.entries()) {
      if (lock.expires <= now) {
        this.locks.delete(resource);
      }
    }
  }

  private getIdempotencyMapKey(taskId: string, idempotencyKey: string): string {
    return `${taskId}::${idempotencyKey}`;
  }

  async getExecutionIdByIdempotencyKey(params: {
    taskId: string;
    idempotencyKey: string;
  }): Promise<string | null> {
    return (
      this.executionIdByIdempotencyKey.get(
        this.getIdempotencyMapKey(params.taskId, params.idempotencyKey),
      ) ?? null
    );
  }

  async setExecutionIdByIdempotencyKey(params: {
    taskId: string;
    idempotencyKey: string;
    executionId: string;
  }): Promise<boolean> {
    const key = this.getIdempotencyMapKey(params.taskId, params.idempotencyKey);
    if (this.executionIdByIdempotencyKey.has(key)) return false;
    this.executionIdByIdempotencyKey.set(key, params.executionId);
    return true;
  }

  async saveExecution(execution: Execution): Promise<void> {
    this.executions.set(execution.id, { ...execution });
  }

  async getExecution(id: string): Promise<Execution | null> {
    const e = this.executions.get(id);
    return e ? { ...e } : null;
  }

  async updateExecution(
    id: string,
    updates: Partial<Execution>,
  ): Promise<void> {
    const e = this.executions.get(id);
    if (!e) return;
    this.executions.set(id, { ...e, ...updates, updatedAt: new Date() });
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
      .map((e) => ({ ...e }));
  }

  async listStuckExecutions(): Promise<Execution[]> {
    return Array.from(this.executions.values())
      .filter((e) => e.status === ExecutionStatus.CompensationFailed)
      .map((e) => ({ ...e }));
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

    // Filter by taskId
    if (options.taskId) {
      results = results.filter((e) => e.taskId === options.taskId);
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

    return results.map((e) => ({ ...e }));
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
    return list.slice(offset, offset + limit).map((e) => ({ ...e }));
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

  async saveStepResult(result: StepResult): Promise<void> {
    let results = this.stepResults.get(result.executionId);
    if (!results) {
      results = new Map();
      this.stepResults.set(result.executionId, results);
    }
    results.set(result.stepId, { ...result });
  }

  async createTimer(timer: Timer): Promise<void> {
    this.timers.set(timer.id, { ...timer });
  }

  async getReadyTimers(now: Date = new Date()): Promise<Timer[]> {
    return Array.from(this.timers.values())
      .filter((t) => t.status === TimerStatus.Pending && t.fireAt <= now)
      .map((t) => ({ ...t }));
  }

  async markTimerFired(timerId: string): Promise<void> {
    const t = this.timers.get(timerId);
    if (t) t.status = TimerStatus.Fired;
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

  async deleteSchedule(id: string): Promise<void> {
    this.schedules.delete(id);
  }

  async listSchedules(): Promise<Schedule[]> {
    return Array.from(this.schedules.values()).map((s) => ({ ...s }));
  }

  async listActiveSchedules(): Promise<Schedule[]> {
    return Array.from(this.schedules.values())
      .filter((s) => s.status === ScheduleStatus.Active)
      .map((s) => ({ ...s }));
  }

  async acquireLock(resource: string, ttlMs: number): Promise<string | null> {
    const now = Date.now();
    this.pruneExpiredLocks(now);
    const lock = this.locks.get(resource);
    if (lock && lock.expires > now) return null;
    const lockId = Math.random().toString(36).substring(2, 10);
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
