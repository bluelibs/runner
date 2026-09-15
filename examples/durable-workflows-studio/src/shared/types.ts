/**
 * API data contracts shared by the studio server and the web client.
 *
 * Everything here is plain JSON-serialisable data: no Runner imports, so the
 * Vite app can import this file directly without pulling Node-only code.
 */

/** Execution lifecycle states, mirroring the durable engine. */
export type StudioExecutionStatus =
  | "pending"
  | "running"
  | "cancelling"
  | "retrying"
  | "sleeping"
  | "completed"
  | "compensation_failed"
  | "failed"
  | "cancelled";

/** Visual node kinds rendered on the execution timeline. */
export type StudioNodeKind =
  | "step"
  | "sleep"
  | "signal"
  | "switch"
  | "child"
  | "note";

/** Runtime state of a single timeline node. */
export type StudioNodeState =
  | "completed"
  | "active"
  | "waiting"
  | "failed"
  | "skipped"
  | "pending"
  | "unreached";

/** A static node of a workflow graph, declared in the catalog. */
export interface StudioGraphNode {
  /** Persisted durable step id (e.g. `validateOrder`, `__signal:awaitPayment`). */
  id: string;
  kind: StudioNodeKind;
  label: string;
  description: string;
  /** Signal id for `signal` nodes. */
  signal?: string;
  /** Branch ids for `switch` nodes. */
  branches?: string[];
}

/** A static edge of a workflow graph. */
export interface StudioGraphEdge {
  from: string;
  to: string;
  /** Switch branch this edge belongs to (for branch edges). */
  branch?: string;
  label?: string;
}

/** Static workflow graph used for visualisation. */
export interface StudioWorkflowGraph {
  nodes: StudioGraphNode[];
  edges: StudioGraphEdge[];
}

/** A runnable workflow presented in the studio sidebar. */
export interface StudioWorkflow {
  key: string;
  title: string;
  category: string;
  description: string;
  /** Signals this workflow can receive. */
  signals: StudioSignal[];
  /** Named input presets for the start dialog. */
  presets: StudioInputPreset[];
  graph: StudioWorkflowGraph;
}

/** A signal a workflow can receive, with payload presets. */
export interface StudioSignal {
  id: string;
  title: string;
  description: string;
  presets: StudioInputPreset[];
}

/** A named JSON payload preset. */
export interface StudioInputPreset {
  name: string;
  payload: unknown;
}

/** Compact execution row for lists. */
export interface StudioExecutionSummary {
  id: string;
  workflowKey: string;
  workflowTitle: string;
  status: StudioExecutionStatus;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** Short human line describing where the execution currently sits. */
  position: string | null;
  /** Direct parent execution when this run was started by another workflow. */
  parentExecutionId?: string;
}

/** A JSON-safe persisted step result. */
export interface StudioStepResult {
  stepId: string;
  result: unknown;
  completedAt: string;
}

/** A JSON-safe audit entry. */
export interface StudioAuditEntry {
  id: string;
  at: string;
  kind: string;
  attempt: number;
  detail: Record<string, unknown>;
}

/** One accepted signal payload in its execution-level journal. */
export interface StudioSignalRecord {
  id: string;
  payload: unknown;
  receivedAt: string;
  /** Queued records still await a matching wait; consumed records already resumed one. */
  state: "queued" | "consumed";
}

/** Retained journal for one signal id. */
export interface StudioSignalJournal {
  signalId: string;
  history: StudioSignalRecord[];
}

/** Runtime overlay for one graph node. */
export interface StudioTimelineNode extends StudioGraphNode {
  state: StudioNodeState;
  /** Switch branch taken, when known. */
  branchTaken: string | null;
  result: unknown;
  completedAt: string | null;
  /** Live wait metadata (signal waits, sleeps) for countdowns. */
  wait: {
    signalId?: string;
    targetExecutionId?: string;
    timeoutAtMs?: number;
    fireAtMs?: number;
  } | null;
}

/** Full execution detail backing the detail view. */
export interface StudioExecutionDetail {
  id: string;
  /** Direct parent execution when this run was started by another workflow. */
  parentExecutionId?: string;
  workflowKey: string;
  workflowTitle: string;
  status: StudioExecutionStatus;
  attempt: number;
  maxAttempts: number;
  input: unknown;
  result: unknown;
  error: { message: string; stack?: string; stepId?: string } | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  position: string | null;
  timeline: StudioTimelineNode[];
  edges: StudioGraphEdge[];
  steps: StudioStepResult[];
  audit: StudioAuditEntry[];
  signals: StudioSignalJournal[];
  relations: {
    parent: StudioExecutionSummary | null;
    children: StudioExecutionSummary[];
  };
}

/** Query filters for the executions list endpoint. */
export interface StudioExecutionFilters {
  workflowKey?: string;
  status?: StudioExecutionStatus;
  limit?: number;
  offset?: number;
}

/** One bounded execution page for progressively loaded operator views. */
export interface StudioExecutionPage {
  executions: StudioExecutionSummary[];
  hasMore: boolean;
  /** Offset for the next page, or `null` when the result set is exhausted. */
  nextOffset: number | null;
  /** Exact filtered total when the backing store can provide it cheaply. */
  total?: number;
}

/** A durable schedule (cron / interval / one-time timer). */
export interface StudioSchedule {
  id: string;
  workflowKey: string;
  workflowTitle: string;
  type: string;
  pattern: string;
  timezone?: string;
  input: unknown;
  status: string;
  lastRun: string | null;
  nextRun: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Result of an orphan-recovery run. */
export interface StudioRecoverReport {
  scannedCount: number;
  recoveredCount: number;
  skippedCount: number;
  failedCount: number;
}
