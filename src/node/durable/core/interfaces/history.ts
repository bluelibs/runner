import type { Execution, StepResult } from "../types";

/** Durable operation identity; runtime implementation code is never serialized. */
export type DurableHistoryKind =
  | "step"
  | "workflow"
  | "continue"
  | "sleep"
  | "signal"
  | "execution"
  | "switch"
  | "state"
  | "command"
  | "origin";

/** Ordered checkpoint metadata used by replay validation and explicit reset. */
export interface DurableHistoryEntry {
  /** Exact durable call-site identity. */
  stepId: string;
  /** Operation contract at the call site. */
  kind: DurableHistoryKind;
  /** Enclosing step when an operation was called inside a callback. */
  parentStepId?: string;
  /** Canonical Runner task identity for task-based steps. */
  taskKey?: string;
  /** Monotonic invocation order within this execution. */
  startedOrder: number;
  /** Monotonic completion order; absent when interrupted or parked. */
  completedOrder?: number;
  /** State after a write, origin, or command; null means no state record. */
  stateAfter?: { value: unknown } | null;
}

/** Atomic history upsert. Replayed operations retain their original order and snapshot. */
export interface DurableHistoryUpdate extends Omit<
  DurableHistoryEntry,
  "startedOrder" | "completedOrder"
> {
  /** Starts an operation or records its completed checkpoint. */
  phase: "started" | "completed";
}

/** Portable execution data for compatibility tests; contains application payloads. */
export interface DurableReplayFixture {
  /** Execution whose persisted prefix is being checked. */
  execution: Execution;
  /** Ordered operations captured from the beginning of the run. */
  history: DurableHistoryEntry[];
  /** Saved operation results; external effects are not re-executed during replay. */
  steps: StepResult[];
}

/** Result of checking proposed workflow code against a saved prefix. */
export interface DurableReplayReport {
  /** True when every observed operation matches the saved prefix. */
  compatible: boolean;
  /** Observed calls matched against history; cached nested calls are skipped. */
  matched: number;
  /** Compatibility errors, rather than business results. */
  issues: string[];
}

/** Explicit branch from a recorded, non-overlapping checkpoint boundary. */
export interface DurableResetOptions {
  /** First top-level operation to run again. */
  beforeStep: string;
  /** Operator explanation retained on the new execution. */
  reason: string;
  /** Optional deduplication key scoped to this source and boundary. */
  idempotencyKey?: string;
}

/** One atomic checkpoint branch commit, prepared while owning the source lease. */
export interface DurableCheckpointBranch {
  /** Exact source snapshot; a concurrent operator change rejects the commit. */
  expected: Execution;
  /** Fresh execution identity and pinned implementation. */
  execution: Execution;
  /** Completed prefix results, readdressed to the new execution. */
  steps: StepResult[];
  /** Retained operation order and state snapshots. */
  history: DurableHistoryEntry[];
  /** State at the branch boundary; null means unset. */
  state: { value: unknown } | null;
}
