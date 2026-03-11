import type { BudgetLedger } from "../app/budget/budget-ledger.resource";
import {
  getAskRunnerHealthTask,
  getBudgetSnapshotTask,
  resumeBudgetTask,
  stopBudgetForDayTask,
} from "../app/http/http-endpoints.task";

describe("http endpoint tasks", () => {
  const fixedDate = new Date("2026-03-09T10:00:00.000Z");

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(fixedDate);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function createLedger(): BudgetLedger {
    return {
      enforceIpLimit: jest.fn(),
      ensureDayCanSpend: jest.fn(),
      recordUsage: jest.fn(),
      stopForDay: jest.fn((day: string, reason: string) => ({
        day,
        spentUsd: 0,
        requestCount: 0,
        stopped: true,
        stopReason: reason,
        remainingUsd: 1,
      })),
      resume: jest.fn((day: string) => ({
        day,
        spentUsd: 0,
        requestCount: 0,
        stopped: false,
        stopReason: null,
        remainingUsd: 1,
      })),
      getSnapshot: jest.fn((day: string) => ({
        day,
        spentUsd: 0,
        requestCount: 0,
        stopped: false,
        stopReason: null,
        remainingUsd: 1,
      })),
    };
  }

  test("health task returns budget snapshot and state", async () => {
    const budgetLedger = createLedger();

    const result = await getAskRunnerHealthTask.run({}, { budgetLedger });

    expect(result.status).toBe("ok");
    expect(result.state.storage).toBe("memory");
    expect(budgetLedger.getSnapshot).toHaveBeenCalled();
  });

  test("budget snapshot task delegates to ledger", async () => {
    const budgetLedger = createLedger();

    const result = await getBudgetSnapshotTask.run(
      {},
      { budgetLedger },
    );

    expect(result.day).toBe("2026-03-09");
    expect(budgetLedger.getSnapshot).toHaveBeenCalledWith("2026-03-09");
  });

  test("stop budget task delegates to ledger", async () => {
    const budgetLedger = createLedger();

    const result = await stopBudgetForDayTask.run(
      { reason: "manual" },
      { budgetLedger },
    );

    expect(result.stopReason).toBe("manual");
    expect(budgetLedger.stopForDay).toHaveBeenCalledWith("2026-03-09", "manual");
  });

  test("resume budget task delegates to ledger", async () => {
    const budgetLedger = createLedger();

    const result = await resumeBudgetTask.run(
      {},
      { budgetLedger },
    );

    expect(result.day).toBe("2026-03-09");
    expect(budgetLedger.resume).toHaveBeenCalledWith("2026-03-09");
  });
});
