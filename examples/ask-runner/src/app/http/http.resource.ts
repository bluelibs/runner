import express, { type Request, type Response } from "express";
import { r } from "@bluelibs/runner";

import { askRunnerTask, streamAskRunnerTask } from "../ai/ask-runner.task";
import { appConfig } from "../config/app-config.resource";
import {
  assertAdminSecret,
  budgetLedger,
  dayKey,
  type BudgetSnapshot,
} from "../budget/budget-ledger.resource";
import { aiDocsPrompt } from "../ai/ai-docs.resource";
import { missingConfigError } from "../errors";
import {
  getAskRunnerHealthTask,
  getBudgetSnapshotTask,
  resumeBudgetTask,
  stopBudgetForDayTask,
  type AskRunnerHealthOutput,
} from "./http-endpoints.task";
import {
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
    askRunnerTask,
    streamAskRunnerTask,
    getAskRunnerHealthTask,
    getBudgetSnapshotTask,
    stopBudgetForDayTask,
    resumeBudgetTask,
  })
  .init(async (): Promise<HttpServer> => {
    const app = express();
    return { app, server: null };
  })
  .ready(async (httpServer, _config, deps) => {
    httpServer.app = createHttpApp({
      appConfig: deps.appConfig,
      aiDocsPrompt: deps.aiDocsPrompt,
      runAskRunnerTask: async (input) => {
        const result = await deps.askRunnerTask(input);
        if (!result) {
          missingConfigError.throw({
            message: "askRunner task returned no result.",
          });
        }

        return result as AskRunnerOutput;
      },
      runStreamAskRunnerTask: async (input) => {
        const result = await deps.streamAskRunnerTask(input);
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
      runHealthTask: async () => {
        const result = await deps.getAskRunnerHealthTask({});
        if (!result) {
          missingConfigError.throw({
            message: "getAskRunnerHealth task returned no result.",
          });
        }

        return result as AskRunnerHealthOutput;
      },
      runBudgetSnapshotTask: async (input) => {
        const result = await deps.getBudgetSnapshotTask(input);
        if (!result) {
          missingConfigError.throw({
            message: "getBudgetSnapshot task returned no result.",
          });
        }

        return result as BudgetSnapshot;
      },
      runStopBudgetForDayTask: async (input) => {
        const result = await deps.stopBudgetForDayTask(input);
        if (!result) {
          missingConfigError.throw({
            message: "stopBudgetForDay task returned no result.",
          });
        }

        return result as BudgetSnapshot;
      },
      runResumeBudgetTask: async (input) => {
        const result = await deps.resumeBudgetTask(input);
        if (!result) {
          missingConfigError.throw({
            message: "resumeBudget task returned no result.",
          });
        }

        return result as BudgetSnapshot;
      },
    });
    httpServer.server = await new Promise<ReturnType<express.Express["listen"]>>((resolve, reject) => {
      const instance = httpServer.app.listen(deps.appConfig.port, deps.appConfig.host, () => resolve(instance));
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
  runAskRunnerTask: (input: { query: string; ip: string }) => Promise<{
    markdown: string;
    model: string;
    usage: { input_tokens?: number; output_tokens?: number } | null;
  }>;
  runStreamAskRunnerTask: (input: {
    query: string;
    ip: string;
    writer: { write(chunk: string): Promise<void> };
  }) => Promise<{
    model: string;
    usage: { input_tokens?: number; output_tokens?: number } | null;
  }>;
  runHealthTask: () => Promise<AskRunnerHealthOutput>;
  runBudgetSnapshotTask: (input: { day: string }) => Promise<BudgetSnapshot>;
  runStopBudgetForDayTask: (input: { day: string; reason: string }) => Promise<BudgetSnapshot>;
  runResumeBudgetTask: (input: { day: string }) => Promise<BudgetSnapshot>;
}): express.Express {
  const app = express();
  app.set("trust proxy", deps.appConfig.trustProxy);
  app.use(express.json());

  app.get("/health", async (_req, res) => {
    res.json(await deps.runHealthTask());
  });

  app.get("/", async (req, res) => {
    const request = prepareQueryRequest(req);
    const result = await deps.runAskRunnerTask(request);

    res.type("text/markdown; charset=utf-8").send(result.markdown);
  });

  app.get("/stream", async (req, res) => {
    const request = prepareQueryRequest(req);

    res.status(200);
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");

    const result = await deps.runStreamAskRunnerTask({
      ...request,
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

    res.end();
  });

  app.post("/admin/stop-for-day", async (req, res) => {
    withAdmin(req, deps.appConfig.adminSecret);
    const snapshot = await deps.runStopBudgetForDayTask({
      day: dayKey(new Date()),
      reason: String(req.body?.reason ?? "Stopped manually."),
    });
    res.json(snapshot);
  });

  app.post("/admin/resume", async (req, res) => {
    withAdmin(req, deps.appConfig.adminSecret);
    const snapshot = await deps.runResumeBudgetTask({
      day: dayKey(new Date()),
    });
    res.json(snapshot);
  });

  app.get("/admin/budget", async (req, res) => {
    withAdmin(req, deps.appConfig.adminSecret);
    const snapshot = await deps.runBudgetSnapshotTask({
      day: dayKey(new Date()),
    });
    res.json(snapshot);
  });

  app.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    if (res.headersSent) {
      res.end();
      return;
    }

    const statusCode =
      typeof error === "object" && error && "httpCode" in error && typeof error.httpCode === "number"
        ? error.httpCode
        : 500;
    const message = error instanceof Error ? error.message : "Internal Server Error";
    res.status(statusCode).json({ error: message });
  });

  return app;
}
function withAdmin(req: Request, adminSecret: string): void {
  assertAdminSecret(req.header("x-admin-secret") ?? undefined, adminSecret);
}
