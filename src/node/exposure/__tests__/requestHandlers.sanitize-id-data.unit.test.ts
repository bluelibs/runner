/**
 * Tests for sanitizeErrorResponse preserving typed error fields (id, data)
 * while masking sensitive information.
 */
jest.mock("../multipart", () => ({
  isMultipart: () => true,
  parseMultipartInput: async () => ({
    ok: false,
    response: {
      statusCode: 500,
      error: {
        message: "Sensitive internal error message",
        code: "TYPED_ERROR_CODE",
        id: "app.errors.CustomError",
        data: { userId: 123, reason: "quota_exceeded" },
        stack: "at secret.ts:42",
        cause: { sql: "SELECT * FROM passwords" },
      },
    },
  }),
}));

import { Readable } from "stream";
import type { IncomingMessage, ServerResponse } from "http";
import {
  createRequestHandlers,
  type RequestProcessingDeps,
} from "../requestHandlers";
import { getDefaultSerializer } from "../../../serializer";

function makeReq(path: string): IncomingMessage {
  const req: any = new Readable({
    read() {
      this.push(null);
    },
  });
  req.method = "POST";
  req.url = path;
  req.headers = { "content-type": "multipart/form-data; boundary=abc" };
  req.on = () => req;
  req.once = () => req;
  return req as unknown as IncomingMessage;
}

function makeRes(): ServerResponse & { _status?: number; _buf?: Buffer } {
  const res: any = {
    statusCode: 0,
    setHeader() {},
    on() {
      return res;
    },
    once() {
      return res;
    },
    end(buf?: any) {
      this._status = this.statusCode;
      if (buf != null) {
        this._buf = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
      }
    },
  };
  return res as any;
}

describe("requestHandlers - sanitizeErrorResponse preserves id and data fields", () => {
  it("preserves id and data from typed errors while masking message and stripping unsafe fields", async () => {
    const deps = {
      store: {
        tasks: new Map([["t", { task: { id: "t" } }]]),
        errors: new Map(),
        asyncContexts: new Map(),
      },
      taskRunner: { run: async () => 1 },
      eventManager: { emit: async () => undefined },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      authenticator: async () => ({ ok: true as const }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      router: {
        basePath: "/api",
        extract: () => ({ kind: "task", id: "t" }),
        isUnderBase: () => true,
      },
      serializer: getDefaultSerializer(),
    };

    const { handleTask } = createRequestHandlers(
      deps as unknown as RequestProcessingDeps,
    );

    const req = makeReq("/api/task/t");
    const res = makeRes();
    await handleTask(req, res);

    expect((res as any)._status).toBe(500);
    const json = (res as any)._buf
      ? JSON.parse(((res as any)._buf as Buffer).toString("utf8"))
      : undefined;

    expect(json?.ok).toBe(false);

    // Should preserve safe fields for typed errors
    expect(json?.error?.code).toBe("TYPED_ERROR_CODE");
    expect(json?.error?.id).toBe("app.errors.CustomError");
    expect(json?.error?.data).toEqual({
      userId: 123,
      reason: "quota_exceeded",
    });

    // Should mask the message
    expect(json?.error?.message).toBe("Internal Error");

    // Should NOT include sensitive fields
    expect(json?.error?.stack).toBeUndefined();
    expect(json?.error?.cause).toBeUndefined();
  });
});
