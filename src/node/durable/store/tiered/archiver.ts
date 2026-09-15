import type { IDurableStore } from "../../core/interfaces/store";
import {
  ExecutionStatus,
  isExecutionTerminal,
  type Execution,
} from "../../core/types";
import { durableExecutionInvariantError } from "../../../../errors";
import {
  copyExecutionData,
  countExecutionData,
  requireExecutionDataDeletion,
  sameExecutionDataCounts,
} from "./tieredCopy";
import type {
  ArchiveSkippedExecution,
  ArchiveSkipReason,
  ArchiveTerminalExecutionsOptions,
  ArchiveTerminalExecutionsResult,
} from "./tieredTypes";

/**
 * Default archive grace period (24h): only executions finished longer ago
 * than this are moved, giving late timers and signals time to settle.
 */
export const DEFAULT_COLD_STORAGE_MIN_AGE_MS = 86_400_000;

/**
 * Default cap of executions moved per archive run.
 */
export const DEFAULT_COLD_STORAGE_LIMIT = 100;

/**
 * Default archive set. `compensation_failed` stays hot until an operator
 * recovers it because it still needs human intervention first.
 */
export const DEFAULT_COLD_STORAGE_STATUSES: ExecutionStatus[] = [
  ExecutionStatus.Completed,
  ExecutionStatus.Failed,
  ExecutionStatus.Cancelled,
];

function resolveArchiveLimit(limit: number | undefined): number {
  const resolved = limit ?? DEFAULT_COLD_STORAGE_LIMIT;
  if (!Number.isInteger(resolved) || resolved <= 0) {
    return durableExecutionInvariantError.throw({
      message: `Cold storage archive limit must be a positive integer. Received: ${resolved}.`,
    });
  }
  return resolved;
}

function resolveArchiveMinAge(minAgeMs: number | undefined): number {
  const resolved = minAgeMs ?? DEFAULT_COLD_STORAGE_MIN_AGE_MS;
  if (!Number.isFinite(resolved) || resolved < 0) {
    return durableExecutionInvariantError.throw({
      message: `Cold storage archive minAgeMs must be a finite number >= 0. Received: ${resolved}.`,
    });
  }
  return resolved;
}

function resolveArchiveStatuses(
  statuses: ExecutionStatus[] | undefined,
): ExecutionStatus[] {
  const selected = statuses ?? DEFAULT_COLD_STORAGE_STATUSES;
  for (const status of selected) {
    if (!isExecutionTerminal(status)) {
      return durableExecutionInvariantError.throw({
        message:
          `Cannot archive durable executions with non-terminal status ` +
          `'${status}': only terminal executions may leave the hot store.`,
      });
    }
  }
  return [...selected];
}

function assertDistinctStores(hot: IDurableStore, cold: IDurableStore): void {
  if (hot === cold) {
    return durableExecutionInvariantError.throw({
      message:
        "Cannot move durable executions between the same store instance: " +
        "hot and cold must differ.",
    });
  }
}

/**
 * Moves one terminal execution from `hot` to `cold` via copy, verify, and
 * delete. The move is idempotent: cold is reset first so re-runs after a
 * crash overwrite instead of duplicating journal rows.
 */
async function archiveOneExecution(params: {
  hot: IDurableStore;
  cold: IDurableStore;
  deleteFromHot: (executionId: string) => Promise<void>;
  deleteFromCold: (executionId: string) => Promise<void>;
  executionId: string;
  minAgeMs: number;
  nowMs: number;
  dryRun: boolean;
}): Promise<{ archived: boolean; skipReason?: ArchiveSkipReason }> {
  const execution = await params.hot.getExecution(params.executionId);
  if (!execution) {
    return { archived: false, skipReason: "missing_from_hot" };
  }
  if (!isExecutionTerminal(execution.status)) {
    return { archived: false, skipReason: "not_terminal" };
  }
  const finishedAtMs = new Date(
    execution.completedAt ?? execution.updatedAt,
  ).getTime();
  if (params.nowMs - finishedAtMs < params.minAgeMs) {
    return { archived: false, skipReason: "too_fresh" };
  }
  if (params.dryRun) {
    return { archived: true };
  }

  const expected = await countExecutionData(params.hot, params.executionId);
  await params.deleteFromCold(params.executionId);
  await copyExecutionData({
    source: params.hot,
    dest: params.cold,
    executionId: params.executionId,
  });
  const actual = await countExecutionData(params.cold, params.executionId);
  if (!sameExecutionDataCounts(expected, actual)) {
    return durableExecutionInvariantError.throw({
      message:
        `Cold storage copy verification failed for execution ` +
        `'${params.executionId}': the cold copy does not match the hot ` +
        `original. The hot original was left untouched.`,
    });
  }

  const latest: Execution | null = await params.hot.getExecution(
    params.executionId,
  );
  if (!latest) {
    return { archived: true };
  }
  if (!isExecutionTerminal(latest.status)) {
    return { archived: false, skipReason: "not_terminal" };
  }
  await params.deleteFromHot(params.executionId);
  return { archived: true };
}

