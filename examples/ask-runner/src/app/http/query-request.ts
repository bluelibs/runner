import type { Request, Response } from "express";

import type { BudgetLedger } from "../budget/budget-ledger.resource";
import { dayKey, hourBucket, minuteBucket } from "../budget/budget-ledger.resource";
import { buildSystemPrompt, estimateTokenCount } from "../ai/prompt";

export interface QueryRouteDeps {
  appConfig: {
    trustProxy: boolean;
    maxInputChars: number;
    maxOutputTokens: number;
    tokenCharsEstimate: number;
    pricing: {
      inputPer1M: number;
      cachedInputPer1M: number;
      outputPer1M: number;
    };
    model: string;
  };
  aiDocsPrompt: {
    content: string;
    version: string;
  };
  budgetLedger: BudgetLedger;
}

export interface QueryRequestContext {
  day: string;
  ip: string;
  query: string;
  estimatedCostUsd: number;
}

export function prepareQueryRequest(
  req: Request,
  res: Response,
  deps: QueryRouteDeps,
): QueryRequestContext | null {
  const query = String(req.query.query ?? "").trim();
  if (query.length === 0) {
    res.status(400).json({ error: "Query must not be empty." });
    return null;
  }

  if (query.length > deps.appConfig.maxInputChars) {
    res.status(400).json({ error: `Query exceeds ${deps.appConfig.maxInputChars} characters.` });
    return null;
  }

  const now = new Date();
  const day = dayKey(now);
  const hour = hourBucket(now);
  const minute = minuteBucket(now);
  const ip = requestIp(req);

  deps.budgetLedger.enforceIpLimit({ day, minuteBucket: minute, hourBucket: hour, ip });
  const estimatedCostUsd = estimateProjectedCostUsd(
    deps.aiDocsPrompt.content,
    query,
    deps.appConfig.maxOutputTokens,
    deps.appConfig.tokenCharsEstimate,
    deps.appConfig.pricing,
  );
  deps.budgetLedger.ensureDayCanSpend({ day, projectedCostUsd: estimatedCostUsd });

  return {
    day,
    ip,
    query,
    estimatedCostUsd,
  };
}

export function estimateProjectedCostUsd(
  aiDocsContent: string,
  query: string,
  maxOutputTokens: number,
  tokenCharsEstimate: number,
  pricing: {
    inputPer1M: number;
    cachedInputPer1M: number;
    outputPer1M: number;
  },
): number {
  const promptText = buildSystemPrompt(aiDocsContent);
  const inputTokens =
    estimateTokenCount(promptText, tokenCharsEstimate) +
    estimateTokenCount(query, tokenCharsEstimate);
  // Preflight stays conservative and treats all input tokens as uncached.
  const outputTokens = maxOutputTokens;
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
  return Number((inputCost + outputCost).toFixed(8));
}

function requestIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }

  return req.ip || req.socket.remoteAddress || "unknown";
}
