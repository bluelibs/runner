import * as crypto from "node:crypto";
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
import { Serializer } from "../../../serializer";
import {
  createDurableAuditEntryId,
  type DurableAuditEntry,
} from "../core/audit";
import { createIORedisClient } from "../optionalDeps/ioredis";
import { durableStoreShapeError } from "../../../errors";

const serializer = new Serializer();

export interface RedisPipeline {
  get(key: string): RedisPipeline;
  hget(hash: string, key: string): RedisPipeline;
  exec(): Promise<Array<[unknown, unknown]> | null>;
}

export interface RedisClient {
  set(...args: unknown[]): Promise<unknown>;
  get(...args: unknown[]): Promise<unknown>;
  scan(...args: unknown[]): Promise<unknown>;
  sscan(...args: unknown[]): Promise<unknown>;
  sadd(...args: unknown[]): Promise<unknown>;
  srem(...args: unknown[]): Promise<unknown>;
  keys?(...args: unknown[]): Promise<unknown>;
  pipeline(): RedisPipeline;

  hset(...args: unknown[]): Promise<unknown>;
  hget(...args: unknown[]): Promise<unknown>;
  hdel(...args: unknown[]): Promise<unknown>;
  hgetall(...args: unknown[]): Promise<unknown>;

  zadd(...args: unknown[]): Promise<unknown>;
  zrangebyscore(...args: unknown[]): Promise<unknown>;
  zrem(...args: unknown[]): Promise<unknown>;

  eval(...args: unknown[]): Promise<unknown>;
  quit(...args: unknown[]): Promise<unknown>;
}

export interface RedisStoreConfig {
  prefix?: string;
  redis?: RedisClient | string;
}

export class RedisStore implements IDurableStore {
  private redis: RedisClient;
  private prefix: string;

  constructor(config: RedisStoreConfig) {
    this.redis =
      typeof config.redis === "string" || config.redis === undefined
        ? (createIORedisClient(config.redis) as RedisClient)
        : config.redis;
    this.prefix = config.prefix || "durable:";
  }

  private k(key: string): string {
    return `${this.prefix}${key}`;
  }

  private encodeKeyPart(value: string): string {
    return encodeURIComponent(value);
  }

  async getExecutionIdByIdempotencyKey(params: {
    taskId: string;
    idempotencyKey: string;
  }): Promise<string | null> {
    const key = this.k(
      `idem:${this.encodeKeyPart(params.taskId)}:${this.encodeKeyPart(params.idempotencyKey)}`,
    );
    const res = await this.redis.get(key);
    return typeof res === "string" ? res : null;
  }

  async setExecutionIdByIdempotencyKey(params: {
    taskId: string;
    idempotencyKey: string;
    executionId: string;
  }): Promise<boolean> {
    const key = this.k(
      `idem:${this.encodeKeyPart(params.taskId)}:${this.encodeKeyPart(params.idempotencyKey)}`,
    );
    const res = await this.redis.set(key, params.executionId, "NX");
    return res === "OK";
  }

  private parseRedisString(value: unknown): string | null {
    return typeof value === "string" ? value : null;
  }

