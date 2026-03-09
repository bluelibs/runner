import express from "express";
import http from "http";
import { r } from "@bluelibs/runner";

import { assertAdminSecret } from "../app/budget/budget-ledger.resource";
import {
  registerTaggedHttpRoutes,
  type TaggedTaskRoute,
} from "../app/http/http-router.resource";
import {
  buildBoundHttpBaseUrl,
  buildHttpExampleUrls,
  logHttpServerReady,
  registerExplicitHttpRoutes,
  registerHttpErrorHandler,
} from "../app/http/http.resource";
import {
  estimateProjectedCostUsd,
  prepareQueryRequest,
} from "../app/http/query-request";

const healthTask = r.task("healthRouteTest").run(async () => undefined).build();
const budgetTask = r.task("budgetRouteTest").run(async () => undefined).build();
const stopTask = r.task("stopRouteTest").run(async () => undefined).build();
const resumeTask = r.task("resumeRouteTest").run(async () => undefined).build();

describe("ask-runner http", () => {
  function createTaggedRoutes(): TaggedTaskRoute[] {
    return [
      {
        definition: healthTask,
        config: {
          method: "get",
          path: "/health",
          responseType: "json",
          inputFrom: "none",
        },
      },
      {
        definition: budgetTask,
        config: {
          method: "get",
          path: "/admin/budget",
          responseType: "json",
          inputFrom: "none",
          admin: true,
        },
      },
      {
        definition: stopTask,
        config: {
          method: "post",
          path: "/admin/stop-for-day",
          responseType: "json",
          inputFrom: "body",
          admin: true,
        },
      },
      {
        definition: resumeTask,
        config: {
          method: "post",
          path: "/admin/resume",
          responseType: "json",
          inputFrom: "none",
          admin: true,
        },
      },
    ];
  }

  function createApp(overrides?: {
    runAskRunnerTask?: (input: { query: string; ip: string }) => Promise<{
      markdown: string;
      model: string;
      usage: { input_tokens?: number; output_tokens?: number } | null;
    }>;
    runStreamAskRunnerTask?: (input: {
      query: string;
      ip: string;
      writer: { write(chunk: string): Promise<void> };
    }) => Promise<{
      model: string;
      usage: { input_tokens?: number; output_tokens?: number } | null;
    }>;
    runHealthTask?: () => Promise<unknown>;
    runBudgetSnapshotTask?: (input: unknown) => Promise<unknown>;
    runStopBudgetForDayTask?: (input: { reason?: string }) => Promise<unknown>;
    runResumeBudgetTask?: (input: unknown) => Promise<unknown>;
  }) {
    const app = express();
    app.set("trust proxy", true);
    app.use(express.json());

    const runHealthTask =
      overrides?.runHealthTask ??
      (async () => ({
        status: "ok" as const,
        budget: {
          day: "2026-03-09",
          spentUsd: 0,
          requestCount: 0,
          stopped: false,
          stopReason: null,
          remainingUsd: 1,
        },
        state: {
          storage: "memory" as const,
          durable: false as const,
          note: "Budget, rate-limit, and admin stop state reset when the process restarts.",
        },
      }));
    const runBudgetSnapshotTask =
      overrides?.runBudgetSnapshotTask ??
      (async () => ({
        day: "2026-03-09",
        spentUsd: 0,
        requestCount: 0,
        stopped: false,
        stopReason: null,
        remainingUsd: 1,
      }));
    const runStopBudgetForDayTask =
      overrides?.runStopBudgetForDayTask ??
      (async ({ reason }: { reason?: string }) => ({
        day: "2026-03-09",
        spentUsd: 0,
        requestCount: 0,
        stopped: true,
        stopReason: reason?.trim() || "Stopped manually.",
        remainingUsd: 1,
      }));
    const runResumeBudgetTask =
      overrides?.runResumeBudgetTask ??
      (async () => ({
        day: "2026-03-09",
        spentUsd: 0,
        requestCount: 0,
        stopped: false,
        stopReason: null,
        remainingUsd: 1,
      }));

    registerExplicitHttpRoutes(app, {
      runAskRunnerTask:
        overrides?.runAskRunnerTask ??
        (async ({ query }) => ({
          markdown: `# ${query}`,
          model: "gpt-5-mini",
          usage: { input_tokens: 100, output_tokens: 50 },
        })),
      runStreamAskRunnerTask:
        overrides?.runStreamAskRunnerTask ??
        (async ({ query, writer }) => {
          await writer.write(`# ${query}`);
          await writer.write("\n\nstream");
          return {
            model: "gpt-5-mini",
            usage: { input_tokens: 100, output_tokens: 50 },
          };
        }),
    });

    const taskRunner = {
      run: jest.fn(async (task: unknown, input: unknown) => {
        if (task === healthTask) {
          return runHealthTask();
        }

        if (task === budgetTask) {
          return runBudgetSnapshotTask(input);
        }

        if (task === stopTask) {
          return runStopBudgetForDayTask(input as { reason?: string });
        }

        if (task === resumeTask) {
          return runResumeBudgetTask(input);
        }

        throw new Error("Unexpected task route.");
      }),
    };

    registerTaggedHttpRoutes({
      adminSecret: "top-secret",
      app,
      routes: createTaggedRoutes(),
      taskRunner,
    });
    registerHttpErrorHandler(app);

    return { app, taskRunner };
  }

  async function request(
    app: express.Express,
    input: {
      method: "GET" | "POST";
      path: string;
      headers?: Record<string, string>;
      body?: unknown;
    },
  ) {
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected an ephemeral HTTP port.");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}${input.path}`, {
      method: input.method,
      headers: input.headers,
      body: input.body ? JSON.stringify(input.body) : undefined,
    });
    const text = await response.text();

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    return {
      headers: response.headers,
      status: response.status,
      text,
    };
  }

  test("query route passes parsed input to the task", async () => {
    const runAskRunnerTask = jest.fn(async ({ query }: { query: string; ip: string }) => ({
      markdown: `# ${query}`,
      model: "gpt-5-mini",
      usage: { input_tokens: 100, output_tokens: 50 },
    }));

    const { app } = createApp({ runAskRunnerTask });
    const response = await request(app, {
      method: "GET",
      path: "/?query=lifecycle",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.text).toBe("# lifecycle");
    expect(runAskRunnerTask).toHaveBeenCalledWith({
      query: "lifecycle",
      ip: "127.0.0.1",
    });
  });

  test("stream route passes parsed input and writer to the task", async () => {
    const runStreamAskRunnerTask = jest.fn(
      async ({
        query,
        writer,
      }: {
        query: string;
        ip: string;
        writer: { write(chunk: string): Promise<void> };
      }) => {
        await writer.write(`# ${query}`);
        await writer.write("\n\nstream");
        return {
          model: "gpt-5-mini",
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      },
    );

    const { app } = createApp({ runStreamAskRunnerTask });
    const response = await request(app, {
      method: "GET",
      path: "/stream?query=lifecycle",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.text).toBe("# lifecycle\n\nstream");
    expect(runStreamAskRunnerTask).toHaveBeenCalled();
  });

  test("stream html route returns a static viewer shell", async () => {
    const { app } = createApp();
    const response = await request(app, {
      method: "GET",
      path: "/stream-html?query=lifecycle",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'unsafe-inline' https://cdn.jsdelivr.net");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.text).toContain("Ask Runner Stream Viewer");
    expect(response.text).toContain("https://cdn.jsdelivr.net/npm/marked@");
    expect(response.text).toContain("https://cdn.jsdelivr.net/npm/dompurify@");
    expect(response.text).toContain('integrity="sha384-');
    expect(response.text).toContain('crossorigin="anonymous"');
    expect(response.text).toContain('fetch("/stream?query=" + encodeURIComponent(query)');
    expect(response.text).toContain('new URLSearchParams(window.location.search)');
  });

  test("query request uses req.ip instead of manually trusting x-forwarded-for", () => {
    const prepared = prepareQueryRequest({
      query: { query: "lifecycle" },
      ip: "10.0.0.5",
      headers: { "x-forwarded-for": "203.0.113.10" },
      socket: { remoteAddress: "127.0.0.1" },
    } as any);

    expect(prepared).toEqual({
      query: "lifecycle",
      ip: "10.0.0.5",
    });
  });

  test("health route returns health task payload through the tagged router", async () => {
    const runHealthTask = jest.fn(async () => ({
      status: "ok" as const,
      budget: {
        day: "2026-03-09",
        spentUsd: 0,
        requestCount: 0,
        stopped: false,
        stopReason: null,
        remainingUsd: 1,
      },
      state: {
        storage: "memory" as const,
        durable: false as const,
        note: "Budget, rate-limit, and admin stop state reset when the process restarts.",
      },
    }));

    const { app, taskRunner } = createApp({ runHealthTask });
    const response = await request(app, {
      method: "GET",
      path: "/health",
    });

    expect(response.status).toBe(200);
    expect(taskRunner.run).toHaveBeenCalledWith(healthTask, {});
    expect(JSON.parse(response.text)).toEqual(await runHealthTask.mock.results[0]?.value);
  });

  test("admin budget route runs budget snapshot task after auth", async () => {
    const runBudgetSnapshotTask = jest.fn(async () => ({
      day: "2026-03-09",
      spentUsd: 0,
      requestCount: 0,
      stopped: false,
      stopReason: null,
      remainingUsd: 1,
    }));

    const { app, taskRunner } = createApp({ runBudgetSnapshotTask });
    const response = await request(app, {
      method: "GET",
      path: "/admin/budget",
      headers: { "x-admin-secret": "top-secret" },
    });

    expect(response.status).toBe(200);
    expect(taskRunner.run).toHaveBeenCalledWith(budgetTask, {});
    expect(JSON.parse(response.text).day).toBe("2026-03-09");
  });

  test("admin stop route runs stop task with default reason", async () => {
    const runStopBudgetForDayTask = jest.fn(async ({ reason }: { reason?: string }) => ({
      day: "2026-03-09",
      spentUsd: 0,
      requestCount: 0,
      stopped: true,
      stopReason: reason?.trim() || "Stopped manually.",
      remainingUsd: 1,
    }));

    const { app, taskRunner } = createApp({ runStopBudgetForDayTask });
    const response = await request(app, {
      method: "POST",
      path: "/admin/stop-for-day",
      headers: {
        "content-type": "application/json",
        "x-admin-secret": "top-secret",
      },
      body: {},
    });

    expect(response.status).toBe(200);
    expect(taskRunner.run).toHaveBeenCalledWith(stopTask, {});
    expect(JSON.parse(response.text).stopReason).toBe("Stopped manually.");
  });

  test("admin resume route runs resume task after auth", async () => {
    const runResumeBudgetTask = jest.fn(async () => ({
      day: "2026-03-09",
      spentUsd: 0,
      requestCount: 0,
      stopped: false,
      stopReason: null,
      remainingUsd: 1,
    }));

    const { app, taskRunner } = createApp({ runResumeBudgetTask });
    const response = await request(app, {
      method: "POST",
      path: "/admin/resume",
      headers: {
        "content-type": "application/json",
        "x-admin-secret": "top-secret",
      },
      body: {},
    });

    expect(response.status).toBe(200);
    expect(taskRunner.run).toHaveBeenCalledWith(resumeTask, {});
  });

  test("admin routes fail before task execution when the secret is invalid", async () => {
    const { app, taskRunner } = createApp();
    const response = await request(app, {
      method: "GET",
      path: "/admin/budget",
    });

    expect(response.status).toBe(401);
    expect(taskRunner.run).not.toHaveBeenCalled();
    expect(JSON.parse(response.text)).toEqual({ error: "Invalid admin secret." });
  });

  test("admin secret validation fails fast", () => {
    expect(() => assertAdminSecret(undefined, "top-secret")).toThrow(/Invalid admin secret/);
  });

  test("projected cost includes docs and output allowance", () => {
    const small = estimateProjectedCostUsd(
      "short docs",
      "hi",
      100,
      4,
      { inputPer1M: 1, cachedInputPer1M: 0.1, outputPer1M: 1 },
    );
    const large = estimateProjectedCostUsd(
      "very long docs ".repeat(100),
      "hi",
      100,
      4,
      { inputPer1M: 1, cachedInputPer1M: 0.1, outputPer1M: 1 },
    );

    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(small);
  });

  test("startup logging includes clickable localhost examples", async () => {
    const logger = {
      info: jest.fn(),
    };

    await logHttpServerReady(logger, {
      host: "127.0.0.1",
      port: 3000,
    });

    expect(buildBoundHttpBaseUrl({ host: "127.0.0.1", port: 3000 })).toBe("http://127.0.0.1:3000");
    expect(buildHttpExampleUrls(3000)).toEqual([
      "http://localhost:3000/?query=xxx",
      "http://localhost:3000/stream?query=xxx",
      "http://localhost:3000/stream-html?query=xxx",
    ]);
    expect(logger.info).toHaveBeenNthCalledWith(
      1,
      "Ask Runner is listening on http://127.0.0.1:3000.",
    );
    expect(logger.info).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3000/?query=xxx",
    );
    expect(logger.info).toHaveBeenNthCalledWith(
      3,
      "http://localhost:3000/stream?query=xxx",
    );
    expect(logger.info).toHaveBeenNthCalledWith(
      4,
      "http://localhost:3000/stream-html?query=xxx",
    );
  });
});
