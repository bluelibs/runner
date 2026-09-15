import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createStudioServer, type StudioServerOptions } from "./server/http.js";
import { createTestStudio, type StudioTestClient } from "./studio.test-support.js";

type Listener = (request: unknown, response: unknown) => unknown;

interface CapturedResponse {
  status: number;
  headers: Record<string, unknown>;
  chunks: string[];
  ended: boolean;
  response: unknown;
}

function mockRequest(options: {
  method: string;
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}): Readable & { url: string; method: string; headers: Record<string, string> } {
  const stream =
    options.body === undefined
      ? new Readable({ read() {} })
      : Readable.from([JSON.stringify(options.body)]);
  return Object.assign(stream, {
    url: options.url,
    method: options.method,
    headers: options.headers ?? {},
  });
}

function mockResponse(): CapturedResponse {
  const captured: CapturedResponse = {
    status: 0,
    headers: {},
    chunks: [],
    ended: false,
    response: undefined,
  };
  captured.response = {
    writeHead: (status: number, headers: Record<string, unknown>) => {
      captured.status = status;
      captured.headers = headers;
    },
    write: (chunk: string) => {
      captured.chunks.push(chunk);
    },
    end: (data?: string) => {
      if (data !== undefined) captured.chunks.push(data);
      captured.ended = true;
    },
  };
  return captured;
}

async function withStudio(
  fn: (client: StudioTestClient, listener: Listener) => Promise<void>,
  options?: StudioServerOptions,
): Promise<void> {
  const client = await createTestStudio();
  try {
    const server = createStudioServer(client.handles, options);
    const listener = server.listeners("request")[0] as Listener;
    await fn(client, listener);
  } finally {
    await client.dispose();
  }
}

test("transport parses JSON bodies through the real listener", async () => {
  await withStudio(async (_client, listener) => {
    const request = mockRequest({
      method: "POST",
      url: "/api/executions",
      body: {
        workflow: "processOrder",
        input: { orderId: "ORD-T", customerId: "C", amount: 1 },
      },
    });
    const captured = mockResponse();
    await listener(request, captured.response);
    assert.equal(captured.status, 201);
    const payload = JSON.parse(captured.chunks.join("")) as {
      executionId: string;
    };
    assert.ok(payload.executionId.length > 0);
  });
});

test("transport parses PATCH bodies when editing schedules", async () => {
  await withStudio(async (client, listener) => {
    const created = await client.post<{ scheduleId: string }>("/api/schedules", {
      workflow: "processOrder",
      input: { orderId: "ORD-PATCH", customerId: "C", amount: 1 },
      id: "patch-schedule",
      interval: 1_000,
    });
    assert.equal(created.status, 201);

    const request = mockRequest({
      method: "PATCH",
      url: `/api/schedules/${created.body.scheduleId}`,
      body: { interval: 2_000 },
    });
    const captured = mockResponse();
    await listener(request, captured.response);
    assert.equal(captured.status, 202);

    const schedules = await client.get<{
      schedules: Array<{ id: string; pattern: string }>;
    }>("/api/schedules");
    assert.equal(
      schedules.body.schedules.find(
        (schedule) => schedule.id === created.body.scheduleId,
      )?.pattern,
      "2000",
    );
  });
});

test("transport answers unknown API routes with JSON 404", async () => {
  await withStudio(async (_client, listener) => {
    const request = mockRequest({ method: "GET", url: "/api/nope" });
    const captured = mockResponse();
    await listener(request, captured.response);
    assert.equal(captured.status, 404);
    assert.equal(captured.headers["content-type"], "application/json");
  });
});

