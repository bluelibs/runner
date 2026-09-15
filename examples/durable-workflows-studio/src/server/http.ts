/**
 * Studio HTTP transport: dependency-free `node:http` server.
 *
 * Routes `/api/*` to the API handlers, serves the built web client from
 * `web/dist` when present, and streams live execution detail over SSE.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import type { StudioExecutionStatus } from "../shared/types.js";
import {
  cancelExecution,
  createSchedule,
  editExecutionState,
  forceFailExecution,
  getExecutionDetail,
  getWorkflowByKey,
  listExecutions,
  listSchedules,
  listStuck,
  listWorkflows,
  pauseSchedule,
  previewSchedule,
  recoverOrphans,
  removeSchedule,
  resumeSchedule,
  retryExecution,
  sendSignal,
  skipExecutionStep,
  startExecution,
  updateSchedule,
} from "./api.js";
import type { StudioHandles } from "./studioApp.js";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function webDistDir(): string {
  return join(__dirname, "..", "..", "web", "dist");
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    if (Buffer.concat(chunks).length > 1_000_000) {
      throw new Error("Request body too large.");
    }
  }
  const text = Buffer.concat(chunks).toString("utf-8").trim();
  if (text === "") return {};
  return JSON.parse(text) as unknown;
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function serveStatic(
  response: ServerResponse,
  pathname: string,
): Promise<boolean> {
  const root = webDistDir();
  const candidate = normalize(join(root, pathname === "/" ? "index.html" : pathname));
  if (!candidate.startsWith(root + sep) && candidate !== join(root, "index.html")) {
    return false;
  }
  try {
    const fileStat = await stat(candidate);
    if (!fileStat.isFile()) return false;
    const content = await readFile(candidate);
    response.writeHead(200, {
      "content-type":
        CONTENT_TYPES[extname(candidate).toLowerCase()] ??
        "application/octet-stream",
    });
    response.end(content);
    return true;
  } catch {
    return false;
  }
}

function streamDetail(
  handles: StudioHandles,
  executionId: string,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  let lastPayload = "";
  let stopped = false;
  const stop = () => {
    stopped = true;
    clearInterval(timer);
    response.end();
  };
  request.on("close", stop);
  const push = async () => {
    if (stopped) return;
    try {
      const detail = await getExecutionDetail(handles, executionId);
      const payload = JSON.stringify(detail.body);
      if (payload !== lastPayload) {
        lastPayload = payload;
        response.write(`event: detail\ndata: ${payload}\n\n`);
      } else {
        response.write(": keep-alive\n\n");
      }
    } catch {
      response.write(": keep-alive\n\n");
    }
  };
  const timer = setInterval(push, 500);
  void push();
}

export type ApiDispatch =
  | { kind: "json"; status: number; body: unknown }
  | { kind: "stream"; executionId: string }
  | { kind: "passthrough" };

/**
 * Routes one API request to its handler. Returns `passthrough` for non-API
 * paths so the server can fall through to static file serving.
 */
