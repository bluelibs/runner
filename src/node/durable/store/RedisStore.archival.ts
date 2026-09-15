import type { RedisStoreRuntime } from "./RedisStore.runtime";

/**
 * Deletes the persisted history of one execution: the execution record, its
 * step and audit buckets, its signal journals, and its index memberships.
 *
 * Idempotency mappings, timers, waiters, schedules, and locks are left
 * untouched by design (see `IDurableStore.deleteExecutionData`). Unknown
 * executions are a no-op because `DEL` and `SREM` already are.
 */
export async function deleteExecutionData(
  runtime: RedisStoreRuntime,
  executionId: string,
): Promise<void> {
  const signalIds = await runtime.scanSetMembers(
    runtime.signalIdsKey(executionId),
  );
  const dataKeys = [
    runtime.executionKey(executionId),
    runtime.stepBucketKey(executionId),
    runtime.auditBucketKey(executionId),
    runtime.signalIdsKey(executionId),
    ...signalIds.map((signalId) => runtime.signalKey(executionId, signalId)),
  ];
  await runtime.redis.eval(
    `
      for index = 1, #KEYS - 3 do
        redis.call("del", KEYS[index])
      end
      redis.call("srem", KEYS[#KEYS - 2], ARGV[1])
      redis.call("srem", KEYS[#KEYS - 1], ARGV[1])
      redis.call("srem", KEYS[#KEYS], ARGV[1])
      return "OK"
    `,
    dataKeys.length + 3,
    ...dataKeys,
    runtime.allExecutionsKey(),
    runtime.activeExecutionsKey(),
    runtime.stuckExecutionsKey(),
    executionId,
  );
}