test("transport streams execution detail over SSE", async () => {
  await withStudio(async (client, listener) => {
    const started = await client.post<{ executionId: string }>("/api/executions", {
      workflow: "processOrder",
      input: {
        orderId: "ORD-SSE",
        customerId: "C",
        amount: 1,
        processingDelayMs: 5000,
      },
    });
    const executionId = started.body.executionId;

    const request = mockRequest({
      method: "GET",
      url: `/api/executions/${executionId}/stream`,
    });
    const captured = mockResponse();
    await listener(request, captured.response);
    assert.equal(captured.status, 200);
    assert.equal(captured.headers["content-type"], "text/event-stream");

    await new Promise((resolve) => setTimeout(resolve, 1200));
    const text = captured.chunks.join("");
    assert.ok(text.includes("event: detail"), "emits detail events");
    assert.ok(text.includes(executionId), "payload carries the execution");

    request.emit("close");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(captured.ended, true);
  });
});

test("token gate rejects API calls without a token, allows health", async () => {
  await withStudio(
    async (_client, listener) => {
      const denied = mockResponse();
      await listener(
        mockRequest({ method: "GET", url: "/api/workflows" }),
        denied.response,
      );
      assert.equal(denied.status, 401);
      assert.equal(
        (JSON.parse(denied.chunks.join("")) as { error: string }).error.length > 0,
        true,
      );

      const wrong = mockResponse();
      await listener(
        mockRequest({
          method: "GET",
          url: "/api/workflows",
          headers: { authorization: "Bearer nope" },
        }),
        wrong.response,
      );
      assert.equal(wrong.status, 401);

      const health = mockResponse();
      await listener(
        mockRequest({ method: "GET", url: "/api/health" }),
        health.response,
      );
      assert.equal(health.status, 200);
    },
    { token: "secret" },
  );
});

test("token gate accepts the bearer header and the SSE query fallback", async () => {
  await withStudio(
    async (client, listener) => {
      const allowed = mockResponse();
      await listener(
        mockRequest({
          method: "GET",
          url: "/api/workflows",
          headers: { authorization: "Bearer secret" },
        }),
        allowed.response,
      );
      assert.equal(allowed.status, 200);

      const started = await client.post<{ executionId: string }>("/api/executions", {
        workflow: "processOrder",
        input: {
          orderId: "ORD-AUTH",
          customerId: "C",
          amount: 1,
          processingDelayMs: 5000,
        },
      });

      const streamDenied = mockResponse();
      await listener(
        mockRequest({
          method: "GET",
          url: `/api/executions/${started.body.executionId}/stream`,
        }),
        streamDenied.response,
      );
      assert.equal(streamDenied.status, 401);

      const streamRequest = mockRequest({
        method: "GET",
        url: `/api/executions/${started.body.executionId}/stream?token=secret`,
      });
      const streamAllowed = mockResponse();
      await listener(streamRequest, streamAllowed.response);
      assert.equal(streamAllowed.status, 200);
      assert.equal(streamAllowed.headers["content-type"], "text/event-stream");
      await new Promise((resolve) => setTimeout(resolve, 1200));
      assert.ok(streamAllowed.chunks.join("").includes("event: detail"));
      streamRequest.emit("close");
      await new Promise((resolve) => setTimeout(resolve, 100));
    },
    { token: "secret" },
  );
});

test("transport serves static files and falls back to index", async () => {
  const webDist = join(__dirname, "..", "web", "dist");
  await mkdir(webDist, { recursive: true });
  const probePath = join(webDist, "__studio_probe.txt");
  await writeFile(probePath, "probe-content");
  try {
    await withStudio(async (_client, listener) => {
      const fileRequest = mockRequest({
        method: "GET",
        url: "/__studio_probe.txt",
      });
      const fileCaptured = mockResponse();
      await listener(fileRequest, fileCaptured.response);
      assert.equal(fileCaptured.status, 200);
      assert.equal(fileCaptured.chunks.join(""), "probe-content");

      const deepRequest = mockRequest({ method: "GET", url: "/deep/link" });
      const deepCaptured = mockResponse();
      await listener(deepRequest, deepCaptured.response);
      assert.equal(deepCaptured.status, 200);
      assert.ok(deepCaptured.chunks.join("").length > 0);
    });
  } finally {
    await rm(probePath, { force: true });
  }
});
