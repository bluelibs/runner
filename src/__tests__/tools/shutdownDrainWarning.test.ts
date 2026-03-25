import { resolveShutdownDrainWarningDecision } from "../../tools/shutdownDrainWarning";

describe("shutdownDrainWarning", () => {
  it("does not warn when drain completes successfully", () => {
    expect(
      resolveShutdownDrainWarningDecision({
        requestedDrainBudgetMs: 100,
        effectiveDrainBudgetMs: 100,
        drainWaitResult: { completed: true, drained: true },
        requestedAbortWindowMs: 0,
        effectiveAbortWindowMs: 0,
        abortWaitResult: { completed: false },
      }),
    ).toEqual({ shouldWarn: false });
  });

  it("does not warn when drain waiting is explicitly disabled", () => {
    expect(
      resolveShutdownDrainWarningDecision({
        requestedDrainBudgetMs: 0,
        effectiveDrainBudgetMs: 0,
        drainWaitResult: { completed: false },
        requestedAbortWindowMs: 0,
        effectiveAbortWindowMs: 0,
        abortWaitResult: { completed: false },
      }),
    ).toEqual({ shouldWarn: false });
  });

  it("warns when drain budget times out", () => {
    expect(
      resolveShutdownDrainWarningDecision({
        requestedDrainBudgetMs: 100,
        effectiveDrainBudgetMs: 100,
        drainWaitResult: { completed: true, drained: false },
        requestedAbortWindowMs: 0,
        effectiveAbortWindowMs: 0,
        abortWaitResult: { completed: false },
      }),
    ).toEqual({
      shouldWarn: true,
      reason: "drain-budget-timeout",
    });
  });

  it("warns when dispose budget is already exhausted before drain starts", () => {
    expect(
      resolveShutdownDrainWarningDecision({
        requestedDrainBudgetMs: 200,
        effectiveDrainBudgetMs: 0,
        drainWaitResult: { completed: false },
        requestedAbortWindowMs: 0,
        effectiveAbortWindowMs: 0,
        abortWaitResult: { completed: false },
      }),
    ).toEqual({
      shouldWarn: true,
      reason: "dispose-budget-exhausted-before-drain",
    });
  });

  it("warns when abort window also times out", () => {
    expect(
      resolveShutdownDrainWarningDecision({
        requestedDrainBudgetMs: 100,
        effectiveDrainBudgetMs: 100,
        drainWaitResult: { completed: true, drained: false },
        requestedAbortWindowMs: 25,
        effectiveAbortWindowMs: 25,
        abortWaitResult: { completed: true, drained: false },
      }),
    ).toEqual({
      shouldWarn: true,
      reason: "abort-window-timeout",
    });
  });

  it("warns when no budget remains for the abort window", () => {
    expect(
      resolveShutdownDrainWarningDecision({
        requestedDrainBudgetMs: 100,
        effectiveDrainBudgetMs: 100,
        drainWaitResult: { completed: true, drained: false },
        requestedAbortWindowMs: 25,
        effectiveAbortWindowMs: 0,
        abortWaitResult: { completed: false },
      }),
    ).toEqual({
      shouldWarn: true,
      reason: "dispose-budget-exhausted-before-abort-window",
    });
  });

  it("keeps the warning at drain-budget-timeout when abort window settles work", () => {
    expect(
      resolveShutdownDrainWarningDecision({
        requestedDrainBudgetMs: 100,
        effectiveDrainBudgetMs: 100,
        drainWaitResult: { completed: true, drained: false },
        requestedAbortWindowMs: 25,
        effectiveAbortWindowMs: 25,
        abortWaitResult: { completed: true, drained: true },
      }),
    ).toEqual({
      shouldWarn: true,
      reason: "drain-budget-timeout",
    });
  });
});
