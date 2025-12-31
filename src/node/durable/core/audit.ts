import { createExecutionId } from "./utils";
import type { ExecutionStatus } from "./types";

export type DurableAuditEntryKind =
  | "execution_status_changed"
  | "step_completed"
  | "sleep_scheduled"
  | "sleep_completed"
  | "signal_waiting"
  | "signal_delivered"
  | "signal_timed_out"
  | "emit_published"
  | "note";

export interface DurableAuditEntryBase {
  id: string;
  executionId: string;
  at: Date;
  kind: DurableAuditEntryKind;
  attempt: number;
  taskId?: string;
}

export type DurableAuditEntry =
  | (DurableAuditEntryBase & {
      kind: "execution_status_changed";
      from: ExecutionStatus | null;
      to: ExecutionStatus;
      reason?: string;
    })
  | (DurableAuditEntryBase & {
      kind: "step_completed";
      stepId: string;
      durationMs: number;
      isInternal: boolean;
    })
  | (DurableAuditEntryBase & {
      kind: "sleep_scheduled";
      stepId: string;
      timerId: string;
      durationMs: number;
      fireAt: Date;
    })
  | (DurableAuditEntryBase & {
      kind: "sleep_completed";
      stepId: string;
      timerId: string;
    })
  | (DurableAuditEntryBase & {
      kind: "signal_waiting";
      stepId: string;
      signalId: string;
      timeoutMs?: number;
      timeoutAtMs?: number;
      timerId?: string;
      reason?: "initial" | "timeout_armed";
    })
  | (DurableAuditEntryBase & {
      kind: "signal_delivered";
      stepId: string;
      signalId: string;
    })
  | (DurableAuditEntryBase & {
      kind: "signal_timed_out";
      stepId: string;
      signalId: string;
      timerId: string;
    })
  | (DurableAuditEntryBase & {
      kind: "emit_published";
      stepId: string;
      eventId: string;
    })
  | (DurableAuditEntryBase & {
      kind: "note";
      message: string;
      meta?: Record<string, unknown>;
    });

export interface DurableAuditEmitter {
  emit(entry: DurableAuditEntry): Promise<void>;
}

export function isDurableInternalStepId(stepId: string): boolean {
  return stepId.startsWith("__") || stepId.startsWith("rollback:");
}

export function createDurableAuditEntryId(atMs: number = Date.now()): string {
  // Keep IDs naturally sortable when stored by key prefix (time first).
  return `${atMs}:${createExecutionId()}`;
}
