import * as http from "http";
import { z } from "zod";
import { defineResource } from "../../define";
import { defineTask } from "../../definers/defineTask";
import { defineEvent } from "../../definers/defineEvent";
import { run } from "../../run";
import { nodeExposure } from "../exposure.resource";
const D = process.env.RUNNER_TEST_NET === "1" ? describe : describe.skip;

D("nodeExposure - unit edge cases", () => {
  const TOKEN = "unit-secret";

  const testTask = defineTask<{ v: number }, Promise<number>>({
    id: "unit.exposure.task",
    inputSchema: z.object({ v: z.number() }).strict(),
    resultSchema: z.number(),
    run: async ({ v }) => v,
  });

  const testEvent = defineEvent<{ msg?: string }>({
    id: "unit.exposure.event",
  });
  const noInputTask = defineTask<void, Promise<number>>({
    id: "unit.exposure.noInputTask",
    // no inputSchema on purpose
    run: async () => 1,
  });

  async function startExposureServer() {
    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        basePath: "/__runner",
        listen: { port: 0 },
        auth: { token: TOKEN },
      },
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
  }): Promise<{ status: number; text: string }> {
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
          res.on("data", (c) =>
            chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)),
          );
          res.on("end", () =>
            resolve({
              status: res.statusCode || 0,
              text: Buffer.concat(chunks as readonly Uint8Array[]).toString(
                "utf8",
              ),
            }),
          );
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
    const r1 = await request({
      method: "GET",
      url: `${baseUrl}/task/${encodeURIComponent(testTask.id)}`,
      headers: h,
    });
    expect(r1.status).toBe(405);
    const r2 = await request({
      method: "GET",
      url: `${baseUrl}/event/${encodeURIComponent(testEvent.id)}`,
      headers: h,
    });
    expect(r2.status).toBe(405);
    await rr.dispose();
  });

  it("returns 400 INVALID_JSON when JSON parsing fails", async () => {
    const { rr, baseUrl } = await startExposureServer();
    const h = { "x-runner-token": TOKEN, "content-type": "application/json" };
    const res = await request({
      method: "POST",
      url: `${baseUrl}/task/${encodeURIComponent(testTask.id)}`,
      headers: h,
      body: "{",
    });
    expect(res.status).toBe(400);
    const payload = JSON.parse(res.text);
    expect(payload?.error?.code).toBe("INVALID_JSON");
    await rr.dispose();
  });

  it("treats aborted JSON bodies as internal errors", async () => {
    const { rr, handlers } = await startExposureServer();
    const { Readable } = require("stream");
    const req: any = new Readable({ read() {} });
    req.method = "POST";
    req.url = `/__runner/task/${encodeURIComponent(testTask.id)}`;
    req.headers = {
      "x-runner-token": TOKEN,
      "content-type": "application/json",
    };
    const res: any = {
      statusCode: 0,
      headers: new Map(),
      setHeader(key: string, value: string) {
        this.headers.set(key, value);
      },
      end(payload?: any) {
        this.payload = payload;
      },
    };
    setImmediate(() => {
      req.emit("aborted");
      req.push(null);
    });
    await handlers.handleTask(req, res);
    expect(res.statusCode).toBe(500);
    await rr.dispose();
  });

  it("returns 404 for target-less base path and for non-base paths (server wrapper)", async () => {
    const { rr, baseUrl } = await startExposureServer();
    const h = { "x-runner-token": TOKEN };
    const r1 = await request({
      method: "POST",
      url: `${baseUrl}`,
      headers: h,
      body: "{}",
    });
    expect(r1.status).toBe(404); // handleRequest target null -> 182-183
    const root = new URL(baseUrl);
    const r2 = await request({
      method: "POST",
      url: `${root.origin}/not-runner`,
      headers: h,
      body: "{}",
    });
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

    await new Promise<void>((r) =>
      proxyToEvent.listen(0, "127.0.0.1", () => r()),
    );
    await new Promise<void>((r) =>
      proxyToTask.listen(0, "127.0.0.1", () => r()),
    );

    const a1 = proxyToEvent.address();
    const a2 = proxyToTask.address();
    if (!a1 || typeof a1 === "string" || !a2 || typeof a2 === "string")
      throw new Error("No address");

    const h = { "x-runner-token": TOKEN };
    // Call event handler with a task path -> triggers 157 branch
    const r1 = await request({
      method: "POST",
      url: `http://127.0.0.1:${a1.port}/__runner/task/${encodeURIComponent(
        testTask.id,
      )}`,
      headers: h,
      body: "{}",
    });
    expect(r1.status).toBe(404);

    // Call task handler with an event path (or missing id) -> triggers 128 branch (+ 113 via extractTarget null)
    const r2 = await request({
      method: "POST",
      url: `http://127.0.0.1:${a2.port}/__runner/event/${encodeURIComponent(
        testEvent.id,
      )}`,
      headers: h,
      body: "{}",
    });
    expect(r2.status).toBe(404);

    // Call task handler with missing id -> extractTarget returns null (113)
    const r3 = await request({
      method: "POST",
      url: `http://127.0.0.1:${a2.port}/__runner/task/`,
      headers: h,
      body: "{}",
    });
    expect(r3.status).toBe(404);

    await new Promise<void>((r) => proxyToEvent.close(() => r()));
    await new Promise<void>((r) => proxyToTask.close(() => r()));
    await rr.dispose();
  });

  it("returns 500 for invalid JSON body when posting to event endpoint", async () => {
    const { rr, baseUrl } = await startExposureServer();
    const h = { "x-runner-token": TOKEN };
    const r = await request({
      method: "POST",
      url: `${baseUrl}/event/${encodeURIComponent(testEvent.id)}`,
      headers: h,
      body: "not-json",
    });
    expect(r.status).toBe(500); // readJson -> parse error -> catch in handleEvent (167-170)
    await rr.dispose();
  });

  it("allows requests without auth when token is not configured", async () => {
    const exposure = nodeExposure.with({
      http: { basePath: "/__runner", listen: { port: 0 } },
    });
    const app = defineResource({
      id: "unit.exposure.noauth.app",
      register: [testEvent, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);
    const addr = handlers.server?.address();
    if (!addr || typeof addr === "string") throw new Error("No server address");
    const baseUrl = `http://127.0.0.1:${addr.port}${handlers.basePath}`;
    const r = await request({
      method: "POST",
      url: `${baseUrl}/event/${encodeURIComponent(testEvent.id)}`,
      body: "{}",
    });
    expect(r.status).toBe(200);
    await rr.dispose();
  });

  it("returns 500 for task validation error (handleTask catch branch)", async () => {
    const { rr, handlers } = await startExposureServer();
    const proxyToTask = http.createServer((req, res) => {
      void handlers.handleTask(req, res);
    });
    await new Promise<void>((r) =>
      proxyToTask.listen(0, "127.0.0.1", () => r()),
    );
    const addr = proxyToTask.address();
    if (!addr || typeof addr === "string") throw new Error("No address");
    const url = `http://127.0.0.1:${
      addr.port
    }/__runner/task/${encodeURIComponent(testTask.id)}`;
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
    await new Promise<void>((r) =>
      proxyToTask.listen(0, "127.0.0.1", () => r()),
    );
    const addr = proxyToTask.address();
    if (!addr || typeof addr === "string") throw new Error("No address");
    const url = `http://127.0.0.1:${
      addr.port
    }/__runner/task/${encodeURIComponent(noInputTask.id)}`;
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
    const r = await request({
      method: "POST",
      url: `${baseUrl}/event/${encodeURIComponent(
        "unit.exposure.missing-event",
      )}`,
      headers: h,
      body: "{}",
    });
    expect(r.status).toBe(404);
    await rr.dispose();
  });

  it("supports custom auth header name", async () => {
    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        basePath: "/__runner",
        listen: { port: 0 },
        auth: { header: "authorization", token: "Bearer XYZ" },
      },
    });
    const app = defineResource({
      id: "unit.exposure.custom-header.app",
      register: [testEvent, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);
    const addr = handlers.server?.address();
    if (!addr || typeof addr === "string") throw new Error("No server address");
    const baseUrl = `http://127.0.0.1:${addr.port}${handlers.basePath}`;

    // Missing/incorrect header -> 401
    let r = await request({
      method: "POST",
      url: `${baseUrl}/event/${encodeURIComponent(testEvent.id)}`,
      body: "{}",
    });
    expect(r.status).toBe(401);

    // Correct header -> 200
    r = await request({
      method: "POST",
      url: `${baseUrl}/event/${encodeURIComponent(testEvent.id)}`,
      headers: { authorization: "Bearer XYZ" },
      body: "{}",
    });
    expect(r.status).toBe(200);
    await rr.dispose();
  });

  it("multipart: returns 400 INVALID_MULTIPART on bad __manifest JSON", async () => {
    const { rr, baseUrl } = await startExposureServer();
    const boundary = "----unitboundary123";
    const body = [
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="__manifest"\r\n' +
        "Content-Type: application/json; charset=utf-8\r\n\r\n" +
        "{bad\r\n" +
        `--${boundary}--\r\n`,
    ].join("");

    const res = await new Promise<{ status: number; text: string }>(
      (resolve, reject) => {
        const req = http.request(
          `${baseUrl}/task/${encodeURIComponent(testTask.id)}`,
          {
            method: "POST",
            headers: {
              "x-runner-token": TOKEN,
              "content-type": `multipart/form-data; boundary=${boundary}`,
              "content-length": String(Buffer.byteLength(body)),
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c) =>
              chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)),
            );
            res.on("end", () =>
              resolve({
                status: res.statusCode || 0,
                text: Buffer.concat(chunks as readonly Uint8Array[]).toString(
                  "utf8",
                ),
              }),
            );
          },
        );
        req.on("error", reject);
        req.end(body);
      },
    );

    expect(res.status).toBe(400);
    const json = JSON.parse(res.text);
    expect(json?.error?.code).toBe("INVALID_MULTIPART");
    await rr.dispose();
  });

  it("multipart: returns 400 MISSING_MANIFEST when __manifest is omitted", async () => {
    const { rr, baseUrl } = await startExposureServer();
    const boundary = "----unitboundary456";
    const body = [
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file:F1"; filename="x.txt"\r\n' +
        "Content-Type: text/plain\r\n\r\n" +
        "abc\r\n" +
        `--${boundary}--\r\n`,
    ].join("");

    const res = await new Promise<{ status: number; text: string }>(
      (resolve, reject) => {
        const req = http.request(
          `${baseUrl}/task/${encodeURIComponent(testTask.id)}`,
          {
            method: "POST",
            headers: {
              "x-runner-token": TOKEN,
              "content-type": `multipart/form-data; boundary=${boundary}`,
              "content-length": String(Buffer.byteLength(body)),
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c) =>
              chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)),
            );
            res.on("end", () =>
              resolve({
                status: res.statusCode || 0,
                text: Buffer.concat(chunks as readonly Uint8Array[]).toString(
                  "utf8",
                ),
              }),
            );
          },
        );
        req.on("error", reject);
        req.end(body);
      },
    );

    expect(res.status).toBe(400);
    const json = JSON.parse(res.text);
    expect(json?.error?.code).toBe("MISSING_MANIFEST");
    await rr.dispose();
  });

  it("multipart: returns 500 when manifest references missing file part", async () => {
    const { rr, baseUrl } = await startExposureServer();
    const boundary = "----unitboundary789";
    const badId = "F1";
    const body = [
      // __manifest referencing file id F1
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="__manifest"\r\n' +
        "Content-Type: application/json; charset=utf-8\r\n\r\n" +
        JSON.stringify({
          input: {
            file: { $runnerFile: "File", id: badId, meta: { name: "x.txt" } },
          },
        }) +
        "\r\n" +
        // Provide a different file id so hydration fails to find it
        `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file:OTHER"; filename="x.txt"\r\n' +
        "Content-Type: text/plain\r\n\r\n" +
        "abc\r\n" +
        `--${boundary}--\r\n`,
    ].join("");

    const res = await new Promise<{ status: number; text: string }>(
      (resolve, reject) => {
        const req = http.request(
          `${baseUrl}/task/${encodeURIComponent(testTask.id)}`,
          {
            method: "POST",
            headers: {
              "x-runner-token": TOKEN,
              "content-type": `multipart/form-data; boundary=${boundary}`,
              "content-length": String(Buffer.byteLength(body)),
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c) =>
              chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)),
            );
            res.on("end", () =>
              resolve({
                status: res.statusCode || 0,
                text: Buffer.concat(chunks as readonly Uint8Array[]).toString(
                  "utf8",
                ),
              }),
            );
          },
        );
        req.on("error", reject);
        req.end(body);
      },
    );

    expect(res.status).toBe(500);
    expect(res.text).toContain("error");
    await rr.dispose();
  });

  it("createRequestListener provides a standalone listener with automatic 404", async () => {
    const { rr, handlers } = await startExposureServer();
    const listener = handlers.createRequestListener();
    const server = http.createServer(listener);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("No server address");
    const origin = `http://127.0.0.1:${addr.port}`;

    const miss = await request({
      method: "POST",
      url: `${origin}/outside`,
      body: "{}",
    });
    expect(miss.status).toBe(404);

    const headers = {
      "x-runner-token": TOKEN,
      "content-type": "application/json",
    };
    const ok = await request({
      method: "POST",
      url: `${origin}${handlers.basePath}/task/${encodeURIComponent(
        testTask.id,
      )}`,
      headers,
      body: JSON.stringify({ input: { v: 3 } }),
    });
    expect(ok.status).toBe(200);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rr.dispose();
  });

  it("attachTo mounts and detaches an external server", async () => {
    const { rr, handlers } = await startExposureServer();
    const external = http.createServer((_req, res) => {
      res.statusCode = 200;
      res.end("fallback");
    });
    await new Promise<void>((resolve) =>
      external.listen(0, "127.0.0.1", resolve),
    );
    const detach = handlers.attachTo(external);
    const addr = external.address();
    if (!addr || typeof addr === "string") throw new Error("No server address");
    const base = `http://127.0.0.1:${addr.port}${handlers.basePath}`;
    const headers = {
      "x-runner-token": TOKEN,
      "content-type": "application/json",
    };

    const first = await request({
      method: "POST",
      url: `${base}/task/${encodeURIComponent(testTask.id)}`,
      headers,
      body: JSON.stringify({ input: { v: 2 } }),
    });
    expect(first.status).toBe(200);
    const parsed = JSON.parse(first.text);
    expect(parsed.ok).toBe(true);

    detach();

    const fallback = await request({
      method: "POST",
      url: `${base}/task/${encodeURIComponent(testTask.id)}`,
      headers,
      body: JSON.stringify({ input: { v: 2 } }),
    });
    expect(fallback.text).toBe("fallback");
    expect(fallback.status).toBe(200);

    await new Promise<void>((resolve) => external.close(() => resolve()));
    await rr.dispose();
  });

  it("createServer returns a ready-to-use HTTP server", async () => {
    const { rr, handlers } = await startExposureServer();
    const extra = handlers.createServer();
    await new Promise<void>((resolve) => extra.listen(0, "127.0.0.1", resolve));
    const addr = extra.address();
    if (!addr || typeof addr === "string") throw new Error("No server address");
    const origin = `http://127.0.0.1:${addr.port}`;
    const headers = {
      "x-runner-token": TOKEN,
      "content-type": "application/json",
    };

    const ok = await request({
      method: "POST",
      url: `${origin}${handlers.basePath}/task/${encodeURIComponent(
        testTask.id,
      )}`,
      headers,
      body: JSON.stringify({ input: { v: 9 } }),
    });
    expect(ok.status).toBe(200);

    const miss = await request({
      method: "POST",
      url: `${origin}/nope`,
      body: "{}",
    });
    expect(miss.status).toBe(404);

    await new Promise<void>((resolve) => extra.close(() => resolve()));
    await rr.dispose();
  });

  it("auto-attaches to a provided server and detaches on dispose", async () => {
    const externalServer = http.createServer((req, res) => {
      res.statusCode = 200;
      res.end("external");
    });
    await new Promise<void>((resolve) =>
      externalServer.listen(0, "127.0.0.1", resolve),
    );
    const exposure = nodeExposure.with({
      http: { server: externalServer, auth: { token: TOKEN } },
    });
    const app = defineResource({
      id: "unit.exposure.serverProvided",
      register: [testTask, testEvent, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);
    expect(handlers.server).toBe(externalServer);
    const addr = externalServer.address();
    if (!addr || typeof addr === "string") throw new Error("No server address");
    const base = `http://127.0.0.1:${addr.port}${handlers.basePath}`;

    const headers = {
      "x-runner-token": TOKEN,
      "content-type": "application/json",
    };
    const first = await request({
      method: "POST",
      url: `${base}/task/${encodeURIComponent(testTask.id)}`,
      headers,
      body: JSON.stringify({ input: { v: 7 } }),
    });
    expect(first.status).toBe(200);

    await rr.dispose();

    const fallback = await request({
      method: "POST",
      url: `${base}/task/${encodeURIComponent(testTask.id)}`,
      headers,
      body: JSON.stringify({ input: { v: 7 } }),
    });
    expect(fallback.text).toBe("external");
    expect(fallback.status).toBe(200);

    await new Promise<void>((resolve) => externalServer.close(() => resolve()));
  });
});
