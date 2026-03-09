import http from "http";

import {
  assertAdminSecret,
  type BudgetLedger,
} from "../app/budget/budget-ledger.resource";
import { createHttpApp } from "../app/http/http.resource";
import {
  estimateProjectedCostUsd,
  prepareQueryRequest,
} from "../app/http/query-request";

describe("ask-runner http", () => {
  function createLedger(): BudgetLedger {
    return {
      enforceIpLimit: jest.fn(),
      ensureDayCanSpend: jest.fn(),
      recordUsage: jest.fn(() => ({
        day: "2026-03-09",
        spentUsd: 0.01,
        requestCount: 1,
        stopped: false,
        stopReason: null,
        remainingUsd: 1,
      })),
      stopForDay: jest.fn(() => ({
        day: "2026-03-09",
        spentUsd: 0,
        requestCount: 0,
        stopped: true,
        stopReason: "manual stop",
        remainingUsd: 1,
      })),
      resume: jest.fn(() => ({
        day: "2026-03-09",
        spentUsd: 0,
        requestCount: 0,
        stopped: false,
        stopReason: null,
        remainingUsd: 1,
      })),
      getSnapshot: jest.fn(() => ({
        day: "2026-03-09",
        spentUsd: 0,
        requestCount: 0,
        stopped: false,
        stopReason: null,
        remainingUsd: 1,
      })),
    };
  }

  function createApp(overrides?: Partial<Parameters<typeof createHttpApp>[0]>) {
    const ledger = createLedger();

    const app = createHttpApp({
      appConfig: {
        adminSecret: "top-secret",
        trustProxy: true,
        maxInputChars: 20,
        maxOutputTokens: 300,
        tokenCharsEstimate: 4,
        pricing: { inputPer1M: 0.25, cachedInputPer1M: 0.025, outputPer1M: 2 },
        model: "gpt-5-mini",
      },
      aiDocsPrompt: {
        content: "Runner docs",
        version: "v1",
      },
      runAskRunnerTask: overrides?.runAskRunnerTask ?? (async ({ query }) => ({
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
      runHealthTask:
        overrides?.runHealthTask ??
        (async () => ({
          status: "ok" as const,
          budget: ledger.getSnapshot("2026-03-09"),
          state: {
            storage: "memory" as const,
            durable: false as const,
            note: "Budget, rate-limit, and admin stop state reset when the process restarts.",
          },
        })),
      runBudgetSnapshotTask:
        overrides?.runBudgetSnapshotTask ?? (async () => ledger.getSnapshot("2026-03-09")),
      runStopBudgetForDayTask:
        overrides?.runStopBudgetForDayTask ??
        (async () => ledger.stopForDay("2026-03-09", "Stopped manually.")),
      runResumeBudgetTask:
        overrides?.runResumeBudgetTask ?? (async () => ledger.resume("2026-03-09")),
    });

    return { app };
  }

  async function request(app: ReturnType<typeof createHttpApp>, input: {
    method: "GET" | "POST";
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
  }) {
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
      status: response.status,
      headers: response.headers,
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

  test("query request uses req.ip instead of manually trusting x-forwarded-for", () => {
    const request = prepareQueryRequest({
      query: { query: "lifecycle" },
      ip: "10.0.0.5",
      headers: { "x-forwarded-for": "203.0.113.10" },
      socket: { remoteAddress: "127.0.0.1" },
    } as any);

    expect(request).toEqual({
      query: "lifecycle",
      ip: "10.0.0.5",
    });
  });

  test("health route returns health task payload", async () => {
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

    const { app } = createApp({ runHealthTask });
    const response = await request(app, {
      method: "GET",
      path: "/health",
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.text)).toEqual(await runHealthTask.mock.results[0]?.value);
  });

  test("admin budget route runs budget snapshot task after auth", async () => {
    const runBudgetSnapshotTask = jest.fn(async ({ day }: { day: string }) => ({
      day,
      spentUsd: 0,
      requestCount: 0,
      stopped: false,
      stopReason: null,
      remainingUsd: 1,
    }));

    const { app } = createApp({ runBudgetSnapshotTask });
    const response = await request(app, {
      method: "GET",
      path: "/admin/budget",
      headers: { "x-admin-secret": "top-secret" },
    });

    expect(response.status).toBe(200);
    expect(runBudgetSnapshotTask).toHaveBeenCalled();
    expect(JSON.parse(response.text).day).toBe("2026-03-09");
  });

  test("admin stop route runs stop task with default reason", async () => {
    const runStopBudgetForDayTask = jest.fn(async ({ day, reason }: { day: string; reason: string }) => ({
      day,
      spentUsd: 0,
      requestCount: 0,
      stopped: true,
      stopReason: reason,
      remainingUsd: 1,
    }));

    const { app } = createApp({ runStopBudgetForDayTask });
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
    expect(runStopBudgetForDayTask).toHaveBeenCalledWith({
      day: "2026-03-09",
      reason: "Stopped manually.",
    });
    expect(JSON.parse(response.text).stopReason).toBe("Stopped manually.");
  });

  test("admin resume route runs resume task after auth", async () => {
    const runResumeBudgetTask = jest.fn(async ({ day }: { day: string }) => ({
      day,
      spentUsd: 0,
      requestCount: 0,
      stopped: false,
      stopReason: null,
      remainingUsd: 1,
    }));

    const { app } = createApp({ runResumeBudgetTask });
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
    expect(runResumeBudgetTask).toHaveBeenCalled();
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
});
