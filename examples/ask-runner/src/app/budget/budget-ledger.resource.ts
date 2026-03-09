import crypto from "crypto";

import { r } from "@bluelibs/runner";
import type Database from "better-sqlite3";

import { appConfig, type AskRunnerPricing } from "../config/app-config.resource";
import {
  dailyBudgetExceededError,
  rateLimitExceededError,
  unauthorizedAdminError,
} from "../errors";
import { sqlite } from "./sqlite.resource";

export interface UsageLike {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: {
    cached_tokens?: number;
  } | null;
  output_tokens_details?: Record<string, unknown> | null;
}

export interface BudgetSnapshot {
  day: string;
  spentUsd: number;
  requestCount: number;
  stopped: boolean;
  stopReason: string | null;
  remainingUsd: number;
}

export interface BudgetLedger {
  enforceIpLimit(input: {
    day: string;
    minuteBucket: string;
    hourBucket: string;
    ip: string;
  }): void;
  ensureDayCanSpend(input: { day: string; projectedCostUsd: number }): void;
  recordUsage(input: {
    day: string;
    ip: string;
    query: string;
    model: string;
    estimatedCostUsd: number;
    usage: UsageLike | null;
    status: "ok" | "rejected";
  }): BudgetSnapshot;
  stopForDay(day: string, reason: string): BudgetSnapshot;
  resume(day: string): BudgetSnapshot;
  getSnapshot(day: string): BudgetSnapshot;
}

export const budgetLedger = r
  .resource("budgetLedger")
  .dependencies({ appConfig, sqlite })
  .init(async (_, { appConfig, sqlite }): Promise<BudgetLedger> => {
    return createBudgetLedger(sqlite, appConfig.dailyBudgetUsd, appConfig.pricing, {
      perMinute: appConfig.rateLimitPerMinute,
      perHour: appConfig.rateLimitPerHour,
      perDay: appConfig.rateLimitPerDay,
    });
  })
  .build();

