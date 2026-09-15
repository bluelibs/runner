import type { IDurableStore } from "../../core/interfaces/store";
import type { ExecutionStatus } from "../../core/types";

/**
 * Hot + cold durable stores composed into one uniform store.
 *
 * Both tiers are plain `IDurableStore` implementations: any store (memory,
 * persistent file, Redis, or a custom backend) can serve either role, so cold
 * storage composes uniformly with durable instead of needing a dedicated
 * backend interface.
 */
export interface TieredDurableStoreConfig {
  /**
   * Live store: owns all writes, timers, waiters, locks, schedules, and
   * listings. The runtime and the operator read active executions from here.
   */
  hot: IDurableStore;
  /**
   * Archive store: holds terminal executions moved by
   * `archiveTerminalExecutions`. Consulted only for executions unknown to
   * hot, and directly (as any other store) for cold history queries.
   */
  cold: IDurableStore;
}

/** Why one archive candidate was left in the hot store. */
export type ArchiveSkipReason =
  | "not_terminal"
  | "too_fresh"
  | "missing_from_hot";

/**
 * One execution left in the hot store by an archive run.
 */
export interface ArchiveSkippedExecution {
  /** Execution id that was left in place. */
  executionId: string;
  /** Why it was left in place. */
  reason: ArchiveSkipReason;
}

/**
 * Options for `archiveTerminalExecutions`.
 */
export interface ArchiveTerminalExecutionsOptions {
  /**
   * Only archives executions finished longer ago than this.
   *
   * Gives late timers and signals time to settle before the move.
   * Defaults to 24 hours. Use 0 to archive immediately.
   */
  minAgeMs?: number;
  /**
   * Maximum executions moved per run. Defaults to 100.
   */
  limit?: number;
  /**
   * Terminal statuses eligible for archival.
   *
   * Defaults to completed/failed/cancelled. `compensation_failed` is
   * excluded by default because it still needs operator recovery first;
   * pass it explicitly once a recovery workflow is in place.
   */
  statuses?: ExecutionStatus[];
  /**
   * Reports candidates without moving anything. Defaults to false.
   */
  dryRun?: boolean;
  /**
   * Clock override for tests. Defaults to now.
   */
  now?: Date;
}

/**
 * Outcome of one `archiveTerminalExecutions` run.
 */
export interface ArchiveTerminalExecutionsResult {
  /**
   * Ids moved to cold, or that would move when `dryRun` is true.
   */
  archived: string[];
  /**
   * Candidates left in hot, with reasons.
   */
  skipped: ArchiveSkippedExecution[];
  /**
   * Echoes the requested dry-run mode.
   */
  dryRun: boolean;
}

/**
 * Configuration for `startColdStorageSweep`.
 */
export interface ColdStorageSweepConfig extends Omit<
  ArchiveTerminalExecutionsOptions,
  "now"
> {
  /**
   * Live store executions are archived from.
   */
  hot: IDurableStore;
  /**
   * Archive store executions are moved to.
   */
  cold: IDurableStore;
  /**
   * Delay between sweep runs in milliseconds. Runs never overlap: the next
   * run is scheduled only after the previous one completes.
   */
  intervalMs: number;
  /**
   * Receives every sweep outcome. Listener errors are swallowed so one bad
   * listener cannot break the sweep loop.
   */
  onResult?: (result: ArchiveTerminalExecutionsResult) => void;
  /**
   * Receives sweep failures; the loop keeps running. Listener errors are
   * swallowed so one bad listener cannot break the sweep loop.
   */
  onError?: (error: unknown) => void;
}

/**
 * Handle for a running cold storage sweep loop.
 */
export interface ColdStorageSweepHandle {
  /**
   * Stops scheduling further sweep runs.
   */
  stop(): void;
  /**
   * Runs one archive pass immediately, independent of the loop.
   */
  runOnce(): Promise<ArchiveTerminalExecutionsResult>;
}
