import type { IncomingMessage, ServerResponse } from "http";
import { createRequestHandlers } from "../requestHandlers";
import { EJSON, getDefaultSerializer } from "../../../globals/resources/tunnel/serializer";

function makeReq(): IncomingMessage {
  const listeners: Record<string, Function[]> = {};
  const req: any = {
    method: "POST",
    url: "/api/task/t",
    headers: { "content-type": [""] } as any,
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
  // Emit body and end on next tick
  setImmediate(() => {
    (listeners["data"] || []).forEach((fn) => fn(Buffer.from("{}", "utf8")));
    (listeners["end"] || []).forEach((fn) => fn());
  });
  return req as IncomingMessage;
}

function makeRes(): ServerResponse & { _status?: number; _buf?: Buffer } {
  const res: any = {
    statusCode: 0,
    setHeader() {},
    end(buf?: any) {
      this._status = this.statusCode;
      this._buf = buf;
    },
  };
  return res as any;
}

describe("requestHandlers - content-type array path", () => {
  it("handles content-type array with empty first element (lines 113-114)", async () => {
    const deps: any = {
      store: { tasks: new Map([["t", { task: async () => 1 }]]) },
      taskRunner: { run: async () => 1 },
      eventManager: {} as any,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      authenticator: () => ({ ok: true }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      router: {
        basePath: "/api",
        extract: (_: string) => ({ kind: "task", id: "t" }),
        isUnderBase: () => true,
      },
      cors: undefined,
    };
    const { handleTask } = createRequestHandlers({
      ...deps,
      serializer: getDefaultSerializer(),
    });
    const req = makeReq();
    const res = makeRes();
    await handleTask(req, res);
    // success implies we parsed type and ran task → 200 JSON
    expect((res as any)._status).toBe(200);
  });
});