export function createBudgetLedger(
  db: Database.Database,
  dailyBudgetUsd: number,
  pricing: AskRunnerPricing,
  rateLimits: { perMinute: number; perHour: number; perDay: number },
): BudgetLedger {
  const upsertDay = db.prepare(`
    INSERT INTO daily_budget_state(day, spent_usd, request_count, stopped, stop_reason)
    VALUES (@day, 0, 0, 0, NULL)
    ON CONFLICT(day) DO NOTHING
  `);
  const readDay = db.prepare(`
    SELECT spent_usd, request_count, stopped, stop_reason
    FROM daily_budget_state
    WHERE day = ?
  `);
  const incrementMinute = db.prepare(`
    INSERT INTO ip_rate_limits(day, minute_bucket, ip, request_count)
    VALUES (@day, @minuteBucket, @ip, 1)
    ON CONFLICT(day, minute_bucket, ip)
    DO UPDATE SET request_count = request_count + 1
  `);
  const readMinute = db.prepare(
    "SELECT request_count FROM ip_rate_limits WHERE day = ? AND minute_bucket = ? AND ip = ?",
  );
  const readDayCount = db.prepare(
    "SELECT COALESCE(SUM(request_count), 0) AS count FROM ip_rate_limits WHERE day = ? AND ip = ?",
  );
  const readHourCount = db.prepare(
    "SELECT COALESCE(SUM(request_count), 0) AS count FROM ip_rate_limits WHERE day = ? AND minute_bucket LIKE ? AND ip = ?",
  );
  const updateUsage = db.prepare(`
    UPDATE daily_budget_state
    SET spent_usd = spent_usd + @actualCostUsd,
        request_count = request_count + 1,
        stopped = CASE WHEN spent_usd + @actualCostUsd >= @dailyBudgetUsd THEN 1 ELSE stopped END,
        stop_reason = CASE
          WHEN spent_usd + @actualCostUsd >= @dailyBudgetUsd THEN 'Daily budget reached.'
          ELSE stop_reason
        END
    WHERE day = @day
  `);
  const writeAudit = db.prepare(`
    INSERT INTO query_audit(timestamp, day, ip, query_hash, model, estimated_cost_usd, actual_cost_usd, status)
    VALUES (@timestamp, @day, @ip, @queryHash, @model, @estimatedCostUsd, @actualCostUsd, @status)
  `);
  const setStop = db.prepare(
    "UPDATE daily_budget_state SET stopped = @stopped, stop_reason = @stopReason WHERE day = @day",
  );

  const ensureDay = (day: string): void => {
    upsertDay.run({ day });
  };

  return {
    enforceIpLimit({ day, minuteBucket, hourBucket, ip }) {
      ensureDay(day);
      incrementMinute.run({ day, minuteBucket, ip });

      const minuteRow = readMinute.get(day, minuteBucket, ip) as { request_count: number };
      if (minuteRow.request_count > rateLimits.perMinute) {
        rateLimitExceededError.throw({
          message: "Rate limit exceeded for this minute.",
        });
      }

      const hourRow = readHourCount.get(day, `${hourBucket}%`, ip) as {
        count: number;
      };
      if (hourRow.count > rateLimits.perHour) {
        rateLimitExceededError.throw({
          message: "Rate limit exceeded for this hour.",
        });
      }

      const dayRow = readDayCount.get(day, ip) as { count: number };
      if (dayRow.count > rateLimits.perDay) {
        rateLimitExceededError.throw({
          message: "Rate limit exceeded for this day.",
        });
      }
    },

    ensureDayCanSpend({ day, projectedCostUsd }) {
      const snapshot = this.getSnapshot(day);
      if (snapshot.stopped) {
        dailyBudgetExceededError.throw({
          message: snapshot.stopReason ?? "Asking is stopped for today.",
        });
      }
      if (snapshot.spentUsd + projectedCostUsd > dailyBudgetUsd) {
        dailyBudgetExceededError.throw({
          message: "Projected cost would exceed the daily budget.",
        });
      }
    },

    recordUsage({ day, ip, query, model, estimatedCostUsd, usage, status }) {
      ensureDay(day);
      const actualCostUsd = usage ? calculateUsageCost(usage, pricing) : 0;
      updateUsage.run({ day, actualCostUsd, dailyBudgetUsd });
      writeAudit.run({
        timestamp: new Date().toISOString(),
        day,
        ip,
        queryHash: sha1(query),
        model,
        estimatedCostUsd,
        actualCostUsd,
        status,
      });
      return this.getSnapshot(day);
    },

    stopForDay(day, reason) {
      ensureDay(day);
      setStop.run({ day, stopped: 1, stopReason: reason });
      return this.getSnapshot(day);
    },

    resume(day) {
      ensureDay(day);
      setStop.run({ day, stopped: 0, stopReason: null });
      return this.getSnapshot(day);
    },

    getSnapshot(day) {
      ensureDay(day);
      const row = readDay.get(day) as {
        spent_usd: number;
        request_count: number;
        stopped: number;
        stop_reason: string | null;
      };
      return {
        day,
        spentUsd: row.spent_usd,
        requestCount: row.request_count,
        stopped: row.stopped === 1,
        stopReason: row.stop_reason,
        remainingUsd: Math.max(0, dailyBudgetUsd - row.spent_usd),
      };
    },
  };
}

export function calculateUsageCost(
  usage: UsageLike,
  pricing: AskRunnerPricing,
): number {
  const inputTokens = usage.input_tokens ?? 0;
  const cachedInputTokens = usage.input_tokens_details?.cached_tokens ?? 0;
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const outputTokens = usage.output_tokens ?? 0;
  const inputCost = (uncachedInputTokens / 1_000_000) * pricing.inputPer1M;
  const cachedInputCost =
    (cachedInputTokens / 1_000_000) * pricing.cachedInputPer1M;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
  return Number((inputCost + cachedInputCost + outputCost).toFixed(8));
}

export function assertAdminSecret(actual: string | undefined, expected: string): void {
  if (!actual || actual !== expected) {
    unauthorizedAdminError.throw({ message: "Invalid admin secret." });
  }
}

export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function minuteBucket(date: Date): string {
  return date.toISOString().slice(0, 16);
}

export function hourBucket(date: Date): string {
  return date.toISOString().slice(0, 13);
}

function sha1(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex");
}
