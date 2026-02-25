type BudgetedWaitResult<T> =
  | { completed: true; value: T }
  | { completed: false };

function normalizeBudgetMs(value: number): number {
  if (!Number.isFinite(value)) {
    return value === Number.POSITIVE_INFINITY ? Number.MAX_SAFE_INTEGER : 0;
  }

  if (value <= 0) {
    return 0;
  }

  return Math.floor(value);
}

export function createDisposalBudget(totalBudgetMs: number) {
  const normalizedTotalBudgetMs = normalizeBudgetMs(totalBudgetMs);
  const deadline = Date.now() + normalizedTotalBudgetMs;

  const remainingMs = (): number => Math.max(0, deadline - Date.now());

  const capByRemainingBudget = (requestedMs: number): number =>
    Math.min(normalizeBudgetMs(requestedMs), remainingMs());

  const waitWithinBudget = async <T>(
    execute: () => Promise<T>,
  ): Promise<BudgetedWaitResult<T>> => {
    const timeoutMs = remainingMs();
    if (timeoutMs <= 0) {
      return { completed: false };
    }

    const execution = Promise.resolve().then(execute);
    let timeoutRef: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<BudgetedWaitResult<T>>((resolve) => {
      timeoutRef = setTimeout(() => resolve({ completed: false }), timeoutMs);
    });

    try {
      const result = await Promise.race([
        execution.then(
          (value): BudgetedWaitResult<T> => ({
            completed: true,
            value,
          }),
        ),
        timeoutPromise,
      ]);

      if (!result.completed) {
        void execution.catch(String);
      }

      return result;
    } finally {
      clearTimeout(timeoutRef);
    }
  };

  return {
    remainingMs,
    capByRemainingBudget,
    waitWithinBudget,
  };
}
