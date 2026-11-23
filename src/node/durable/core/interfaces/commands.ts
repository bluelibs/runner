/** Client options for a tracked command; waiting can stop without cancelling the durable request. */
export interface DurableCommandOptions {
  /** Stable request key. Repeating it returns the original result. */
  idempotencyKey?: string;
  /** Optional caller wait deadline in milliseconds. */
  waitTimeoutMs?: number;
}

/** Persisted command receipt and private staged workflow state. */
export interface DurableCommandRecord {
  /** Exact request identity, scoped by requested execution, task, and request key. */
  id: string;
  /** Address used by the caller, before following continuations. */
  requestedExecutionId: string;
  /** Live execution that serializes this command with workflow progress. */
  executionId: string;
  /** Canonical Runner task identity; never its display name. */
  taskKey: string;
  /** Workflow implementation version that accepted the request. */
  workflowVersion?: number;
  /** Input validated by the Runner task contract. */
  input: unknown;
  /** Durable receipt phase. */
  status: "pending" | "running" | "completed" | "failed";
  /** Result retained for duplicate callers. */
  result?: unknown;
  /** Persisted failure returned to callers. */
  error?: { message: string; stack?: string };
  /** Private state applied atomically on success. Undefined is uninitialized; null is initialized without a value. */
  state?: { value: unknown } | null;
  /** Admission timestamp. */
  createdAt: Date;
  /** Receipt completion timestamp. */
  completedAt?: Date;
}
