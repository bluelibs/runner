import { createExecutionId } from "./utils";
import type { ExecutionStatus } from "./types";

export const DurableAuditEntryKind = {
  ExecutionStatusChanged: "execution_status_changed",
  StepCompleted: "step_completed",
  SleepScheduled: "sleep_scheduled",
  SleepCompleted: "sleep_completed",
  SignalWaiting: "signal_waiting",
  SignalDelivered: "signal_delivered",
  SignalTimedOut: "signal_timed_out",
  EmitPublished: "emit_published",
  SwitchEvaluated: "switch_evaluated",
  Note: "note",
} as const;

export type DurableAuditEntryKind =
  (typeof DurableAuditEntryKind)[keyof typeof DurableAuditEntryKind];

export interface DurableAuditEntryBase {
  id: string;
  executionId: string;
  at: Date;
  kind: DurableAuditEntryKind;
  attempt: number;
  workflowKey?: string;
}

export type DurableAuditEntry =
  | (DurableAuditEntryBase & {
      kind: typeof DurableAuditEntryKind.ExecutionStatusChanged;
      from: ExecutionStatus | null;
      to: ExecutionStatus;
      reason?: string;
    })
  | (DurableAuditEntryBase & {
      kind: typeof DurableAuditEntryKind.StepCompleted;
      stepId: string;
      durationMs: number;
      isInternal: boolean;
    })
  | (DurableAuditEntryBase & {
      kind: typeof DurableAuditEntryKind.SleepScheduled;
      stepId: string;
      timerId: string;
      durationMs: number;
      fireAt: Date;
    })
  | (DurableAuditEntryBase & {
      kind: typeof DurableAuditEntryKind.SleepCompleted;
      stepId: string;
      timerId: string;
    })
  | (DurableAuditEntryBase & {
      kind: typeof DurableAuditEntryKind.SignalWaiting;
      stepId: string;
      signalId: string;
      timeoutMs?: number;
      timeoutAtMs?: number;
      timerId?: string;
      reason?: "initial" | "timeout_armed";
    })
  | (DurableAuditEntryBase & {
      kind: typeof DurableAuditEntryKind.SignalDelivered;
      stepId: string;
      signalId: string;
    })
  | (DurableAuditEntryBase & {
      kind: typeof DurableAuditEntryKind.SignalTimedOut;
      stepId: string;
      signalId: string;
      timerId: string;
    })
  | (DurableAuditEntryBase & {
      kind: typeof DurableAuditEntryKind.EmitPublished;
      stepId: string;
      eventId: string;
    })
  | (DurableAuditEntryBase & {
      kind: typeof DurableAuditEntryKind.SwitchEvaluated;
      stepId: string;
      branchId: string;
      durationMs: number;
    })
  | (DurableAuditEntryBase & {
      kind: typeof DurableAuditEntryKind.Note;
      message: string;
      meta?: Record<string, unknown>;
    });

/**
 * Input type for appendAuditEntry - omits auto-generated fields (id, at).
 * Preserves the discriminated union for proper type checking at call sites.
 * executionId and attempt are required for service-level entries but filled by context.
 */
export type DurableAuditEntryInput =
  | {
      kind: typeof DurableAuditEntryKind.ExecutionStatusChanged;
      executionId: string;
      attempt: number;
      from: ExecutionStatus | null;
      to: ExecutionStatus;
      reason?: string;
      workflowKey?: string;
    }
  | {
      kind: typeof DurableAuditEntryKind.StepCompleted;
      stepId: string;
      durationMs: number;
      isInternal: boolean;
      workflowKey?: string;
    }
  | {
      kind: typeof DurableAuditEntryKind.SleepScheduled;
      stepId: string;
      timerId: string;
      durationMs: number;
      fireAt: Date;
      workflowKey?: string;
    }
  | {
      kind: typeof DurableAuditEntryKind.SleepCompleted;
      executionId: string;
      attempt: number;
      stepId: string;
      timerId: string;
      workflowKey?: string;
    }
  | {
      kind: typeof DurableAuditEntryKind.SignalWaiting;
      stepId: string;
      signalId: string;
      timeoutMs?: number;
      timeoutAtMs?: number;
      timerId?: string;
      reason?: "initial" | "timeout_armed";
      workflowKey?: string;
    }
  | {
      kind: typeof DurableAuditEntryKind.SignalDelivered;
      executionId: string;
      attempt: number;
      stepId: string;
      signalId: string;
      workflowKey?: string;
    }
  | {
      kind: typeof DurableAuditEntryKind.SignalTimedOut;
      executionId: string;
      attempt: number;
      stepId: string;
      signalId: string;
      timerId: string;
      workflowKey?: string;
    }
  | {
      kind: typeof DurableAuditEntryKind.EmitPublished;
      stepId: string;
      eventId: string;
      workflowKey?: string;
    }
  | {
      kind: typeof DurableAuditEntryKind.SwitchEvaluated;
      stepId: string;
      branchId: string;
      durationMs: number;
      workflowKey?: string;
    }
  | {
      kind: typeof DurableAuditEntryKind.Note;
      message: string;
      meta?: Record<string, unknown>;
      workflowKey?: string;
    };

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
