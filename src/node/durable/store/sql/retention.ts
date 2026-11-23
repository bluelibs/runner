import {
  collectionDeadline,
  receiptExpiryDeadline,
} from "../../core/retention";
import { ExecutionStatus, type Execution } from "../../core/types";
import { upsertExecutionInTx } from "./executions";
import type { SqlStoreRuntime } from "./runtime";
import {
  forUpdate,
  forUpdateSkipLocked,
  nowMsSql,
  type SqlExecutor,
  type SqlParam,
} from "./types";

const DETAIL_TABLES = [
  "runner_durable_steps",
  "runner_durable_history",
  "runner_durable_history_seq",
  "runner_durable_signal_states",
  "runner_durable_signal_waiters",
  "runner_durable_workflow_states",
  "runner_durable_audit",
  "runner_durable_timers",
] as const;

const DELETE_BATCH_CHUNK_SIZE = 200;
const MAX_SCAN_PAGES = 8;

type DeadlineColumn = "history_deadline_ms" | "receipt_deadline_ms";

interface DueExecutionRow {
  [key: string]: unknown;
  id: string;
  deadline_ms: number | string;
  payload: string;
}

async function hasProtectedDependenciesInTx(
  runtime: SqlStoreRuntime,
  tx: SqlExecutor,
  execution: Execution,
): Promise<boolean> {
  if (execution.parentExecutionId) {
    // Plain read avoids child -> parent FOR UPDATE lock-order deadlocks.
    const parentRow = await tx.get<{ status: string }>(
      `SELECT status FROM runner_durable_executions
       WHERE namespace = ? AND id = ?`,
      [runtime.namespace, execution.parentExecutionId],
    );
    if (
      parentRow
        ? parentRow.status !== ExecutionStatus.Completed
        : !execution.parentExecutionInStore
    ) {
      return true;
    }
  }
  const waiterRow = await tx.get(
    `SELECT 1 AS ok FROM runner_durable_execution_waiters
     WHERE namespace = ? AND target_execution_id = ? LIMIT 1`,
    [runtime.namespace, execution.id],
  );
  if (waiterRow) return true;

  // Leases always use backend real time, never the caller's retention clock.
  const nowClock = nowMsSql(tx.dialect);
  const lockRow = await tx.get(
    `SELECT 1 AS ok FROM runner_durable_locks
     WHERE namespace = ? AND resource = ? AND expires_at_ms > ${nowClock.expr}`,
    [runtime.namespace, `execution:${execution.id}`, ...nowClock.params],
  );
  return lockRow !== null;
}

async function forEachChunk(
  ids: readonly string[],
  callback: (chunk: readonly string[], placeholders: string) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < ids.length; i += DELETE_BATCH_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + DELETE_BATCH_CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(", ");
    await callback(chunk, placeholders);
  }
}

async function deleteExecutionDetailRowsBatchInTx(
  runtime: SqlStoreRuntime,
  tx: SqlExecutor,
  executionIds: readonly string[],
): Promise<void> {
  await forEachChunk(executionIds, async (chunk, placeholders) => {
    // Preserve the timer-then-claim lock order used by timer workers.
    await tx.all(
      `SELECT id FROM runner_durable_timers
       WHERE namespace = ? AND execution_id IN (${placeholders})
       ORDER BY id ASC${forUpdate(tx.dialect)}`,
      [runtime.namespace, ...chunk],
    );
    await tx.run(
      `DELETE FROM runner_durable_locks
       WHERE namespace = ? AND resource IN (
         SELECT 'timer:claim:' || id FROM runner_durable_timers
         WHERE namespace = ? AND execution_id IN (${placeholders})
       )`,
      [runtime.namespace, runtime.namespace, ...chunk],
    );
    for (const table of DETAIL_TABLES) {
      await tx.run(
        `DELETE FROM ${table}
         WHERE namespace = ? AND execution_id IN (${placeholders})`,
        [runtime.namespace, ...chunk],
      );
    }
  });
}

