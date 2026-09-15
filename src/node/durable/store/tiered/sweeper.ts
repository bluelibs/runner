import { durableExecutionInvariantError } from "../../../../errors";
import { archiveTerminalExecutions } from "./archiver";
import type {
  ArchiveTerminalExecutionsResult,
  ColdStorageSweepConfig,
  ColdStorageSweepHandle,
} from "./tieredTypes";

/**
 * Starts a background loop that archives terminal executions on an
 * interval. Runs never overlap: the next run is scheduled only after the
 * previous one completes, and failures are reported via `onError` while
 * the loop keeps running.
 */
export function startColdStorageSweep(
  config: ColdStorageSweepConfig,
): ColdStorageSweepHandle {
  if (!Number.isInteger(config.intervalMs) || config.intervalMs <= 0) {
    return durableExecutionInvariantError.throw({
      message:
        `Cold storage sweep interval must be a positive integer of ` +
        `milliseconds. Received: ${config.intervalMs}.`,
    });
  }

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const runOnce = (): Promise<ArchiveTerminalExecutionsResult> =>
    archiveTerminalExecutions({
      hot: config.hot,
      cold: config.cold,
      minAgeMs: config.minAgeMs,
      limit: config.limit,
      statuses: config.statuses,
      dryRun: config.dryRun,
    });

  const scheduleNext = (): void => {
    if (stopped) {
      return;
    }
    timer = setTimeout(() => void tick(), config.intervalMs);
    timer.unref?.();
  };

  const tick = async (): Promise<void> => {
    try {
      const result = await runOnce();
      try {
        config.onResult?.(result);
      } catch {
        // Listener bugs must not break the sweep loop.
      }
    } catch (error) {
      try {
        config.onError?.(error);
      } catch {
        // Listener bugs must not break the sweep loop.
      }
    } finally {
      scheduleNext();
    }
  };

  scheduleNext();

  return {
    stop: () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
      timer = null;
    },
    runOnce,
  };
}
