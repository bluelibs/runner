import * as crypto from "node:crypto";
import {
  type DurableSignalRecord,
  type DurableQueuedSignalRecord,
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
import { Serializer } from "../../../serializer";
import {
  createDurableAuditEntryId,
  type DurableAuditEntry,
} from "../core/audit";
import { createIORedisClient } from "../optionalDeps/ioredis";
import {
  durableExecutionInvariantError,
  durableStoreShapeError,
} from "../../../errors";
import { getSignalIdFromStepId } from "../core/signalWaiters";

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
  disposeProvidedClient?: boolean;
}

const createRedisSignalState = (
  executionId: string,
  signalId: string,
): DurableSignalState => ({
  executionId,
  signalId,
  queued: [],
  history: [],
});

const getSignalIdFromStepResult = (result: StepResult): string => {
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
};

export class RedisStore implements IDurableStore {
  private redis: RedisClient;
  private prefix: string;
  private readonly ownsRedisClient: boolean;

  constructor(config: RedisStoreConfig) {
    this.ownsRedisClient =
      typeof config.redis === "string" ||
      config.redis === undefined ||
      config.disposeProvidedClient === true;
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

  async createExecutionWithIdempotencyKey(params: {
    execution: Execution;
    taskId: string;
    idempotencyKey: string;
  }): Promise<
    | { created: true; executionId: string }
    | { created: false; executionId: string }
  > {
    const { isActive, isStuck } = this.statusFlags(params.execution.status);
    const outcome = await this.redis.eval(
      `
        local existingId = redis.call("get", KEYS[1])
        if existingId then
          return existingId
        end

        redis.call("set", KEYS[1], ARGV[2])
        redis.call("set", KEYS[2], ARGV[1])
        ${this.saveExecutionIndexesScript()}
        return "__created__"
      `,
      5,
      this.k(
        `idem:${this.encodeKeyPart(params.taskId)}:${this.encodeKeyPart(params.idempotencyKey)}`,
      ),
      this.k(`exec:${params.execution.id}`),
      this.allExecutionsKey(),
      this.activeExecutionsKey(),
      this.stuckExecutionsKey(),
      serializer.stringify(params.execution),
      params.execution.id,
      isActive,
      isStuck,
    );

    if (outcome === "__created__") {
      return { created: true, executionId: params.execution.id };
    }

    const executionId = this.parseRedisString(outcome);
    if (executionId === null) {
      return durableStoreShapeError.throw({
        message: "Unexpected Redis idempotent execution create response",
      });
    }

    return { created: false, executionId };
  }

  private parseRedisString(value: unknown): string | null {
    return typeof value === "string" ? value : null;
  }

  private assertEvalResultNotError(value: unknown): void {
    if (typeof value === "string" && value.startsWith("__error__:")) {
      durableStoreShapeError.throw({
        message: value.slice("__error__:".length),
      });
    }
  }

  private parseScanResponse(value: unknown): [string, string[]] | null {
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [cursor, keys] = value;
    if (typeof cursor !== "string") return null;
    if (!Array.isArray(keys) || !keys.every((k) => typeof k === "string"))
      return null;
    return [cursor, keys];
  }

  private expectScanResponse(
    value: unknown,
    operation: "SCAN" | "SSCAN",
  ): [string, string[]] {
    const parsed = this.parseScanResponse(value);
    if (parsed === null) {
      durableStoreShapeError.throw({
        message: `Unexpected Redis ${operation} response shape`,
      });
    }
    return parsed as [string, string[]];
  }

  private async scanSetMembers(setKey: string): Promise<string[]> {
    const members: string[] = [];
    let cursor = "0";
    do {
      const parsed = this.expectScanResponse(
        await this.redis.sscan(setKey, cursor, "COUNT", 100),
        "SSCAN",
      );
      const [newCursor, scannedMembers] = parsed;
      cursor = newCursor;
      members.push(...scannedMembers);
    } while (cursor !== "0");
    return members;
  }

  private activeExecutionsKey(): string {
    return this.k("active_executions");
  }

  private allExecutionsKey(): string {
    return this.k("all_executions");
  }

  private stuckExecutionsKey(): string {
    return this.k("stuck_executions");
  }

  private stepBucketKey(executionId: string): string {
    return this.k(`steps:${executionId}`);
  }

  private auditBucketKey(executionId: string): string {
    return this.k(`audit:${executionId}`);
  }

  private signalKey(executionId: string, signalId: string): string {
    return this.k(`signal:${executionId}:${this.encodeKeyPart(signalId)}`);
  }

  private signalWaiterOrderKey(executionId: string, signalId: string): string {
    return this.k(
      `signal_waiters:${executionId}:${this.encodeKeyPart(signalId)}:order`,
    );
  }

  private signalWaiterPayloadKey(
    executionId: string,
    signalId: string,
  ): string {
    return this.k(
      `signal_waiters:${executionId}:${this.encodeKeyPart(signalId)}:payloads`,
    );
  }

  private signalWaiterStepKey(executionId: string, signalId: string): string {
    return this.k(
      `signal_waiters:${executionId}:${this.encodeKeyPart(signalId)}:steps`,
    );
  }

  private isActiveExecutionStatus(status: ExecutionStatus): boolean {
    return (
      status !== ExecutionStatus.Completed &&
      status !== ExecutionStatus.Failed &&
      status !== ExecutionStatus.CompensationFailed &&
      status !== ExecutionStatus.Cancelled
    );
  }

  private saveExecutionIndexesScript(): string {
    return `
      redis.call("sadd", KEYS[2], ARGV[2])

      if ARGV[3] == "1" then
        redis.call("sadd", KEYS[3], ARGV[2])
      else
        redis.call("srem", KEYS[3], ARGV[2])
      end

      if ARGV[4] == "1" then
        redis.call("sadd", KEYS[4], ARGV[2])
      else
        redis.call("srem", KEYS[4], ARGV[2])
      end
    `;
  }

  private saveExecutionScript(): string {
    return `
      redis.call("set", KEYS[1], ARGV[1])
      ${this.saveExecutionIndexesScript()}
      return "OK"
    `;
  }

  private statusFlags(status: ExecutionStatus): {
    isActive: "1" | "0";
    isStuck: "1" | "0";
  } {
    return {
      isActive: this.isActiveExecutionStatus(status) ? "1" : "0",
      isStuck: status === ExecutionStatus.CompensationFailed ? "1" : "0",
    };
  }

  private parseHashValues<T>(data: unknown): T[] {
    if (typeof data !== "object" || data === null) return [];

    return Object.values(data as Record<string, unknown>)
      .filter((value): value is string => typeof value === "string")
      .map((value) => serializer.parse(value) as T);
  }

  private async loadExecutionsFromSet(setKey: string): Promise<Execution[]> {
    const executionIds = await this.scanSetMembers(setKey);
    if (executionIds.length === 0) return [];

    const pipeline = this.redis.pipeline();
    executionIds.forEach((id) => pipeline.get(this.k(`exec:${id}`)));
    const results = await pipeline.exec();
    if (!results) return [];

    const staleIds: string[] = [];
    const executions: Execution[] = [];

    for (let index = 0; index < executionIds.length; index += 1) {
      const raw = results[index]?.[1];
      if (typeof raw !== "string") {
        staleIds.push(executionIds[index]);
        continue;
      }

      executions.push(serializer.parse(raw) as Execution);
    }

    if (staleIds.length > 0) {
      try {
        await this.redis.srem(setKey, ...staleIds);
      } catch {
        // Best-effort cleanup; ignore.
      }
    }

    return executions;
  }

  async saveExecution(execution: Execution): Promise<void> {
    const { isActive, isStuck } = this.statusFlags(execution.status);

    await this.redis.eval(
      this.saveExecutionScript(),
      4,
      this.k(`exec:${execution.id}`),
      this.allExecutionsKey(),
      this.activeExecutionsKey(),
      this.stuckExecutionsKey(),
      serializer.stringify(execution),
      execution.id,
      isActive,
      isStuck,
    );
  }

  async saveExecutionIfStatus(
    execution: Execution,
    expectedStatuses: ExpectedExecutionStatuses,
  ): Promise<boolean> {
    const { isActive, isStuck } = this.statusFlags(execution.status);
    const outcome = await this.redis.eval(
      `
        local current = redis.call("get", KEYS[1])
        if not current then
          return 0
        end

        local okCurrent, currentExecution = pcall(cjson.decode, current)
        if not okCurrent then
          return "__error__:Corrupted durable execution payload"
        end

        local okExpected, expectedStatuses = pcall(cjson.decode, ARGV[5])
        if not okExpected then
          return "__error__:Invalid expected execution statuses payload"
        end

        local matches = false
        for _, expectedStatus in ipairs(expectedStatuses) do
          if currentExecution.status == expectedStatus then
            matches = true
            break
          end
        end

        if not matches then
          return 0
        end

        redis.call("set", KEYS[1], ARGV[1])
        ${this.saveExecutionIndexesScript()}
        return 1
      `,
      4,
      this.k(`exec:${execution.id}`),
      this.allExecutionsKey(),
      this.activeExecutionsKey(),
      this.stuckExecutionsKey(),
      serializer.stringify(execution),
      execution.id,
      isActive,
      isStuck,
      serializer.stringify(expectedStatuses),
    );
    this.assertEvalResultNotError(outcome);
    return outcome === 1;
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
    const current = await this.getExecution(id);
    if (!current) return;

    const updatesWithTime = { ...updates, updatedAt: new Date() };
    const next = { ...current, ...updatesWithTime };
    const { isActive, isStuck } = this.statusFlags(next.status);

    await this.redis.eval(
      this.saveExecutionScript(),
      4,
      this.k(`exec:${id}`),
      this.allExecutionsKey(),
      this.activeExecutionsKey(),
      this.stuckExecutionsKey(),
      serializer.stringify(next),
      id,
      isActive,
      isStuck,
    );
  }

  async listIncompleteExecutions(): Promise<Execution[]> {
    const executions = await this.loadExecutionsFromSet(
      this.activeExecutionsKey(),
    );
    const inactiveIds = executions
      .filter((execution) => !this.isActiveExecutionStatus(execution.status))
      .map((execution) => execution.id);

    if (inactiveIds.length > 0) {
      try {
        await this.redis.srem(this.activeExecutionsKey(), ...inactiveIds);
      } catch {
        // Best-effort cleanup; ignore.
      }
    }

    return executions.filter((execution) =>
      this.isActiveExecutionStatus(execution.status),
    );
  }

  async listStuckExecutions(): Promise<Execution[]> {
    const executions = await this.loadExecutionsFromSet(
      this.stuckExecutionsKey(),
    );
    return executions.filter(
      (execution) => execution.status === ExecutionStatus.CompensationFailed,
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
    let executions = await this.loadExecutionsFromSet(this.allExecutionsKey());

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
    return this.parseHashValues<StepResult>(
      await this.redis.hgetall(this.stepBucketKey(executionId)),
    ).sort(
      (a, b) =>
        new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime(),
    );
  }

  async appendAuditEntry(entry: DurableAuditEntry): Promise<void> {
    const atMs = entry.at.getTime();
    const id = entry.id || createDurableAuditEntryId(atMs);
    const payload = serializer.stringify({ ...entry, id });
    await this.redis.hset(this.auditBucketKey(entry.executionId), id, payload);
  }

  async listAuditEntries(
    executionId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<DurableAuditEntry[]> {
    let entries = this.parseHashValues<DurableAuditEntry>(
      await this.redis.hgetall(this.auditBucketKey(executionId)),
    );
    entries.sort((a, b) => a.at.getTime() - b.at.getTime());

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
      await this.redis.hget(this.stepBucketKey(executionId), stepId),
    );
    return data ? (serializer.parse(data) as StepResult) : null;
  }

  async saveStepResult(result: StepResult): Promise<void> {
    const payload = serializer.stringify(result);
    await this.redis.hset(
      this.stepBucketKey(result.executionId),
      result.stepId,
      payload,
    );
  }

  async getSignalState(
    executionId: string,
    signalId: string,
  ): Promise<DurableSignalState | null> {
    const data = this.parseRedisString(
      await this.redis.get(this.signalKey(executionId, signalId)),
    );
    return data ? (serializer.parse(data) as DurableSignalState) : null;
  }

  async appendSignalRecord(
    executionId: string,
    signalId: string,
    record: DurableSignalRecord,
  ): Promise<void> {
    const script = `
      local current = redis.call("get", KEYS[1])
      local okState, state = pcall(cjson.decode, current or ARGV[1])
      if not okState then
        return "__error__:Corrupted durable signal state"
      end
      local okRecord, record = pcall(cjson.decode, ARGV[2])
      if not okRecord then
        return "__error__:Invalid durable signal record payload"
      end
      table.insert(state.history, record)
      redis.call("set", KEYS[1], cjson.encode(state))
      return "OK"
    `;

    const outcome = await this.redis.eval(
      script,
      1,
      this.signalKey(executionId, signalId),
      serializer.stringify(createRedisSignalState(executionId, signalId)),
      serializer.stringify(record),
    );
    this.assertEvalResultNotError(outcome);
  }

  async bufferSignalRecord(
    executionId: string,
    signalId: string,
    record: DurableQueuedSignalRecord,
  ): Promise<void> {
    const script = `
      local current = redis.call("get", KEYS[1])
      local okState, state = pcall(cjson.decode, current or ARGV[1])
      if not okState then
        return "__error__:Corrupted durable signal state"
      end
      local okRecord, record = pcall(cjson.decode, ARGV[2])
      if not okRecord then
        return "__error__:Invalid durable queued signal payload"
      end

      table.insert(state.history, record)
      table.insert(state.queued, record)
      redis.call("set", KEYS[1], cjson.encode(state))
      return "OK"
    `;

    const outcome = await this.redis.eval(
      script,
      1,
      this.signalKey(executionId, signalId),
      serializer.stringify(createRedisSignalState(executionId, signalId)),
      serializer.stringify(record),
    );
    this.assertEvalResultNotError(outcome);
  }

  async enqueueQueuedSignalRecord(
    executionId: string,
    signalId: string,
    record: DurableQueuedSignalRecord,
  ): Promise<void> {
    const script = `
      local current = redis.call("get", KEYS[1])
      local okState, state = pcall(cjson.decode, current or ARGV[1])
      if not okState then
        return "__error__:Corrupted durable signal state"
      end
      local okRecord, record = pcall(cjson.decode, ARGV[2])
      if not okRecord then
        return "__error__:Invalid durable queued signal payload"
      end

      table.insert(state.queued, record)
      redis.call("set", KEYS[1], cjson.encode(state))
      return "OK"
    `;

    const outcome = await this.redis.eval(
      script,
      1,
      this.signalKey(executionId, signalId),
      serializer.stringify(createRedisSignalState(executionId, signalId)),
      serializer.stringify(record),
    );
    this.assertEvalResultNotError(outcome);
  }

  async consumeQueuedSignalRecord(
    executionId: string,
    signalId: string,
  ): Promise<DurableSignalRecord | null> {
    const script = `
      local current = redis.call("get", KEYS[1])
      if not current then
        return nil
      end

      local okState, state = pcall(cjson.decode, current)
      if not okState then
        return "__error__:Corrupted durable signal state"
      end
      local record = table.remove(state.queued, 1)
      redis.call("set", KEYS[1], cjson.encode(state))

      if not record then
        return nil
      end

      return cjson.encode(record)
    `;

    const outcome = await this.redis.eval(
      script,
      1,
      this.signalKey(executionId, signalId),
    );
    this.assertEvalResultNotError(outcome);
    const payload = this.parseRedisString(outcome);

    return payload ? (serializer.parse(payload) as DurableSignalRecord) : null;
  }

  async consumeBufferedSignalForStep(
    stepResult: StepResult,
  ): Promise<DurableSignalRecord | null> {
    const signalId = getSignalIdFromStepResult(stepResult);
    const stepPayload = serializer.stringify(stepResult);
    const script = `
      local current = redis.call("get", KEYS[1])
      if not current then
        return nil
      end

      local okState, state = pcall(cjson.decode, current)
      if not okState then
        return "__error__:Corrupted durable signal state"
      end
      local record = table.remove(state.queued, 1)
      if not record then
        return nil
      end

      redis.call("set", KEYS[1], cjson.encode(state))
      local okStepResult, stepResult = pcall(cjson.decode, ARGV[2])
      if not okStepResult then
        return "__error__:Invalid buffered signal step result payload"
      end
      if type(stepResult) ~= "table" then
        return "__error__:Invalid buffered signal step result payload"
      end
      if type(stepResult.result) ~= "table" then
        return "__error__:Invalid buffered signal completion state"
      end
      stepResult.result.payload = record.payload
      redis.call("hset", KEYS[2], ARGV[1], cjson.encode(stepResult))
      return cjson.encode(record)
    `;

    const outcome = await this.redis.eval(
      script,
      2,
      this.signalKey(stepResult.executionId, signalId),
      this.stepBucketKey(stepResult.executionId),
      stepResult.stepId,
      stepPayload,
    );
    this.assertEvalResultNotError(outcome);
    const payload = this.parseRedisString(outcome);

    return payload ? (serializer.parse(payload) as DurableSignalRecord) : null;
  }

  async upsertSignalWaiter(waiter: DurableSignalWaiter): Promise<void> {
    const member = `${waiter.sortKey}\n${waiter.stepId}`;
    const payload = serializer.stringify(waiter);
    const script = `
      local existingMember = redis.call("hget", KEYS[3], ARGV[1])
      if existingMember and existingMember ~= ARGV[2] then
        redis.call("zrem", KEYS[1], existingMember)
        redis.call("hdel", KEYS[2], existingMember)
      end
      redis.call("zadd", KEYS[1], 0, ARGV[2])
      redis.call("hset", KEYS[2], ARGV[2], ARGV[3])
      redis.call("hset", KEYS[3], ARGV[1], ARGV[2])
      return "OK"
    `;

    await this.redis.eval(
      script,
      3,
      this.signalWaiterOrderKey(waiter.executionId, waiter.signalId),
      this.signalWaiterPayloadKey(waiter.executionId, waiter.signalId),
      this.signalWaiterStepKey(waiter.executionId, waiter.signalId),
      waiter.stepId,
      member,
      payload,
    );
  }

  async peekNextSignalWaiter(
    executionId: string,
    signalId: string,
  ): Promise<DurableSignalWaiter | null> {
    const script = `
      local member = redis.call("zrange", KEYS[1], 0, 0)[1]
      if not member then
        return nil
      end

      return redis.call("hget", KEYS[2], member)
    `;

    const outcome = await this.redis.eval(
      script,
      2,
      this.signalWaiterOrderKey(executionId, signalId),
      this.signalWaiterPayloadKey(executionId, signalId),
    );
    this.assertEvalResultNotError(outcome);
    const payload = this.parseRedisString(outcome);

    return payload ? (serializer.parse(payload) as DurableSignalWaiter) : null;
  }

  async commitSignalDelivery(params: {
    executionId: string;
    signalId: string;
    stepId: string;
    stepResult: StepResult;
    signalRecord: DurableSignalRecord;
    timerId?: string;
  }): Promise<boolean> {
    const script = `
      local stepPayload = redis.call("hget", KEYS[2], ARGV[1])
      if not stepPayload then
        return 0
      end

      local okStep, step = pcall(cjson.decode, stepPayload)
      if not okStep or type(step) ~= "table" or type(step.result) ~= "table" then
        return 0
      end
      if step.result.state ~= "waiting" then
        return 0
      end
      if step.result.signalId ~= cjson.null and step.result.signalId ~= nil and step.result.signalId ~= ARGV[2] then
        return 0
      end

      local member = redis.call("hget", KEYS[5], ARGV[1])
      if not member then
        return 0
      end

      local currentSignalState = redis.call("get", KEYS[1])
      local okState, state = pcall(cjson.decode, currentSignalState or ARGV[4])
      if not okState then
        return "__error__:Corrupted durable signal state"
      end
      local okRecord, record = pcall(cjson.decode, ARGV[5])
      if not okRecord then
        return "__error__:Invalid durable signal record payload"
      end
      local okCompletedStep, completedStep = pcall(cjson.decode, ARGV[3])
      if not okCompletedStep then
        return "__error__:Invalid signal delivery step result payload"
      end

      table.insert(state.history, record)
      redis.call("set", KEYS[1], cjson.encode(state))
      redis.call("hset", KEYS[2], ARGV[1], cjson.encode(completedStep))
      redis.call("zrem", KEYS[3], member)
      redis.call("hdel", KEYS[4], member)
      redis.call("hdel", KEYS[5], ARGV[1])

      if ARGV[6] ~= "" then
        redis.call("hdel", KEYS[6], ARGV[6])
        redis.call("zrem", KEYS[7], ARGV[6])
      end

      return 1
    `;

    const result = await this.redis.eval(
      script,
      7,
      this.signalKey(params.executionId, params.signalId),
      this.stepBucketKey(params.executionId),
      this.signalWaiterOrderKey(params.executionId, params.signalId),
      this.signalWaiterPayloadKey(params.executionId, params.signalId),
      this.signalWaiterStepKey(params.executionId, params.signalId),
      this.k("timers"),
      this.k("timers_schedule"),
      params.stepId,
      params.signalId,
      serializer.stringify(params.stepResult),
      serializer.stringify(
        createRedisSignalState(params.executionId, params.signalId),
      ),
      serializer.stringify(params.signalRecord),
      params.timerId ?? "",
    );
    this.assertEvalResultNotError(result);
    return Number(result) === 1;
  }

  async takeNextSignalWaiter(
    executionId: string,
    signalId: string,
  ): Promise<DurableSignalWaiter | null> {
    const script = `
      local member = redis.call("zrange", KEYS[1], 0, 0)[1]
      if not member then
        return nil
      end

      local payload = redis.call("hget", KEYS[2], member)
      redis.call("zrem", KEYS[1], member)
      redis.call("hdel", KEYS[2], member)

      if payload then
        local okPayload, decoded = pcall(cjson.decode, payload)
        if not okPayload then
          return "__error__:Corrupted durable signal waiter payload"
        end
        if decoded and decoded.stepId then
          redis.call("hdel", KEYS[3], decoded.stepId)
        end
      end

      return payload
    `;

    const outcome = await this.redis.eval(
      script,
      3,
      this.signalWaiterOrderKey(executionId, signalId),
      this.signalWaiterPayloadKey(executionId, signalId),
      this.signalWaiterStepKey(executionId, signalId),
    );
    this.assertEvalResultNotError(outcome);
    const payload = this.parseRedisString(outcome);

    return payload ? (serializer.parse(payload) as DurableSignalWaiter) : null;
  }

  async deleteSignalWaiter(
    executionId: string,
    signalId: string,
    stepId: string,
  ): Promise<void> {
    const script = `
      local member = redis.call("hget", KEYS[3], ARGV[1])
      if not member then
        return 0
      end

      redis.call("zrem", KEYS[1], member)
      redis.call("hdel", KEYS[2], member)
      redis.call("hdel", KEYS[3], ARGV[1])
      return 1
    `;

    await this.redis.eval(
      script,
      3,
      this.signalWaiterOrderKey(executionId, signalId),
      this.signalWaiterPayloadKey(executionId, signalId),
      this.signalWaiterStepKey(executionId, signalId),
      stepId,
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
    const script = `
      local current = redis.call("hget", KEYS[1], ARGV[1])
      if not current then
        return 0
      end

      local okTimer, timer = pcall(cjson.decode, current)
      if not okTimer then
        return "__error__:Corrupted durable timer payload"
      end
      timer.status = ARGV[2]
      redis.call("hset", KEYS[1], ARGV[1], cjson.encode(timer))
      redis.call("zrem", KEYS[2], ARGV[1])
      return 1
    `;

    const outcome = await this.redis.eval(
      script,
      2,
      this.k("timers"),
      this.k("timers_schedule"),
      timerId,
      TimerStatus.Fired,
    );
    this.assertEvalResultNotError(outcome);
  }

  async deleteTimer(timerId: string): Promise<void> {
    const script = `
      redis.call("hdel", KEYS[1], ARGV[1])
      redis.call("zrem", KEYS[2], ARGV[1])
      return 1
    `;

    await this.redis.eval(
      script,
      2,
      this.k("timers"),
      this.k("timers_schedule"),
      timerId,
    );
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

  async renewTimerClaim(
    timerId: string,
    workerId: string,
    ttlMs: number,
  ): Promise<boolean> {
    const key = this.k(`timer:claim:${timerId}`);
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("pexpire", KEYS[1], ARGV[2])
      else
        return 0
      end
    `;

    const result = await this.redis.eval(script, 1, key, workerId, `${ttlMs}`);
    return Number(result) === 1;
  }

  async finalizeClaimedTimer(
    timerId: string,
    workerId: string,
  ): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[3]) ~= ARGV[2] then
        return 0
      end

      local current = redis.call("hget", KEYS[1], ARGV[1])
      if current then
        local okTimer, timer = pcall(cjson.decode, current)
        if not okTimer then
          return "__error__:Corrupted durable timer payload"
        end
        timer.status = ARGV[3]
        redis.call("hset", KEYS[1], ARGV[1], cjson.encode(timer))
      end

      redis.call("hdel", KEYS[1], ARGV[1])
      redis.call("zrem", KEYS[2], ARGV[1])
      redis.call("del", KEYS[3])
      return 1
    `;

    const result = await this.redis.eval(
      script,
      3,
      this.k("timers"),
      this.k("timers_schedule"),
      this.k(`timer:claim:${timerId}`),
      timerId,
      workerId,
      TimerStatus.Fired,
    );
    this.assertEvalResultNotError(result);
    return Number(result) === 1;
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

  async saveScheduleWithTimer(schedule: Schedule, timer: Timer): Promise<void> {
    const script = `
      redis.call("hset", KEYS[1], ARGV[1], ARGV[2])
      redis.call("hset", KEYS[2], ARGV[3], ARGV[4])
      redis.call("zadd", KEYS[3], ARGV[5], ARGV[3])
      return "OK"
    `;

    await this.redis.eval(
      script,
      3,
      this.k("schedules"),
      this.k("timers"),
      this.k("timers_schedule"),
      schedule.id,
      serializer.stringify(schedule),
      timer.id,
      serializer.stringify(timer),
      timer.fireAt.getTime(),
    );
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
    if (this.ownsRedisClient) {
      await this.redis.quit();
    }
  }
}
