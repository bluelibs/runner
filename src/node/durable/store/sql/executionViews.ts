import { durableExecutionInvariantError } from "../../../../errors";
import type { DurableAuditEntry } from "../../core/audit";
import { decodeExecutionCursor } from "../../core/executionCursor";
import { executionQueryLimit } from "../../core/executionIndex";
import type { ListExecutionsOptions } from "../../core/interfaces/store";
import type {
  DurableExecutionState,
  Execution,
  StepResult,
  WorkflowState,
} from "../../core/types";
import type { SqlStoreRuntime } from "./runtime";
import type { SqlExecutor, SqlParam } from "./types";

function buildExecutionWhere(
  namespace: string,
  options: ListExecutionsOptions,
): { sql: string; params: SqlParam[] } {
  const clauses: string[] = ["namespace = ?"];
  const params: SqlParam[] = [namespace];

  if (options.status && options.status.length > 0) {
    const statuses = [...new Set(options.status)];
    clauses.push(`status IN (${statuses.map(() => "?").join(", ")})`);
    params.push(...statuses);
  }
  if (options.workflowKey !== undefined) {
    clauses.push("workflow_key = ?");
    params.push(options.workflowKey);
  }
  if (options.parentExecutionId !== undefined) {
    clauses.push("parent_execution_id = ?");
    params.push(options.parentExecutionId);
  }
  if (options.cursor !== undefined) {
    const cursor = decodeExecutionCursor(options.cursor);
    const cursorMs = new Date(cursor.createdAt).getTime();
    clauses.push("(created_at_ms < ? OR (created_at_ms = ? AND id > ?))");
    params.push(cursorMs, cursorMs, cursor.id);
  }

  return { sql: clauses.join(" AND "), params };
}

export async function getExecutionState(
  runtime: SqlStoreRuntime,
  executionId: string,
): Promise<DurableExecutionState | null> {
  return runtime.withRead(async (exec) => {
    const row = await exec.get<{ state_payload: string }>(
      `SELECT state_payload FROM runner_durable_executions WHERE namespace = ? AND id = ?`,
      [runtime.namespace, executionId],
    );
    return row ? runtime.parse<DurableExecutionState>(row.state_payload) : null;
  });
}

export async function listExecutions(
  runtime: SqlStoreRuntime,
  options: ListExecutionsOptions = {},
): Promise<Execution[]> {
  const limit = options.limit ?? 100;
  const where = buildExecutionWhere(runtime.namespace, options);
  const offsetSql =
    options.cursor === undefined && options.offset !== undefined
      ? " OFFSET ?"
      : "";
  const extraParams: SqlParam[] =
    options.cursor === undefined && options.offset !== undefined
      ? [limit, options.offset]
      : [limit];

  return runtime.withRead(async (exec) => {
    const rows = await exec.all<{ payload: string }>(
      `SELECT payload FROM runner_durable_executions
       WHERE ${where.sql}
       ORDER BY created_at_ms DESC, id ASC
       LIMIT ?${offsetSql}`,
      [...where.params, ...extraParams],
    );
    return rows.map((row) => runtime.parse<Execution>(row.payload));
  });
}

export async function listExecutionStates(
  runtime: SqlStoreRuntime,
  options: ListExecutionsOptions,
): Promise<DurableExecutionState[]> {
  const limit = executionQueryLimit(options);
  const where = buildExecutionWhere(runtime.namespace, options);

  return runtime.withRead(async (exec) => {
    const rows = await exec.all<{ state_payload: string }>(
      `SELECT state_payload FROM runner_durable_executions
       WHERE ${where.sql}
       ORDER BY created_at_ms DESC, id ASC
       LIMIT ?`,
      [...where.params, limit],
    );
    return rows.map((row) =>
      runtime.parse<DurableExecutionState>(row.state_payload),
    );
  });
}

export async function rebuildExecutionIndex(
  runtime: SqlStoreRuntime,
  options: { cursor?: string; limit?: number },
): Promise<{ nextCursor: string | null }> {
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    durableExecutionInvariantError.throw({
      message: "Index backfill limit must be an integer between 1 and 1000.",
    });
  }
  return runtime.withRead(async () => ({ nextCursor: null }));
}

export async function saveStepResultInTx(
  runtime: SqlStoreRuntime,
  tx: SqlExecutor,
  result: StepResult,
): Promise<void> {
  await tx.run(
    `INSERT INTO runner_durable_steps (namespace, execution_id, step_id, payload)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (namespace, execution_id, step_id) DO UPDATE SET payload = EXCLUDED.payload`,
    [
      runtime.namespace,
      result.executionId,
      result.stepId,
      runtime.stringify(result),
    ],
  );
}

