import {
  collectionDeadline,
  receiptExpiryDeadline,
} from "../../core/retention";
import { ExecutionStatus, type Execution } from "../../core/types";
import { upsertExecutionInTx } from "./executions";
import type { SqlStoreRuntime } from "./runtime";
import { forUpdate, type SqlExecutor } from "./types";

async function hasProtectedDependenciesInTx(
  runtime: SqlStoreRuntime,
  tx: SqlExecutor,
  execution: Execution,
  now: Date,
): Promise<boolean> {
  if (execution.parentExecutionId) {
    const parentRow = await tx.get<{ status: string }>(
      `SELECT status FROM runner_durable_executions
       WHERE namespace = ? AND id = ?${forUpdate(tx.dialect)}`,
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

  const lockRow = await tx.get<{ expires_at_ms: number | string }>(
    `SELECT expires_at_ms FROM runner_durable_locks
     WHERE namespace = ? AND resource = ?`,
    [runtime.namespace, `execution:${execution.id}`],
  );
  return Boolean(lockRow && Number(lockRow.expires_at_ms) > now.getTime());
}

async function deleteExecutionDetailRowsInTx(
  runtime: SqlStoreRuntime,
  tx: SqlExecutor,
  executionId: string,
): Promise<void> {
  // Preserve the timer-then-claim lock order used by timer workers.
  await tx.all(
    `SELECT id FROM runner_durable_timers
     WHERE namespace = ? AND execution_id = ? ORDER BY id ASC${forUpdate(tx.dialect)}`,
    [runtime.namespace, executionId],
  );
  await tx.run(
    `DELETE FROM runner_durable_locks
     WHERE namespace = ? AND resource IN (
       SELECT 'timer:claim:' || id FROM runner_durable_timers
       WHERE namespace = ? AND execution_id = ?
     )`,
    [runtime.namespace, runtime.namespace, executionId],
  );
  for (const table of [
    "runner_durable_steps",
    "runner_durable_history",
    "runner_durable_history_seq",
    "runner_durable_signal_states",
    "runner_durable_signal_waiters",
    "runner_durable_workflow_states",
    "runner_durable_audit",
    "runner_durable_timers",
  ] as const) {
    await tx.run(
      `DELETE FROM ${table} WHERE namespace = ? AND execution_id = ?`,
      [runtime.namespace, executionId],
    );
  }
}

/** Collects due successful history while preserving completion receipts. */
export async function collectCompletedHistory(
  runtime: SqlStoreRuntime,
  now: Date,
  limit: number,
): Promise<number> {
  return runtime.withWriteTx(async (tx) => {
    const rows = await tx.all<{ payload: string }>(
      `SELECT payload FROM runner_durable_executions
       WHERE namespace = ? AND history_deadline_ms IS NOT NULL AND history_deadline_ms <= ?
       ORDER BY history_deadline_ms ASC, id ASC${forUpdate(tx.dialect)}`,
      [runtime.namespace, now.getTime()],
    );
    let collected = 0;
    for (const row of rows) {
      if (collected >= limit) break;
      const execution = runtime.parse<Execution>(row.payload);
      if (collectionDeadline(execution) === undefined) {
        await tx.run(
          `UPDATE runner_durable_executions SET history_deadline_ms = NULL
           WHERE namespace = ? AND id = ?`,
          [runtime.namespace, execution.id],
        );
        continue;
      }
      if (await hasProtectedDependenciesInTx(runtime, tx, execution, now)) {
        continue;
      }
      await deleteExecutionDetailRowsInTx(runtime, tx, execution.id);
      await upsertExecutionInTx(runtime, tx, {
        ...execution,
        input: undefined,
        historyCollectedAt: now,
      });
      collected += 1;
    }
    return collected;
  });
}

/** Expires due completion receipts and dependent execution records. */
export async function collectExpiredReceipts(
  runtime: SqlStoreRuntime,
  now: Date,
  limit: number,
): Promise<number> {
  return runtime.withWriteTx(async (tx) => {
    const rows = await tx.all<{ payload: string }>(
      `SELECT payload FROM runner_durable_executions
       WHERE namespace = ? AND receipt_deadline_ms IS NOT NULL AND receipt_deadline_ms <= ?
       ORDER BY receipt_deadline_ms ASC, id ASC${forUpdate(tx.dialect)}`,
      [runtime.namespace, now.getTime()],
    );
    let collected = 0;
    for (const row of rows) {
      if (collected >= limit) break;
      const execution = runtime.parse<Execution>(row.payload);
      if (receiptExpiryDeadline(execution) === undefined) {
        await tx.run(
          `UPDATE runner_durable_executions SET receipt_deadline_ms = NULL
           WHERE namespace = ? AND id = ?`,
          [runtime.namespace, execution.id],
        );
        continue;
      }
      const queuedCommand = await tx.get(
        `SELECT 1 AS ok FROM runner_durable_commands
         WHERE namespace = ? AND execution_id = ? AND queue_seq IS NOT NULL LIMIT 1`,
        [runtime.namespace, execution.id],
      );
      if (
        queuedCommand ||
        (await hasProtectedDependenciesInTx(runtime, tx, execution, now))
      ) {
        continue;
      }
      await deleteExecutionDetailRowsInTx(runtime, tx, execution.id);
      await tx.run(
        `DELETE FROM runner_durable_commands WHERE namespace = ? AND execution_id = ?`,
        [runtime.namespace, execution.id],
      );
      await tx.run(
        `DELETE FROM runner_durable_idempotency WHERE namespace = ? AND execution_id = ?`,
        [runtime.namespace, execution.id],
      );
      await tx.run(
        `DELETE FROM runner_durable_locks WHERE namespace = ? AND resource = ?`,
        [runtime.namespace, `execution:${execution.id}`],
      );
      await tx.run(
        `DELETE FROM runner_durable_executions WHERE namespace = ? AND id = ?`,
        [runtime.namespace, execution.id],
      );
      collected += 1;
    }
    return collected;
  });
}
