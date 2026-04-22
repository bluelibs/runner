import type {
  DurableExecutionWaiter,
  DurableSignalState,
  DurableSignalWaiter,
  Execution,
  Schedule,
  StepResult,
  Timer,
} from "../../core/types";
import type { DurableAuditEntry } from "../../core/audit";

/**
 * Serializable snapshot of the in-memory durable state.
 *
 * This intentionally excludes ephemeral lock ownership because lock recovery is
 * rebuilt on boot and must not resurrect stale claims from a prior process.
 */
export interface MemoryStoreSnapshot {
  version: 1;
  executions: Execution[];
  executionIdByIdempotencyKey: Array<readonly [string, string]>;
  stepResults: StepResult[];
  signalStates: DurableSignalState[];
  signalWaiters: DurableSignalWaiter[];
  executionWaiters: DurableExecutionWaiter[];
  auditEntries: DurableAuditEntry[];
  timers: Timer[];
  schedules: Schedule[];
}

export type DurableMutationResult<T> = {
  result: T;
  changed: boolean;
};
