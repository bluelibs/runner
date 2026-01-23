import { Readable } from "stream";
import type { IncomingMessage, ServerResponse } from "http";
import { createRequestHandlers } from "../../../exposure/requestHandlers";
import { getDefaultSerializer } from "../../../../serializer";

function makeReq(
  taskId: string,
  body: any,
  headers: Record<string, string>,
): IncomingMessage {
  const payload = Buffer.from(JSON.stringify({ input: body }), "utf8");
  const r: any = new Readable({
    read() {
      this.push(payload);
      this.push(null);
    },
  });
  r.method = "POST";
  r.url = "/api/task/" + encodeURIComponent(taskId);
  r.headers = headers;
  return r as unknown as IncomingMessage;
}

function makeRes(): ServerResponse & { _status?: number; _buf?: Buffer } {
  const res: any = {
    statusCode: 0,
    setHeader() {},
    once() {
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

describe("requestHandlers - task context via x-runner-context", () => {
  it("hydrates async context around taskRunner.run", async () => {
    const serializer = getDefaultSerializer();
    // Fake async context impl
    let current: any;
    const ctx = {
      id: "ctx.demo",
      use: () => current,
      serialize: (v: any) => JSON.stringify(v),
      parse: (s: string) => JSON.parse(s),
      provide: (v: any, fn: any) => {
        current = v;
        return fn();
      },
      require: () => ({}) as any,
    } as any;

    const store: any = {
      tasks: new Map([["t.ctx", { task: { id: "t.ctx" } }]]),
      errors: new Map(),
      asyncContexts: new Map([[ctx.id, ctx]]),
    };
    const deps: any = {
      store,
      taskRunner: {
        run: async () => {
          expect(ctx.use().v).toBe(1);
          return 123;
        },
      },
      eventManager: {} as any,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      authenticator: async () => ({ ok: true }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      router: {
        basePath: "/api",
        extract: (_p: string) => ({ kind: "task", id: "t.ctx" }),
        isUnderBase: () => true,
      },
      cors: undefined,
      serializer,
    };

    const { handleTask } = createRequestHandlers(deps);
    const headerMap = { "content-type": "application/json" } as Record<
      string,
      string
    >;
    headerMap["x-runner-context"] = serializer.stringify({
      [ctx.id]: ctx.serialize({ v: 1 }),
    });
    const req = makeReq("t.ctx", { a: 1 }, headerMap);
    const res = makeRes();
    await handleTask(req, res);
    const json = (res as any)._buf
      ? (serializer.parse(
          ((res as any)._buf as Buffer).toString("utf8"),
        ) as any)
      : undefined;
    expect((res as any)._status).toBe(200);
    expect(json?.ok).toBe(true);
    expect(json?.result).toBe(123);
  });

  it("hydrates context when header is provided as array", async () => {
    const serializer = getDefaultSerializer();
    let current: any;
    const ctx = {
      id: "ctx.demo2",
      use: () => current,
      serialize: (v: any) => JSON.stringify(v),
      parse: (s: string) => JSON.parse(s),
      provide: (v: any, fn: any) => {
        current = v;
        return fn();
      },
      require: () => ({}) as any,
    } as any;

    const store: any = {
      tasks: new Map([["t.ctx.arr", { task: { id: "t.ctx.arr" } }]]),
      errors: new Map(),
      asyncContexts: new Map([[ctx.id, ctx]]),
    };
    const deps: any = {
      store,
      taskRunner: {
        run: async () => {
          expect(ctx.use().v).toBe(2);
          return 321;
        },
      },
      eventManager: {} as any,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      authenticator: async () => ({ ok: true }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      router: {
        basePath: "/api",
        extract: (_p: string) => ({ kind: "task", id: "t.ctx.arr" }),
        isUnderBase: () => true,
      },
      cors: undefined,
      serializer,
    };
    const { handleTask } = createRequestHandlers(deps);
    const headerText = serializer.stringify({
      [ctx.id]: ctx.serialize({ v: 2 }),
    });
    const req = makeReq(
      "t.ctx.arr",
      { a: 1 },
      {
        "content-type": "application/json",
        "x-runner-context": [headerText] as any,
      },
    );
    const res = makeRes();
    await handleTask(req, res);
    const json = (res as any)._buf
      ? (serializer.parse(
          ((res as any)._buf as Buffer).toString("utf8"),
        ) as any)
      : undefined;
    expect((res as any)._status).toBe(200);
    expect(json?.ok).toBe(true);
    expect(json?.result).toBe(321);
  });
});
