import { Readable } from "stream";
import type { IncomingMessage, ServerResponse } from "http";
import { createRequestHandlers } from "../requestHandlers";
import { getDefaultSerializer } from "../../../globals/resources/tunnel/serializer";

function makeReq(
  serializer: ReturnType<typeof getDefaultSerializer>,
  eventId: string,
  body: any,
  headers: Record<string, any>,
): IncomingMessage {
  const payload = Buffer.from(serializer.stringify(body), "utf8");
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

describe("requestHandlers - event returnPayload", () => {
  it("responds with result when returnPayload is true", async () => {
    const serializer = getDefaultSerializer();
    const emitWithResult = jest.fn(async () => ({ x: 2 }));

    const store: any = {
      events: new Map([["e.ret", { event: { id: "e.ret" } }]]),
      errors: new Map(),
      asyncContexts: new Map(),
    };
    const deps: any = {
      store,
      taskRunner: {} as any,
      eventManager: {
        emit: jest.fn(async () => undefined),
        emitWithResult,
      },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      authenticator: async () => ({ ok: true }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      router: {
        basePath: "/api",
        extract: (_p: string) => ({ kind: "event", id: "e.ret" }),
        isUnderBase: () => true,
      },
      cors: undefined,
      serializer,
    };

    const { handleEvent } = createRequestHandlers(deps);
    const req = makeReq(
      serializer,
      "e.ret",
      { payload: { x: 1 }, returnPayload: true },
      { "content-type": "application/json" },
    );
    const res = makeRes();
    await handleEvent(req, res);

    const json = (res as any)._buf
      ? (serializer.parse(((res as any)._buf as Buffer).toString("utf8")) as any)
      : undefined;
    expect((res as any)._status).toBe(200);
    expect(json?.ok).toBe(true);
    expect(json?.result).toEqual({ x: 2 });
    expect(emitWithResult).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when event is parallel and returnPayload is requested", async () => {
    const serializer = getDefaultSerializer();
    const emitWithResult = jest.fn(async () => ({ x: 2 }));

    const store: any = {
      events: new Map([["e.par", { event: { id: "e.par", parallel: true } }]]),
      errors: new Map(),
      asyncContexts: new Map(),
    };
    const deps: any = {
      store,
      taskRunner: {} as any,
      eventManager: {
        emit: jest.fn(async () => undefined),
        emitWithResult,
      },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      authenticator: async () => ({ ok: true }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      router: {
        basePath: "/api",
        extract: (_p: string) => ({ kind: "event", id: "e.par" }),
        isUnderBase: () => true,
      },
      cors: undefined,
      serializer,
    };

    const { handleEvent } = createRequestHandlers(deps);
    const req = makeReq(
      serializer,
      "e.par",
      { payload: { x: 1 }, returnPayload: true },
      { "content-type": "application/json" },
    );
    const res = makeRes();
    await handleEvent(req, res);

    const json = (res as any)._buf
      ? (serializer.parse(((res as any)._buf as Buffer).toString("utf8")) as any)
      : undefined;
    expect((res as any)._status).toBe(400);
    expect(json?.ok).toBe(false);
    expect(json?.error?.code).toBe("PARALLEL_EVENT_RETURN_UNSUPPORTED");
    expect(emitWithResult).not.toHaveBeenCalled();
  });
});

