import type { IncomingMessage, ServerResponse } from "http";
import { createRequestHandlers } from "../requestHandlers";
import { EJSON } from "../../../globals/resources/tunnel/serializer";

function makeReq(): IncomingMessage {
  const listeners: Record<string, Function[]> = {};
  const req: any = {
    method: "POST",
    url: "/api/task/t",
    headers: { "content-type": ["application/json"] } as any,
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
    (listeners["data"] || []).forEach((fn) => fn(Buffer.from("{}", "utf8")));
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

describe("requestHandlers - content-type array non-empty branch (line 114)", () => {
  it('covers truthy branch of contentTypeRaw[0] || ""', async () => {
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
      serializer: EJSON,
    });
    const req = makeReq();
    const res = makeRes();
    await handleTask(req, res);
    expect((res as any)._status).toBe(200);
  });
});
