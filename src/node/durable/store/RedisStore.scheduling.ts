import * as crypto from "node:crypto";
import { ScheduleStatus, type Schedule, type Timer } from "../core/types";
import type { RedisStoreRuntime } from "./RedisStore.runtime";

export async function createSchedule(
  runtime: RedisStoreRuntime,
  schedule: Schedule,
): Promise<void> {
  await runtime.redis.hset(
    runtime.schedulesKey(),
    schedule.id,
    runtime.serializer.stringify(schedule),
  );
}

export async function getSchedule(
  runtime: RedisStoreRuntime,
  id: string,
): Promise<Schedule | null> {
  const data = runtime.parseRedisString(
    await runtime.redis.hget(runtime.schedulesKey(), id),
  );
  return data ? (runtime.serializer.parse(data) as Schedule) : null;
}

export async function updateSchedule(
  runtime: RedisStoreRuntime,
  id: string,
  updates: Partial<Schedule>,
): Promise<void> {
  const current = await getSchedule(runtime, id);
  if (!current) return;
  await createSchedule(runtime, { ...current, ...updates });
}

export async function saveScheduleWithTimer(
  runtime: RedisStoreRuntime,
  schedule: Schedule,
  timer: Timer,
): Promise<void> {
  await runtime.redis.eval(
    `
      redis.call("hset", KEYS[1], ARGV[1], ARGV[2])
      redis.call("hset", KEYS[2], ARGV[3], ARGV[4])
      redis.call("zadd", KEYS[3], ARGV[5], ARGV[3])
      return "OK"
    `,
    3,
    runtime.schedulesKey(),
    runtime.timersKey(),
    runtime.timersScheduleKey(),
    schedule.id,
    runtime.serializer.stringify(schedule),
    timer.id,
    runtime.serializer.stringify(timer),
    timer.fireAt.getTime(),
  );
}

export async function deleteSchedule(
  runtime: RedisStoreRuntime,
  id: string,
): Promise<void> {
  await runtime.redis.hdel(runtime.schedulesKey(), id);
}

export async function listSchedules(
  runtime: RedisStoreRuntime,
): Promise<Schedule[]> {
  return runtime
    .parseHashValues<Schedule>(
      await runtime.redis.hgetall(runtime.schedulesKey()),
    )
    .map((schedule) => schedule);
}

export async function listActiveSchedules(
  runtime: RedisStoreRuntime,
): Promise<Schedule[]> {
  const schedules = await listSchedules(runtime);
  return schedules.filter(
    (schedule) => schedule.status === ScheduleStatus.Active,
  );
}

export async function acquireLock(
  runtime: RedisStoreRuntime,
  resource: string,
  ttlMs: number,
): Promise<string | null> {
  const lockId = crypto.randomUUID();
  const result = await runtime.redis.set(
    runtime.lockKey(resource),
    lockId,
    "PX",
    ttlMs,
    "NX",
  );
  return result === "OK" ? lockId : null;
}

export async function releaseLock(
  runtime: RedisStoreRuntime,
  resource: string,
  lockId: string,
): Promise<void> {
  await runtime.redis.eval(
    `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `,
    1,
    runtime.lockKey(resource),
    lockId,
  );
}

export async function renewLock(
  runtime: RedisStoreRuntime,
  resource: string,
  lockId: string,
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
    runtime.lockKey(resource),
    lockId,
    `${ttlMs}`,
  );
  return Number(result) === 1;
}
