import { randomUUID } from "node:crypto";
import { ScheduleStatus, type Schedule, type Timer } from "../../core/types";
import { cloneSchedule, cloneTimer } from "./shared";
import type { MemoryStoreRuntime } from "./runtime";

export async function createSchedule(
  runtime: MemoryStoreRuntime,
  schedule: Schedule,
): Promise<void> {
  runtime.schedules.set(schedule.id, cloneSchedule(schedule));
  await runtime.persistDurableMutation();
}

export async function getSchedule(
  runtime: MemoryStoreRuntime,
  id: string,
): Promise<Schedule | null> {
  const schedule = runtime.schedules.get(id);
  return schedule ? cloneSchedule(schedule) : null;
}

export async function updateSchedule(
  runtime: MemoryStoreRuntime,
  id: string,
  updates: Partial<Schedule>,
): Promise<void> {
  const schedule = runtime.schedules.get(id);
  if (!schedule) {
    return;
  }

  runtime.schedules.set(id, cloneSchedule({ ...schedule, ...updates }));
  await runtime.persistDurableMutation();
}

export async function saveScheduleWithTimer(
  runtime: MemoryStoreRuntime,
  schedule: Schedule,
  timer: Timer,
): Promise<void> {
  runtime.schedules.set(schedule.id, cloneSchedule(schedule));
  runtime.timers.set(timer.id, cloneTimer(timer));
  await runtime.persistDurableMutation();
}

export async function deleteSchedule(
  runtime: MemoryStoreRuntime,
  id: string,
): Promise<void> {
  if (!runtime.schedules.delete(id)) {
    return;
  }

  await runtime.persistDurableMutation();
}

export async function listSchedules(
  runtime: MemoryStoreRuntime,
): Promise<Schedule[]> {
  return Array.from(runtime.schedules.values()).map(cloneSchedule);
}

export async function listActiveSchedules(
  runtime: MemoryStoreRuntime,
): Promise<Schedule[]> {
  return Array.from(runtime.schedules.values())
    .filter((schedule) => schedule.status === ScheduleStatus.Active)
    .map(cloneSchedule);
}

export async function acquireLock(
  runtime: MemoryStoreRuntime,
  resource: string,
  ttlMs: number,
): Promise<string | null> {
  const now = Date.now();
  runtime.pruneExpiredLocks(now);
  const lock = runtime.locks.get(resource);
  if (lock && lock.expires > now) {
    return null;
  }

  const lockId = randomUUID();
  runtime.locks.set(resource, {
    id: lockId,
    expires: now + ttlMs,
  });
  return lockId;
}

export async function renewLock(
  runtime: MemoryStoreRuntime,
  resource: string,
  lockId: string,
  ttlMs: number,
): Promise<boolean> {
  const now = Date.now();
  runtime.pruneExpiredLocks(now);

  const lock = runtime.locks.get(resource);
  if (!lock || lock.id !== lockId) {
    return false;
  }

  runtime.locks.set(resource, {
    id: lockId,
    expires: now + ttlMs,
  });
  return true;
}

export async function releaseLock(
  runtime: MemoryStoreRuntime,
  resource: string,
  lockId: string,
): Promise<void> {
  const lock = runtime.locks.get(resource);
  if (lock && lock.id === lockId) {
    runtime.locks.delete(resource);
  }
}