async function collectDueExecutionsInTx(params: {
  runtime: SqlStoreRuntime;
  tx: SqlExecutor;
  column: DeadlineColumn;
  nowMs: number;
  limit: number;
  getDeadline: (execution: Execution) => number | undefined;
  isBlocked?: (execution: Execution) => Promise<boolean>;
}): Promise<Execution[]> {
  const { runtime, tx, column, nowMs, limit, getDeadline, isBlocked } = params;
  const pageLimit = Math.max(limit * 2, limit);
  const collected: Execution[] = [];
  let cursor: { deadlineMs: number; id: string } | null = null;

  for (
    let page = 0;
    page < MAX_SCAN_PAGES && collected.length < limit;
    page += 1
  ) {
    const cursorClause: string = cursor
      ? ` AND ${column} >= ? AND (${column} > ? OR id > ?)`
      : "";
    const cursorParams: SqlParam[] = cursor
      ? [cursor.deadlineMs, cursor.deadlineMs, cursor.id]
      : [];
    const rows: DueExecutionRow[] = await tx.all<DueExecutionRow>(
      `SELECT id, ${column} AS deadline_ms, payload
       FROM runner_durable_executions
       WHERE namespace = ? AND ${column} IS NOT NULL AND ${column} <= ?${cursorClause}
       ORDER BY ${column} ASC, id ASC
       LIMIT ?${forUpdateSkipLocked(tx.dialect)}`,
      [runtime.namespace, nowMs, ...cursorParams, pageLimit],
    );
    if (rows.length === 0) break;

    for (const row of rows) {
      if (collected.length >= limit) break;
      const execution = runtime.parse<Execution>(row.payload);
      if (getDeadline(execution) === undefined) {
        await tx.run(
          `UPDATE runner_durable_executions SET ${column} = NULL
           WHERE namespace = ? AND id = ?`,
          [runtime.namespace, execution.id],
        );
        continue;
      }
      if (
        (isBlocked && (await isBlocked(execution))) ||
        (await hasProtectedDependenciesInTx(runtime, tx, execution))
      ) {
        continue;
      }
      collected.push(execution);
    }

    if (rows.length < pageLimit) break;
    const last = rows[rows.length - 1]!;
    cursor = { deadlineMs: Number(last.deadline_ms), id: last.id };
  }

  return collected;
}

async function sweepExpiredLocksInTx(
  runtime: SqlStoreRuntime,
  tx: SqlExecutor,
  limit: number,
): Promise<void> {
  const nowClock = nowMsSql(tx.dialect);
  await tx.run(
    `DELETE FROM runner_durable_locks
     WHERE namespace = ? AND resource IN (
       SELECT resource FROM runner_durable_locks
       WHERE namespace = ? AND expires_at_ms <= ${nowClock.expr}
       ORDER BY expires_at_ms ASC
       LIMIT ?
     )`,
    [runtime.namespace, runtime.namespace, ...nowClock.params, limit],
  );
}

/** Collects due successful history while preserving completion receipts. */
export async function collectCompletedHistory(
  runtime: SqlStoreRuntime,
  now: Date,
  limit: number,
): Promise<number> {
  if (limit <= 0) return 0;
  return runtime.withWriteTx(async (tx) => {
    const collected = await collectDueExecutionsInTx({
      runtime,
      tx,
      column: "history_deadline_ms",
      nowMs: now.getTime(),
      limit,
      getDeadline: collectionDeadline,
    });
    if (collected.length > 0) {
      await deleteExecutionDetailRowsBatchInTx(
        runtime,
        tx,
        collected.map((execution) => execution.id),
      );
      for (const execution of collected) {
        await upsertExecutionInTx(runtime, tx, {
          ...execution,
          input: undefined,
          historyCollectedAt: now,
        });
      }
    }
    return collected.length;
  });
}

/** Expires due completion receipts and dependent execution records. */
export async function collectExpiredReceipts(
  runtime: SqlStoreRuntime,
  now: Date,
  limit: number,
): Promise<number> {
  if (limit <= 0) return 0;
  return runtime.withWriteTx(async (tx) => {
    const collected = await collectDueExecutionsInTx({
      runtime,
      tx,
      column: "receipt_deadline_ms",
      nowMs: now.getTime(),
      limit,
      getDeadline: receiptExpiryDeadline,
      isBlocked: async (execution) =>
        (await tx.get(
          `SELECT 1 AS ok FROM runner_durable_commands
           WHERE namespace = ? AND execution_id = ? AND queue_seq IS NOT NULL LIMIT 1`,
          [runtime.namespace, execution.id],
        )) !== null,
    });
    const collectedIds = collected.map((execution) => execution.id);

    if (collectedIds.length > 0) {
      await deleteExecutionDetailRowsBatchInTx(runtime, tx, collectedIds);
      const nowClock = nowMsSql(tx.dialect);
      await forEachChunk(collectedIds, async (chunk, placeholders) => {
        await tx.run(
          `DELETE FROM runner_durable_commands
           WHERE namespace = ? AND execution_id IN (${placeholders})`,
          [runtime.namespace, ...chunk],
        );
        await tx.run(
          `DELETE FROM runner_durable_idempotency
           WHERE namespace = ? AND execution_id IN (${placeholders})`,
          [runtime.namespace, ...chunk],
        );
        // Only remove expired execution leases so a freshly acquired lease cannot be deleted.
        await tx.run(
          `DELETE FROM runner_durable_locks
           WHERE namespace = ? AND resource IN (${placeholders}) AND expires_at_ms <= ${nowClock.expr}`,
          [
            runtime.namespace,
            ...chunk.map((id) => `execution:${id}`),
            ...nowClock.params,
          ],
        );
        await tx.run(
          `DELETE FROM runner_durable_executions
           WHERE namespace = ? AND id IN (${placeholders})`,
          [runtime.namespace, ...chunk],
        );
      });
    }

    await sweepExpiredLocksInTx(runtime, tx, limit);
    return collectedIds.length;
  });
}
