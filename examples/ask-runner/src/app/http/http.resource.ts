import express, { type Request, type Response } from "express";
import { resources, r } from "@bluelibs/runner";

import { askRunnerTask, streamAskRunnerTask } from "../ai/ask-runner.task";
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
import { missingConfigError } from "../errors";
import {
  estimateProjectedCostUsd,
  prepareQueryRequest,
  type QueryRouteDeps,
} from "./query-request";
import type { AskRunnerOutput } from "../ai/ask-runner-request";

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
      runStreamTask: async (input) => {
        const result = await taskRunner.run(streamAskRunnerTask, input);
        if (!result) {
          missingConfigError.throw({
            message: "streamAskRunner task returned no result.",
          });
        }
        return result as {
          model: string;
          usage: { input_tokens?: number; output_tokens?: number } | null;
        };
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

export function createHttpApp(deps: QueryRouteDeps & {
  appConfig: QueryRouteDeps["appConfig"] & {
    adminSecret: string;
  };
  runTask: (input: { query: string }) => Promise<{
    markdown: string;
    model: string;
    usage: { input_tokens?: number; output_tokens?: number } | null;
  }>;
  runStreamTask: (input: {
    query: string;
    writer: { write(chunk: string): Promise<void> };
  }) => Promise<{
    model: string;
    usage: { input_tokens?: number; output_tokens?: number } | null;
  }>;
}): express.Express {
  const app = express();
  app.set("trust proxy", deps.appConfig.trustProxy);
  app.use(express.json());

  app.get("/health", (_req, res) => {
    const snapshot = deps.budgetLedger.getSnapshot(dayKey(new Date()));
    res.json({
      status: "ok",
      budget: snapshot,
      state: {
        storage: "memory",
        durable: false,
        note: "Budget, rate-limit, and admin stop state reset when the process restarts.",
      },
    });
  });

  app.get("/", async (req, res) => {
    await handleQueryRequest(req, res, deps);
  });

  app.get("/stream", async (req, res) => {
    await handleStreamQueryRequest(req, res, deps);
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
  deps: QueryRouteDeps & {
    runTask: (input: { query: string }) => Promise<{
      markdown: string;
      model: string;
      usage: { input_tokens?: number; output_tokens?: number } | null;
    }>;
  },
): Promise<void> {
  const request = prepareQueryRequest(req, res, deps);
  if (!request) {
    return;
  }

  const result = await deps.runTask({ query: request.query });
  deps.budgetLedger.recordUsage({
    day: request.day,
    ip: request.ip,
    query: request.query,
    model: result.model || deps.appConfig.model,
    estimatedCostUsd: request.estimatedCostUsd,
    usage: result.usage,
    status: "ok",
  });

  res.type("text/markdown; charset=utf-8").send(result.markdown);
}

export async function handleStreamQueryRequest(
  req: Request,
  res: Response,
  deps: QueryRouteDeps & {
    runStreamTask: (input: {
      query: string;
      writer: { write(chunk: string): Promise<void> };
    }) => Promise<{
      model: string;
      usage: { input_tokens?: number; output_tokens?: number } | null;
    }>;
  },
): Promise<void> {
  const request = prepareQueryRequest(req, res, deps);
  if (!request) {
    return;
  }

  res.status(200);
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");

  const result = await deps.runStreamTask({
    query: request.query,
    writer: {
      write: async (chunk) => {
        await new Promise<void>((resolve, reject) => {
          res.write(chunk, (error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      },
    },
  });

  deps.budgetLedger.recordUsage({
    day: request.day,
    ip: request.ip,
    query: request.query,
    model: result.model || deps.appConfig.model,
    estimatedCostUsd: request.estimatedCostUsd,
    usage: result.usage,
    status: "ok",
  });

  res.end();
}

function withAdmin<T>(req: Request, adminSecret: string, run: () => T): T {
  assertAdminSecret(req.header("x-admin-secret") ?? undefined, adminSecret);
  return run();
}

export { estimateProjectedCostUsd } from "./query-request";
