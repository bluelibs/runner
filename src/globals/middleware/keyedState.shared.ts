import type { ITimerHandle, ITimers } from "../../types/timers";
import { middlewareKeyCapacityExceededError } from "../../errors";

const MIN_KEYED_STATE_CLEANUP_INTERVAL_MS = 1_000;
const MAX_KEYED_STATE_CLEANUP_INTERVAL_MS = 60_000;

export interface CleanupTimerState {
  cleanupIntervalMs?: number;
  cleanupTimer?: ITimerHandle;
}

export interface KeyedStateCapacityOptions {
  hasKey: boolean;
  maxKeys: number | undefined;
  middlewareId: string;
  prune: () => void;
  size: () => number;
}

export function ensureKeyedStateCapacity(
  options: KeyedStateCapacityOptions,
): void {
  if (options.hasKey) {
    return;
  }

  options.prune();

  if (options.maxKeys === undefined) {
    return;
  }

  if (options.size() < options.maxKeys) {
    return;
  }

  middlewareKeyCapacityExceededError.throw({
    maxKeys: options.maxKeys,
    middlewareId: options.middlewareId,
  });
}

export function deriveKeyedStateCleanupInterval(
  values: Iterable<number>,
): number | undefined {
  let minValue: number | undefined;

  for (const value of values) {
    if (minValue === undefined || value < minValue) {
      minValue = value;
    }
  }

  if (minValue === undefined) {
    return undefined;
  }

  return Math.min(
    MAX_KEYED_STATE_CLEANUP_INTERVAL_MS,
    Math.max(MIN_KEYED_STATE_CLEANUP_INTERVAL_MS, minValue),
  );
}

export function syncCleanupTimer(
  state: CleanupTimerState,
  timers: ITimers,
  intervalMs: number | undefined,
  callback?: () => void | Promise<void>,
): void {
  if (intervalMs === undefined) {
    state.cleanupTimer?.cancel();
    state.cleanupTimer = undefined;
    state.cleanupIntervalMs = undefined;
    return;
  }

  if (state.cleanupTimer && state.cleanupIntervalMs === intervalMs) {
    return;
  }

  state.cleanupTimer?.cancel();
  state.cleanupIntervalMs = intervalMs;
  state.cleanupTimer = timers.setInterval(callback!, intervalMs);
}
