import Database from "better-sqlite3";

import {
  assertAdminSecret,
  calculateUsageCost,
  createBudgetLedger,
  dayKey,
  hourBucket,
  minuteBucket,
} from "../app/budget/budget-ledger.resource";

describe("budget ledger", () => {
  function buildDb(): Database.Database {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE daily_budget_state (
        day TEXT PRIMARY KEY,
        spent_usd REAL NOT NULL,
        request_count INTEGER NOT NULL,
        stopped INTEGER NOT NULL,
        stop_reason TEXT
      );
      CREATE TABLE ip_rate_limits (
        day TEXT NOT NULL,
        minute_bucket TEXT NOT NULL,
        ip TEXT NOT NULL,
        request_count INTEGER NOT NULL,
        PRIMARY KEY (day, minute_bucket, ip)
      );
      CREATE TABLE query_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        day TEXT NOT NULL,
        ip TEXT NOT NULL,
        query_hash TEXT NOT NULL,
        model TEXT NOT NULL,
        estimated_cost_usd REAL NOT NULL,
        actual_cost_usd REAL NOT NULL,
        status TEXT NOT NULL
      );
    `);
    return db;
  }

  test("records usage cost and persists stop state", () => {
    const db = buildDb();
    const ledger = createBudgetLedger(
      db,
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
    const db = buildDb();
    const ledger = createBudgetLedger(
      db,
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
    const db = buildDb();
    const ledger = createBudgetLedger(
      db,
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
    const db = buildDb();
    const ledger = createBudgetLedger(
      db,
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
});
