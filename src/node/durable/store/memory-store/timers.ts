import { TimerStatus, type Timer } from "../../core/types";
import { cloneTimer, compareTimersByReadyOrder } from "./shared";
import type { MemoryStoreRuntime } from "./runtime";

function getTimerClaimKey(timerId: string): string {
  return `timer:claim:${timerId}`;
}

function listReadyPendingTimers(
  runtime: MemoryStoreRuntime,
  now: Date,
): Timer[] {
  return Array.from(runtime.timers.values())
    .filter(
      (timer) => timer.status === TimerStatus.Pending && timer.fireAt <= now,
    )
    .sort(compareTimersByReadyOrder);
}

export async function createTimer(
  runtime: MemoryStoreRuntime,
  timer: Timer,
): Promise<void> {
  runtime.timers.set(timer.id, cloneTimer(timer));
  await runtime.persistDurableMutation();
}

export async function getReadyTimers(
  runtime: MemoryStoreRuntime,
  now: Date,
): Promise<Timer[]> {
  return listReadyPendingTimers(runtime, now).map(cloneTimer);
}

export async function markTimerFired(
  runtime: MemoryStoreRuntime,
  timerId: string,
): Promise<void> {
  const timer = runtime.timers.get(timerId);
  if (!timer) {
    return;
  }

  runtime.timers.set(timerId, {
    ...timer,
    status: TimerStatus.Fired,
  });
  await runtime.persistDurableMutation();
}

export async function deleteTimer(
  runtime: MemoryStoreRuntime,
  timerId: string,
): Promise<void> {
  if (!runtime.timers.delete(timerId)) {
    return;
  }

  await runtime.persistDurableMutation();
}

export async function claimTimer(
  runtime: MemoryStoreRuntime,
  timerId: string,
  workerId: string,
  ttlMs: number,
): Promise<boolean> {
  const claimKey = getTimerClaimKey(timerId);
  const now = Date.now();
  runtime.pruneExpiredLocks(now);
  const existing = runtime.locks.get(claimKey);
  if (existing && existing.expires > now) {
    return false;
  }

  runtime.locks.set(claimKey, {
    id: workerId,
    expires: now + ttlMs,
  });
  return true;
}

export async function renewTimerClaim(
  runtime: MemoryStoreRuntime,
  timerId: string,
  workerId: string,
  ttlMs: number,
): Promise<boolean> {
  const claimKey = getTimerClaimKey(timerId);
  const now = Date.now();
  runtime.pruneExpiredLocks(now);
  const existing = runtime.locks.get(claimKey);
  if (!existing || existing.id !== workerId) {
    return false;
  }

  runtime.locks.set(claimKey, {
    id: workerId,
    expires: now + ttlMs,
  });
  return true;
}

export async function releaseTimerClaim(
  runtime: MemoryStoreRuntime,
  timerId: string,
  workerId: string,
): Promise<boolean> {
  const claimKey = getTimerClaimKey(timerId);
  const now = Date.now();
  runtime.pruneExpiredLocks(now);
  const existing = runtime.locks.get(claimKey);
  if (!existing || existing.id !== workerId || existing.expires <= now) {
    return false;
  }

  runtime.locks.delete(claimKey);
  return true;
}

export async function finalizeClaimedTimer(
  runtime: MemoryStoreRuntime,
  timerId: string,
  workerId: string,
): Promise<boolean> {
  const claimKey = getTimerClaimKey(timerId);
  const now = Date.now();
  runtime.pruneExpiredLocks(now);
  const existing = runtime.locks.get(claimKey);
  if (!existing || existing.id !== workerId || existing.expires <= now) {
    return false;
  }

  const timer = runtime.timers.get(timerId);
  if (!timer) {
    runtime.locks.delete(claimKey);
    return true;
  }

  runtime.timers.delete(timerId);
  runtime.locks.delete(claimKey);
  await runtime.persistDurableMutation();
  return true;
}
