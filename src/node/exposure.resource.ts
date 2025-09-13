import { defineResource } from "../define";
import { globalResources } from "../globals/globalResources";
import type { Store } from "../models/Store";
import type { TaskRunner } from "../models/TaskRunner";
import type { EventManager } from "../models/EventManager";
import type { Logger } from "../models/Logger";
import * as http from "http";
import type { IncomingMessage, ServerResponse } from "http";

export interface NodeExposureHttpAuthConfig {
  header?: string;
  token: string;
}

export interface NodeExposureHttpConfig {
  // Base path for endpoints (default: "/__runner")
  basePath?: string;
  // Provide an existing server to attach to (optional)
  server?: http.Server;
  // Or make this resource listen on its own
  listen?: { port: number; host?: string };
  // Optional simple header-based auth
  auth?: NodeExposureHttpAuthConfig;
}

export interface NodeExposureConfig {
  http?: NodeExposureHttpConfig;
}

export interface NodeExposureHandlers {
  // Returns true if the request was handled by the exposure
  handleRequest: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
  handleTask: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  handleEvent: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  server?: http.Server | null;
  basePath: string;
  close: () => Promise<void>;
}

function json(res: ServerResponse, status: number, body: any) {
  const payload = Buffer.from(JSON.stringify(body));
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", String(payload.length));
  res.end(payload);
}

