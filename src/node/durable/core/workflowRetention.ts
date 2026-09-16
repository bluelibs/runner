import type { IDurableStore } from "./interfaces/store";
import {
  ExecutionStatus as ExecutionStatuses,
  type Execution,
  type ExecutionStatus,
} from "./types";
import { encodeExecutionCursor } from "./executionCursor";
import {
  durableExecutionInvariantError,
  durableOperatorUnsupportedStoreCapabilityError,
} from "../../../errors";

const DEFAULT_WORKFLOW_RETENTION_LIMIT = 100;
const ARCHIVABLE_WORKFLOW_STATUSES = [
  ExecutionStatuses.Completed,
  ExecutionStatuses.Failed,
  ExecutionStatuses.Cancelled,
] as const;

function resolveWorkflowRetentionCutoff(before: Date): number {
  const cutoff = before.getTime();
  if (!Number.isFinite(cutoff)) {
    durableExecutionInvariantError.throw({
      message: `Durable operator retention cutoff must be a valid Date. Received: ${before}.`,
    });
  }
  return cutoff;
}

function resolveWorkflowRetentionLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit <= 0) {
    durableExecutionInvariantError.throw({
      message: `Durable operator retention limit must be a positive integer. Received: ${limit}.`,
    });
  }
  return limit;
}

function getWorkflowRetentionTimestamp(execution: Execution): number {
  return new Date(execution.completedAt ?? execution.updatedAt).getTime();
}

function isArchivableWorkflowStatus(status: ExecutionStatus): boolean {
  return (
    status === ExecutionStatuses.Completed ||
    status === ExecutionStatuses.Failed ||
    status === ExecutionStatuses.Cancelled
  );
}

async function scanWorkflowsBefore(
  store: IDurableStore,
  before: Date,
  limit: number,
): Promise<Execution[]> {
  const cutoff = resolveWorkflowRetentionCutoff(before);
  const target = resolveWorkflowRetentionLimit(limit);
  const matches: Execution[] = [];
  let cursor: string | undefined;

  while (matches.length < target) {
    const pageSize = Math.min(target - matches.length, 100);
    const page = await store.listExecutions({
      status: [...ARCHIVABLE_WORKFLOW_STATUSES],
      limit: pageSize,
      cursor,
    });
    if (page.length === 0) {
      break;
    }

    for (const execution of page) {
      if (getWorkflowRetentionTimestamp(execution) < cutoff) {
        matches.push(execution);
        if (matches.length === target) {
          break;
        }
      }
    }

    if (page.length < pageSize) {
      break;
    }
    const last = page[page.length - 1]!;
    cursor = encodeExecutionCursor({
      createdAt: new Date(last.createdAt).toISOString(),
      id: last.id,
    });
  }

  return matches;
}

/**
 * Fetches completed, failed, and cancelled workflows whose retained terminal
 * record predates `before`.
 *
 * Intended for external retention jobs (for example a cron) that first copy
 * workflow data elsewhere, then call `deleteWorkflowsBefore()` once archival
 * is confirmed. `compensation_failed` is intentionally excluded because those
 * workflows still need operator recovery.
 */
export async function fetchWorkflowsBefore(
  store: IDurableStore,
  before: Date,
  limit = DEFAULT_WORKFLOW_RETENTION_LIMIT,
): Promise<Execution[]> {
  return await scanWorkflowsBefore(store, before, limit);
}

/**
 * Deletes the stored history for completed, failed, and cancelled workflows
 * older than `before`, up to `limit`.
 *
 * This requires store support for `deleteExecutionData()`. Each workflow is
 * re-read immediately before deletion so operator recovery or other late
 * updates cannot accidentally remove a workflow that is no longer eligible.
 */
export async function deleteWorkflowsBefore(
  store: IDurableStore,
  before: Date,
  limit = DEFAULT_WORKFLOW_RETENTION_LIMIT,
): Promise<string[]> {
  const deleteExecutionData = store.deleteExecutionData;
  if (!deleteExecutionData) {
    durableOperatorUnsupportedStoreCapabilityError.throw({
      operation: "deleteExecutionData",
    });
  }
  const boundDeleteExecutionData = deleteExecutionData!.bind(store);

  const cutoff = resolveWorkflowRetentionCutoff(before);
  const deleted: string[] = [];
  const candidates = await scanWorkflowsBefore(store, before, limit);
  for (const candidate of candidates) {
    const execution = await store.getExecution(candidate.id);
    if (!execution) {
      continue;
    }
    if (
      !isArchivableWorkflowStatus(execution.status) ||
      getWorkflowRetentionTimestamp(execution) >= cutoff
    ) {
      continue;
    }
    await boundDeleteExecutionData(execution.id);
    deleted.push(execution.id);
  }
  return deleted;
}
