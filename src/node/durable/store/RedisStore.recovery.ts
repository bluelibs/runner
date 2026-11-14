import { Match } from "../../../tools/check";
import { durableExecutionInvariantError } from "../../../errors";
import { TimerStatus, type Timer } from "../core/types";
import type { RedisStoreRuntime } from "./RedisStore.runtime";

const scanPage = Match.compile({ cursor: String, fields: [String] });

/** Timer membership is separate from the time-ordered polling index. */
export function executionTimerIndexKey(
  runtime: RedisStoreRuntime,
  executionId: string,
): string {
  return runtime.k(`execution_timers:${runtime.encodeKeyPart(executionId)}`);
}

async function ensureTimerIndex(runtime: RedisStoreRuntime): Promise<void> {
  const marker = runtime.k("execution_timer_index_ready");
  if ((await runtime.redis.get(marker)) === "1") return;
  if (!runtime.redis.hscan) {
    return durableExecutionInvariantError.throw({
      message: "Continuous recovery requires a Redis client with hscan().",
    });
  }
  // New writers index atomically. A page-wise backfill safely covers pre-upgrade timers.
  let cursor = "0";
  do {
    const raw = await runtime.redis.hscan(
      runtime.timersKey(),
      cursor,
      "COUNT",
      100,
    );
    const page = scanPage.parse({
      cursor: Array.isArray(raw) ? raw[0] : undefined,
      fields: Array.isArray(raw) ? raw[1] : undefined,
    });
    cursor = page.cursor;
    for (let index = 1; index < page.fields.length; index += 2) {
      const timer = runtime.serializer.parse<Timer>(page.fields[index]);
      if (timer.executionId !== undefined) {
        await runtime.redis.sadd(
          executionTimerIndexKey(runtime, timer.executionId),
          timer.id,
        );
      }
    }
  } while (cursor !== "0");
  await runtime.redis.set(marker, "1");
}

/** Reads one execution's timers, pruning stale membership after waiter/poller cleanup. */
export async function getExecutionTimers(
  runtime: RedisStoreRuntime,
  executionId: string,
): Promise<Timer[]> {
  await ensureTimerIndex(runtime);
  const key = executionTimerIndexKey(runtime, executionId);
  const ids = await runtime.scanSetMembers(key);
  if (ids.length === 0) return [];
  const pipeline = runtime.redis.pipeline();
  for (const id of ids) pipeline.hget(runtime.timersKey(), id);
  const values = await pipeline.exec();
  if (!values) return [];
  const timers: Timer[] = [];
  for (let index = 0; index < ids.length; index++) {
    if (values[index]?.[0]) {
      return durableExecutionInvariantError.throw({
        message: "Redis execution timer inspection failed.",
      });
    }
    const value = runtime.parseRedisString(values[index]?.[1]);
    const timer = value ? runtime.serializer.parse<Timer>(value) : null;
    if (
      timer?.executionId === executionId &&
      timer.status === TimerStatus.Pending
    ) {
      timers.push(timer);
    } else {
      // A timer can be recreated between inspection and cleanup. Remove only the observed record.
      await runtime.redis.eval(
        `
        if (redis.call("hget", KEYS[1], ARGV[1]) or "") == ARGV[2] then
          return redis.call("srem", KEYS[2], ARGV[1])
        end
        return 0
      `,
        2,
        runtime.timersKey(),
        key,
        ids[index],
        value ?? "",
      );
    }
  }
  return timers;
}