export async function dispatchApiRequest(
  handles: StudioHandles,
  method: string,
  url: URL,
  body: unknown,
): Promise<ApiDispatch> {
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/health") {
    return { kind: "json", status: 200, body: { ok: true } };
  }
  if (method === "GET" && pathname === "/api/workflows") {
    const result = listWorkflows({
      query: url.searchParams.get("query") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: Number(url.searchParams.get("limit") ?? 20),
    });
    return { kind: "json", status: result.status, body: result.body };
  }
  const workflowMatch = pathname.match(/^\/api\/workflows\/([^/]+)$/);
  if (method === "GET" && workflowMatch) {
    const result = getWorkflowByKey(decodeURIComponent(workflowMatch[1]!));
    return { kind: "json", status: result.status, body: result.body };
  }
  if (method === "POST" && pathname === "/api/executions") {
    const result = await startExecution(handles, body);
    return { kind: "json", status: result.status, body: result.body };
  }
  if (method === "GET" && pathname === "/api/executions") {
    const status = url.searchParams.get("status") as
      | StudioExecutionStatus
      | null;
    const result = await listExecutions(handles, {
      workflowKey: url.searchParams.get("workflowKey") ?? undefined,
      status: status ?? undefined,
      limit: Number(url.searchParams.get("limit") ?? 100),
      offset: url.searchParams.has("offset") ? Number(url.searchParams.get("offset")) : undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
      executionId: url.searchParams.get("executionId") ?? undefined,
    });
    return { kind: "json", status: result.status, body: result.body };
  }
  const streamMatch = pathname.match(/^\/api\/executions\/([^/]+)\/stream$/);
  if (method === "GET" && streamMatch) {
    return {
      kind: "stream",
      executionId: decodeURIComponent(streamMatch[1]!),
    };
  }
  const signalMatch = pathname.match(/^\/api\/executions\/([^/]+)\/signals$/);
  if (method === "POST" && signalMatch) {
    const result = await sendSignal(
      handles,
      decodeURIComponent(signalMatch[1]!),
      body,
    );
    return { kind: "json", status: result.status, body: result.body };
  }
  const actionMatch = pathname.match(
    /^\/api\/executions\/([^/]+)\/(cancel|retry|force-fail)$/,
  );
  if (method === "POST" && actionMatch) {
    const id = decodeURIComponent(actionMatch[1]!);
    const action = actionMatch[2]!;
    const result =
      action === "cancel"
        ? await cancelExecution(handles, id)
        : action === "retry"
          ? await retryExecution(handles, id)
          : await forceFailExecution(handles, id, body);
    return { kind: "json", status: result.status, body: result.body };
  }
  const stateActionMatch = pathname.match(
    /^\/api\/executions\/([^/]+)\/(skip-step|edit-state)$/,
  );
  if (method === "POST" && stateActionMatch) {
    const id = decodeURIComponent(stateActionMatch[1]!);
    const result =
      stateActionMatch[2] === "skip-step"
        ? await skipExecutionStep(handles, id, body)
        : await editExecutionState(handles, id, body);
    return { kind: "json", status: result.status, body: result.body };
  }
  const detailMatch = pathname.match(/^\/api\/executions\/([^/]+)$/);
  if (method === "GET" && detailMatch) {
    const result = await getExecutionDetail(
      handles,
      decodeURIComponent(detailMatch[1]!),
    );
    return { kind: "json", status: result.status, body: result.body };
  }
  if (method === "GET" && pathname === "/api/schedules") {
    const result = await listSchedules(handles);
    return { kind: "json", status: result.status, body: result.body };
  }
  if (method === "POST" && pathname === "/api/schedules/preview") {
    const result = previewSchedule(body);
    return { kind: "json", status: result.status, body: result.body };
  }
  if (method === "POST" && pathname === "/api/schedules") {
    const result = await createSchedule(handles, body);
    return { kind: "json", status: result.status, body: result.body };
  }
  const scheduleActionMatch = pathname.match(
    /^\/api\/schedules\/([^/]+)\/(pause|resume)$/,
  );
  if (method === "POST" && scheduleActionMatch) {
    const id = decodeURIComponent(scheduleActionMatch[1]!);
    const result =
      scheduleActionMatch[2] === "pause"
        ? await pauseSchedule(handles, id)
        : await resumeSchedule(handles, id);
    return { kind: "json", status: result.status, body: result.body };
  }
  const scheduleMatch = pathname.match(/^\/api\/schedules\/([^/]+)$/);
  if (method === "PATCH" && scheduleMatch) {
    const result = await updateSchedule(
      handles,
      decodeURIComponent(scheduleMatch[1]!),
      body,
    );
    return { kind: "json", status: result.status, body: result.body };
  }
  if (method === "DELETE" && scheduleMatch) {
    const result = await removeSchedule(
      handles,
      decodeURIComponent(scheduleMatch[1]!),
    );
    return { kind: "json", status: result.status, body: result.body };
  }
  if (method === "GET" && pathname === "/api/stuck") {
    const result = await listStuck(handles);
    return { kind: "json", status: result.status, body: result.body };
  }
  if (method === "POST" && pathname === "/api/recover") {
    const result = await recoverOrphans(handles);
    return { kind: "json", status: result.status, body: result.body };
  }
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return { kind: "json", status: 404, body: { error: "Unknown API route." } };
  }
  return { kind: "passthrough" };
}

export interface StudioServerOptions {
  /**
   * Optional admin token. When set, every `/api` route except
   * `GET /api/health` requires `Authorization: Bearer <token>` (or the
   * `?token=` query fallback for SSE, which cannot set headers).
   * Unset means open access.
   */
  token?: string;
}

/** Extracts the caller's bearer token (header first, `?token=` fallback). */
function requestToken(request: IncomingMessage, url: URL): string | null {
  const header = request.headers["authorization"];
  if (typeof header === "string") {
    const match = header.match(/^Bearer (.+)$/);
    if (match) return match[1]!.trim();
  }
  const query = url.searchParams.get("token");
  return query && query.length > 0 ? query : null;
}

export function createStudioServer(
  handles: StudioHandles,
  options: StudioServerOptions = {},
): Server {
  const token = options.token && options.token.length > 0 ? options.token : undefined;
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://studio.local");
      const method = request.method ?? "GET";
      const isApi = url.pathname === "/api" || url.pathname.startsWith("/api/");
      const isHealthProbe = method === "GET" && url.pathname === "/api/health";
      if (token !== undefined && isApi && !isHealthProbe) {
        if (requestToken(request, url) !== token) {
          sendJson(response, 401, {
            error: "Unauthorized: a valid admin token is required.",
          });
          return;
        }
      }
      const needsBody =
        method === "POST" || method === "PUT" || method === "PATCH";
      const body = needsBody ? await readJsonBody(request) : undefined;
      const dispatched = await dispatchApiRequest(
        handles,
        method,
        url,
        body,
      );
      if (dispatched.kind === "json") {
        sendJson(response, dispatched.status, dispatched.body);
        return;
      }
      if (dispatched.kind === "stream") {
        streamDetail(handles, dispatched.executionId, request, response);
        return;
      }
      const pathname = url.pathname;

      if (method === "GET") {
        if (await serveStatic(response, pathname)) return;
        // SPA fallback so deep links boot the client.
        if (await serveStatic(response, "/")) return;
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(
          "<h1>Durable Workflows Studio</h1><p>Web client not built. Run <code>npm run build:web</code> or use the JSON API under <code>/api</code>.</p>",
        );
        return;
      }
      sendJson(response, 404, { error: "Not found." });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected error.";
      sendJson(response, 500, { error: message });
    }
  });
}
