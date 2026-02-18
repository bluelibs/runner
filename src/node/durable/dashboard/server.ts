import type { Request, Response, Router } from "express";
import * as express from "express";
import * as path from "node:path";
import * as fs from "node:fs";
import { IDurableService } from "../core/interfaces/service";
import { DurableOperator } from "../core/DurableOperator";
import { ExecutionStatus } from "../core/types";
import { normalizeError } from "../../../globals/resources/tunnel/error-utils";

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
  InvalidQuery = "Invalid query parameter",
  InvalidBody = "Invalid request body",
}

export function createDashboardMiddleware(
  _service: IDurableService,
  operator: DurableOperator,
  options: DashboardMiddlewareOptions = {},
): Router {
  const router = express.Router();
  const api = express.Router();
  const executionStatuses = new Set<string>(Object.values(ExecutionStatus));

  const parseStrictIntegerQuery = (
    value: unknown,
    options: { defaultValue: number; min: number; max: number },
  ): number | null => {
    if (value === undefined) return options.defaultValue;
    if (Array.isArray(value)) return null;
    if (typeof value !== "string") return null;
    if (!/^\d+$/.test(value)) return null;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed)) return null;
    if (parsed < options.min || parsed > options.max) return null;
    return parsed;
  };

  const parseStatusQuery = (
    value: unknown,
  ): string[] | undefined | null => {
    if (value === undefined) return undefined;
    if (Array.isArray(value)) return null;
    if (typeof value !== "string") return null;
    const statuses = value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (statuses.length === 0) return [];
    if (statuses.some((status) => !executionStatuses.has(status))) return null;
    return statuses;
  };

  const isNonEmptyString = (value: unknown): value is string =>
    typeof value === "string" && value.trim().length > 0;
  const getErrorMessage = (error: unknown): string =>
    normalizeError(error).message;

  api.get("/executions", async (req, res) => {
    try {
      const status = parseStatusQuery(req.query.status);
      if (status === null) {
        return res.status(400).json({
          error: `${DashboardErrorMessage.InvalidQuery}: status`,
        });
      }

      const limit = parseStrictIntegerQuery(req.query.limit, {
        defaultValue: 50,
        min: 1,
        max: 500,
      });
      if (limit === null) {
        return res.status(400).json({
          error: `${DashboardErrorMessage.InvalidQuery}: limit`,
        });
      }

      const offset = parseStrictIntegerQuery(req.query.offset, {
        defaultValue: 0,
        min: 0,
        max: 1_000_000,
      });
      if (offset === null) {
        return res.status(400).json({
          error: `${DashboardErrorMessage.InvalidQuery}: offset`,
        });
      }

      const taskIdRaw = req.query.taskId;
      if (
        taskIdRaw !== undefined &&
        (Array.isArray(taskIdRaw) || typeof taskIdRaw !== "string")
      ) {
        return res.status(400).json({
          error: `${DashboardErrorMessage.InvalidQuery}: taskId`,
        });
      }
      const taskId = taskIdRaw as string | undefined;

      const executions = await operator.listExecutions({
        status: status as ExecutionStatus[] | undefined,
        taskId,
        limit,
        offset,
      });

      res.json(executions);
    } catch (err: unknown) {
      res.status(500).json({ error: getErrorMessage(err) });
    }
  });

  api.get("/executions-stuck", async (req, res) => {
    try {
      const executions = await operator.listStuckExecutions();
      res.json(executions);
    } catch (err: unknown) {
      res.status(500).json({ error: getErrorMessage(err) });
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
    } catch (err: unknown) {
      res.status(500).json({ error: getErrorMessage(err) });
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

      if (!isNonEmptyString(executionId)) {
        return res.status(400).json({
          error: `${DashboardErrorMessage.InvalidBody}: executionId`,
        });
      }

      switch (action) {
        case "retryRollback":
          await operator.retryRollback(executionId);
          break;
        case "skipStep":
          if (!isNonEmptyString(stepId)) {
            return res.status(400).json({
              error: `${DashboardErrorMessage.InvalidBody}: stepId`,
            });
          }
          await operator.skipStep(executionId, stepId);
          break;
        case "forceFail":
          await operator.forceFail(
            executionId,
            isNonEmptyString(reason) ? reason : "Operator forced fail",
          );
          break;
        case "editState":
          if (!isNonEmptyString(stepId)) {
            return res.status(400).json({
              error: `${DashboardErrorMessage.InvalidBody}: stepId`,
            });
          }
          if (state === undefined) {
            return res.status(400).json({
              error: `${DashboardErrorMessage.InvalidBody}: state`,
            });
          }
          await operator.editState(executionId, stepId, state);
          break;
        default:
          return res.status(400).json({ error: "Unknown action" });
      }

      res.json({ success: true });
    } catch (err: unknown) {
      res.status(500).json({ error: getErrorMessage(err) });
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
