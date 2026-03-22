import { Serializer } from "../../../serializer";
import { durableStoreShapeError } from "../../../errors";

export interface RedisPipeline {
  get(key: string): RedisPipeline;
  hget(hash: string, key: string): RedisPipeline;
  exec(): Promise<Array<[unknown, unknown]> | null>;
}

export interface RedisClient {
  set(...args: unknown[]): Promise<unknown>;
  get(...args: unknown[]): Promise<unknown>;
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

export const serializer = new Serializer();

export class RedisStoreRuntime {
  constructor(
    readonly redis: RedisClient,
    readonly prefix: string,
    readonly ownsRedisClient: boolean,
  ) {}

  k(key: string): string {
    return `${this.prefix}${key}`;
  }

  encodeKeyPart(value: string): string {
    return encodeURIComponent(value);
  }

  parseRedisString(value: unknown): string | null {
    return typeof value === "string" ? value : null;
  }

  assertEvalResultNotError(value: unknown): void {
    if (typeof value === "string" && value.startsWith("__error__:")) {
      durableStoreShapeError.throw({
        message: value.slice("__error__:".length),
      });
    }
  }

  parseHashValues<T>(data: unknown): T[] {
    if (typeof data !== "object" || data === null) return [];

    return Object.values(data as Record<string, unknown>)
      .filter((value): value is string => typeof value === "string")
      .map((value) => serializer.parse(value) as T);
  }

  private parseScanResponse(value: unknown): [string, string[]] | null {
    if (!Array.isArray(value) || value.length !== 2) return null;
    const [cursor, keys] = value;
    if (typeof cursor !== "string") return null;
    if (!Array.isArray(keys) || !keys.every((key) => typeof key === "string")) {
      return null;
    }
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

  async scanSetMembers(setKey: string): Promise<string[]> {
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

  allExecutionsKey(): string {
    return this.k("all_executions");
  }

  activeExecutionsKey(): string {
    return this.k("active_executions");
  }

  stuckExecutionsKey(): string {
    return this.k("stuck_executions");
  }

  stepBucketKey(executionId: string): string {
    return this.k(`steps:${executionId}`);
  }

  auditBucketKey(executionId: string): string {
    return this.k(`audit:${executionId}`);
  }

  signalKey(executionId: string, signalId: string): string {
    return this.k(`signal:${executionId}:${this.encodeKeyPart(signalId)}`);
  }

  signalWaiterOrderKey(executionId: string, signalId: string): string {
    return this.k(
      `signal_waiters:${executionId}:${this.encodeKeyPart(signalId)}:order`,
    );
  }

  signalWaiterPayloadKey(executionId: string, signalId: string): string {
    return this.k(
      `signal_waiters:${executionId}:${this.encodeKeyPart(signalId)}:payloads`,
    );
  }

  signalWaiterStepKey(executionId: string, signalId: string): string {
    return this.k(
      `signal_waiters:${executionId}:${this.encodeKeyPart(signalId)}:steps`,
    );
  }

  executionWaiterKey(targetExecutionId: string): string {
    return this.k(`execution_waiters:${this.encodeKeyPart(targetExecutionId)}`);
  }

  timersKey(): string {
    return this.k("timers");
  }

  timersScheduleKey(): string {
    return this.k("timers_schedule");
  }

  schedulesKey(): string {
    return this.k("schedules");
  }

  timerClaimKey(timerId: string): string {
    return this.k(`timer:claim:${timerId}`);
  }

  executionKey(executionId: string): string {
    return this.k(`exec:${executionId}`);
  }

  idempotencyKey(taskId: string, idempotencyKey: string): string {
    return this.k(
      `idem:${this.encodeKeyPart(taskId)}:${this.encodeKeyPart(idempotencyKey)}`,
    );
  }

  lockKey(resource: string): string {
    return this.k(`lock:${resource}`);
  }
}
