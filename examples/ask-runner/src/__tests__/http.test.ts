import type { Request, Response } from "express";

import { assertAdminSecret, type BudgetLedger } from "../app/budget/budget-ledger.resource";
import {
  estimateProjectedCostUsd,
  handleQueryRequest,
  handleStreamQueryRequest,
} from "../app/http/http.resource";

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

  function createResponse() {
    const response = {
      statusCode: 200,
      body: undefined as unknown,
      contentType: undefined as string | undefined,
      headers: {} as Record<string, string>,
      chunks: [] as string[],
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
      type(value: string) {
        this.contentType = value;
        return this;
      },
      setHeader(name: string, value: string) {
        this.headers[name] = value;
        return this;
      },
      write(payload: string, callback?: (error?: Error | null) => void) {
        this.chunks.push(payload);
        if (callback) {
          callback(null);
        }
        return true;
      },
      send(payload: unknown) {
        this.body = payload;
        return this;
      },
      end(payload?: string) {
        if (payload) {
          this.chunks.push(payload);
        }
        this.body = this.chunks.join("");
        return this;
      },
    };

    return response as unknown as Response & {
      statusCode: number;
      body: unknown;
      contentType?: string;
      headers: Record<string, string>;
      chunks: string[];
    };
  }

  function createRequest(query: string, ip: string = "127.0.0.1") {
    return {
      query: { query },
      headers: {},
      ip,
      socket: { remoteAddress: ip },
      header: jest.fn(() => undefined),
    } as unknown as Request;
  }

  test("handler returns markdown", async () => {
    const ledger = createLedger();
    const response = createResponse();

    await handleQueryRequest(createRequest("lifecycle"), response, {
      appConfig: {
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
      budgetLedger: ledger,
      runTask: async ({ query }) => ({
        markdown: `# ${query}`,
        model: "gpt-5-mini",
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.contentType).toBe("text/markdown; charset=utf-8");
    expect(response.body).toBe("# lifecycle");
    expect(ledger.recordUsage).toHaveBeenCalled();
  });

  test("stream handler writes markdown chunks and records final usage", async () => {
    const ledger = createLedger();
    const response = createResponse();

    await handleStreamQueryRequest(createRequest("lifecycle"), response, {
      appConfig: {
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
      budgetLedger: ledger,
      runStreamTask: async ({ query, writer }) => {
        await writer.write(`# ${query}`);
        await writer.write("\n\nstream");
        return {
          model: "gpt-5-mini",
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["Content-Type"]).toBe("text/markdown; charset=utf-8");
    expect(response.body).toBe("# lifecycle\n\nstream");
    expect(ledger.recordUsage).toHaveBeenCalled();
  });

  test("stream handler rejects empty queries before opening the stream", async () => {
    const response = createResponse();

    await handleStreamQueryRequest(createRequest(""), response, {
      appConfig: {
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
      budgetLedger: createLedger(),
      runStreamTask: async () => ({
        model: "gpt-5-mini",
        usage: null,
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: "Query must not be empty." });
  });

  test("handler rejects empty queries", async () => {
    const response = createResponse();

    await handleQueryRequest(createRequest(""), response, {
      appConfig: {
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
      budgetLedger: createLedger(),
      runTask: async () => ({
        markdown: "# ignored",
        model: "gpt-5-mini",
        usage: null,
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: "Query must not be empty." });
  });

  test("handler rejects oversized queries", async () => {
    const response = createResponse();

    await handleQueryRequest(createRequest("this query is too long"), response, {
      appConfig: {
        trustProxy: true,
        maxInputChars: 5,
        maxOutputTokens: 300,
        tokenCharsEstimate: 4,
        pricing: { inputPer1M: 0.25, cachedInputPer1M: 0.025, outputPer1M: 2 },
        model: "gpt-5-mini",
      },
      aiDocsPrompt: {
        content: "Runner docs",
        version: "v1",
      },
      budgetLedger: createLedger(),
      runTask: async () => ({
        markdown: "# ignored",
        model: "gpt-5-mini",
        usage: null,
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: "Query exceeds 5 characters." });
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