export async function getStepResult(
  runtime: SqlStoreRuntime,
  executionId: string,
  stepId: string,
): Promise<StepResult | null> {
  return runtime.withRead(async (exec) => {
    const row = await exec.get<{ payload: string }>(
      `SELECT payload FROM runner_durable_steps
       WHERE namespace = ? AND execution_id = ? AND step_id = ?`,
      [runtime.namespace, executionId, stepId],
    );
    return row ? runtime.parse<StepResult>(row.payload) : null;
  });
}

export async function saveStepResult(
  runtime: SqlStoreRuntime,
  result: StepResult,
): Promise<void> {
  await runtime.withWriteTx(async (tx) => {
    await saveStepResultInTx(runtime, tx, result);
  });
}

export async function listStepResults(
  runtime: SqlStoreRuntime,
  executionId: string,
): Promise<StepResult[]> {
  return runtime.withRead(async (exec) => {
    const rows = await exec.all<{ payload: string }>(
      `SELECT payload FROM runner_durable_steps WHERE namespace = ? AND execution_id = ?`,
      [runtime.namespace, executionId],
    );
    return rows
      .map((row) => runtime.parse<StepResult>(row.payload))
      .sort(
        (left, right) =>
          new Date(left.completedAt).getTime() -
          new Date(right.completedAt).getTime(),
      );
  });
}

export async function appendAuditEntry(
  runtime: SqlStoreRuntime,
  entry: DurableAuditEntry,
): Promise<void> {
  await runtime.withWriteTx(async (tx) => {
    await tx.run(
      `INSERT INTO runner_durable_audit (namespace, execution_id, payload) VALUES (?, ?, ?)`,
      [runtime.namespace, entry.executionId, runtime.stringify(entry)],
    );
  });
}

export async function listAuditEntries(
  runtime: SqlStoreRuntime,
  executionId: string,
  options: { limit?: number; offset?: number },
): Promise<DurableAuditEntry[]> {
  return runtime.withRead(async (exec) => {
    const offset = options.offset ?? 0;
    const hasLimit = options.limit !== undefined;
    const sql = hasLimit
      ? `SELECT payload FROM runner_durable_audit
         WHERE namespace = ? AND execution_id = ?
         ORDER BY id ASC LIMIT ? OFFSET ?`
      : `SELECT payload FROM runner_durable_audit
         WHERE namespace = ? AND execution_id = ?
         ORDER BY id ASC${offset > 0 ? " LIMIT -1 OFFSET ?" : ""}`;
    const params: SqlParam[] = hasLimit
      ? [runtime.namespace, executionId, options.limit!, offset]
      : offset > 0
        ? [runtime.namespace, executionId, offset]
        : [runtime.namespace, executionId];

    // PostgreSQL does not accept LIMIT -1; run unbounded OFFSET query cleanly when needed.
    const normalizedSql =
      !hasLimit && offset > 0 && exec.dialect === "postgres"
        ? `SELECT payload FROM runner_durable_audit
           WHERE namespace = ? AND execution_id = ?
           ORDER BY id ASC OFFSET ?`
        : sql;
    const rows = await exec.all<{ payload: string }>(normalizedSql, params);
    return rows.map((row) => runtime.parse<DurableAuditEntry>(row.payload));
  });
}

export async function getWorkflowState<TState = unknown>(
  runtime: SqlStoreRuntime,
  executionId: string,
): Promise<WorkflowState<TState> | null> {
  return runtime.withRead(async (exec) => {
    const row = await exec.get<{ payload: string }>(
      `SELECT payload FROM runner_durable_workflow_states
       WHERE namespace = ? AND execution_id = ?`,
      [runtime.namespace, executionId],
    );
    return row ? runtime.parse<WorkflowState<TState>>(row.payload) : null;
  });
}

export async function saveWorkflowStateInTx(
  runtime: SqlStoreRuntime,
  tx: SqlExecutor,
  state: WorkflowState,
): Promise<void> {
  await tx.run(
    `INSERT INTO runner_durable_workflow_states (namespace, execution_id, payload)
     VALUES (?, ?, ?)
     ON CONFLICT (namespace, execution_id) DO UPDATE SET payload = EXCLUDED.payload`,
    [runtime.namespace, state.executionId, runtime.stringify(state)],
  );
}

export async function saveWorkflowState(
  runtime: SqlStoreRuntime,
  state: WorkflowState,
): Promise<void> {
  await runtime.withWriteTx(async (tx) => {
    await saveWorkflowStateInTx(runtime, tx, state);
  });
}
