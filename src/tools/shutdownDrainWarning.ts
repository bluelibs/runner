export type ShutdownDrainWarningReason =
  | "drain-budget-timeout"
  | "dispose-budget-exhausted-before-drain";

export type ShutdownDrainWaitResult =
  | { completed: false }
  | { completed: true; drained: boolean };

export type ShutdownDrainWarningInput = {
  requestedDrainBudgetMs: number;
  effectiveDrainBudgetMs: number;
  drainWaitResult: ShutdownDrainWaitResult;
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
    return { shouldWarn: true, reason: "drain-budget-timeout" };
  }

  return { shouldWarn: false };
}
