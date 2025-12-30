import { Readable } from "stream";
import type { IncomingMessage, ServerResponse } from "http";
import { createRequestHandlers } from "../requestHandlers";
import { getDefaultSerializer } from "../../../globals/resources/tunnel/serializer";

function makeReq(
  eventId: string,
  body: any,
  headers: Record<string, string>,
): IncomingMessage {
  const payload = Buffer.from(JSON.stringify({ payload: body }), "utf8");
  const r: any = new Readable({
    read() {
      this.push(payload);
      this.push(null);
    },
  });
  r.method = "POST";
  r.url = "/api/event/" + encodeURIComponent(eventId);
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

describe("requestHandlers - event context via x-runner-context", () => {
  it("hydrates async context around event emit", async () => {
    const serializer = getDefaultSerializer();
    let current: any;
    const ctx = {
      id: "ctx.ev",
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
      events: new Map([["e.ctx", { event: { id: "e.ctx" } }]]),
      errors: new Map(),
      asyncContexts: new Map([[ctx.id, ctx]]),
    };
    const deps: any = {
      store,
      taskRunner: {} as any,
      eventManager: {
        emit: async () => {
          expect(ctx.use().w).toBe(2);
        },
      },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      authenticator: async () => ({ ok: true }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      router: {
        basePath: "/api",
        extract: (_p: string) => ({ kind: "event", id: "e.ctx" }),
        isUnderBase: () => true,
      },
      cors: undefined,
      serializer,
    };

    const { handleEvent } = createRequestHandlers(deps);
    const headerMap = { "content-type": "application/json" } as Record<
      string,
      string
    >;
    headerMap["x-runner-context"] = serializer.stringify({
      [ctx.id]: ctx.serialize({ w: 2 }),
    });
    const req = makeReq("e.ctx", { a: 1 }, headerMap);
    const res = makeRes();
    await handleEvent(req, res);
    const json = (res as any)._buf
      ? serializer.parse(((res as any)._buf as Buffer).toString("utf8")) as any
      : undefined;
    expect((res as any)._status).toBe(200);
    expect(json?.ok).toBe(true);
  });

  it("hydrates context when header is provided as array (event)", async () => {
    const serializer = getDefaultSerializer();
    let current: any;
    const ctx = {
      id: "ctx.ev2",
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
      events: new Map([["e.ctx.arr", { event: { id: "e.ctx.arr" } }]]),
      errors: new Map(),
      asyncContexts: new Map([[ctx.id, ctx]]),
    };
    const deps: any = {
      store,
      taskRunner: {} as any,
      eventManager: {
        emit: async () => {
          expect(ctx.use().w).toBe(7);
        },
      },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      authenticator: async () => ({ ok: true }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      router: {
        basePath: "/api",
        extract: (_p: string) => ({ kind: "event", id: "e.ctx.arr" }),
        isUnderBase: () => true,
      },
      cors: undefined,
      serializer,
    };

    const { handleEvent } = createRequestHandlers(deps);
    const headerText = serializer.stringify({
      [ctx.id]: ctx.serialize({ w: 7 }),
    });
    const req = makeReq(
      "e.ctx.arr",
      { a: 1 },
      {
        "content-type": "application/json",
        "x-runner-context": [headerText] as any,
      },
    );
    const res = makeRes();
    await handleEvent(req, res);
    const json = (res as any)._buf
      ? serializer.parse(((res as any)._buf as Buffer).toString("utf8")) as any
      : undefined;
    expect((res as any)._status).toBe(200);
    expect(json?.ok).toBe(true);
  });
});
