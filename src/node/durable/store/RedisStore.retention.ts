import type { RedisStoreRuntime } from "./RedisStore.runtime";
import type { Execution, Timer } from "../core/types";
import { check } from "../../../tools/check";
import { collectionDeadline } from "../core/retention";

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
    const signalIds = await runtime.scanSetMembers(runtime.signalIdsKey(id));
    const detailKeys = signalIds.flatMap((signal) => [
      runtime.signalKey(id, signal),
      runtime.signalWaiterOrderKey(id, signal),
      runtime.signalWaiterPayloadKey(id, signal),
      runtime.signalWaiterStepKey(id, signal),
    ]);
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
        if not parentRaw or cjson.decode(parentRaw).status ~= "completed" then
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