/**
 * Moves terminal executions from `hot` to `cold`, freeing active space
 * while keeping full history queryable.
 *
 * Only terminal executions older than `minAgeMs` move, and every move is
 * verified before the hot original is deleted. Skipped candidates are
 * reported with reasons instead of failing the run, but a verification
 * mismatch fails fast because it signals corruption or a racy store.
 */
export async function archiveTerminalExecutions(
  params: {
    hot: IDurableStore;
    cold: IDurableStore;
  } & ArchiveTerminalExecutionsOptions,
): Promise<ArchiveTerminalExecutionsResult> {
  assertDistinctStores(params.hot, params.cold);
  const deleteFromHot = requireExecutionDataDeletion(params.hot, "hot");
  const deleteFromCold = requireExecutionDataDeletion(params.cold, "cold");
  const limit = resolveArchiveLimit(params.limit);
  const minAgeMs = resolveArchiveMinAge(params.minAgeMs);
  const statuses = resolveArchiveStatuses(params.statuses);
  const dryRun = params.dryRun ?? false;
  if (statuses.length === 0) {
    return { archived: [], skipped: [], dryRun };
  }

  const candidates = await params.hot.listExecutions({
    status: statuses,
    limit,
  });
  const archived: string[] = [];
  const skipped: ArchiveSkippedExecution[] = [];
  for (const candidate of candidates) {
    const outcome = await archiveOneExecution({
      hot: params.hot,
      cold: params.cold,
      deleteFromHot,
      deleteFromCold,
      executionId: candidate.id,
      minAgeMs,
      nowMs: (params.now ?? new Date()).getTime(),
      dryRun,
    });
    if (outcome.archived) {
      archived.push(candidate.id);
    } else {
      skipped.push({
        executionId: candidate.id,
        reason: outcome.skipReason!,
      });
    }
  }
  return { archived, skipped, dryRun };
}

/**
 * Moves one archived execution from `cold` back to `hot` so operator
 * actions (retry, skip, patch) keep working after archival.
 *
 * Returns false when there is nothing to restore: the execution is already
 * hot, or neither tier knows it. Hot leftovers (late-timer orphans) are
 * cleared first so the restored copy verifies exactly.
 */
export async function restoreArchivedExecution(params: {
  hot: IDurableStore;
  cold: IDurableStore;
  executionId: string;
}): Promise<boolean> {
  assertDistinctStores(params.hot, params.cold);
  if ((await params.hot.getExecution(params.executionId)) !== null) {
    return false;
  }
  if ((await params.cold.getExecution(params.executionId)) === null) {
    return false;
  }
  const deleteFromHot = requireExecutionDataDeletion(params.hot, "hot");
  const deleteFromCold = requireExecutionDataDeletion(params.cold, "cold");

  await deleteFromHot(params.executionId);
  await copyExecutionData({
    source: params.cold,
    dest: params.hot,
    executionId: params.executionId,
  });
  const expected = await countExecutionData(params.cold, params.executionId);
  const actual = await countExecutionData(params.hot, params.executionId);
  if (!sameExecutionDataCounts(expected, actual)) {
    return durableExecutionInvariantError.throw({
      message:
        `Cold storage restore verification failed for execution ` +
        `'${params.executionId}': the hot copy does not match the cold ` +
        `original. The cold original was left untouched.`,
    });
  }
  await deleteFromCold(params.executionId);
  return true;
}
