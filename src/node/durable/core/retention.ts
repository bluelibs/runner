import { durableExecutionInvariantError } from "../../../errors/domain-runtime.errors";
import { check, Match } from "../../../tools/check";
import type { Execution } from "./types";

/** Retention schedule for completed-execution history or receipt cleanup. */
export type ExecutionRetentionSchedule =
  | "retain"
  | "delete"
  | { afterMs: number };

/** Successful-execution retention; failures are always retained. */
export interface ExecutionRetention {
  /** Retain history, collect it immediately, or collect after the given milliseconds. */
  onComplete: ExecutionRetentionSchedule;
  /** Optional retention schedule for completion receipts and dependent execution state. */
  receipts?: ExecutionRetentionSchedule;
}

const retentionSchedulePattern = Match.OneOf("retain", "delete", {
  afterMs: Match.Where(
    (value: unknown) =>
      typeof value === "number" && Number.isFinite(value) && value >= 0,
  ),
});

function scheduleDelay(
  schedule: ExecutionRetentionSchedule,
): number | undefined {
  return schedule === "retain"
    ? undefined
    : schedule === "delete"
      ? 0
      : schedule.afterMs;
}

/** Resolves and validates a successful-history retention policy. */
export function retentionDelay(
  policy?: ExecutionRetention,
): number | undefined {
  if (!policy) return undefined;
  check(policy, {
    onComplete: retentionSchedulePattern,
    receipts: Match.Optional(retentionSchedulePattern),
  });
  const historyDelay = scheduleDelay(policy.onComplete);
  const receiptsDelay =
    policy.receipts !== undefined ? scheduleDelay(policy.receipts) : undefined;
  if (
    historyDelay !== undefined &&
    receiptsDelay !== undefined &&
    receiptsDelay < historyDelay
  ) {
    durableExecutionInvariantError.throw({
      message:
        "Retention receipts schedule cannot expire earlier than onComplete history collection.",
    });
  }
  return historyDelay;
}

/** Validates policy and resolves receipt-expiry delay in milliseconds, if configured. */
export function receiptRetentionDelay(
  policy?: ExecutionRetention,
): number | undefined {
  retentionDelay(policy);
  return policy?.receipts !== undefined
    ? scheduleDelay(policy.receipts)
    : undefined;
}

/** Returns the durable history-collection deadline for a completed execution. */
export function collectionDeadline(execution: Execution): number | undefined {
  const delay = retentionDelay(execution.retention);
  return !execution.historyCollectedAt &&
    execution.status === "completed" &&
    execution.completedAt &&
    delay !== undefined
    ? execution.completedAt.getTime() + delay
    : undefined;
}

/** Returns the durable receipt-expiry deadline for a completed execution. */
export function receiptExpiryDeadline(
  execution: Execution,
): number | undefined {
  const delay = receiptRetentionDelay(execution.retention);
  return execution.status === "completed" &&
    execution.completedAt &&
    delay !== undefined
    ? execution.completedAt.getTime() + delay
    : undefined;
}
