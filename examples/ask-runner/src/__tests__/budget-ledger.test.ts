import {
  assertAdminSecret,
  calculateUsageCost,
  createBudgetLedger,
  dayKey,
  defaultBudgetLedgerStorageLimits,
  hourBucket,
  minuteBucket,
} from "../app/budget/budget-ledger.resource";

describe("budget ledger", () => {
  function buildState() {
    return {
      dayStateByDay: new Map<
        string,
        {
          spentUsd: number;
          requestCount: number;
          stopped: boolean;
          stopReason: string | null;
        }
      >(),
      minuteWindow: { bucket: null, countsByIp: new Map<string, number>() },
      hourWindow: { bucket: null, countsByIp: new Map<string, number>() },
      dayWindow: { bucket: null, countsByIp: new Map<string, number>() },
      audit: [] as Array<{
        timestamp: string;
        day: string;
        ip: string;
        queryHash: string;
        model: string;
        estimatedCostUsd: number;
        actualCostUsd: number;
        status: "ok" | "rejected";
      }>,
    };
  }

  test("records usage cost and persists stop state", () => {
    const ledger = createBudgetLedger(
      buildState(),
      0.000001,
      { inputPer1M: 1, cachedInputPer1M: 0.1, outputPer1M: 1 },
      { perMinute: 5, perHour: 10, perDay: 10 },
    );

    const snapshot = ledger.recordUsage({
      day: "2026-03-09",
      ip: "127.0.0.1",
      query: "what is runner",
      model: "gpt-5-mini",
      estimatedCostUsd: 0.000001,
      usage: { input_tokens: 1, output_tokens: 1 },
      status: "ok",
    });

    expect(snapshot.requestCount).toBe(1);
    expect(snapshot.stopped).toBe(true);
    expect(snapshot.stopReason).toBe("Daily budget reached.");
  });

  test("enforces per-minute and per-day limits", () => {
    const ledger = createBudgetLedger(
      buildState(),
      10,
      { inputPer1M: 1, cachedInputPer1M: 0.1, outputPer1M: 1 },
      { perMinute: 1, perHour: 10, perDay: 2 },
    );

    ledger.enforceIpLimit({
      day: "2026-03-09",
      hourBucket: "2026-03-09T10",
      minuteBucket: "2026-03-09T10:00",
      ip: "1.1.1.1",
    });
    expect(() =>
      ledger.enforceIpLimit({
        day: "2026-03-09",
        hourBucket: "2026-03-09T10",
        minuteBucket: "2026-03-09T10:00",
        ip: "1.1.1.1",
      }),
    ).toThrow(/minute/);
  });

  test("enforces per-hour limits across minute buckets", () => {
    const ledger = createBudgetLedger(
      buildState(),
      10,
      { inputPer1M: 1, cachedInputPer1M: 0.1, outputPer1M: 1 },
      { perMinute: 5, perHour: 2, perDay: 10 },
    );

    ledger.enforceIpLimit({
      day: "2026-03-09",
      hourBucket: "2026-03-09T10",
      minuteBucket: "2026-03-09T10:00",
      ip: "1.1.1.1",
    });
    ledger.enforceIpLimit({
      day: "2026-03-09",
      hourBucket: "2026-03-09T10",
      minuteBucket: "2026-03-09T10:01",
      ip: "1.1.1.1",
    });
    expect(() =>
      ledger.enforceIpLimit({
        day: "2026-03-09",
        hourBucket: "2026-03-09T10",
        minuteBucket: "2026-03-09T10:02",
        ip: "1.1.1.1",
      }),
    ).toThrow(/hour/);
  });

  test("enforces per-day limits across minute buckets", () => {
    const ledger = createBudgetLedger(
      buildState(),
      10,
      { inputPer1M: 1, cachedInputPer1M: 0.1, outputPer1M: 1 },
      { perMinute: 5, perHour: 10, perDay: 2 },
    );

    ledger.enforceIpLimit({
      day: "2026-03-09",
      hourBucket: "2026-03-09T10",
      minuteBucket: "2026-03-09T10:00",
      ip: "1.1.1.1",
    });
    ledger.enforceIpLimit({
      day: "2026-03-09",
      hourBucket: "2026-03-09T10",
      minuteBucket: "2026-03-09T10:01",
      ip: "1.1.1.1",
    });
    expect(() =>
      ledger.enforceIpLimit({
        day: "2026-03-09",
        hourBucket: "2026-03-09T10",
        minuteBucket: "2026-03-09T10:02",
        ip: "1.1.1.1",
      }),
    ).toThrow(/day/);
  });

  test("admin secret check fails fast", () => {
    expect(() => assertAdminSecret("bad", "good")).toThrow(/Invalid admin secret/);
  });

  test("usage cost rounds predictably", () => {
    expect(
      calculateUsageCost(
        {
          input_tokens: 1000,
          input_tokens_details: { cached_tokens: 400 },
          output_tokens: 500,
        },
        { inputPer1M: 0.25, cachedInputPer1M: 0.025, outputPer1M: 2 },
      ),
    ).toBe(0.00116);
  });

  test("date helpers produce stable keys", () => {
    const date = new Date("2026-03-09T10:22:45.000Z");
    expect(dayKey(date)).toBe("2026-03-09");
    expect(hourBucket(date)).toBe("2026-03-09T10");
    expect(minuteBucket(date)).toBe("2026-03-09T10:22");
  });

  test("resets window counters when the bucket changes", () => {
    const state = buildState();
    const ledger = createBudgetLedger(
      state,
      10,
      { inputPer1M: 1, cachedInputPer1M: 0.1, outputPer1M: 1 },
      { perMinute: 1, perHour: 2, perDay: 2 },
    );

    ledger.enforceIpLimit({
      day: "2026-03-09",
      hourBucket: "2026-03-09T10",
      minuteBucket: "2026-03-09T10:00",
      ip: "1.1.1.1",
    });
    ledger.enforceIpLimit({
      day: "2026-03-10",
      hourBucket: "2026-03-10T10",
      minuteBucket: "2026-03-10T10:00",
      ip: "1.1.1.1",
    });

    expect(state.minuteWindow.bucket).toBe("2026-03-10T10:00");
    expect(state.minuteWindow.countsByIp.get("1.1.1.1")).toBe(1);
    expect(state.hourWindow.bucket).toBe("2026-03-10T10");
    expect(state.dayWindow.bucket).toBe("2026-03-10");
  });

  test("keeps audit history bounded", () => {
    const state = buildState();
    const ledger = createBudgetLedger(
      state,
      10,
      { inputPer1M: 1, cachedInputPer1M: 0.1, outputPer1M: 1 },
      { perMinute: 10_000, perHour: 10_000, perDay: 10_000 },
      {
        ...defaultBudgetLedgerStorageLimits,
        maxAuditEntries: 3,
      },
    );

    for (let index = 0; index < 5; index += 1) {
      ledger.recordUsage({
        day: "2026-03-09",
        ip: "1.1.1.1",
        query: `query-${index}`,
        model: "gpt-5-mini",
        estimatedCostUsd: 0,
        usage: null,
        status: "ok",
      });
    }

    expect(state.audit).toHaveLength(3);
    expect(state.audit[0]?.queryHash).toBeDefined();
  });

  test("collapses excess ips into an overflow bucket instead of growing forever", () => {
    const state = buildState();
    const ledger = createBudgetLedger(
      state,
      10,
      { inputPer1M: 1, cachedInputPer1M: 0.1, outputPer1M: 1 },
      { perMinute: 1, perHour: 1, perDay: 1 },
      {
        ...defaultBudgetLedgerStorageLimits,
        maxTrackedMinuteIps: 1,
        maxTrackedHourIps: 1,
        maxTrackedDayIps: 1,
      },
    );

    ledger.enforceIpLimit({
      day: "2026-03-09",
      hourBucket: "2026-03-09T10",
      minuteBucket: "2026-03-09T10:00",
      ip: "1.1.1.1",
    });
    ledger.enforceIpLimit({
      day: "2026-03-09",
      hourBucket: "2026-03-09T10",
      minuteBucket: "2026-03-09T10:00",
      ip: "2.2.2.2",
    });

    expect(() =>
      ledger.enforceIpLimit({
        day: "2026-03-09",
        hourBucket: "2026-03-09T10",
        minuteBucket: "2026-03-09T10:00",
        ip: "3.3.3.3",
      }),
    ).toThrow(/minute|hour|day/);

    expect(state.minuteWindow.countsByIp.size).toBe(2);
    expect(state.hourWindow.countsByIp.size).toBe(2);
    expect(state.dayWindow.countsByIp.size).toBe(2);
  });
});
