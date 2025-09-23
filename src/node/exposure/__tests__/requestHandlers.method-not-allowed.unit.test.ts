import { Readable } from "stream";
import type { IncomingMessage, ServerResponse } from "http";
import { createRequestHandlers } from "../requestHandlers";

function makeReq(path: string, method: string): IncomingMessage {
  const r: any = new Readable({
    read() {
      this.push(null);
    },
  });
  r.method = method;
  r.url = path;
  r.headers = { "content-type": "application/json" };
  r.once = (event: string, _cb: Function) => r;
  r.on = (event: string, _cb: Function) => r;
  return r as unknown as IncomingMessage;
}

function makeRes(): ServerResponse & { _status?: number; _buf?: Buffer } {
  const res: any = {
    statusCode: 0,
    setHeader() {},
    end(buf?: any) {
      this._status = this.statusCode;
      if (buf)
        this._buf = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
    },
  };
  return res as any;
}

describe("requestHandlers - method not allowed", () => {
  it("handleTask responds 405 for non-POST", async () => {
    const deps: any = {
      store: { tasks: new Map([["t.id", { task: async () => 1 }]]) },
      taskRunner: { run: async () => 1 },
      eventManager: {} as any,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      authenticator: () => ({ ok: true }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      router: {
        basePath: "/api",
        extract: (_p: string) => ({ kind: "task", id: "t.id" }),
        isUnderBase: () => true,
      },
      cors: undefined,
    };
    const { handleTask } = createRequestHandlers(deps);
    const req = makeReq("/api/task/t.id", "GET");
    const res = makeRes();
    await handleTask(req, res);
    expect((res as any)._status).toBe(405);
    const json = (res as any)._buf
      ? JSON.parse(((res as any)._buf as Buffer).toString("utf8"))
      : undefined;
    expect(json?.error?.code).toBe("METHOD_NOT_ALLOWED");
  });

  it("handleEvent responds 405 for non-POST", async () => {
    const deps: any = {
      store: { events: new Map([["e.id", { event: { id: "e.id" } }]]) },
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
    const req = makeReq("/api/event/e.id", "GET");
    const res = makeRes();
    await handleEvent(req, res);
    expect((res as any)._status).toBe(405);
    const json = (res as any)._buf
      ? JSON.parse(((res as any)._buf as Buffer).toString("utf8"))
      : undefined;
    expect(json?.error?.code).toBe("METHOD_NOT_ALLOWED");
  });
});
