import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as http from "node:http";
import { Duplex } from "node:stream";

import type { Express } from "express";
import express = require("express");

import type { IDurableService } from "../../durable/core/interfaces/service";
import { MemoryStore } from "../../durable/store/MemoryStore";
import { DurableOperator } from "../../durable/core/DurableOperator";
import { createDashboardMiddleware } from "../../durable/dashboard/server";

function createUnusedService(): IDurableService {
  const unused = (): never => {
    throw new Error("Not used by createDashboardMiddleware");
  };

  return {
    startExecution: async () => unused(),
    cancelExecution: async () => unused(),
    wait: async () => unused(),
    execute: async () => unused(),
    executeStrict: async () => unused(),
    schedule: async () => unused(),
    recover: async () => unused(),
    start: () => unused(),
    stop: async () => unused(),
    pauseSchedule: async () => unused(),
    resumeSchedule: async () => unused(),
    getSchedule: async () => unused(),
    listSchedules: async () => unused(),
    updateSchedule: async () => unused(),
    removeSchedule: async () => unused(),
    signal: async () => unused(),
    ensureSchedule: async () => unused(),
  };
}

async function createTempUiDist(): Promise<{
  path: string;
  cleanup: () => Promise<void>;
}> {
  const base = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "runner-durable-dashboard-ui-"),
  );

  await fs.promises.mkdir(path.join(base, "assets"), { recursive: true });

  await fs.promises.writeFile(
    path.join(base, "index.html"),
    [
      "<!doctype html>",
      "<html>",
      "  <head>",
      '    <meta charset="UTF-8" />',
      "    <title>Test Dashboard</title>",
      "  </head>",
      "  <body>",
      "    <h1>Dashboard</h1>",
      "  </body>",
      "</html>",
      "",
    ].join("\n"),
    "utf8",
  );

  await fs.promises.writeFile(
    path.join(base, "assets", "health.txt"),
    "ok",
    "utf8",
  );

  return {
    path: base,
    cleanup: async () => {
      await fs.promises.rm(base, { recursive: true, force: true });
    },
  };
}

