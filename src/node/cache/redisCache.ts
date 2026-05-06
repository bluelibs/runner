import { createHash } from "node:crypto";
import type { SerializerLike } from "../../serializer";
import {
  computeEntrySize,
  type CacheEntryMetadata,
  type CacheFactoryOptions,
  type ICacheProvider,
} from "../../globals/middleware/cache/shared";
import {
  normalizeCacheKeys,
  normalizeCacheRefs,
} from "../../globals/middleware/cache/key";

export interface RedisCacheClient {
  del(...keys: string[]): Promise<unknown>;
  exists(key: string): Promise<unknown>;
  get(key: string): Promise<unknown>;
  hdel(key: string, ...fields: string[]): Promise<unknown>;
  hget(key: string, field: string): Promise<unknown>;
  hmget?(key: string, ...fields: string[]): Promise<readonly unknown[]>;
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
  private readonly entryRefsKey: string;
  private readonly entrySizesKey: string;
  private readonly globalBytesKey: string;
  private readonly globalLruKey: string;
  private readonly taskBytesKey: string;
  private readonly taskLruKey: string;
  private readonly taskMembersKey: string;
  private readonly taskToken: string;

  constructor(private readonly config: RedisCacheOptions) {
    this.taskToken = hashValue(config.taskId);
    this.entryRefsKey = this.createKey("entry-refs");
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

    try {
      const value = this.config.serializer.parse(payload);
      await this.touch(entryId);
      return value;
    } catch {
      await this.removeTrackedEntry(entryId);
      return undefined;
    }
  }

  async set(
    key: string,
    value: unknown,
    metadata?: CacheEntryMetadata,
  ): Promise<void> {
    const entryId = this.createEntryId(key);
    const entrySize = computeEntrySize(this.config.options, key, value);

    if (
      this.config.options.maxEntrySize !== undefined &&
      entrySize > this.config.options.maxEntrySize
    ) {
      return;
    }

    const refs = normalizeCacheRefs(metadata?.refs);
    const payload = this.config.serializer.stringify(value);
    const previousRefs = await this.getStoredRefs(entryId);
    const previousSize = await this.getStoredSize(entryId);

    await this.writeEntryPayload(entryId, payload);
    await this.config.redis.hset(
      this.entrySizesKey,
      entryId,
      String(entrySize),
    );
    await this.writeStoredRefs(entryId, refs);
    await this.config.redis.sadd(this.taskMembersKey, entryId);
    await this.touch(entryId);
    await this.replaceRefBindings(entryId, previousRefs, refs);

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

    await this.removeTrackedEntries(members);

    await this.config.redis.del(
      this.taskMembersKey,
      this.taskLruKey,
      this.taskBytesKey,
    );
  }

  async invalidateRefs(refs: readonly string[]): Promise<number> {
    const normalizedRefs = normalizeCacheRefs(refs);

    if (normalizedRefs.length === 0) {
      return 0;
    }

    const memberLists = await Promise.all(
      normalizedRefs.map((ref) =>
        this.config.redis.smembers(this.getRefMembersKey(ref)),
      ),
    );
    const entryIds = new Set<string>();

    for (const members of memberLists) {
      for (const member of toStringArray(members)) {
        entryIds.add(member);
      }
    }

    return this.removeTrackedEntries([...entryIds]);
  }

