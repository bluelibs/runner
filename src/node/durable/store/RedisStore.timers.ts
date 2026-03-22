import { TimerStatus, type Timer } from "../core/types";
import { serializer, type RedisStoreRuntime } from "./RedisStore.runtime";

export async function createTimer(
  runtime: RedisStoreRuntime,
  timer: Timer,
): Promise<void> {
  await runtime.redis.eval(
    `
      redis.call("hset", KEYS[1], ARGV[1], ARGV[2])
      redis.call("zadd", KEYS[2], ARGV[3], ARGV[1])
      return "OK"
    `,
    2,
    runtime.timersKey(),
    runtime.timersScheduleKey(),
    timer.id,
    serializer.stringify(timer),
    timer.fireAt.getTime(),
  );
}

export async function getReadyTimers(
  runtime: RedisStoreRuntime,
  now: Date,
): Promise<Timer[]> {
  const timerIdsUnknown = await runtime.redis.zrangebyscore(
    runtime.timersScheduleKey(),
    0,
    now.getTime(),
  );
  const timerIds =
    Array.isArray(timerIdsUnknown) &&
    timerIdsUnknown.every((timerId) => typeof timerId === "string")
      ? timerIdsUnknown
      : [];
  if (timerIds.length === 0) return [];

  const pipeline = runtime.redis.pipeline();
  timerIds.forEach((id) => pipeline.hget(runtime.timersKey(), id));
  const results = await pipeline.exec();
  if (!results) return [];

  return results
    .map(([_, result]) =>
      typeof result === "string" ? (serializer.parse(result) as Timer) : null,
    )
    .filter(
      (timer): timer is Timer =>
        timer !== null && timer.status === TimerStatus.Pending,
    );
}

export async function markTimerFired(
  runtime: RedisStoreRuntime,
  timerId: string,
): Promise<void> {
  const outcome = await runtime.redis.eval(
    `
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
    `,
    2,
    runtime.timersKey(),
    runtime.timersScheduleKey(),
    timerId,
    TimerStatus.Fired,
  );
  runtime.assertEvalResultNotError(outcome);
}

export async function deleteTimer(
  runtime: RedisStoreRuntime,
  timerId: string,
): Promise<void> {
  await runtime.redis.eval(
    `
      redis.call("hdel", KEYS[1], ARGV[1])
      redis.call("zrem", KEYS[2], ARGV[1])
      return 1
    `,
    2,
    runtime.timersKey(),
    runtime.timersScheduleKey(),
    timerId,
  );
}

export async function claimTimer(
  runtime: RedisStoreRuntime,
  timerId: string,
  workerId: string,
  ttlMs: number,
): Promise<boolean> {
  const result = await runtime.redis.set(
    runtime.timerClaimKey(timerId),
    workerId,
    "PX",
    ttlMs,
    "NX",
  );
  return result === "OK";
}

export async function renewTimerClaim(
  runtime: RedisStoreRuntime,
  timerId: string,
  workerId: string,
  ttlMs: number,
): Promise<boolean> {
  const result = await runtime.redis.eval(
    `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("pexpire", KEYS[1], ARGV[2])
      else
        return 0
      end
    `,
    1,
    runtime.timerClaimKey(timerId),
    workerId,
    `${ttlMs}`,
  );
  return Number(result) === 1;
}

export async function releaseTimerClaim(
  runtime: RedisStoreRuntime,
  timerId: string,
  workerId: string,
): Promise<boolean> {
  const result = await runtime.redis.eval(
    `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `,
    1,
    runtime.timerClaimKey(timerId),
    workerId,
  );
  return Number(result) === 1;
}

export async function finalizeClaimedTimer(
  runtime: RedisStoreRuntime,
  timerId: string,
  workerId: string,
): Promise<boolean> {
  const result = await runtime.redis.eval(
    `
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
    `,
    3,
    runtime.timersKey(),
    runtime.timersScheduleKey(),
    runtime.timerClaimKey(timerId),
    timerId,
    workerId,
    TimerStatus.Fired,
  );
  runtime.assertEvalResultNotError(result);
  return Number(result) === 1;
}
