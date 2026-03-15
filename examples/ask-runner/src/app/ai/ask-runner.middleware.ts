import { r } from "@bluelibs/runner";

import { aiDocsPrompt } from "./ai-docs.resource";
import { estimateProjectedCostUsd } from "../http/query-request";
import {
  budgetLedger,
  dayKey,
  hourBucket,
  minuteBucket,
} from "../budget/budget-ledger.resource";
import { appConfig } from "../config/app-config.resource";
import { invalidQueryError } from "../errors";

interface AskRunnerBudgetedInput {
  query: string;
  ip: string;
}

interface AskRunnerBudgetedOutput {
  model: string;
  usage: {
    input_tokens?: number;
    output_tokens?: number;
  } | null;
}

export const askRunnerBudgetMiddleware = r.middleware
  .task<void, AskRunnerBudgetedInput, AskRunnerBudgetedOutput>(
    "askRunnerBudgetPolicy",
  )
  .dependencies({
    appConfig,
    aiDocsPrompt,
    budgetLedger,
  })
  .run(async ({ next, task }, deps) => {
    const normalizedQuery = task.input.query.trim();
    if (normalizedQuery.length === 0) {
      invalidQueryError.throw({ message: "Query must not be empty." });
    }

    if (normalizedQuery.length > deps.appConfig.maxInputChars) {
      invalidQueryError.throw({
        message: `Query exceeds ${deps.appConfig.maxInputChars} characters.`,
      });
    }

    const now = new Date();
    const day = dayKey(now);
    const hour = hourBucket(now);
    const minute = minuteBucket(now);
    const estimatedCostUsd = estimateProjectedCostUsd(
      deps.aiDocsPrompt.content,
      normalizedQuery,
      deps.appConfig.maxOutputTokens,
      deps.appConfig.tokenCharsEstimate,
      deps.appConfig.pricing,
    );

    deps.budgetLedger.enforceIpLimit({
      day,
      minuteBucket: minute,
      hourBucket: hour,
      ip: task.input.ip,
    });
    deps.budgetLedger.ensureDayCanSpend({
      day,
      projectedCostUsd: estimatedCostUsd,
    });

    const result = await next({
      ...task.input,
      query: normalizedQuery,
    });

    deps.budgetLedger.recordUsage({
      day,
      ip: task.input.ip,
      query: normalizedQuery,
      model: result.model || deps.appConfig.model,
      estimatedCostUsd,
      usage: result.usage,
      status: "ok",
    });

    return result;
  })
  .build();
