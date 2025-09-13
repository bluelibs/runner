import * as http from "http";
import { z } from "zod";
import { defineResource } from "../../define";
import { defineTask } from "../../definers/defineTask";
import { defineEvent } from "../../definers/defineEvent";
import { run } from "../../run";
import { nodeExposure } from "../exposure.resource";

describe("nodeExposure - unit edge cases", () => {
  const TOKEN = "unit-secret";

  const testTask = defineTask<{ v: number }, Promise<number>>({
    id: "unit.exposure.task",
    inputSchema: z.object({ v: z.number() }).strict(),
    resultSchema: z.number(),
    run: async ({ v }) => v,
  });

  const testEvent = defineEvent<{ msg?: string }>({ id: "unit.exposure.event" });
  const noInputTask = defineTask<void, Promise<number>>({
    id: "unit.exposure.noInputTask",
    // no inputSchema on purpose
    run: async () => 1,
  });

  async function startExposureServer() {
    const exposure = nodeExposure.with({
      http: { basePath: "/__runner", listen: { port: 0 }, auth: { token: TOKEN } },
    });
    const app = defineResource({
      id: "unit.exposure.app",
      register: [testTask, noInputTask, testEvent, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);
    const addr = handlers.server?.address();
    if (!addr || typeof addr === "string") throw new Error("No server address");
    const baseUrl = `http://127.0.0.1:${addr.port}${handlers.basePath}`;
    return { rr, handlers, baseUrl } as const;
  }

  function request({
    method,
    url,
    headers,
    body,
  }: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<{ status: number; text: string }>
  {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const req = http.request(
        {
          hostname: u.hostname,
          port: Number(u.port),
          path: u.pathname + u.search,
          method,
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
          res.on("end", () => resolve({ status: res.statusCode || 0, text: Buffer.concat(chunks).toString("utf8") }));
        },
      );
      req.on("error", reject);
      if (body != null) req.end(body);
      else req.end();
    });
  }

  it("returns 405 for GET on task and event endpoints", async () => {
    const { rr, baseUrl } = await startExposureServer();
    const h = { "x-runner-token": TOKEN };
    const r1 = await request({ method: "GET", url: `${baseUrl}/task/${encodeURIComponent(testTask.id)}`, headers: h });
    expect(r1.status).toBe(405);
    const r2 = await request({ method: "GET", url: `${baseUrl}/event/${encodeURIComponent(testEvent.id)}`, headers: h });
    expect(r2.status).toBe(405);
    await rr.dispose();
  });

  it("returns 404 for target-less base path and for non-base paths (server wrapper)", async () => {
    const { rr, baseUrl } = await startExposureServer();
    const h = { "x-runner-token": TOKEN };
    const r1 = await request({ method: "POST", url: `${baseUrl}`, headers: h, body: "{}" });
    expect(r1.status).toBe(404); // handleRequest target null -> 182-183
    const root = new URL(baseUrl);
    const r2 = await request({ method: "POST", url: `${root.origin}/not-runner`, headers: h, body: "{}" });
    expect(r2.status).toBe(404); // server wrapper !handled -> 207-208
    await rr.dispose();
  });

  it("returns 404 when calling task/event handlers with wrong paths (direct handlers)", async () => {
    const { rr, handlers } = await startExposureServer();

    // Build a proxy server that routes directly to the specific handler to cover branches
    const proxyToEvent = http.createServer((req, res) => {
      void handlers.handleEvent(req, res);
    });
    const proxyToTask = http.createServer((req, res) => {
      void handlers.handleTask(req, res);
    });

    await new Promise<void>((r) => proxyToEvent.listen(0, "127.0.0.1", () => r()));
    await new Promise<void>((r) => proxyToTask.listen(0, "127.0.0.1", () => r()));

    const a1 = proxyToEvent.address();
    const a2 = proxyToTask.address();
    if (!a1 || typeof a1 === "string" || !a2 || typeof a2 === "string") throw new Error("No address");

    const h = { "x-runner-token": TOKEN };
    // Call event handler with a task path -> triggers 157 branch
    const r1 = await request({ method: "POST", url: `http://127.0.0.1:${a1.port}/__runner/task/${encodeURIComponent(testTask.id)}`, headers: h, body: "{}" });
    expect(r1.status).toBe(404);

    // Call task handler with an event path (or missing id) -> triggers 128 branch (+ 113 via extractTarget null)
    const r2 = await request({ method: "POST", url: `http://127.0.0.1:${a2.port}/__runner/event/${encodeURIComponent(testEvent.id)}`, headers: h, body: "{}" });
    expect(r2.status).toBe(404);

    // Call task handler with missing id -> extractTarget returns null (113)
    const r3 = await request({ method: "POST", url: `http://127.0.0.1:${a2.port}/__runner/task/`, headers: h, body: "{}" });
    expect(r3.status).toBe(404);

    await new Promise<void>((r) => proxyToEvent.close(() => r()));
    await new Promise<void>((r) => proxyToTask.close(() => r()));
    await rr.dispose();
  });

  it("returns 500 for invalid JSON body when posting to event endpoint", async () => {
    const { rr, baseUrl } = await startExposureServer();
    const h = { "x-runner-token": TOKEN };
    const r = await request({ method: "POST", url: `${baseUrl}/event/${encodeURIComponent(testEvent.id)}`, headers: h, body: "not-json" });
    expect(r.status).toBe(500); // readJson -> parse error -> catch in handleEvent (167-170)
    await rr.dispose();
  });

  it("allows requests without auth when token is not configured", async () => {
    const exposure = nodeExposure.with({ http: { basePath: "/__runner", listen: { port: 0 } } });
    const app = defineResource({ id: "unit.exposure.noauth.app", register: [testEvent, exposure] });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);
    const addr = handlers.server?.address();
    if (!addr || typeof addr === "string") throw new Error("No server address");
    const baseUrl = `http://127.0.0.1:${addr.port}${handlers.basePath}`;
    const r = await request({ method: "POST", url: `${baseUrl}/event/${encodeURIComponent(testEvent.id)}`, body: "{}" });
    expect(r.status).toBe(200);
    await rr.dispose();
  });

  it("returns 500 for task validation error (handleTask catch branch)", async () => {
    const { rr, handlers } = await startExposureServer();
    const proxyToTask = http.createServer((req, res) => {
      void handlers.handleTask(req, res);
    });
    await new Promise<void>((r) => proxyToTask.listen(0, "127.0.0.1", () => r()));
    const addr = proxyToTask.address();
    if (!addr || typeof addr === "string") throw new Error("No address");
    const url = `http://127.0.0.1:${addr.port}/__runner/task/${encodeURIComponent(testTask.id)}`;
    const h = { "x-runner-token": TOKEN };
    // Missing required input v -> validation fails -> 500
    const r = await request({ method: "POST", url, headers: h, body: "{}" });
    expect(r.status).toBe(500);
    await new Promise<void>((r) => proxyToTask.close(() => r()));
    await rr.dispose();
  });

  it("handles task with empty body (readJson undefined branch)", async () => {
    const { rr, handlers } = await startExposureServer();
    const proxyToTask = http.createServer((req, res) => {
      void handlers.handleTask(req, res);
    });
    await new Promise<void>((r) => proxyToTask.listen(0, "127.0.0.1", () => r()));
    const addr = proxyToTask.address();
    if (!addr || typeof addr === "string") throw new Error("No address");
    const url = `http://127.0.0.1:${addr.port}/__runner/task/${encodeURIComponent(noInputTask.id)}`;
    const h = { "x-runner-token": TOKEN };
    // No body sent
    const result = await request({ method: "POST", url, headers: h });
    expect(result.status).toBe(200);
    await new Promise<void>((r) => proxyToTask.close(() => r()));
    await rr.dispose();
  });

  it("returns 404 when posting to missing event id (store lookup)", async () => {
    const { rr, baseUrl } = await startExposureServer();
    const h = { "x-runner-token": TOKEN };
    const r = await request({ method: "POST", url: `${baseUrl}/event/${encodeURIComponent("unit.exposure.missing-event")}`, headers: h, body: "{}" });
    expect(r.status).toBe(404);
    await rr.dispose();
  });

  it("supports custom auth header name", async () => {
    const exposure = nodeExposure.with({
      http: { basePath: "/__runner", listen: { port: 0 }, auth: { header: "authorization", token: "Bearer XYZ" } },
    });
    const app = defineResource({ id: "unit.exposure.custom-header.app", register: [testEvent, exposure] });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);
    const addr = handlers.server?.address();
    if (!addr || typeof addr === "string") throw new Error("No server address");
    const baseUrl = `http://127.0.0.1:${addr.port}${handlers.basePath}`;

    // Missing/incorrect header -> 401
    let r = await request({ method: "POST", url: `${baseUrl}/event/${encodeURIComponent(testEvent.id)}`, body: "{}" });
    expect(r.status).toBe(401);

    // Correct header -> 200
    r = await request({ method: "POST", url: `${baseUrl}/event/${encodeURIComponent(testEvent.id)}`, headers: { authorization: "Bearer XYZ" }, body: "{}" });
    expect(r.status).toBe(200);
    await rr.dispose();
  });

  it("does not auto-attach when httpCfg.server is provided (server stays null)", async () => {
    const externalServer = http.createServer((_req, res) => res.end("ok"));
    // Note: we do not listen() on purpose; exposure should not auto-attach
    const exposure = nodeExposure.with({ http: { server: externalServer, auth: { token: TOKEN } } });
    const app = defineResource({ id: "unit.exposure.serverProvided", register: [testTask, testEvent, exposure] });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);
    expect(handlers.server).toBeNull();
    await rr.dispose();
    externalServer.close();
  });
});
