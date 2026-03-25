export type ShutdownDrainWarningReason =
  | "drain-budget-timeout"
  | "abort-window-timeout"
  | "dispose-budget-exhausted-before-drain"
  | "dispose-budget-exhausted-before-abort-window";

export type ShutdownDrainWaitResult =
  | { completed: false }
  | { completed: true; drained: boolean };

export type ShutdownDrainWarningInput = {
  requestedDrainBudgetMs: number;
  effectiveDrainBudgetMs: number;
  drainWaitResult: ShutdownDrainWaitResult;
  requestedAbortWindowMs: number;
  effectiveAbortWindowMs: number;
  abortWaitResult: ShutdownDrainWaitResult;
};

export type ShutdownDrainWarningDecision =
  | { shouldWarn: false }
  | { shouldWarn: true; reason: ShutdownDrainWarningReason };

export function resolveShutdownDrainWarningDecision(
  input: ShutdownDrainWarningInput,
): ShutdownDrainWarningDecision {
  if (input.requestedDrainBudgetMs <= 0) {
    return { shouldWarn: false };
  }

  if (input.effectiveDrainBudgetMs <= 0) {
    return {
      shouldWarn: true,
      reason: "dispose-budget-exhausted-before-drain",
    };
  }

  if (
    input.drainWaitResult.completed &&
    input.drainWaitResult.drained === false
  ) {
    if (input.requestedAbortWindowMs <= 0) {
      return { shouldWarn: true, reason: "drain-budget-timeout" };
    }

    if (input.effectiveAbortWindowMs <= 0) {
      return {
        shouldWarn: true,
        reason: "dispose-budget-exhausted-before-abort-window",
      };
    }

    if (
      input.abortWaitResult.completed &&
      input.abortWaitResult.drained === false
    ) {
      return { shouldWarn: true, reason: "abort-window-timeout" };
    }

    return { shouldWarn: true, reason: "drain-budget-timeout" };
  }

  return { shouldWarn: false };
}