  async invalidateKeys(keys: readonly string[]): Promise<number> {
    return this.removeTrackedEntries(
      normalizeCacheKeys(keys).map((key) => this.createEntryId(key)),
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

  private async writeStoredRefs(entryId: string, refs: readonly string[]) {
    await this.config.redis.hset(
      this.entryRefsKey,
      entryId,
      JSON.stringify(refs),
    );
  }

  private async getStoredRefs(entryId: string): Promise<readonly string[]> {
    return normalizeStoredRefs(
      (await this.readHashValues(this.entryRefsKey, [entryId]))[0],
    );
  }

  private async touch(entryId: string) {
    const order = Date.now();
    await this.config.redis.zadd(this.globalLruKey, order, entryId);
    await this.config.redis.zadd(this.taskLruKey, order, entryId);
  }

  private async replaceRefBindings(
    entryId: string,
    previousRefs: readonly string[],
    nextRefs: readonly string[],
  ) {
    const previousRefSet = new Set(previousRefs);
    const nextRefSet = new Set(nextRefs);
    const refsToRemove = previousRefs.filter((ref) => !nextRefSet.has(ref));
    const refsToAdd = nextRefs.filter((ref) => !previousRefSet.has(ref));

    for (const ref of refsToRemove) {
      await this.config.redis.srem(this.getRefMembersKey(ref), entryId);
    }

    for (const ref of refsToAdd) {
      await this.config.redis.sadd(this.getRefMembersKey(ref), entryId);
    }
  }

  private async removeTrackedEntry(entryId: string): Promise<boolean> {
    return (await this.removeTrackedEntries([entryId])) > 0;
  }

  private async removeTrackedEntries(
    entryIds: readonly string[],
  ): Promise<number> {
    const uniqueEntryIds = [...new Set(entryIds)];

    if (uniqueEntryIds.length === 0) {
      return 0;
    }

    const [storedRefsByEntryId, storedSizesByEntryId] = await Promise.all([
      this.readStoredRefsByEntryId(uniqueEntryIds),
      this.readStoredSizesByEntryId(uniqueEntryIds),
    ]);
    const entryIdsByTaskToken = new Map<string, string[]>();
    const entryIdsByRefMembersKey = new Map<string, string[]>();
    const bytesRemovedByTaskToken = new Map<string, number>();
    let totalBytesRemoved = 0;

    for (const entryId of uniqueEntryIds) {
      const taskToken = getTaskToken(entryId);
      const taskEntries = entryIdsByTaskToken.get(taskToken) ?? [];
      taskEntries.push(entryId);
      entryIdsByTaskToken.set(taskToken, taskEntries);

      const entrySize = storedSizesByEntryId.get(entryId)!;
      if (entrySize !== 0) {
        totalBytesRemoved += entrySize;
        bytesRemovedByTaskToken.set(
          taskToken,
          (bytesRemovedByTaskToken.get(taskToken) ?? 0) + entrySize,
        );
      }

      for (const ref of storedRefsByEntryId.get(entryId)!) {
        const refMembersKey = this.getRefMembersKeyForTask(ref, taskToken);
        const refMembers = entryIdsByRefMembersKey.get(refMembersKey) ?? [];
        refMembers.push(entryId);
        entryIdsByRefMembersKey.set(refMembersKey, refMembers);
      }
    }

    const dataKeys = uniqueEntryIds.map((entryId) =>
      this.getEntryDataKey(entryId),
    );
    const deletionOperations: Array<Promise<unknown>> = [
      this.config.redis.del(...dataKeys),
      this.config.redis.hdel(this.entryRefsKey, ...uniqueEntryIds),
      this.config.redis.hdel(this.entrySizesKey, ...uniqueEntryIds),
      this.config.redis.zrem(this.globalLruKey, ...uniqueEntryIds),
    ];

    for (const [taskToken, taskEntryIds] of entryIdsByTaskToken) {
      deletionOperations.push(
        this.config.redis.zrem(this.getTaskLruKey(taskToken), ...taskEntryIds),
      );
      deletionOperations.push(
        this.config.redis.srem(
          this.getTaskMembersKey(taskToken),
          ...taskEntryIds,
        ),
      );
    }

    for (const [refMembersKey, refEntryIds] of entryIdsByRefMembersKey) {
      // Shared-budget eviction can remove entries that belong to a different
      // task cache than the current RedisCache instance. Group by the evicted
      // entry's task token so we unlink the correct ref membership sets.
      deletionOperations.push(
        this.config.redis.srem(refMembersKey, ...refEntryIds),
      );
    }

    const [deletedCount] = await Promise.all(deletionOperations);

    if (totalBytesRemoved !== 0) {
      await this.adjustTrackedBytes(this.globalBytesKey, -totalBytesRemoved);

      await Promise.all(
        [...bytesRemovedByTaskToken.entries()].map(([taskToken, taskBytes]) =>
          this.adjustTrackedBytes(this.getTaskBytesKey(taskToken), -taskBytes),
        ),
      );
    }

    return toInteger(deletedCount);
  }

  private async getStoredSize(entryId: string) {
    return toInteger(
      (await this.readHashValues(this.entrySizesKey, [entryId]))[0],
    );
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

  private async readStoredRefsByEntryId(entryIds: readonly string[]) {
    const rawRefs = await this.readHashValues(this.entryRefsKey, entryIds);

    return new Map(
      entryIds.map((entryId, index) => [
        entryId,
        normalizeStoredRefs(rawRefs[index]),
      ]),
    );
  }

  private async readStoredSizesByEntryId(entryIds: readonly string[]) {
    const rawSizes = await this.readHashValues(this.entrySizesKey, entryIds);

    return new Map(
      entryIds.map((entryId, index) => [entryId, toInteger(rawSizes[index])]),
    );
  }

  private async readHashValues(hashKey: string, fields: readonly string[]) {
    const { hmget } = this.config.redis;
    if (typeof hmget === "function") {
      return hmget.call(this.config.redis, hashKey, ...fields);
    }

    return Promise.all(
      fields.map((field) => this.config.redis.hget(hashKey, field)),
    );
  }

  private createEntryId(key: string) {
    return `${this.taskToken}:${hashValue(key)}`;
  }

  private getEntryDataKey(entryId: string) {
    return this.createKey(`entry:${entryId}`);
  }

  private getRefMembersKey(ref: string) {
    return this.getRefMembersKeyForTask(ref, this.taskToken);
  }

  private getRefMembersKeyForTask(ref: string, taskToken: string) {
    return this.createKey(`task:${taskToken}:ref:${hashValue(ref)}:members`);
  }

  private getTaskBytesKey(taskToken: string) {
    return this.createKey(`task:${taskToken}:bytes`);
  }

  private getTaskLruKey(taskToken: string) {
    return this.createKey(`task:${taskToken}:lru`);
  }

  private getTaskMembersKey(taskToken: string) {
    return this.createKey(`task:${taskToken}:members`);
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

function normalizeStoredRefs(value: unknown) {
  if (typeof value !== "string") {
    return [];
  }

  try {
    return normalizeCacheRefs(JSON.parse(value));
  } catch {
    return [];
  }
}
