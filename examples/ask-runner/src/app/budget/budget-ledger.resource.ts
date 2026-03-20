import crypto from "crypto";

import { r } from "@bluelibs/runner";

import { appConfig, type AskRunnerPricing } from "../config/app-config.resource";
import {
  appendBoundedAuditEntry,
  ensureLedgerDayState,
  incrementWindowCount,
} from "./budget-ledger.storage";
import {
  createBudgetLedgerState,
  defaultBudgetLedgerStorageLimits,
  type BudgetLedger,
  type BudgetLedgerState,
  type BudgetLedgerStorageLimits,
  type UsageLike,
} from "./budget-ledger.types";
import {
  dailyBudgetExceededError,
  rateLimitExceededError,
  unauthorizedAdminError,
} from "../errors";

export {
  createBudgetLedgerState,
  defaultBudgetLedgerStorageLimits,
  type BudgetLedger,
  type BudgetLedgerState,
  type BudgetLedgerStorageLimits,
  type BudgetSnapshot,
  type UsageLike,
} from "./budget-ledger.types";

export const budgetLedger = r
  .resource("budgetLedger")
  .dependencies({ appConfig })
  .context<BudgetLedgerState>(createBudgetLedgerState)
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
  storageLimits: BudgetLedgerStorageLimits = defaultBudgetLedgerStorageLimits,
): BudgetLedger {
  return {
    enforceIpLimit({ day, minuteBucket, hourBucket, ip }) {
      ensureLedgerDayState(state, day, storageLimits);
      const minuteCount = incrementWindowCount(
        state.minuteWindow,
        minuteBucket,
        ip,
        storageLimits.maxTrackedMinuteIps,
      );
      if (minuteCount > rateLimits.perMinute) {
        rateLimitExceededError.throw({
          message: "Rate limit exceeded for this minute.",
        });
      }

      const hourCount = incrementWindowCount(
        state.hourWindow,
        hourBucket,
        ip,
        storageLimits.maxTrackedHourIps,
      );
      if (hourCount > rateLimits.perHour) {
        rateLimitExceededError.throw({
          message: "Rate limit exceeded for this hour.",
        });
      }

      const dayCount = incrementWindowCount(
        state.dayWindow,
        day,
        ip,
        storageLimits.maxTrackedDayIps,
      );
      if (dayCount > rateLimits.perDay) {
        rateLimitExceededError.throw({
          message: "Rate limit exceeded for this day.",
        });
      }
    },

    ensureDayCanSpend({ day, projectedCostUsd }) {
      const dayState = ensureLedgerDayState(state, day, storageLimits);
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
      const dayState = ensureLedgerDayState(state, day, storageLimits);
      const actualCostUsd = usage ? calculateUsageCost(usage, pricing) : 0;
      dayState.spentUsd = Number((dayState.spentUsd + actualCostUsd).toFixed(8));
      dayState.requestCount += 1;
      if (dayState.spentUsd >= dailyBudgetUsd) {
        dayState.stopped = true;
        dayState.stopReason = "Daily budget reached.";
      }
      appendBoundedAuditEntry(state, {
        timestamp: new Date().toISOString(),
        day,
        ip,
        queryHash: sha1(query),
        model,
        estimatedCostUsd,
        actualCostUsd,
        status,
      }, storageLimits);
      return this.getSnapshot(day);
    },

    stopForDay(day, reason) {
      const dayState = ensureLedgerDayState(state, day, storageLimits);
      dayState.stopped = true;
      dayState.stopReason = reason;
      return this.getSnapshot(day);
    },

    resume(day) {
      const dayState = ensureLedgerDayState(state, day, storageLimits);
      dayState.stopped = false;
      dayState.stopReason = null;
      return this.getSnapshot(day);
    },

    getSnapshot(day) {
      const dayState = ensureLedgerDayState(state, day, storageLimits);
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

function sha1(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex");
}
