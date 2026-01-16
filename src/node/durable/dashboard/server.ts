import type { Request, Response, Router } from "express";
import * as express from "express";
import * as path from "node:path";
import * as fs from "node:fs";
import { IDurableService } from "../core/interfaces/service";
import { DurableOperator } from "../core/DurableOperator";
import type { ExecutionStatus } from "../core/types";

function findUp(startDir: string, filename: string): string | null {
  let current = startDir;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = path.join(current, filename);
    if (fs.existsSync(candidate)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function injectBaseHrefIntoHtml(html: string, baseHref: string): string {
  const normalizedBaseHref = baseHref.endsWith("/") ? baseHref : `${baseHref}/`;
  const safeBaseTag = `<base href="${normalizedBaseHref}">`;

  if (/<base\s/i.test(html)) {
    return html.replace(/<base[^>]*>/i, safeBaseTag);
  }

  const headOpenTag = html.match(/<head[^>]*>/i)?.[0];
  if (!headOpenTag) return `${safeBaseTag}\n${html}`;

  return html.replace(headOpenTag, `${headOpenTag}\n    ${safeBaseTag}`);
}

function resolveDashboardUiDistPath(): string | null {
  const packageRoot = findUp(__dirname, "package.json");
  if (!packageRoot) return null;

  const candidates = [
    // Primary (published package / root build): dist/ui
    path.join(packageRoot, "dist", "ui"),
    // Fallback (building inside the dashboard folder): src/node/durable/dashboard/dist
    path.join(packageRoot, "src", "node", "durable", "dashboard", "dist"),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export type DashboardMiddlewareOptions = {
  /**
   * Override where the dashboard UI is served from.
   * Useful for tests or custom deployments.
   */
  uiDistPath?: string;
  /**
   * Authorization hook for operator actions (retry/skip/force/edit).
   * Return true to allow, false to deny.
   */
  operatorAuth?: (req: Request) => boolean | Promise<boolean>;
  /**
   * Opt out of operator auth checks (not recommended).
   */
  dangerouslyAllowUnauthenticatedOperator?: boolean;
};

enum DashboardErrorMessage {
  Forbidden = "Forbidden",
};

export function createDashboardMiddleware(
  _service: IDurableService,
  operator: DurableOperator,
  options: DashboardMiddlewareOptions = {},
): Router {
  const router = express.Router();
  const api = express.Router();

  api.get("/executions", async (req, res) => {
    try {
      const statusParam = req.query.status as string | undefined;
      const status = statusParam
        ? (statusParam.split(",") as ExecutionStatus[])
        : undefined;

      const taskId = req.query.taskId as string | undefined;
      const limit = req.query.limit
        ? parseInt(req.query.limit as string, 10)
        : 50;
      const offset = req.query.offset
        ? parseInt(req.query.offset as string, 10)
        : 0;

      const executions = await operator.listExecutions({
        status,
        taskId,
        limit,
        offset,
      });

      res.json(executions);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  api.get("/executions/:id", async (req, res) => {
    try {
      const { execution, steps, audit } = await operator.getExecutionDetail(
        req.params.id,
      );
      if (!execution) {
        return res.status(404).json({ error: "Execution not found" });
      }

      res.json({ ...execution, steps, audit });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  api.post("/operator/:action", async (req, res) => {
    const { action } = req.params;
    const { executionId, stepId, reason, state } = req.body;

    try {
      if (options.operatorAuth) {
        const isAuthorized = await options.operatorAuth(req);
        if (!isAuthorized) {
          return res
            .status(403)
            .json({ error: DashboardErrorMessage.Forbidden });
        }
      } else if (!options.dangerouslyAllowUnauthenticatedOperator) {
        return res.status(403).json({ error: DashboardErrorMessage.Forbidden });
      }

      switch (action) {
        case "retryRollback":
          await operator.retryRollback(executionId);
          break;
        case "skipStep":
          await operator.skipStep(executionId, stepId);
          break;
        case "forceFail":
          await operator.forceFail(
            executionId,
            reason || "Operator forced fail",
          );
          break;
        case "editState":
          await operator.editState(executionId, stepId, state);
          break;
        default:
          return res.status(400).json({ error: "Unknown action" });
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.use("/api", express.json(), api);

  const uiDistPath = options.uiDistPath ?? resolveDashboardUiDistPath();
  if (!uiDistPath) {
    const notFound = (_req: Request, res: Response) => {
      res
        .status(404)
        .send(
          [
            "<h1>Durable Dashboard</h1>",
            "<p>UI build artifacts were not found.</p>",
            "<p>Run <code>npm run build:dashboard</code> in the package root.</p>",
          ].join("\n"),
        );
    };
    router.get("/", notFound);
    router.get("/*splat", notFound);
    return router;
  }

  const indexHtmlPath = path.join(uiDistPath, "index.html");
  if (!fs.existsSync(indexHtmlPath)) {
    const notFound = (_req: Request, res: Response) => {
      res
        .status(404)
        .send(
          [
            "<h1>Durable Dashboard</h1>",
            `<p>index.html not found at <code>${indexHtmlPath}</code></p>`,
            "<p>Run <code>npm run build:dashboard</code> in the package root.</p>",
          ].join("\n"),
        );
    };
    router.get("/", notFound);
    router.get("/*splat", notFound);
    return router;
  }

  const indexHtmlTemplate = fs.readFileSync(indexHtmlPath, "utf-8");

  router.use(
    express.static(uiDistPath, {
      index: false,
    }),
  );

  const serveIndex = (req: Request, res: Response) => {
    const baseHref = `${req.baseUrl || ""}/`;
    res
      .status(200)
      .type("html")
      .send(injectBaseHrefIntoHtml(indexHtmlTemplate, baseHref));
  };
  router.get("/", serveIndex);
  router.get("/*splat", serveIndex);

  return router;
}
