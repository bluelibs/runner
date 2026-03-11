import { createHash } from "node:crypto";
import type { SerializerLike } from "../../serializer";
import {
  computeEntrySize,
  type CacheFactoryOptions,
  type ICacheProvider,
} from "../../globals/middleware/cache.shared";

export interface RedisCacheClient {
  del(...keys: string[]): Promise<unknown>;
  exists(key: string): Promise<unknown>;
  get(key: string): Promise<unknown>;
  hdel(key: string, ...fields: string[]): Promise<unknown>;
  hget(key: string, field: string): Promise<unknown>;
  hset(key: string, field: string, value: string): Promise<unknown>;
  incrby(key: string, increment: number): Promise<unknown>;
  quit?(): Promise<unknown>;
  sadd(key: string, ...members: string[]): Promise<unknown>;
  set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<unknown>;
  setex?(key: string, seconds: number, value: string): Promise<unknown>;
  smembers(key: string): Promise<unknown>;
  srem(key: string, ...members: string[]): Promise<unknown>;
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zrange(key: string, start: number, stop: number): Promise<unknown>;
  zrem(key: string, ...members: string[]): Promise<unknown>;
}

export interface RedisCacheOptions {
  options: CacheFactoryOptions;
  prefix: string;
  redis: RedisCacheClient;
  serializer: SerializerLike;
  taskId: string;
  totalBudgetBytes?: number;
}

export class RedisCache implements ICacheProvider {
  private readonly entrySizesKey: string;
  private readonly globalBytesKey: string;
  private readonly globalLruKey: string;
  private readonly taskBytesKey: string;
  private readonly taskLruKey: string;
  private readonly taskMembersKey: string;
  private readonly taskToken: string;

  constructor(private readonly config: RedisCacheOptions) {
    this.taskToken = hashValue(config.taskId);
    this.entrySizesKey = this.createKey("entry-sizes");
    this.globalBytesKey = this.createKey("bytes:global");
    this.globalLruKey = this.createKey("lru:global");
    this.taskBytesKey = this.createKey(`task:${this.taskToken}:bytes`);
    this.taskLruKey = this.createKey(`task:${this.taskToken}:lru`);
    this.taskMembersKey = this.createKey(`task:${this.taskToken}:members`);
  }

  async get(key: string): Promise<unknown | undefined> {
    const entryId = this.createEntryId(key);
    const payload = await this.config.redis.get(this.getEntryDataKey(entryId));

    if (typeof payload !== "string") {
      await this.removeTrackedEntry(entryId);
      return undefined;
    }

    await this.touch(entryId);
    return this.config.serializer.parse(payload);
  }

  async set(key: string, value: unknown): Promise<void> {
    const entryId = this.createEntryId(key);
    const entrySize = computeEntrySize(this.config.options, key, value);

    if (
      this.config.options.maxEntrySize !== undefined &&
      entrySize > this.config.options.maxEntrySize
    ) {
      return;
    }

    const payload = this.config.serializer.stringify(value);
    const previousSize = await this.getStoredSize(entryId);

    await this.writeEntryPayload(entryId, payload);
    await this.config.redis.hset(
      this.entrySizesKey,
      entryId,
      String(entrySize),
    );
    await this.config.redis.sadd(this.taskMembersKey, entryId);
    await this.touch(entryId);

    const sizeDelta = entrySize - previousSize;
    if (sizeDelta !== 0) {
      await this.adjustTrackedBytes(this.globalBytesKey, sizeDelta);
      await this.adjustTrackedBytes(this.taskBytesKey, sizeDelta);
    }

    await this.enforceTaskLimits();
    await this.enforceTotalBudget();
  }

  async clear(): Promise<void> {
    const members = await this.getTaskMembers();

    for (const member of members) {
      await this.removeTrackedEntry(member);
    }

    await this.config.redis.del(
      this.taskMembersKey,
      this.taskLruKey,
      this.taskBytesKey,
    );
  }

  async has(key: string): Promise<boolean> {
    const entryId = this.createEntryId(key);
    const exists = toInteger(
      await this.config.redis.exists(this.getEntryDataKey(entryId)),
    );

    if (exists > 0) {
      await this.touch(entryId);
      return true;
    }

    await this.removeTrackedEntry(entryId);
    return false;
  }

  private async enforceTaskLimits() {
    await this.enforceTaskMaxEntries();
    await this.enforceTaskMaxSize();
  }

