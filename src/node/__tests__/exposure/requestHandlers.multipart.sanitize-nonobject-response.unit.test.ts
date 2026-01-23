jest.mock("../../exposure/multipart", () => ({
  isMultipart: () => true,
  parseMultipartInput: async () => ({
    ok: false,
    response: "not-an-object",
  }),
}));

import { Readable } from "stream";
import type { IncomingMessage, ServerResponse } from "http";
import {
  createRequestHandlers,
  type RequestProcessingDeps,
} from "../../exposure/requestHandlers";
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

describe("requestHandlers - multipart sanitizeErrorResponse non-object response", () => {
  it("falls back to a normalized 500 JsonResponse", async () => {
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
    expect(json?.error?.code).toBe("INTERNAL_ERROR");
    expect(json?.error?.message).toBe("Internal Error");
  });
});
