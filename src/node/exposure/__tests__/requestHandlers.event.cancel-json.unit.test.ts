import { Readable } from "stream";
import type { IncomingMessage, ServerResponse } from "http";
import { createRequestHandlers } from "../requestHandlers";

jest.mock("../requestBody", () => ({
  readJsonBody: async () => {
    const { cancellationError } = require("../../../errors");
    try {
      cancellationError.throw({ reason: "Client Closed Request" });
    } catch (e) {
      throw e;
    }
  },
}));

function makeReq(eventId: string): IncomingMessage {
  const r: any = new Readable({
    read() {
      this.push(null);
    },
  });
  r.method = "POST";
  r.url = "/api/event/" + encodeURIComponent(eventId);
  r.headers = { "content-type": "application/json" };
  r.once = (event: string, _cb: Function) => r;
  r.on = (event: string, _cb: Function) => r;
  return r as unknown as IncomingMessage;
}

function makeRes(): ServerResponse & { _status?: number; _buf?: Buffer } {
  const res: any = {
    statusCode: 0,
    setHeader() {},
    once(_e: string, cb: Function) {
      if (_e === "close") setImmediate(() => cb());
      return this;
    },
    on() {
      return this;
    },
    end(buf?: any) {
      this._status = this.statusCode;
      if (buf)
        this._buf = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
    },
  };
  return res as any;
}

describe("requestHandlers - event json cancel (mocked)", () => {
  it("responds 499 when readJsonBody rejects with CancellationError (event)", async () => {
    const store: any = {
      events: new Map([["e.id", { event: { id: "e.id" } }]]),
    };
    const deps: any = {
      store,
      taskRunner: {} as any,
      eventManager: { emit: async () => {} },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      authenticator: () => ({ ok: true }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      router: {
        basePath: "/api",
        extract: (_p: string) => ({ kind: "event", id: "e.id" }),
        isUnderBase: () => true,
      },
      cors: undefined,
    };

    const { handleEvent } = createRequestHandlers(deps);
    const req = makeReq("e.id");
    const res = makeRes();
    await handleEvent(req, res);
    expect((res as any)._status).toBe(499);
    const json = (res as any)._buf
      ? JSON.parse(((res as any)._buf as Buffer).toString("utf8"))
      : undefined;
    expect(json?.error?.code).toBe("REQUEST_ABORTED");
  });
});