  private parseScanResponse(value: unknown): [string, string[]] | null {
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [cursor, keys] = value;
    if (typeof cursor !== "string") return null;
    if (!Array.isArray(keys) || !keys.every((k) => typeof k === "string"))
      return null;
    return [cursor, keys];
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = "0";
    do {
      const scanned = await this.redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100,
      );
      const parsed = this.parseScanResponse(scanned);
      if (!parsed) {
        durableStoreShapeError.throw({
          message: "Unexpected Redis SCAN response shape",
        });
      }
      const [newCursor, scannedKeys] = parsed!;
      cursor = newCursor;
      keys.push(...scannedKeys);
    } while (cursor !== "0");
    return keys;
  }

  private async scanSetMembers(setKey: string): Promise<string[]> {
    const members: string[] = [];
    let cursor = "0";
    do {
      const scanned = await this.redis.sscan(setKey, cursor, "COUNT", 100);
      const parsed = this.parseScanResponse(scanned);
      if (!parsed) {
        durableStoreShapeError.throw({
          message: "Unexpected Redis SSCAN response shape",
        });
      }
      const [newCursor, scannedMembers] = parsed!;
      cursor = newCursor;
      members.push(...scannedMembers);
    } while (cursor !== "0");
    return members;
  }

  private activeExecutionsKey(): string {
    return this.k("active_executions");
  }

  private isActiveExecutionStatus(status: ExecutionStatus): boolean {
    return (
      status !== ExecutionStatus.Completed &&
      status !== ExecutionStatus.Failed &&
      status !== ExecutionStatus.CompensationFailed &&
      status !== ExecutionStatus.Cancelled
    );
  }

  private async updateActiveExecutionMembership(
    executionId: string,
    status: ExecutionStatus,
  ): Promise<void> {
    const key = this.activeExecutionsKey();
    if (this.isActiveExecutionStatus(status)) {
      await this.redis.sadd(key, executionId);
      return;
    }

    await this.redis.srem(key, executionId);
  }

  async saveExecution(execution: Execution): Promise<void> {
    await this.redis.set(
      this.k(`exec:${execution.id}`),
      serializer.stringify(execution),
    );
    await this.updateActiveExecutionMembership(execution.id, execution.status);
  }

  async getExecution(id: string): Promise<Execution | null> {
    const data = this.parseRedisString(
      await this.redis.get(this.k(`exec:${id}`)),
    );
    return data ? (serializer.parse(data) as Execution) : null;
  }

  async updateExecution(
    id: string,
    updates: Partial<Execution>,
  ): Promise<void> {
    const key = this.k(`exec:${id}`);
    const updatesWithTime = { ...updates, updatedAt: new Date() };
    const updatesStr = serializer.stringify(updatesWithTime);

    const script = `
      local current = redis.call("get", KEYS[1])
      if not current then return nil end
      
      local data = cjson.decode(current)
      local upd = cjson.decode(ARGV[1])
      
      for k, v in pairs(upd) do
        data[k] = v
      end
      
      local result = cjson.encode(data)
      redis.call("set", KEYS[1], result)
      return "OK"
    `;

    const updated = await this.redis.eval(script, 1, key, updatesStr);

    if (updated === "OK" && updates.status) {
      await this.updateActiveExecutionMembership(id, updates.status);
    }
  }

  async listIncompleteExecutions(): Promise<Execution[]> {
    const activeIds = await this.scanSetMembers(this.activeExecutionsKey());
    if (activeIds.length === 0) return [];
    const pipeline = this.redis.pipeline();
    activeIds.forEach((id) => pipeline.get(this.k(`exec:${id}`)));
    const results = await pipeline.exec();
    if (!results) return [];

    const staleIds: string[] = [];
    const executions = results
      .map(([_, res]) =>
        typeof res === "string" ? (serializer.parse(res) as Execution) : null,
      )
      .filter(
        (e): e is Execution =>
          e !== null && this.isActiveExecutionStatus(e.status),
      );

    for (let i = 0; i < activeIds.length; i += 1) {
      const raw = results[i]?.[1];
      if (typeof raw !== "string") {
        staleIds.push(activeIds[i]);
        continue;
      }
      const execution = serializer.parse(raw) as Execution;
      if (!this.isActiveExecutionStatus(execution.status)) {
        staleIds.push(activeIds[i]);
      }
    }

    if (staleIds.length > 0) {
      try {
        await this.redis.srem(this.activeExecutionsKey(), ...staleIds);
      } catch {
        // Best-effort cleanup; ignore.
      }
    }

    return executions;
  }

  async listStuckExecutions(): Promise<Execution[]> {
    const keys = await this.scanKeys(this.k("exec:*"));
    if (keys.length === 0) return [];

    const pipeline = this.redis.pipeline();
    keys.forEach((k: string) => pipeline.get(k));
    const results = await pipeline.exec();

    return (results || [])
      .map(([_, res]) =>
        typeof res === "string" ? (serializer.parse(res) as Execution) : null,
      )
      .filter(
        (e): e is Execution =>
          e !== null && e.status === ExecutionStatus.CompensationFailed,
      );
  }

  // Operator API
  async retryRollback(executionId: string): Promise<void> {
    const execution = await this.getExecution(executionId);
    if (!execution) return;

    await this.saveExecution({
      ...execution,
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
    await this.updateExecution(executionId, {
      status: ExecutionStatus.Failed,
      error,
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

  // Dashboard API
  async listExecutions(
    options: ListExecutionsOptions = {},
  ): Promise<Execution[]> {
    const keys = await this.scanKeys(this.k("exec:*"));
    if (keys.length === 0) return [];

    const pipeline = this.redis.pipeline();
    keys.forEach((k: string) => pipeline.get(k));
    const results = await pipeline.exec();

    let executions = (results || [])
      .map(([_, res]) =>
        typeof res === "string" ? (serializer.parse(res) as Execution) : null,
      )
      .filter((e): e is Execution => e !== null);

    // Filter by status
    if (options.status && options.status.length > 0) {
      executions = executions.filter((e) => options.status?.includes(e.status));
    }

    // Filter by taskId
    if (options.taskId) {
      executions = executions.filter((e) => e.taskId === options.taskId);
    }

    // Sort by createdAt desc
    executions.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    // Pagination
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 100;
    executions = executions.slice(offset, offset + limit);

    return executions;
  }

  async listStepResults(executionId: string): Promise<StepResult[]> {
    const keys = await this.scanKeys(this.k(`step:${executionId}:*`));
    if (keys.length === 0) return [];

    const pipeline = this.redis.pipeline();
    keys.forEach((k: string) => pipeline.get(k));
    const results = await pipeline.exec();

    return (results || [])
      .map(([_, res]) =>
        typeof res === "string" ? (serializer.parse(res) as StepResult) : null,
      )
      .filter((s): s is StepResult => s !== null)
      .sort(
        (a, b) =>
          new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime(),
      );
  }

  async appendAuditEntry(entry: DurableAuditEntry): Promise<void> {
    const atMs = entry.at.getTime();
    const id = entry.id || createDurableAuditEntryId(atMs);
    await this.redis.set(
      this.k(`audit:${entry.executionId}:${id}`),
      serializer.stringify({ ...entry, id }),
    );
  }

  async listAuditEntries(
    executionId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<DurableAuditEntry[]> {
    const keys = await this.scanKeys(this.k(`audit:${executionId}:*`));
    if (keys.length === 0) return [];

    const pipeline = this.redis.pipeline();
    keys.forEach((k: string) => pipeline.get(k));
    const results = await pipeline.exec();
    let entries = (results || [])
      .map(([_, res]) =>
        typeof res === "string"
          ? (serializer.parse(res) as DurableAuditEntry)
          : null,
      )
      .filter((e): e is DurableAuditEntry => e !== null)
      .sort((a, b) => a.at.getTime() - b.at.getTime());

    const offset = options.offset ?? 0;
    const limit = options.limit ?? entries.length;
    entries = entries.slice(offset, offset + limit);
    return entries;
  }

  async getStepResult(
    executionId: string,
    stepId: string,
  ): Promise<StepResult | null> {
    const data = this.parseRedisString(
      await this.redis.get(this.k(`step:${executionId}:${stepId}`)),
    );
    return data ? (serializer.parse(data) as StepResult) : null;
  }

  async saveStepResult(result: StepResult): Promise<void> {
    await this.redis.set(
      this.k(`step:${result.executionId}:${result.stepId}`),
      serializer.stringify(result),
    );
  }

  async createTimer(timer: Timer): Promise<void> {
    const script = `
      redis.call("hset", KEYS[1], ARGV[1], ARGV[2])
      redis.call("zadd", KEYS[2], ARGV[3], ARGV[1])
      return "OK"
    `;

    await this.redis.eval(
      script,
      2,
      this.k("timers"),
      this.k("timers_schedule"),
      timer.id,
      serializer.stringify(timer),
      timer.fireAt.getTime(),
    );
  }

  async getReadyTimers(now: Date = new Date()): Promise<Timer[]> {
    const timerIdsUnknown = await this.redis.zrangebyscore(
      this.k("timers_schedule"),
      0,
      now.getTime(),
    );
    const timerIds =
      Array.isArray(timerIdsUnknown) &&
      timerIdsUnknown.every((t) => typeof t === "string")
        ? timerIdsUnknown
        : [];
    if (timerIds.length === 0) return [];

    const pipeline = this.redis.pipeline();
    timerIds.forEach((id: string) => pipeline.hget(this.k("timers"), id));
    const results = await pipeline.exec();
    return (results || [])
      .map(([_, res]) =>
        res ? (serializer.parse(res as string) as Timer) : null,
      )
      .filter(
        (t): t is Timer => t !== null && t.status === TimerStatus.Pending,
      );
  }

  async markTimerFired(timerId: string): Promise<void> {
    const data = this.parseRedisString(
      await this.redis.hget(this.k("timers"), timerId),
    );
    if (!data) return;
    const timer = serializer.parse(data) as Timer;
    timer.status = TimerStatus.Fired;
    await this.redis.hset(
      this.k("timers"),
      timerId,
      serializer.stringify(timer),
    );
    await this.redis.zrem(this.k("timers_schedule"), timerId);
  }

  async deleteTimer(timerId: string): Promise<void> {
    await this.redis.hdel(this.k("timers"), timerId);
    await this.redis.zrem(this.k("timers_schedule"), timerId);
  }

  async claimTimer(
    timerId: string,
    workerId: string,
    ttlMs: number,
  ): Promise<boolean> {
    const key = this.k(`timer:claim:${timerId}`);
    const result = await this.redis.set(key, workerId, "PX", ttlMs, "NX");
    return result === "OK";
  }

  async createSchedule(schedule: Schedule): Promise<void> {
    await this.redis.hset(
      this.k("schedules"),
      schedule.id,
      serializer.stringify(schedule),
    );
  }

  async getSchedule(id: string): Promise<Schedule | null> {
    const data = this.parseRedisString(
      await this.redis.hget(this.k("schedules"), id),
    );
    return data ? (serializer.parse(data) as Schedule) : null;
  }

  async updateSchedule(id: string, updates: Partial<Schedule>): Promise<void> {
    const s = await this.getSchedule(id);
    if (!s) return;
    await this.createSchedule({ ...s, ...updates });
  }

  async deleteSchedule(id: string): Promise<void> {
    await this.redis.hdel(this.k("schedules"), id);
  }

  async listSchedules(): Promise<Schedule[]> {
    const data = await this.redis.hgetall(this.k("schedules"));
    if (typeof data !== "object" || data === null) return [];
    const values = Object.values(data as Record<string, unknown>);
    return values
      .filter((v): v is string => typeof v === "string")
      .map((v) => serializer.parse(v) as Schedule);
  }

  async listActiveSchedules(): Promise<Schedule[]> {
    const all = await this.listSchedules();
    return all.filter((s) => s.status === ScheduleStatus.Active);
  }

  async acquireLock(resource: string, ttlMs: number): Promise<string | null> {
    const lockId = crypto.randomUUID();
    const key = this.k(`lock:${resource}`);
    const result = await this.redis.set(key, lockId, "PX", ttlMs, "NX");
    return result === "OK" ? lockId : null;
  }

  async releaseLock(resource: string, lockId: string): Promise<void> {
    const key = this.k(`lock:${resource}`);
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await this.redis.eval(script, 1, key, lockId);
  }

  async renewLock(
    resource: string,
    lockId: string,
    ttlMs: number,
  ): Promise<boolean> {
    const key = this.k(`lock:${resource}`);
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("pexpire", KEYS[1], ARGV[2])
      else
        return 0
      end
    `;

    const result = await this.redis.eval(script, 1, key, lockId, `${ttlMs}`);
    return Number(result) === 1;
  }

  async dispose(): Promise<void> {
    await this.redis.quit();
  }
}
