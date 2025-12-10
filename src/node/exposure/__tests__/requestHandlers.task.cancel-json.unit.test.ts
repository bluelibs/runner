import { Readable } from "stream";
import type { IncomingMessage, ServerResponse } from "http";
import { createRequestHandlers } from "../requestHandlers";
import { cancellationError } from "../../../errors";

jest.mock("../requestBody", () => ({
  readJsonBody: async () => {
    try {
      cancellationError.throw({ reason: "Client Closed Request" });
    } catch (e) {
      throw e;
    }
  },
}));

function makeReq(taskId: string): IncomingMessage {
  const r: any = new Readable({
    read() {
      // no data; cancellation is simulated by mocked readJsonBody
      this.push(null);
    },
  });
  r.method = "POST";
  r.url = "/api/task/" + encodeURIComponent(taskId);
  r.headers = { "content-type": "application/json" };
  // Provide once/on for aborted listener wiring (not used by mock)
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

describe("requestHandlers - task json cancel (mocked)", () => {
  it("responds 499 when readJsonBody rejects with CancellationError", async () => {
    const store: any = { tasks: new Map([["t.id", { task: async () => 1 }]]) };
    const deps: any = {
      store,
      taskRunner: { run: async () => 1 },
      eventManager: {} as any,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      authenticator: async () => ({ ok: true }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      router: {
        basePath: "/api",
        extract: (p: string) => ({ kind: "task", id: "t.id" }),
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
