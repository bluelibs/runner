import { isDeepStrictEqual } from "node:util";
import type {
  DurableCheckpointBranch,
  DurableHistoryEntry,
  DurableHistoryUpdate,
} from "../../core/interfaces/history";
import type { Execution } from "../../core/types";
import { upsertExecutionInTx } from "./executions";
import { saveStepResultInTx, saveWorkflowStateInTx } from "./executionViews";
import type { SqlStoreRuntime } from "./runtime";
import { forUpdate, type SqlExecutor } from "./types";

async function upsertHistorySeqInTx(
  runtime: SqlStoreRuntime,
  tx: SqlExecutor,
  executionId: string,
  seq: number,
): Promise<void> {
  await tx.run(
    `INSERT INTO runner_durable_history_seq (namespace, execution_id, seq)
     VALUES (?, ?, ?)
     ON CONFLICT (namespace, execution_id) DO UPDATE SET seq = EXCLUDED.seq`,
    [runtime.namespace, executionId, seq],
  );
}

async function upsertHistoryEntryInTx(
  runtime: SqlStoreRuntime,
  tx: SqlExecutor,
  executionId: string,
  entry: DurableHistoryEntry,
): Promise<void> {
  await tx.run(
    `INSERT INTO runner_durable_history (
      namespace, execution_id, step_id, started_order, completed_order, payload
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (namespace, execution_id, step_id) DO UPDATE SET
      started_order = EXCLUDED.started_order,
      completed_order = EXCLUDED.completed_order,
      payload = EXCLUDED.payload`,
    [
      runtime.namespace,
      executionId,
      entry.stepId,
      entry.startedOrder,
      entry.completedOrder ?? null,
      runtime.stringify(entry),
    ],
  );
}

export async function recordExecutionHistoryInTx(
  runtime: SqlStoreRuntime,
  tx: SqlExecutor,
  executionId: string,
  update: DurableHistoryUpdate,
): Promise<boolean> {
  const existingRow = await tx.get<{ payload: string }>(
    `SELECT payload FROM runner_durable_history
     WHERE namespace = ? AND execution_id = ? AND step_id = ?${forUpdate(tx.dialect)}`,
    [runtime.namespace, executionId, update.stepId],
  );
  let entry = existingRow
    ? runtime.parse<DurableHistoryEntry>(existingRow.payload)
    : undefined;
  if (
    entry &&
    (update.phase === "started" || entry.completedOrder !== undefined)
  ) {
    return false;
  }

  const seqRow = await tx.get<{ seq: number | string }>(
    `SELECT seq FROM runner_durable_history_seq
     WHERE namespace = ? AND execution_id = ?${forUpdate(tx.dialect)}`,
    [runtime.namespace, executionId],
  );
  let seq = seqRow ? Number(seqRow.seq) : 0;

  if (!entry) {
    const { phase: _phase, stateAfter: _state, ...identity } = update;
    seq += 1;
    entry = { ...identity, startedOrder: seq };
  }
  if (update.phase === "completed" && entry.completedOrder === undefined) {
    seq += 1;
    entry.completedOrder = seq;
    if ("stateAfter" in update) {
      entry.stateAfter = update.stateAfter;
    }
  }

  await upsertHistorySeqInTx(runtime, tx, executionId, seq);
  await upsertHistoryEntryInTx(runtime, tx, executionId, entry);
  return true;
}

export async function recordExecutionHistory(
  runtime: SqlStoreRuntime,
  executionId: string,
  update: DurableHistoryUpdate,
): Promise<void> {
  await runtime.withWriteTx(async (tx) => {
    await recordExecutionHistoryInTx(runtime, tx, executionId, update);
  });
}

export async function listExecutionHistory(
  runtime: SqlStoreRuntime,
  executionId: string,
): Promise<DurableHistoryEntry[]> {
  return runtime.withRead(async (exec) => {
    const rows = await exec.all<{ payload: string }>(
      `SELECT payload FROM runner_durable_history
       WHERE namespace = ? AND execution_id = ?
       ORDER BY started_order ASC, step_id ASC`,
      [runtime.namespace, executionId],
    );
    return rows.map((row) => runtime.parse<DurableHistoryEntry>(row.payload));
  });
}

export async function createCheckpointExecution(
  runtime: SqlStoreRuntime,
  branch: DurableCheckpointBranch,
): Promise<boolean> {
  return runtime.withWriteTx(async (tx) => {
    const targetRow = await tx.get<{ id: string }>(
      `SELECT id FROM runner_durable_executions
       WHERE namespace = ? AND id = ?${forUpdate(tx.dialect)}`,
      [runtime.namespace, branch.execution.id],
    );
    if (targetRow) return false;

    const sourceRow = await tx.get<{ payload: string }>(
      `SELECT payload FROM runner_durable_executions
       WHERE namespace = ? AND id = ?${forUpdate(tx.dialect)}`,
      [runtime.namespace, branch.expected.id],
    );
    if (
      !sourceRow ||
      !isDeepStrictEqual(
        runtime.parse<Execution>(sourceRow.payload),
        branch.expected,
      )
    ) {
      return false;
    }

    await upsertExecutionInTx(runtime, tx, branch.execution);
    for (const step of branch.steps) {
      await saveStepResultInTx(runtime, tx, step);
    }
    const maxOrder = Math.max(
      0,
      ...branch.history.flatMap((entry) => [
        entry.startedOrder,
        entry.completedOrder ?? 0,
      ]),
    );
    await upsertHistorySeqInTx(runtime, tx, branch.execution.id, maxOrder);
    for (const entry of branch.history) {
      await upsertHistoryEntryInTx(runtime, tx, branch.execution.id, entry);
    }
    if (branch.state) {
      await saveWorkflowStateInTx(runtime, tx, {
        executionId: branch.execution.id,
        state: branch.state.value,
        updatedAt: branch.execution.createdAt,
      });
    }
    return true;
  });
}