  private async enforceTaskMaxEntries() {
    if (this.config.options.max === undefined) {
      return;
    }

    while ((await this.getTaskMembers()).length > this.config.options.max) {
      const oldest = await this.getOldestMember(this.taskLruKey);
      if (!oldest) {
        return;
      }

      await this.removeTrackedEntry(oldest);
    }
  }

  private async enforceTaskMaxSize() {
    if (this.config.options.maxSize === undefined) {
      return;
    }

    while (
      (await this.getTrackedBytes(this.taskBytesKey)) >
      this.config.options.maxSize
    ) {
      const oldest = await this.getOldestMember(this.taskLruKey);
      if (!oldest) {
        await this.config.redis.set(this.taskBytesKey, "0");
        return;
      }

      await this.removeTrackedEntry(oldest);
    }
  }

  private async enforceTotalBudget() {
    if (this.config.totalBudgetBytes === undefined) {
      return;
    }

    while (
      (await this.getTrackedBytes(this.globalBytesKey)) >
      this.config.totalBudgetBytes
    ) {
      const oldest = await this.getOldestMember(this.globalLruKey);
      if (!oldest) {
        await this.config.redis.set(this.globalBytesKey, "0");
        return;
      }

      await this.removeTrackedEntry(oldest);
    }
  }

  private async writeEntryPayload(entryId: string, payload: string) {
    const dataKey = this.getEntryDataKey(entryId);

    if (this.config.options.ttl === undefined) {
      await this.config.redis.set(dataKey, payload);
      return;
    }

    if (typeof this.config.redis.setex === "function") {
      await this.config.redis.setex(
        dataKey,
        Math.ceil(this.config.options.ttl / 1000),
        payload,
      );
      return;
    }

    await this.config.redis.set(
      dataKey,
      payload,
      "PX",
      this.config.options.ttl,
    );
  }

  private async touch(entryId: string) {
    const order = Date.now();
    await this.config.redis.zadd(this.globalLruKey, order, entryId);
    await this.config.redis.zadd(this.taskLruKey, order, entryId);
  }

  private async removeTrackedEntry(entryId: string) {
    const entrySize = await this.getStoredSize(entryId);
    const taskToken = getTaskToken(entryId);

    await this.config.redis.del(this.getEntryDataKey(entryId));
    await this.config.redis.hdel(this.entrySizesKey, entryId);
    await this.config.redis.zrem(this.globalLruKey, entryId);
    await this.config.redis.zrem(
      this.createKey(`task:${taskToken}:lru`),
      entryId,
    );
    await this.config.redis.srem(
      this.createKey(`task:${taskToken}:members`),
      entryId,
    );

    if (entrySize === 0) {
      return;
    }

    await this.adjustTrackedBytes(this.globalBytesKey, -entrySize);
    await this.adjustTrackedBytes(
      this.createKey(`task:${taskToken}:bytes`),
      -entrySize,
    );
  }

  private async getStoredSize(entryId: string) {
    return toInteger(await this.config.redis.hget(this.entrySizesKey, entryId));
  }

  private async getTrackedBytes(bytesKey: string) {
    return toInteger(await this.config.redis.get(bytesKey));
  }

  private async adjustTrackedBytes(bytesKey: string, delta: number) {
    const nextValue = toInteger(
      await this.config.redis.incrby(bytesKey, delta),
    );

    if (nextValue < 0) {
      await this.config.redis.set(bytesKey, "0");
    }
  }

  private async getOldestMember(zsetKey: string) {
    const members = toStringArray(
      await this.config.redis.zrange(zsetKey, 0, 0),
    );
    return members[0];
  }

  private async getTaskMembers() {
    return toStringArray(await this.config.redis.smembers(this.taskMembersKey));
  }

  private createEntryId(key: string) {
    return `${this.taskToken}:${hashValue(key)}`;
  }

  private getEntryDataKey(entryId: string) {
    return this.createKey(`entry:${entryId}`);
  }

  private createKey(suffix: string) {
    return `${this.config.prefix}:${suffix}`;
  }
}

function hashValue(value: string) {
  return createHash("sha1").update(value).digest("hex");
}

function getTaskToken(entryId: string) {
  const separatorIndex = entryId.indexOf(":");
  return separatorIndex === -1 ? entryId : entryId.slice(0, separatorIndex);
}

function toInteger(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function toStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}
