import path from "path";

import express, { type Request, type Response } from "express";
import { r, resources } from "@bluelibs/runner";

import { askRunnerTask } from "../ai/ask-runner.task";
import { streamAskRunnerTask } from "../ai/stream-ask-runner.task";
import { appConfig } from "../config/app-config.resource";
import { missingConfigError } from "../errors";
import { prepareQueryRequest } from "./query-request";
import { buildStreamHtmlPage } from "./stream-html-page";

const streamHtmlContentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const streamHtmlAssetRoutes = [
  {
    route: "/__ask-runner-assets/marked",
    directory: path.join(
      path.dirname(require.resolve("marked/package.json")),
      "lib",
    ),
  },
  {
    route: "/__ask-runner-assets/dompurify",
    directory: path.dirname(require.resolve("dompurify/dist/purify.min.js")),
  },
  {
    route: "/__ask-runner-assets/highlight",
    directory: path.dirname(require.resolve("highlight.js/package.json")),
  },
  {
    route: "/__ask-runner-assets/mermaid",
    directory: path.dirname(require.resolve("mermaid/dist/mermaid.min.js")),
  },
] as const;

export interface HttpServer {
  app: express.Express;
  server: ReturnType<express.Express["listen"]> | null;
}

export const httpServer = r
  .resource("httpServer")
  .dependencies({
    appConfig,
    askRunnerTask,
    streamAskRunnerTask,
    logger: resources.logger,
  })
  .init(async (_config, deps): Promise<HttpServer> => {
    const app = express();
    app.set("trust proxy", deps.appConfig.trustProxy);
    app.use(express.json());
    registerExplicitHttpRoutes(app, {
      runAskRunnerTask: async (input) => {
        const result = await deps.askRunnerTask(input);
        if (!result) {
          missingConfigError.throw({
            message: "askRunner task returned no result.",
          });
        }

        return result;
      },
      runStreamAskRunnerTask: async (input) => {
        const result = await deps.streamAskRunnerTask(input);
        if (!result) {
          missingConfigError.throw({
            message: "streamAskRunner task returned no result.",
          });
        }

        return result;
      },
    });
    return { app, server: null };
  })
  .ready(async (httpServer, _config, deps) => {
    registerHttpErrorHandler(httpServer.app);
    httpServer.server = await new Promise<
      ReturnType<express.Express["listen"]>
    >((resolve, reject) => {
      const instance = httpServer.app.listen(
        deps.appConfig.port,
        deps.appConfig.host,
        () => resolve(instance),
      );
      instance.once("error", reject);
    });
    await logHttpServerReady(deps.logger, {
      host: deps.appConfig.host,
      port: deps.appConfig.port,
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

export function registerExplicitHttpRoutes(
  app: express.Express,
  deps: {
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
  },
): void {
  for (const assetRoute of streamHtmlAssetRoutes) {
    app.use(
      assetRoute.route,
      express.static(assetRoute.directory, {
        fallthrough: false,
        immutable: true,
        maxAge: "1d",
      }),
    );
  }

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

  app.get("/stream-html", (_req, res) => {
    res.setHeader("Content-Security-Policy", streamHtmlContentSecurityPolicy);
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.type("text/html; charset=utf-8").send(buildStreamHtmlPage());
  });
}

export function registerHttpErrorHandler(app: express.Express): void {
  app.use(
    (
      error: unknown,
      _req: Request,
      res: Response,
      _next: express.NextFunction,
    ) => {
      if (res.headersSent) {
        res.end();
        return;
      }

      const statusCode =
        typeof error === "object" &&
        error &&
        "httpCode" in error &&
        typeof error.httpCode === "number"
          ? error.httpCode
          : 500;
      const message =
        error instanceof Error ? error.message : "Internal Server Error";
      res.status(statusCode).json({ error: message });
    },
  );
}

export async function logHttpServerReady(
  logger: { info(message: string): Promise<void> | void },
  input: { host: string; port: number },
): Promise<void> {
  await logger.info(
    `Ask Runner is listening on ${buildBoundHttpBaseUrl(input)}.`,
  );

  for (const url of buildHttpExampleUrls(input.port)) {
    await logger.info(url);
  }
}

export function buildBoundHttpBaseUrl(input: {
  host: string;
  port: number;
}): string {
  return `http://${input.host}:${input.port}`;
}

export function buildHttpExampleUrls(port: number): string[] {
  const baseUrl = `http://localhost:${port}`;
  return [
    `${baseUrl}/?query=xxx`,
    `${baseUrl}/stream?query=xxx`,
    `${baseUrl}/stream-html?query=xxx`,
  ];
}