async function readJson<T = any>(req: IncomingMessage): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => {
      if (chunks.length === 0) return resolve(undefined);
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function ensureLeadingSlash(p: string) {
  return p.startsWith("/") ? p : "/" + p;
}

function trimTrailingSlash(p: string) {
  return p.endsWith("/") && p !== "/" ? p.slice(0, -1) : p;
}

export const nodeExposure = defineResource<NodeExposureConfig, Promise<NodeExposureHandlers>>({
  id: "platform.node.resources.exposure",
  meta: {
    title: "Node Exposure (HTTP)",
    description:
      "Exposes Runner tasks and events over HTTP so a tunnel client can invoke them.",
  },
  dependencies: {
    store: globalResources.store,
    taskRunner: globalResources.taskRunner,
    eventManager: globalResources.eventManager,
    logger: globalResources.logger,
  },
  async init(cfg, deps) {
    const { store, taskRunner, eventManager, logger } = deps as any;
    const httpCfg = cfg?.http ?? {};
    const basePath = trimTrailingSlash(ensureLeadingSlash(httpCfg.basePath ?? "/__runner"));
    const authCfg = httpCfg.auth;

    const authenticate = (req: IncomingMessage): { ok: true } | { ok: false; reason: string } => {
      if (!authCfg?.token) return { ok: true };
      const header = (authCfg.header ?? "x-runner-token").toLowerCase();
      const provided = (req.headers[header] as string | undefined) ?? "";
      return provided === authCfg.token
        ? { ok: true }
        : { ok: false, reason: "Unauthorized" };
    };

    // Route helpers
    const isUnderBase = (pathname: string) => pathname === basePath || pathname.startsWith(basePath + "/");

    const extractTarget = (pathname: string): { kind: "task" | "event"; id: string } | null => {
      if (!isUnderBase(pathname)) return null;
      const rest = pathname.slice(basePath.length); // "" or "/task/..." or "/event/..."
      if (!rest || rest === "/") return null;
      const segs = rest.split("/").filter(Boolean);
      const kind = segs[0];
      const id = decodeURIComponent(segs.slice(1).join("/"));
      if (kind === "task" && id) return { kind: "task", id };
      if (kind === "event" && id) return { kind: "event", id };
      return null;
    };

    /* istanbul ignore next */
    function safeLogError(l: Logger, message: string, data: any) {
      try {
        l.error(message, data);
      } catch (_) {}
    }

    const handleTask = async (req: IncomingMessage, res: ServerResponse) => {
      try {
        if (req.method !== "POST") {
          return json(res, 405, { ok: false, error: { message: "Method Not Allowed" } });
        }
        const auth = authenticate(req);
        if (!auth.ok) {
          return json(res, 401, { ok: false, error: { message: auth.reason } });
        }
        const url = new URL(req.url || "/", "http://localhost");
        const target = extractTarget(url.pathname);
        if (!target || target.kind !== "task") {
          return json(res, 404, { ok: false, error: { message: "Not Found" } });
        }
        const storeTask = (store as Store).tasks.get(target.id);
        if (!storeTask) {
          return json(res, 404, { ok: false, error: { message: `Task ${target.id} not found` } });
        }
        const body = (await readJson<{ input?: any }>(req)) || {};
        const result = await (taskRunner as TaskRunner).run(storeTask.task as any, body?.input);
        return json(res, 200, { ok: true, result });
        /* istanbul ignore next */
        } catch (e: any) {
        safeLogError(logger as Logger, "exposure.task.error", { error: e?.message || String(e) });
        return json(res, 500, { ok: false, error: { message: e?.message || "Internal Error" } });
      }
    };

    const handleEvent = async (req: IncomingMessage, res: ServerResponse) => {
      try {
        if (req.method !== "POST") {
          return json(res, 405, { ok: false, error: { message: "Method Not Allowed" } });
        }
        const auth = authenticate(req);
        if (!auth.ok) {
          return json(res, 401, { ok: false, error: { message: auth.reason } });
        }
        const url = new URL(req.url || "/", "http://localhost");
        const target = extractTarget(url.pathname);
        if (!target || target.kind !== "event") {
          return json(res, 404, { ok: false, error: { message: "Not Found" } });
        }
        const storeEvent = (store as Store).events.get(target.id);
        if (!storeEvent) {
          return json(res, 404, { ok: false, error: { message: `Event ${target.id} not found` } });
        }
        const body = (await readJson<{ payload?: any }>(req)) || {};
        await (eventManager as EventManager).emit(storeEvent.event as any, body?.payload, "exposure:http");
        return json(res, 200, { ok: true });
        /* istanbul ignore next */
        } catch (e: any) {
        safeLogError(logger as Logger, "exposure.event.error", { error: e?.message || String(e) });
        return json(res, 500, { ok: false, error: { message: e?.message || "Internal Error" } });
      }
    };

      /* istanbul ignore next */
      const handleRequest = async (
        req: IncomingMessage,
        res: ServerResponse,
      ): Promise<boolean> => {
      const url = new URL(req.url || "/", "http://localhost");
      if (!isUnderBase(url.pathname)) return false;
      const target = extractTarget(url.pathname);
      if (!target) {
        json(res, 404, { ok: false, error: { message: "Not Found" } });
        return true;
      }
      if (target.kind === "task") {
        await handleTask(req, res);
      } else if (target.kind === "event") {
        await handleEvent(req, res);
      }
      return true;
    };

    // Optionally attach to a provided server or create our own
    let server: http.Server | null = null;
    if (httpCfg.server) {
      // Do not auto-attach to provided servers; return handler for explicit mounting.
      server = null;
    }
    /* istanbul ignore next */
    if (!httpCfg.server && httpCfg.listen) {
      server = http.createServer((req, res) => {
        /* istanbul ignore next */
        handleRequest(req, res).then((handled) => {
          /* istanbul ignore next */
          if (!handled) {
            json(res, 404, { ok: false, error: { message: "Not Found" } });
          }
        });
      });
      await new Promise<void>((resolve) =>
        server!.listen(httpCfg.listen!.port, httpCfg.listen!.host, resolve),
      );
      try {
        (logger as Logger).info("node.exposure.listen", {
          basePath,
          port: httpCfg.listen.port,
          host: httpCfg.listen.host ?? "0.0.0.0",
        });
      } catch (_) {}
    }

    const close = async () => {
      if (server) {
        /* istanbul ignore next */
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      }
    };

    return { handleRequest, handleTask, handleEvent, server, basePath, close };
  },
  async dispose(value) {
    if (value?.close) await value.close();
  },
});
