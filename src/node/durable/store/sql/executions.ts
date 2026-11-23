import { ExecutionStatus, type Execution } from "../../core/types";
import type { ExpectedExecutionStatuses } from "../../core/interfaces/store";
import type { SqlStoreRuntime } from "./runtime";
import { transferQueuedSignalBacklogInTx } from "./signalState";
import { forUpdate, type SqlExecutor } from "./types";

const TERMINAL_STATUSES = [
  ExecutionStatus.Completed,
  ExecutionStatus.Failed,
  ExecutionStatus.CompensationFailed,
  ExecutionStatus.Cancelled,
  ExecutionStatus.ContinuedAsNew,
] as const;

export async function upsertExecutionInTx(
  runtime: SqlStoreRuntime,
  tx: SqlExecutor,
  execution: Execution,
): Promise<void> {
  const row = runtime.encodeExecutionRow(execution);
  await tx.run(
    `INSERT INTO runner_durable_executions (
      namespace, id, workflow_key, parent_execution_id, status,
      created_at_ms, history_deadline_ms, receipt_deadline_ms, payload, state_payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (namespace, id) DO UPDATE SET
      workflow_key = EXCLUDED.workflow_key,
      parent_execution_id = EXCLUDED.parent_execution_id,
      status = EXCLUDED.status,
      created_at_ms = EXCLUDED.created_at_ms,
      history_deadline_ms = EXCLUDED.history_deadline_ms,
      receipt_deadline_ms = EXCLUDED.receipt_deadline_ms,
      payload = EXCLUDED.payload,
      state_payload = EXCLUDED.state_payload`,
    [
      row.namespace,
      row.id,
      row.workflowKey,
      row.parentExecutionId,
      row.status,
      row.createdAtMs,
      row.historyDeadlineMs,
      row.receiptDeadlineMs,
      row.payload,
      row.statePayload,
    ],
  );
}

export async function createExecutionWithIdempotencyKey(
  runtime: SqlStoreRuntime,
  params: {
    execution: Execution;
    workflowKey: string;
    idempotencyKey: string;
  },
): Promise<
  | { created: true; executionId: string }
  | { created: false; executionId: string }
> {
  return runtime.withWriteTx(async (tx) => {
    const row = await tx.get<{ execution_id: string }>(
      `INSERT INTO runner_durable_idempotency (
        namespace, workflow_key, idempotency_key, execution_id
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT (namespace, workflow_key, idempotency_key) DO UPDATE SET
        execution_id = runner_durable_idempotency.execution_id
      RETURNING execution_id`,
      [
        runtime.namespace,
        params.workflowKey,
        params.idempotencyKey,
        params.execution.id,
      ],
    );
    if (row!.execution_id !== params.execution.id) {
      return { created: false, executionId: String(row!.execution_id) };
    }
    await upsertExecutionInTx(runtime, tx, params.execution);
    return { created: true, executionId: params.execution.id };
  });
}

export async function saveExecution(
  runtime: SqlStoreRuntime,
  execution: Execution,
): Promise<void> {
  await runtime.withWriteTx(async (tx) => {
    await upsertExecutionInTx(runtime, tx, execution);
  });
}

export async function saveExecutionIfStatus(
  runtime: SqlStoreRuntime,
  execution: Execution,
  expectedStatuses: ExpectedExecutionStatuses,
): Promise<boolean> {
  return runtime.withWriteTx(async (tx) => {
    const currentRow = await tx.get<{ status: string }>(
      `SELECT status FROM runner_durable_executions
       WHERE namespace = ? AND id = ?${forUpdate(tx.dialect)}`,
      [runtime.namespace, execution.id],
    );
    if (
      !currentRow ||
      !expectedStatuses.includes(currentRow.status as ExecutionStatus)
    ) {
      return false;
    }
    if (
      execution.status === ExecutionStatus.Completed ||
      execution.status === ExecutionStatus.ContinuedAsNew
    ) {
      const queued = await tx.get(
        `SELECT 1 AS has_cmd FROM runner_durable_commands
         WHERE namespace = ? AND execution_id = ? AND queue_seq IS NOT NULL LIMIT 1`,
        [runtime.namespace, execution.id],
      );
      if (queued) return false;
    }
    await upsertExecutionInTx(runtime, tx, execution);
    return true;
  });
}

