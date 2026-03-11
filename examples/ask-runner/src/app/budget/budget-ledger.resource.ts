import crypto from "crypto";

import { r } from "@bluelibs/runner";

import { appConfig, type AskRunnerPricing } from "../config/app-config.resource";
import {
  dailyBudgetExceededError,
  rateLimitExceededError,
  unauthorizedAdminError,
} from "../errors";

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

interface DayState {
  spentUsd: number;
  requestCount: number;
  stopped: boolean;
  stopReason: string | null;
}

interface AuditEntry {
  timestamp: string;
  day: string;
  ip: string;
  queryHash: string;
  model: string;
  estimatedCostUsd: number;
  actualCostUsd: number;
  status: "ok" | "rejected";
}

interface BudgetLedgerState {
  dayStateByDay: Map<string, DayState>;
  minuteCountsByKey: Map<string, number>;
  audit: AuditEntry[];
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
  .dependencies({ appConfig })
  .context<BudgetLedgerState>(() => ({
    dayStateByDay: new Map(),
    minuteCountsByKey: new Map(),
    audit: [],
  }))
  .init(async (_config, { appConfig }, context): Promise<BudgetLedger> => {
    return createBudgetLedger(context, appConfig.dailyBudgetUsd, appConfig.pricing, {
      perMinute: appConfig.rateLimitPerMinute,
      perHour: appConfig.rateLimitPerHour,
      perDay: appConfig.rateLimitPerDay,
    });
  })
  .build();

export function createBudgetLedger(
  state: BudgetLedgerState,
  dailyBudgetUsd: number,
  pricing: AskRunnerPricing,
  rateLimits: { perMinute: number; perHour: number; perDay: number },
): BudgetLedger {
  const ensureDay = (day: string): DayState => {
    const existing = state.dayStateByDay.get(day);
    if (existing) return existing;

    const created: DayState = {
      spentUsd: 0,
      requestCount: 0,
      stopped: false,
      stopReason: null,
    };
    state.dayStateByDay.set(day, created);
    return created;
  };

  const readMinuteCount = (day: string, minuteBucket: string, ip: string): number => {
    return state.minuteCountsByKey.get(rateKey(day, minuteBucket, ip)) ?? 0;
  };

  const incrementMinuteCount = (day: string, minuteBucket: string, ip: string): number => {
    const key = rateKey(day, minuteBucket, ip);
    const next = (state.minuteCountsByKey.get(key) ?? 0) + 1;
    state.minuteCountsByKey.set(key, next);
    return next;
  };

  const readHourCount = (day: string, hourBucket: string, ip: string): number => {
    let total = 0;
    for (const [key, count] of state.minuteCountsByKey.entries()) {
      if (key.startsWith(`${day}:${hourBucket}:`) && key.endsWith(`:${ip}`)) {
        total += count;
      }
    }
    return total;
  };

  const readDayCount = (day: string, ip: string): number => {
    let total = 0;
    for (const [key, count] of state.minuteCountsByKey.entries()) {
      if (key.startsWith(`${day}:`) && key.endsWith(`:${ip}`)) {
        total += count;
      }
    }
    return total;
  };

  return {
    enforceIpLimit({ day, minuteBucket, hourBucket, ip }) {
      ensureDay(day);
      const minuteCount = incrementMinuteCount(day, minuteBucket, ip);
      if (minuteCount > rateLimits.perMinute) {
        rateLimitExceededError.throw({
          message: "Rate limit exceeded for this minute.",
        });
      }

      const hourCount = readHourCount(day, hourBucket, ip);
      if (hourCount > rateLimits.perHour) {
        rateLimitExceededError.throw({
          message: "Rate limit exceeded for this hour.",
        });
      }

      const dayCount = readDayCount(day, ip);
      if (dayCount > rateLimits.perDay) {
        rateLimitExceededError.throw({
          message: "Rate limit exceeded for this day.",
        });
      }
    },

    ensureDayCanSpend({ day, projectedCostUsd }) {
      const dayState = ensureDay(day);
      if (dayState.stopped) {
        dailyBudgetExceededError.throw({
          message: dayState.stopReason ?? "Asking is stopped for today.",
        });
      }
      if (dayState.spentUsd + projectedCostUsd > dailyBudgetUsd) {
        dailyBudgetExceededError.throw({
          message: "Projected cost would exceed the daily budget.",
        });
      }
    },

    recordUsage({ day, ip, query, model, estimatedCostUsd, usage, status }) {
      const dayState = ensureDay(day);
      const actualCostUsd = usage ? calculateUsageCost(usage, pricing) : 0;
      dayState.spentUsd = Number((dayState.spentUsd + actualCostUsd).toFixed(8));
      dayState.requestCount += 1;
      if (dayState.spentUsd >= dailyBudgetUsd) {
        dayState.stopped = true;
        dayState.stopReason = "Daily budget reached.";
      }
      state.audit.push({
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
      const dayState = ensureDay(day);
      dayState.stopped = true;
      dayState.stopReason = reason;
      return this.getSnapshot(day);
    },

    resume(day) {
      const dayState = ensureDay(day);
      dayState.stopped = false;
      dayState.stopReason = null;
      return this.getSnapshot(day);
    },

    getSnapshot(day) {
      const dayState = ensureDay(day);
      return {
        day,
        spentUsd: dayState.spentUsd,
        requestCount: dayState.requestCount,
        stopped: dayState.stopped,
        stopReason: dayState.stopReason,
        remainingUsd: Math.max(0, Number((dailyBudgetUsd - dayState.spentUsd).toFixed(8))),
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

function rateKey(day: string, minuteBucket: string, ip: string): string {
  return `${day}:${minuteBucket}:${ip}`;
}

function sha1(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex");
}
