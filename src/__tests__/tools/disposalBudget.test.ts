import { createDisposalBudget } from "../../tools/disposalBudget";

describe("disposalBudget", () => {
  it("normalizes non-finite and non-positive budgets", async () => {
    const nanBudget = createDisposalBudget(Number.NaN);
    expect(nanBudget.remainingMs()).toBe(0);
    expect(nanBudget.capByRemainingBudget(100)).toBe(0);

    const shouldNotRun = jest.fn(async () => "ok");
    await expect(nanBudget.waitWithinBudget(shouldNotRun)).resolves.toEqual({
      completed: false,
    });
    expect(shouldNotRun).not.toHaveBeenCalled();

    const infinityBudget = createDisposalBudget(Number.POSITIVE_INFINITY);
    expect(infinityBudget.remainingMs()).toBeGreaterThan(0);
    expect(infinityBudget.capByRemainingBudget(5.9)).toBe(5);

    const negativeInfinityBudget = createDisposalBudget(
      Number.NEGATIVE_INFINITY,
    );
    expect(negativeInfinityBudget.remainingMs()).toBe(0);
  });

  it("caps requested budget by remaining time", () => {
    jest.useFakeTimers();

    try {
      const budget = createDisposalBudget(10);
      jest.advanceTimersByTime(7);

      expect(budget.capByRemainingBudget(10)).toBe(3);
      expect(budget.capByRemainingBudget(1)).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("returns completed result when execution resolves before timeout", async () => {
    const budget = createDisposalBudget(100);

    await expect(budget.waitWithinBudget(async () => "done")).resolves.toEqual({
      completed: true,
      value: "done",
    });
  });

  it("times out long-running execution and swallows late rejection", async () => {
    jest.useFakeTimers();

    try {
      const budget = createDisposalBudget(10);
      const delayedRejection = jest.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            setTimeout(() => reject(new Error("late failure")), 20);
          }),
      );

      const resultPromise = budget.waitWithinBudget(delayedRejection);
      jest.advanceTimersByTime(10);

      await expect(resultPromise).resolves.toEqual({ completed: false });
      jest.advanceTimersByTime(10);
      await Promise.resolve();
      expect(delayedRejection).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