async function request(
  app: Express,
  params: {
    label?: string;
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: unknown;
  },
): Promise<{ status: number; body: string }> {
  const bodyText =
    params.body === undefined ? undefined : JSON.stringify(params.body);
  const headers: Record<string, string> = { ...(params.headers ?? {}) };
  if (bodyText !== undefined && headers["content-type"] === undefined) {
    headers["content-type"] = "application/json";
  }
  if (bodyText !== undefined && headers["content-length"] === undefined) {
    headers["content-length"] = String(Buffer.byteLength(bodyText));
  }

  const bodyChunks: Buffer[] = [];

  const socket = new Duplex({
    read() {},
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  (socket as any).encrypted = false;

  const req = new http.IncomingMessage(socket as any);
  req.method = params.method;
  req.url = params.url;
  (req as any).headers = headers;
  (req as any).httpVersionMajor = 1;
  (req as any).httpVersionMinor = 1;
  (req as any).httpVersion = "1.1";

  const res = new http.ServerResponse(req);
  res.assignSocket(socket as any);

  const originalWrite = res.write.bind(res);
  res.write = ((chunk: any, encoding?: any, cb?: any) => {
    if (chunk !== undefined) {
      const buffer =
        typeof chunk === "string"
          ? Buffer.from(
              chunk,
              (typeof encoding === "string"
                ? encoding
                : "utf8") as BufferEncoding,
            )
          : Buffer.from(chunk);
      bodyChunks.push(buffer);
    }
    return originalWrite(chunk, encoding, cb);
  }) as any;

  const originalEnd = res.end.bind(res);
  res.end = ((chunk?: any, encoding?: any, cb?: any) => {
    if (chunk !== undefined) {
      const buffer =
        typeof chunk === "string"
          ? Buffer.from(
              chunk,
              (typeof encoding === "string"
                ? encoding
                : "utf8") as BufferEncoding,
            )
          : Buffer.from(chunk);
      bodyChunks.push(buffer);
    }
    return originalEnd(chunk, encoding, cb);
  }) as any;

  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      const label = params.label ? `${params.label} ` : "";
      reject(
        new Error(`${label}Request timed out: ${params.method} ${params.url}`),
      );
    }, 2000);
    res.once("finish", () => {
      clearTimeout(timeout);
      resolve({
        status: res.statusCode,
        body: Buffer.concat(bodyChunks as Uint8Array[]).toString("utf8"),
      });
    });

    try {
      // Express internal handle method exists at runtime but not in types
      (
        app as unknown as {
          handle: (req: http.IncomingMessage, res: http.ServerResponse) => void;
        }
      ).handle(req, res);
      process.nextTick(() => {
        if (bodyText !== undefined) {
          req.emit("data", Buffer.from(bodyText, "utf8"));
        }
        (req as any).complete = true;
        req.emit("end");
      });
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}

describe("durable: dashboard middleware (e2e)", () => {
  it("serves index.html with injected base href and serves static assets", async () => {
    const ui = await createTempUiDist();

    const store = new MemoryStore();
    const operator = new DurableOperator(store);
    const service = createUnusedService();

    const app = express();
    app.use(
      "/ops/durable-dashboard",
      createDashboardMiddleware(service, operator, { uiDistPath: ui.path }),
    );

    try {
      const rootRes = await request(app, {
        method: "GET",
        url: "/ops/durable-dashboard/",
      });
      expect(rootRes.status).toBe(200);
      const rootHtml = rootRes.body;
      expect(rootHtml).toContain('<base href="/ops/durable-dashboard/">');
      expect(rootHtml).toContain("<title>Test Dashboard</title>");

      const deepLinkRes = await request(app, {
        method: "GET",
        url: "/ops/durable-dashboard/executions/e1",
      });
      expect(deepLinkRes.status).toBe(200);
      const deepLinkHtml = deepLinkRes.body;
      expect(deepLinkHtml).toContain('<base href="/ops/durable-dashboard/">');

      const assetRes = await request(app, {
        method: "GET",
        url: "/ops/durable-dashboard/assets/health.txt",
      });
      expect(assetRes.status).toBe(200);
      expect(assetRes.body).toBe("ok");
    } finally {
      await ui.cleanup();
    }
  });

  it("blocks operator actions when operator auth is not configured", async () => {
    const ui = await createTempUiDist();

    const store = new MemoryStore();
    const operator = new DurableOperator(store);
    const service = createUnusedService();

    const app = express();
    app.use(
      "/durable-dashboard",
      createDashboardMiddleware(service, operator, { uiDistPath: ui.path }),
    );

    try {
      const retryRes = await request(app, {
        method: "POST",
        url: "/durable-dashboard/api/operator/retryRollback",
        body: { executionId: "e1" },
      });
      expect(retryRes.status).toBe(403);
    } finally {
      await ui.cleanup();
    }
  });

  it("exposes dashboard APIs and operator actions under the mounted prefix", async () => {
    const ui = await createTempUiDist();

    const store = new MemoryStore();
    const operator = new DurableOperator(store);
    const service = createUnusedService();

    await store.saveExecution({
      id: "e1",
      taskId: "t1",
      input: undefined,
      status: "pending",
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    });

    await store.saveExecution({
      id: "e2",
      taskId: "t2",
      input: undefined,
      status: "compensation_failed",
      error: { message: "boom" },
      attempt: 1,
      maxAttempts: 1,
      createdAt: new Date("2024-01-02T00:00:00.000Z"),
      updatedAt: new Date("2024-01-02T00:00:00.000Z"),
    });

    const app = express();
    app.use(
      "/durable-dashboard",
      createDashboardMiddleware(service, operator, {
        uiDistPath: ui.path,
        operatorAuth: () => true,
      }),
    );

    try {
      const listRes = await request(app, {
        method: "GET",
        url: "/durable-dashboard/api/executions",
      });
      expect(listRes.status).toBe(200);
      const list = JSON.parse(listRes.body) as Array<{ id: string }>;
      expect(list.map((e) => e.id)).toEqual(["e2", "e1"]);

      const missingRes = await request(app, {
        method: "GET",
        url: "/durable-dashboard/api/executions/missing",
      });
      expect(missingRes.status).toBe(404);

      const retryRes = await request(app, {
        method: "POST",
        url: "/durable-dashboard/api/operator/retryRollback",
        body: { executionId: "e2" },
      });
      expect(retryRes.status).toBe(200);
      expect((await store.getExecution("e2"))?.status).toBe("pending");
      expect((await store.getExecution("e2"))?.error).toBeUndefined();

      const forceFailRes = await request(app, {
        method: "POST",
        url: "/durable-dashboard/api/operator/forceFail",
        body: { executionId: "e1", reason: "manual" },
      });
      expect(forceFailRes.status).toBe(200);
      expect((await store.getExecution("e1"))?.status).toBe("failed");
      expect((await store.getExecution("e1"))?.error?.message).toBe("manual");
    } finally {
      await ui.cleanup();
    }
  });
});
