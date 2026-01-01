import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AddressInfo } from "node:net";

import type { Express } from "express";
import express = require("express");

import type { IDurableService } from "../core/interfaces/service";
import { MemoryStore } from "../store/MemoryStore";
import { DurableOperator } from "../core/DurableOperator";
import { createDashboardMiddleware } from "../dashboard/server";

function createUnusedService(): IDurableService {
  const unused = (): never => {
    throw new Error("Not used by createDashboardMiddleware");
  };

  return {
    startExecution: async () => unused(),
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
  };
}

async function createTempUiDist(): Promise<{ path: string; cleanup: () => Promise<void> }> {
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
      "    <meta charset=\"UTF-8\" />",
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

async function startServer(app: Express): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  return await new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected server to be listening on a TCP port");
      }

      const port = (address as AddressInfo).port;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: async () =>
          await new Promise<void>((done) => server.close(() => done())),
      });
    });
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

    const server = await startServer(app);
    try {
      const rootRes = await fetch(`${server.baseUrl}/ops/durable-dashboard/`);
      expect(rootRes.status).toBe(200);
      const rootHtml = await rootRes.text();
      expect(rootHtml).toContain('<base href="/ops/durable-dashboard/">');
      expect(rootHtml).toContain("<title>Test Dashboard</title>");

      const deepLinkRes = await fetch(
        `${server.baseUrl}/ops/durable-dashboard/executions/e1`,
      );
      expect(deepLinkRes.status).toBe(200);
      const deepLinkHtml = await deepLinkRes.text();
      expect(deepLinkHtml).toContain('<base href="/ops/durable-dashboard/">');

      const assetRes = await fetch(
        `${server.baseUrl}/ops/durable-dashboard/assets/health.txt`,
      );
      expect(assetRes.status).toBe(200);
      expect(await assetRes.text()).toBe("ok");
    } finally {
      await server.close();
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
      createDashboardMiddleware(service, operator, { uiDistPath: ui.path }),
    );

    const server = await startServer(app);
    try {
      const listRes = await fetch(`${server.baseUrl}/durable-dashboard/api/executions`);
      expect(listRes.status).toBe(200);
      const list = (await listRes.json()) as Array<{ id: string }>;
      expect(list.map((e) => e.id)).toEqual(["e2", "e1"]);

      const missingRes = await fetch(
        `${server.baseUrl}/durable-dashboard/api/executions/missing`,
      );
      expect(missingRes.status).toBe(404);

      const retryRes = await fetch(
        `${server.baseUrl}/durable-dashboard/api/operator/retryRollback`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ executionId: "e2" }),
        },
      );
      expect(retryRes.status).toBe(200);
      expect((await store.getExecution("e2"))?.status).toBe("pending");
      expect((await store.getExecution("e2"))?.error).toBeUndefined();

      const forceFailRes = await fetch(
        `${server.baseUrl}/durable-dashboard/api/operator/forceFail`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ executionId: "e1", reason: "manual" }),
        },
      );
      expect(forceFailRes.status).toBe(200);
      expect((await store.getExecution("e1"))?.status).toBe("failed");
      expect((await store.getExecution("e1"))?.error?.message).toBe("manual");
    } finally {
      await server.close();
      await ui.cleanup();
    }
  });
});
