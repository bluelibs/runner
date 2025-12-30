import type { IncomingMessage, ServerResponse } from "http";
import { createRequestHandlers } from "../requestHandlers";

function makeReq(): IncomingMessage {
  const listeners: Record<string, Function[]> = {};
  const req: any = {
    method: "POST",
    url: "/api/task/t",
    headers: {},
    on(event: string, cb: Function) {
      (listeners[event] = listeners[event] || []).push(cb);
      return this;
    },
    once(event: string, cb: Function) {
      const wrapper = (...args: any[]) => {
        cb(...args);
        const arr = listeners[event] || [];
        const i = arr.indexOf(wrapper);
        if (i >= 0) arr.splice(i, 1);
      };
      (listeners[event] = listeners[event] || []).push(wrapper);
      return this;
    },
  };
  setImmediate(() => {
    // no data -> empty body
    (listeners["end"] || []).forEach((fn) => fn());
  });
  return req as IncomingMessage;
}

function makeRes(): ServerResponse & { _status?: number; _buf?: Buffer } {
  const res: any = {
    statusCode: 0,
    setHeader() {},
    once() {
      return this;
    },
    end(buf?: any) {
      this._status = this.statusCode;
      this._buf = buf;
    },
  };
  return res as any;
}

describe("requestHandlers - content-type missing path (line 114)", () => {
  it("handles missing content-type by treating as empty string", async () => {
    const deps: any = {
      store: { tasks: new Map([["t", { task: async () => 7 }]]) },
      taskRunner: { run: async () => 7 },
      eventManager: {} as any,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      authenticator: async () => ({ ok: true }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      router: {
        basePath: "/api",
        extract: (_: string) => ({ kind: "task", id: "t" }),
        isUnderBase: () => true,
      },
      cors: undefined,
    };
    const { handleTask } = createRequestHandlers(deps);
    const req = makeReq();
    const res = makeRes();
    await handleTask(req, res);
    expect((res as any)._status).toBe(200);
    const json = (res as any)._buf
      ? JSON.parse(((res as any)._buf as Buffer).toString("utf8"))
      : undefined;
    expect(json?.ok).toBe(true);
  });
});
