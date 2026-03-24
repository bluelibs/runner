import { durableStoreShapeError } from "../../../errors";
import { TimerStatus, type Timer } from "../core/types";
import { serializer, type RedisStoreRuntime } from "./RedisStore.runtime";

function parsePendingTimerPayloads(payloads: unknown[]): Timer[] {
  return payloads
    .map((payload) =>
      typeof payload === "string" ? (serializer.parse(payload) as Timer) : null,
    )
    .filter(
      (timer): timer is Timer =>
        timer !== null && timer.status === TimerStatus.Pending,
    );
}

function parseClaimedTimerPayloads(payloads: unknown): Timer[] {
  if (!Array.isArray(payloads)) {
    durableStoreShapeError.throw({
      message: "Unexpected Redis claimed timer response shape",
    });
  }

  const claimedPayloads = payloads as unknown[];

  return claimedPayloads.map((payload: unknown) => {
    if (typeof payload !== "string") {
      return durableStoreShapeError.throw({
        message: "Unexpected Redis claimed timer payload shape",
      });
    }

    const timer = serializer.parse(payload) as Timer;
    if (timer.status !== TimerStatus.Pending) {
      return durableStoreShapeError.throw({
        message: `Unexpected claimed timer status '${String(timer.status)}'`,
      });
    }

    return timer;
  });
}

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

  return parsePendingTimerPayloads(results.map(([, result]) => result));
}

export async function claimReadyTimers(
  runtime: RedisStoreRuntime,
  now: Date,
  limit: number,
  workerId: string,
  ttlMs: number,
): Promise<Timer[]> {
  if (limit <= 0) {
    return [];
  }

  const scanBatch = Math.max(limit * 4, 50);
  const result = await runtime.redis.eval(
    `
      local limit = tonumber(ARGV[3]) or 0
      if limit <= 0 then
        return {}
      end

      local nowMs = tonumber(ARGV[1]) or 0
      local nowIso = ARGV[2]
      local workerId = ARGV[4]
      local ttlMs = tonumber(ARGV[5]) or 0
      local scanBatch = tonumber(ARGV[6]) or limit
      local claimKeyPrefix = ARGV[7]
      local pendingStatus = ARGV[8]
      local claimed = {}
      local offset = 0

      while #claimed < limit do
        local timerIds = redis.call(
          "zrangebyscore",
          KEYS[1],
          0,
          nowMs,
          "LIMIT",
          offset,
          scanBatch
        )

        if #timerIds == 0 then
          break
        end

        offset = offset + #timerIds

        for _, timerId in ipairs(timerIds) do
          if #claimed >= limit then
            break
          end

          local claimKey = claimKeyPrefix .. timerId
          if redis.call("set", claimKey, workerId, "PX", ttlMs, "NX") then
            local current = redis.call("hget", KEYS[2], timerId)
            if current then
              local okTimer, timer = pcall(cjson.decode, current)
              if not okTimer then
                redis.call("del", claimKey)
                return "__error__:Corrupted durable timer payload"
              end

              local fireAt = timer.fireAt
              if type(fireAt) ~= "table" or fireAt.__type ~= "Date" or type(fireAt.value) ~= "string" then
                redis.call("del", claimKey)
                return "__error__:Corrupted durable timer payload"
              end

              if timer.status == pendingStatus and fireAt.value <= nowIso then
                table.insert(claimed, current)
              else
                redis.call("del", claimKey)
              end
            else
              redis.call("del", claimKey)
            end
          end
        end
      end

      return claimed
    `,
    2,
    runtime.timersScheduleKey(),
    runtime.timersKey(),
    `${now.getTime()}`,
    now.toISOString(),
    `${limit}`,
    workerId,
    `${ttlMs}`,
    `${scanBatch}`,
    runtime.k("timer:claim:"),
    TimerStatus.Pending,
  );
  runtime.assertEvalResultNotError(result);

  return parseClaimedTimerPayloads(result);
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
