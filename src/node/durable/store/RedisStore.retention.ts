import type { RedisStoreRuntime } from "./RedisStore.runtime";
import type { Execution, Timer } from "../core/types";
import { check } from "../../../tools/check";
import { collectionDeadline, receiptExpiryDeadline } from "../core/retention";
import { executionTimerIndexKey } from "./RedisStore.recovery";
import { historyKey, historySequenceKey } from "./RedisStore.history";
import { commandQueueKey } from "./RedisStore.commandTimer";

async function collectExecutionDetailKeys(
  runtime: RedisStoreRuntime,
  id: string,
): Promise<string[]> {
  const signalIds = await runtime.scanSetMembers(runtime.signalIdsKey(id));
  const detailKeys = signalIds.flatMap((signal) => [
    runtime.signalKey(id, signal),
    runtime.signalWaiterOrderKey(id, signal),
    runtime.signalWaiterPayloadKey(id, signal),
    runtime.signalWaiterStepKey(id, signal),
  ]);
  detailKeys.push(executionTimerIndexKey(runtime, id));
  detailKeys.push(historyKey(runtime, id), historySequenceKey(runtime, id));
  return detailKeys;
}

/** One Lua commit serializes collection against lifecycle/operator writes. */
export async function collectCompletedHistory(
  runtime: RedisStoreRuntime,
  now: Date,
  limit: number,
): Promise<number> {
  const index = runtime.k("execution_index_metadata:cleanup");
  const ids = await runtime.redis.zrangebyscore(
    index,
    "-inf",
    now.getTime(),
    "LIMIT",
    0,
    limit,
  );
  check(ids, [String]);
  let collected = 0;
  let timersByExecution: Map<string, string[]> | undefined;
  for (const id of ids as string[]) {
    const raw = runtime.parseRedisString(
      await runtime.redis.get(runtime.executionKey(id)),
    );
    if (!raw) {
      await runtime.redis.zrem(index, id);
      continue;
    }
    const execution = runtime.serializer.parse<Execution>(raw);
    // The policy may have changed after this execution was selected from the index.
    const deadline = collectionDeadline(execution);
    if (deadline === undefined || deadline > now.getTime()) continue;
    const detailKeys = await collectExecutionDetailKeys(runtime, id);
    timersByExecution ??= await readTimersByExecution(runtime);
    const timerIds = timersByExecution.get(id) ?? [];
    const compacted = runtime.serializer.stringify({
      ...execution,
      input: undefined,
      historyCollectedAt: now,
    });
    const outcome = await runtime.redis.eval(
      `
      local raw = redis.call("get", KEYS[1])
      if raw ~= ARGV[2] then return 0 end
      local execution = cjson.decode(raw)
      if execution.status ~= "completed" then redis.call("zrem", KEYS[2], ARGV[1]); return 0 end
      if redis.call("exists", KEYS[8]) == 1 or redis.call("hlen", KEYS[6]) > 0 then
        redis.call("zadd", KEYS[2], ARGV[7], ARGV[1]); return 0
      end
      if type(execution.parentExecutionId) == "string" then
        local parentRaw = redis.call("get", ARGV[4] .. execution.parentExecutionId)
        if (parentRaw and cjson.decode(parentRaw).status ~= "completed") or (not parentRaw and execution.parentExecutionInStore ~= true) then
          redis.call("zadd", KEYS[2], ARGV[7], ARGV[1]); return 0
        end
      end
      for _, key in ipairs(cjson.decode(ARGV[5])) do redis.call("del", key) end
      for _, timerId in ipairs(cjson.decode(ARGV[6])) do
        redis.call("hdel", KEYS[9], timerId)
        redis.call("zrem", KEYS[10], timerId)
      end
      redis.call("del", KEYS[3], KEYS[4], KEYS[5], KEYS[7])
      redis.call("set", KEYS[1], ARGV[3])
      redis.call("zrem", KEYS[2], ARGV[1])
      return 1
    `,
      10,
      runtime.executionKey(id),
      index,
      runtime.stepBucketKey(id),
      runtime.auditBucketKey(id),
      runtime.workflowStateKey(id),
      runtime.executionWaiterKey(id),
      runtime.signalIdsKey(id),
      runtime.lockKey(`execution:${id}`),
      runtime.timersKey(),
      runtime.timersScheduleKey(),
      id,
      raw,
      compacted,
      runtime.k("exec:"),
      JSON.stringify(detailKeys),
      JSON.stringify(timerIds),
      now.getTime() + 60_000,
    );
    if (outcome === 1) collected++;
  }
  return collected;
}