export async function createContinuedExecution(
  runtime: SqlStoreRuntime,
  params: {
    priorExecution: Execution;
    successorExecution: Execution;
  },
): Promise<boolean> {
  return runtime.withWriteTx(async (tx) => {
    const currentRow = await tx.get<{ status: string }>(
      `SELECT status FROM runner_durable_executions
       WHERE namespace = ? AND id = ?${forUpdate(tx.dialect)}`,
      [runtime.namespace, params.priorExecution.id],
    );
    if (!currentRow || currentRow.status !== ExecutionStatus.Running) {
      return false;
    }
    const queued = await tx.get(
      `SELECT 1 AS has_cmd FROM runner_durable_commands
       WHERE namespace = ? AND execution_id = ? AND queue_seq IS NOT NULL LIMIT 1`,
      [runtime.namespace, params.priorExecution.id],
    );
    if (queued) return false;

    await transferQueuedSignalBacklogInTx(
      runtime,
      tx,
      params.priorExecution.id,
      params.successorExecution.id,
    );
    await upsertExecutionInTx(runtime, tx, params.priorExecution);
    await upsertExecutionInTx(runtime, tx, params.successorExecution);
    return true;
  });
}

export async function getExecution(
  runtime: SqlStoreRuntime,
  id: string,
): Promise<Execution | null> {
  return runtime.withRead(async (exec) => {
    const row = await exec.get<{ payload: string }>(
      `SELECT payload FROM runner_durable_executions WHERE namespace = ? AND id = ?`,
      [runtime.namespace, id],
    );
    return row ? runtime.parse<Execution>(row.payload) : null;
  });
}

export async function updateExecution(
  runtime: SqlStoreRuntime,
  id: string,
  updates: Partial<Execution>,
): Promise<void> {
  await runtime.withWriteTx(async (tx) => {
    const row = await tx.get<{ payload: string }>(
      `SELECT payload FROM runner_durable_executions
       WHERE namespace = ? AND id = ?${forUpdate(tx.dialect)}`,
      [runtime.namespace, id],
    );
    if (!row) return;
    const current = runtime.parse<Execution>(row.payload);
    await upsertExecutionInTx(runtime, tx, {
      ...current,
      ...updates,
      id,
      updatedAt: new Date(),
    });
  });
}

export async function listIncompleteExecutions(
  runtime: SqlStoreRuntime,
): Promise<Execution[]> {
  return runtime.withRead(async (exec) => {
    const placeholders = TERMINAL_STATUSES.map(() => "?").join(", ");
    const rows = await exec.all<{ payload: string }>(
      `SELECT payload FROM runner_durable_executions
       WHERE namespace = ? AND status NOT IN (${placeholders})
       ORDER BY created_at_ms DESC, id ASC`,
      [runtime.namespace, ...TERMINAL_STATUSES],
    );
    return rows.map((row) => runtime.parse<Execution>(row.payload));
  });
}

export async function listStuckExecutions(
  runtime: SqlStoreRuntime,
): Promise<Execution[]> {
  return runtime.withRead(async (exec) => {
    const rows = await exec.all<{ payload: string }>(
      `SELECT payload FROM runner_durable_executions
       WHERE namespace = ? AND status = ?
       ORDER BY created_at_ms DESC, id ASC`,
      [runtime.namespace, ExecutionStatus.CompensationFailed],
    );
    return rows.map((row) => runtime.parse<Execution>(row.payload));
  });
}

export async function retryRollback(
  runtime: SqlStoreRuntime,
  executionId: string,
): Promise<void> {
  await runtime.withWriteTx(async (tx) => {
    const row = await tx.get<{ payload: string }>(
      `SELECT payload FROM runner_durable_executions
       WHERE namespace = ? AND id = ?${forUpdate(tx.dialect)}`,
      [runtime.namespace, executionId],
    );
    if (!row) return;
    const execution = runtime.parse<Execution>(row.payload);
    await upsertExecutionInTx(runtime, tx, {
      ...execution,
      status: ExecutionStatus.Pending,
      error: undefined,
      updatedAt: new Date(),
    });
  });
}

export async function forceFail(
  runtime: SqlStoreRuntime,
  executionId: string,
  error: { message: string; stack?: string },
): Promise<void> {
  await runtime.withWriteTx(async (tx) => {
    const row = await tx.get<{ payload: string }>(
      `SELECT payload FROM runner_durable_executions
       WHERE namespace = ? AND id = ?${forUpdate(tx.dialect)}`,
      [runtime.namespace, executionId],
    );
    if (!row) return;
    const execution = runtime.parse<Execution>(row.payload);
    await upsertExecutionInTx(runtime, tx, {
      ...execution,
      status: ExecutionStatus.Failed,
      error,
      updatedAt: new Date(),
    });
  });
}
