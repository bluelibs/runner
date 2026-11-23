import type { SqlDialect } from "./types";

/** Generates idempotent schema DDL statements for the shared durable SQL tables. */
export function createSchemaStatements(dialect: SqlDialect): string[] {
  const c = dialect === "postgres" ? ' COLLATE "C"' : "";
  const auditIdCol =
    dialect === "postgres"
      ? "id BIGSERIAL PRIMARY KEY"
      : "id INTEGER PRIMARY KEY AUTOINCREMENT";

  return [
    `CREATE TABLE IF NOT EXISTS runner_durable_executions (
      namespace TEXT NOT NULL,
      id TEXT${c} NOT NULL,
      workflow_key TEXT NOT NULL,
      parent_execution_id TEXT,
      status TEXT NOT NULL,
      created_at_ms BIGINT NOT NULL,
      history_deadline_ms BIGINT,
      receipt_deadline_ms BIGINT,
      payload TEXT NOT NULL,
      state_payload TEXT NOT NULL,
      PRIMARY KEY (namespace, id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_runner_durable_executions_cursor
      ON runner_durable_executions (namespace, created_at_ms DESC, id ASC)`,
    `CREATE INDEX IF NOT EXISTS idx_runner_durable_executions_status_cursor
      ON runner_durable_executions (namespace, status, created_at_ms DESC, id ASC)`,
    `CREATE INDEX IF NOT EXISTS idx_runner_durable_executions_wf_cursor
      ON runner_durable_executions (namespace, workflow_key, created_at_ms DESC, id ASC)`,
    `CREATE INDEX IF NOT EXISTS idx_runner_durable_executions_wf_status_cursor
      ON runner_durable_executions (namespace, workflow_key, status, created_at_ms DESC, id ASC)`,
    `CREATE INDEX IF NOT EXISTS idx_runner_durable_executions_parent_cursor
      ON runner_durable_executions (namespace, parent_execution_id, created_at_ms DESC, id ASC)
      WHERE parent_execution_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_runner_durable_executions_active_cursor
      ON runner_durable_executions (namespace, created_at_ms DESC, id ASC)
      WHERE status NOT IN ('completed', 'failed', 'compensation_failed', 'cancelled', 'continued_as_new')`,
    `CREATE INDEX IF NOT EXISTS idx_runner_durable_executions_history_due
      ON runner_durable_executions (namespace, history_deadline_ms ASC, id ASC)
      WHERE history_deadline_ms IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_runner_durable_executions_receipt_due
      ON runner_durable_executions (namespace, receipt_deadline_ms ASC, id ASC)
      WHERE receipt_deadline_ms IS NOT NULL`,

    `CREATE TABLE IF NOT EXISTS runner_durable_idempotency (
      namespace TEXT NOT NULL,
      workflow_key TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      PRIMARY KEY (namespace, workflow_key, idempotency_key)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_runner_durable_idempotency_exec
      ON runner_durable_idempotency (namespace, execution_id)`,

    `CREATE TABLE IF NOT EXISTS runner_durable_steps (
      namespace TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      step_id TEXT${c} NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (namespace, execution_id, step_id)
    )`,

    `CREATE TABLE IF NOT EXISTS runner_durable_history (
      namespace TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      started_order BIGINT NOT NULL,
      completed_order BIGINT,
      payload TEXT NOT NULL,
      PRIMARY KEY (namespace, execution_id, step_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_runner_durable_history_order
      ON runner_durable_history (namespace, execution_id, started_order)`,

    `CREATE TABLE IF NOT EXISTS runner_durable_history_seq (
      namespace TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      seq BIGINT NOT NULL,
      PRIMARY KEY (namespace, execution_id)
    )`,

    `CREATE TABLE IF NOT EXISTS runner_durable_workflow_states (
      namespace TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (namespace, execution_id)
    )`,

    `CREATE TABLE IF NOT EXISTS runner_durable_audit (
      ${auditIdCol},
      namespace TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      payload TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_runner_durable_audit_exec
      ON runner_durable_audit (namespace, execution_id, id)`,

    `CREATE TABLE IF NOT EXISTS runner_durable_signal_states (
      namespace TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      signal_id TEXT${c} NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (namespace, execution_id, signal_id)
    )`,

    `CREATE TABLE IF NOT EXISTS runner_durable_signal_waiters (
      namespace TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      signal_id TEXT${c} NOT NULL,
      step_id TEXT NOT NULL,
      sort_key TEXT${c} NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (namespace, execution_id, signal_id, step_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_runner_durable_signal_waiters_order
      ON runner_durable_signal_waiters (namespace, execution_id, signal_id, sort_key, step_id)`,

    `CREATE TABLE IF NOT EXISTS runner_durable_execution_waiters (
      namespace TEXT NOT NULL,
      target_execution_id TEXT NOT NULL,
      execution_id TEXT NOT NULL,
      step_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (namespace, target_execution_id, execution_id, step_id)
    )`,

    `CREATE TABLE IF NOT EXISTS runner_durable_timers (
      namespace TEXT NOT NULL,
      id TEXT${c} NOT NULL,
      execution_id TEXT,
      status TEXT NOT NULL,
      fire_at_ms BIGINT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (namespace, id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_runner_durable_timers_ready
      ON runner_durable_timers (namespace, status, fire_at_ms, id)`,
    `CREATE INDEX IF NOT EXISTS idx_runner_durable_timers_exec
      ON runner_durable_timers (namespace, execution_id)`,

    `CREATE TABLE IF NOT EXISTS runner_durable_schedules (
      namespace TEXT NOT NULL,
      id TEXT${c} NOT NULL,
      status TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (namespace, id)
    )`,

    `CREATE TABLE IF NOT EXISTS runner_durable_commands (
      namespace TEXT NOT NULL,
      id TEXT${c} NOT NULL,
      execution_id TEXT NOT NULL,
      status TEXT NOT NULL,
      queue_seq BIGINT,
      payload TEXT NOT NULL,
      PRIMARY KEY (namespace, id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_runner_durable_commands_fifo
      ON runner_durable_commands (namespace, execution_id, queue_seq)
      WHERE queue_seq IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_runner_durable_commands_exec
      ON runner_durable_commands (namespace, execution_id)`,

    `CREATE TABLE IF NOT EXISTS runner_durable_locks (
      namespace TEXT NOT NULL,
      resource TEXT${c} NOT NULL,
      lock_id TEXT NOT NULL,
      expires_at_ms BIGINT NOT NULL,
      PRIMARY KEY (namespace, resource)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_runner_durable_locks_expires
      ON runner_durable_locks (namespace, expires_at_ms)`,
  ];
}
