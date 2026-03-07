import { resolveShutdownDrainWarningDecision } from "../../tools/shutdownDrainWarning";

describe("shutdownDrainWarning", () => {
  it("does not warn when drain completes successfully", () => {
    expect(
      resolveShutdownDrainWarningDecision({
        requestedDrainBudgetMs: 100,
        effectiveDrainBudgetMs: 100,
        drainWaitResult: { completed: true, drained: true },
      }),
    ).toEqual({ shouldWarn: false });
  });

  it("does not warn when drain waiting is explicitly disabled", () => {
    expect(
      resolveShutdownDrainWarningDecision({
        requestedDrainBudgetMs: 0,
        effectiveDrainBudgetMs: 0,
        drainWaitResult: { completed: false },
      }),
    ).toEqual({ shouldWarn: false });
  });

  it("warns when drain budget times out", () => {
    expect(
      resolveShutdownDrainWarningDecision({
        requestedDrainBudgetMs: 100,
        effectiveDrainBudgetMs: 100,
        drainWaitResult: { completed: true, drained: false },
      }),
    ).toEqual({
      shouldWarn: true,
      reason: "drain-budget-timeout",
    });
  });

  it("warns when total dispose budget expires during drain wait", () => {
    expect(
      resolveShutdownDrainWarningDecision({
        requestedDrainBudgetMs: 200,
        effectiveDrainBudgetMs: 150,
        drainWaitResult: { completed: false },
      }),
    ).toEqual({
      shouldWarn: true,
      reason: "dispose-budget-timeout-during-drain",
    });
  });

  it("warns when dispose budget is already exhausted before drain starts", () => {
    expect(
      resolveShutdownDrainWarningDecision({
        requestedDrainBudgetMs: 200,
        effectiveDrainBudgetMs: 0,
        drainWaitResult: { completed: false },
      }),
    ).toEqual({
      shouldWarn: true,
      reason: "dispose-budget-exhausted-before-drain",
    });
  });
});
