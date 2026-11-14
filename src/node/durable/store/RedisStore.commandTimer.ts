import { commandWakeupTimer } from "../core/commandWakeup";
import { executionTimerIndexKey } from "./RedisStore.recovery";
import type { RedisStoreRuntime } from "./RedisStore.runtime";

/** FIFO identity is the full persisted execution id. */
export function commandQueueKey(
  runtime: RedisStoreRuntime,
  id: string,
): string {
  return runtime.k(`command_queue:${runtime.encodeKeyPart(id)}`);
}

/** Keys: FIFO, timer records, due index, execution index. Arguments: id, payload, deadline, replace. */
export const syncCommandTimerScript = `
  local pending = redis.call("llen", KEYS[1]) > 0
  if pending then
    if ARGV[4] == "1" or redis.call("hexists", KEYS[2], ARGV[1]) == 0 then
      redis.call("hset", KEYS[2], ARGV[1], ARGV[2])
      redis.call("zadd", KEYS[3], ARGV[3], ARGV[1])
      redis.call("sadd", KEYS[4], ARGV[1])
    end
  else
    redis.call("hdel", KEYS[2], ARGV[1])
    redis.call("zrem", KEYS[3], ARGV[1])
    redis.call("srem", KEYS[4], ARGV[1])
  end
`;

/** Shared timer keys also participate in command admission and completion scripts. */
export function commandTimerKeys(
  runtime: RedisStoreRuntime,
  id: string,
): string[] {
  return [
    runtime.timersKey(),
    runtime.timersScheduleKey(),
    executionTimerIndexKey(runtime, id),
  ];
}

/** Reconciliation never deletes a claim, including one held by an older delivery. */
export async function rescheduleCommandTimer(
  runtime: RedisStoreRuntime,
  executionId: string,
  fireAt: Date,
): Promise<boolean> {
  const timer = commandWakeupTimer(executionId, fireAt);
  const result = await runtime.redis.eval(
    `${syncCommandTimerScript} return pending and 1 or 0`,
    4,
    commandQueueKey(runtime, executionId),
    ...commandTimerKeys(runtime, executionId),
    timer.id,
    runtime.serializer.stringify(timer),
    fireAt.getTime(),
    "1",
  );
  return result === 1;
}
