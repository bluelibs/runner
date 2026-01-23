import { Readable } from "stream";
import type { IncomingMessage, ServerResponse } from "http";
import { createRequestHandlers } from "../../exposure/requestHandlers";
import * as requestBody from "../../exposure/requestBody";

function makeReq(taskId: string): IncomingMessage {
  const r: any = new Readable({
    read() {
      this.push(null);
    },
  });
  r.method = "POST";
  r.url = "/api/task/" + encodeURIComponent(taskId);
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

describe("requestHandlers - task json cancel", () => {
  beforeEach(() => {
    jest
      .spyOn(requestBody, "readJsonBody")
      .mockImplementation(async () => {
        const { cancellationError } = require("../../../errors");
        try {
          cancellationError.throw({ reason: "Client Closed Request" });
        } catch (e) {
          throw e;
        }
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("responds 499 when readJsonBody rejects with CancellationError (task)", async () => {
    const deps: any = {
      store: { tasks: new Map([["t.id", { task: { id: "t.id" } }]]) },
      taskRunner: { run: async () => {} },
      eventManager: { emit: async () => {} },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      authenticator: async () => ({ ok: true }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      router: {
        basePath: "/api",
        extract: (_p: string) => ({ kind: "task", id: "t.id" }),
        isUnderBase: () => true,
      },
      cors: undefined,
    };

    const { handleTask } = createRequestHandlers(deps);
    const req = makeReq("t.id");
    const res = makeRes();
    await handleTask(req, res);
    expect((res as any)._status).toBe(499);
    const json = (res as any)._buf
      ? JSON.parse(((res as any)._buf as Buffer).toString("utf8"))
      : undefined;
    expect(json?.error?.code).toBe("REQUEST_ABORTED");
  });
});
