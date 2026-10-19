import { check, Match } from "../../../tools/check";
import type { Execution } from "./types";

/** Successful-execution history retention; failures are always retained. */
export interface ExecutionRetention {
  /** Retain history, collect it immediately, or collect after the given milliseconds. */
  onComplete: "retain" | "delete" | { afterMs: number };
}

/** Resolves and validates a successful-history retention policy. */
export function retentionDelay(
  policy?: ExecutionRetention,
): number | undefined {
  if (!policy) return undefined;
  check(policy, {
    onComplete: Match.OneOf("retain", "delete", {
      afterMs: Match.Where(
        (value: unknown) =>
          typeof value === "number" && Number.isFinite(value) && value >= 0,
      ),
    }),
  });
  return policy.onComplete === "retain"
    ? undefined
    : policy.onComplete === "delete"
      ? 0
      : policy.onComplete.afterMs;
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
