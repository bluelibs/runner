import type { Request } from "express";

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
}

export interface QueryRequestContext {
  ip: string;
  query: string;
}

export function prepareQueryRequest(req: Request): QueryRequestContext {
  const query = String(req.query.query ?? "");
  const ip = requestIp(req);
  return {
    ip,
    query,
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
  return req.ip || req.socket.remoteAddress || "unknown";
}
