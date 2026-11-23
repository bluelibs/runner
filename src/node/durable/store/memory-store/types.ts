import type {
  DurableExecutionWaiter,
  DurableSignalState,
  DurableSignalWaiter,
  Execution,
  Schedule,
  StepResult,
  Timer,
  WorkflowState,
} from "../../core/types";
import type { DurableAuditEntry } from "../../core/audit";
import type { DurableHistoryEntry } from "../../core/interfaces/history";
import type { DurableCommandRecord } from "../../core/interfaces/commands";

/**
 * Serializable snapshot of the in-memory durable state.
 *
 * This intentionally excludes ephemeral lock ownership because lock recovery is
 * rebuilt on boot and must not resurrect stale claims from a prior process.
 */
export interface MemoryStoreSnapshot {
  version: 1;
  /** Optional for reading snapshots written before ordered history was introduced. */
  histories?: Array<{
    executionId: string;
    sequence: number;
    entries: DurableHistoryEntry[];
  }>;
  /** Optional command receipts and FIFO indexes preserve old snapshot compatibility. */
  commands?: DurableCommandRecord[];
  /** Pending command identities in admission order for each target. */
  commandQueues?: Array<readonly [string, string[]]>;
  executions: Execution[];
  executionIdByIdempotencyKey: Array<readonly [string, string]>;
  stepResults: StepResult[];
  signalStates: DurableSignalState[];
  signalWaiters: DurableSignalWaiter[];
  executionWaiters: DurableExecutionWaiter[];
  workflowStates: WorkflowState[];
  auditEntries: DurableAuditEntry[];
  timers: Timer[];
  schedules: Schedule[];
}

export type DurableMutationResult<T> = {
  result: T;
  changed: boolean;
};
