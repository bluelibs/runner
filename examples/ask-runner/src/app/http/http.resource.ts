import express, { type Request, type Response } from "express";
import { resources, r } from "@bluelibs/runner";

import { askRunnerTask } from "../ai/ask-runner.task";
import { buildSystemPrompt, estimateTokenCount } from "../ai/prompt";
import { appConfig } from "../config/app-config.resource";
import type { BudgetLedger } from "../budget/budget-ledger.resource";
import {
  assertAdminSecret,
  budgetLedger,
  dayKey,
  hourBucket,
  minuteBucket,
} from "../budget/budget-ledger.resource";
import { aiDocsPrompt } from "../ai/ai-docs.resource";
import type { AskRunnerOutput } from "../ai/ask-runner.task";
import { missingConfigError } from "../errors";

export interface HttpServer {
  app: express.Express;
  server: ReturnType<express.Express["listen"]> | null;
}

export const httpServer = r
  .resource("httpServer")
  .dependencies({
    appConfig,
    aiDocsPrompt,
    budgetLedger,
    taskRunner: resources.taskRunner,
  })
  .init(async (): Promise<HttpServer> => {
    const app = express();
    return { app, server: null };
  })
  .ready(async (httpServer, _config, { appConfig, aiDocsPrompt, budgetLedger, taskRunner }) => {
    httpServer.app = createHttpApp({
      appConfig,
      aiDocsPrompt,
      budgetLedger,
      runTask: async (input) => {
        const result = await taskRunner.run(askRunnerTask, input);
        if (!result) {
          missingConfigError.throw({
            message: "askRunner task returned no result.",
          });
        }
        return result as AskRunnerOutput;
      },
    });
    httpServer.server = await new Promise<ReturnType<express.Express["listen"]>>((resolve, reject) => {
      const instance = httpServer.app.listen(appConfig.port, appConfig.host, () => resolve(instance));
      instance.once("error", reject);
    });
  })
  .cooldown(async (httpServer) => {
    if (!httpServer.server) return;
    await new Promise<void>((resolve, reject) => {
      httpServer.server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    httpServer.server = null;
  })
  .dispose(async () => {
    return;
  })
  .build();

export function createHttpApp(deps: {
  appConfig: {
    adminSecret: string;
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
  runTask: (input: { query: string }) => Promise<{
    markdown: string;
    model: string;
    usage: { input_tokens?: number; output_tokens?: number } | null;
  }>;
}): express.Express {
  const app = express();
  app.set("trust proxy", deps.appConfig.trustProxy);
  app.use(express.json());

  app.get("/health", (_req, res) => {
    const snapshot = deps.budgetLedger.getSnapshot(dayKey(new Date()));
    res.json({ status: "ok", budget: snapshot });
  });

  app.get("/", async (req, res) => {
    await handleQueryRequest(req, res, deps);
  });

  app.post("/admin/stop-for-day", (req, res) => {
    const snapshot = withAdmin(req, deps.appConfig.adminSecret, () =>
      deps.budgetLedger.stopForDay(dayKey(new Date()), String(req.body?.reason ?? "Stopped manually.")),
    );
    res.json(snapshot);
  });

  app.post("/admin/resume", (req, res) => {
    const snapshot = withAdmin(req, deps.appConfig.adminSecret, () =>
      deps.budgetLedger.resume(dayKey(new Date())),
    );
    res.json(snapshot);
  });

  app.get("/admin/budget", (req, res) => {
    const snapshot = withAdmin(req, deps.appConfig.adminSecret, () =>
      deps.budgetLedger.getSnapshot(dayKey(new Date())),
    );
    res.json(snapshot);
  });

  app.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    const statusCode =
      typeof error === "object" && error && "httpCode" in error && typeof error.httpCode === "number"
        ? error.httpCode
        : 500;
    const message = error instanceof Error ? error.message : "Internal Server Error";
    res.status(statusCode).json({ error: message });
  });

  return app;
}

export async function handleQueryRequest(
  req: Request,
  res: Response,
  deps: {
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
    runTask: (input: { query: string }) => Promise<{
      markdown: string;
      model: string;
      usage: { input_tokens?: number; output_tokens?: number } | null;
    }>;
  },
): Promise<void> {
  const query = String(req.query.query ?? "").trim();
  if (query.length === 0) {
    res.status(400).json({ error: "Query must not be empty." });
    return;
  }

  if (query.length > deps.appConfig.maxInputChars) {
    res.status(400).json({ error: `Query exceeds ${deps.appConfig.maxInputChars} characters.` });
    return;
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

  const result = await deps.runTask({ query });
  deps.budgetLedger.recordUsage({
    day,
    ip,
    query,
    model: result.model || deps.appConfig.model,
    estimatedCostUsd,
    usage: result.usage,
    status: "ok",
  });

  res.type("text/markdown; charset=utf-8").send(result.markdown);
}

function requestIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }

  return req.ip || req.socket.remoteAddress || "unknown";
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

function withAdmin<T>(req: Request, adminSecret: string, run: () => T): T {
  assertAdminSecret(req.header("x-admin-secret") ?? undefined, adminSecret);
  return run();
}
