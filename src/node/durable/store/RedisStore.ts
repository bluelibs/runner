import Redis from "ioredis";
import * as crypto from "node:crypto";
import type { Execution, Schedule, StepResult, Timer } from "../core/types";
import type {
  IDurableStore,
  ListExecutionsOptions,
} from "../core/interfaces/store";
import { getDefaultSerializer } from "../../../serializer";

const serializer = getDefaultSerializer();

export interface RedisPipeline {
  get(key: string): RedisPipeline;
  hget(hash: string, key: string): RedisPipeline;
  exec(): Promise<Array<[unknown, unknown]> | null>;
}

export interface RedisClient {
  set(...args: unknown[]): Promise<unknown>;
  get(...args: unknown[]): Promise<unknown>;
  scan(...args: unknown[]): Promise<unknown>;
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
      typeof config.redis === "string"
        ? new Redis(config.redis)
        : (config.redis ?? new Redis());
    this.prefix = config.prefix || "durable:";
  }

  private k(key: string): string {
    return `${this.prefix}${key}`;
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
        throw new Error("Unexpected Redis SCAN response shape");
      }

      const [newCursor, scannedKeys] = parsed;
      cursor = newCursor;
      keys.push(...scannedKeys);
    } while (cursor !== "0");
    return keys;
  }

  async saveExecution(execution: Execution): Promise<void> {
    await this.redis.set(
      this.k(`exec:${execution.id}`),
      serializer.stringify(execution),
    );
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

    await this.redis.eval(script, 1, key, updatesStr);
  }

  async listIncompleteExecutions(): Promise<Execution[]> {
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
          e !== null &&
          e.status !== "completed" &&
          e.status !== "failed" &&
          e.status !== "compensation_failed",
      );
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
        (e): e is Execution => e !== null && e.status === "compensation_failed",
      );
  }

  // Operator API
  async retryRollback(executionId: string): Promise<void> {
    const execution = await this.getExecution(executionId);
    if (!execution) return;

    await this.saveExecution({
      ...execution,
      status: "pending",
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
    await this.updateExecution(executionId, { status: "failed", error });
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
    await this.redis.hset(
      this.k("timers"),
      timer.id,
      serializer.stringify(timer),
    );
    await this.redis.zadd(
      this.k("timers_schedule"),
      timer.fireAt.getTime(),
      timer.id,
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
      .filter((t): t is Timer => t !== null && t.status === "pending");
  }

  async markTimerFired(timerId: string): Promise<void> {
    const data = this.parseRedisString(
      await this.redis.hget(this.k("timers"), timerId),
    );
    if (!data) return;
    const timer = serializer.parse(data) as Timer;
    timer.status = "fired";
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
    return all.filter((s) => s.status === "active");
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

  async dispose(): Promise<void> {
    await this.redis.quit();
  }
}