/** Atomically expires due completion receipts, indexes, idempotency, and commands. */
export async function collectExpiredReceipts(
  runtime: RedisStoreRuntime,
  now: Date,
  limit: number,
): Promise<number> {
  const index = runtime.k("execution_index_metadata:receipt_cleanup");
  const cleanupIndex = runtime.k("execution_index_metadata:cleanup");
  const ids = await runtime.redis.zrangebyscore(
    index,
    "-inf",
    now.getTime(),
    "LIMIT",
    0,
    limit,
  );
  check(ids, [String]);
  let collected = 0;
  let timersByExecution: Map<string, string[]> | undefined;
  for (const id of ids as string[]) {
    const executionKey = runtime.executionKey(id);
    const raw = runtime.parseRedisString(await runtime.redis.get(executionKey));
    if (!raw) {
      await runtime.redis.zrem(index, id);
      continue;
    }
    const execution = runtime.serializer.parse<Execution>(raw);
    const deadline = receiptExpiryDeadline(execution);
    if (deadline === undefined) {
      await runtime.redis.zrem(index, id);
      continue;
    }
    if (deadline > now.getTime()) continue;
    const detailKeys = await collectExecutionDetailKeys(runtime, id);
    timersByExecution ??= await readTimersByExecution(runtime);
    const timerIds = timersByExecution.get(id) ?? [];
    const idemKeys = await runtime.scanSetMembers(`${executionKey}:idem`);
    const commandIds = await runtime.scanSetMembers(`${executionKey}:commands`);
    const outcome = await runtime.redis.eval(
      `
      local raw = redis.call("get", KEYS[1])
      if raw ~= ARGV[2] then return 0 end
      local execution = cjson.decode(raw)
      if execution.status ~= "completed" then redis.call("zrem", KEYS[2], ARGV[1]); return 0 end
      if redis.call("exists", KEYS[14]) == 1 or redis.call("hlen", KEYS[12]) > 0 or redis.call("llen", KEYS[17]) > 0 then
        redis.call("zadd", KEYS[2], ARGV[8], ARGV[1]); return 0
      end
      if type(execution.parentExecutionId) == "string" then
        local parentRaw = redis.call("get", ARGV[3] .. execution.parentExecutionId)
        if (parentRaw and cjson.decode(parentRaw).status ~= "completed") or (not parentRaw and execution.parentExecutionInStore ~= true) then
          redis.call("zadd", KEYS[2], ARGV[8], ARGV[1]); return 0
        end
      end
      local previous = redis.call("hget", KEYS[7], ARGV[1])
      if previous then
        local oldIndex = cjson.decode(previous)
        for _, partition in ipairs(oldIndex.partitions) do
          redis.call("zrem", partition, oldIndex.member)
        end
        redis.call("hdel", KEYS[8], oldIndex.member)
        redis.call("hdel", KEYS[7], ARGV[1])
      end
      redis.call("srem", KEYS[4], ARGV[1])
      redis.call("srem", KEYS[5], ARGV[1])
      redis.call("srem", KEYS[6], ARGV[1])
      for _, key in ipairs(cjson.decode(ARGV[4])) do redis.call("del", key) end
      for _, timerId in ipairs(cjson.decode(ARGV[5])) do
        redis.call("hdel", KEYS[15], timerId)
        redis.call("zrem", KEYS[16], timerId)
      end
      for _, idemKey in ipairs(cjson.decode(ARGV[6])) do
        if redis.call("get", idemKey) == ARGV[1] then redis.call("del", idemKey) end
      end
      for _, cmdId in ipairs(cjson.decode(ARGV[7])) do
        redis.call("hdel", KEYS[18], cmdId)
        redis.call("hdel", KEYS[19], cmdId)
      end
      redis.call("del", KEYS[1], KEYS[9], KEYS[10], KEYS[11], KEYS[12], KEYS[13], KEYS[17], KEYS[20], KEYS[21])
      redis.call("zrem", KEYS[2], ARGV[1])
      redis.call("zrem", KEYS[3], ARGV[1])
      return 1
    `,
      21,
      executionKey,
      index,
      cleanupIndex,
      runtime.allExecutionsKey(),
      runtime.activeExecutionsKey(),
      runtime.stuckExecutionsKey(),
      runtime.k("execution_index_metadata"),
      runtime.k("execution_index_states"),
      runtime.stepBucketKey(id),
      runtime.auditBucketKey(id),
      runtime.workflowStateKey(id),
      runtime.executionWaiterKey(id),
      runtime.signalIdsKey(id),
      runtime.lockKey(`execution:${id}`),
      runtime.timersKey(),
      runtime.timersScheduleKey(),
      commandQueueKey(runtime, id),
      runtime.k("command_receipts"),
      runtime.k("command_statuses"),
      `${executionKey}:idem`,
      `${executionKey}:commands`,
      id,
      raw,
      runtime.k("exec:"),
      JSON.stringify(detailKeys),
      JSON.stringify(timerIds),
      JSON.stringify(idemKeys),
      JSON.stringify(commandIds),
      now.getTime() + 60_000,
    );
    if (outcome === 1) collected++;
  }
  return collected;
}

async function readTimersByExecution(
  runtime: RedisStoreRuntime,
): Promise<Map<string, string[]>> {
  const timers = runtime.parseHashValues<Timer>(
    await runtime.redis.hgetall(runtime.timersKey()),
  );
  const grouped = new Map<string, string[]>();
  for (const timer of timers) {
    if (timer.executionId === undefined) continue;
    const ids = grouped.get(timer.executionId) ?? [];
    ids.push(timer.id);
    grouped.set(timer.executionId, ids);
  }
  return grouped;
}
