import { Readable } from "stream";
import type { IncomingMessage, ServerResponse } from "http";
import { createRequestHandlers } from "../requestHandlers";
import { defineError } from "../../../definers/defineError";
import { getDefaultSerializer } from "../../../globals/resources/tunnel/serializer";

function makeReq(eventId: string, body: any): IncomingMessage {
  const payload = Buffer.from(JSON.stringify({ payload: body }), "utf8");
  const r: any = new Readable({
    read() {
      this.push(payload);
      this.push(null);
    },
  });
  r.method = "POST";
  r.url = "/api/event/" + encodeURIComponent(eventId);
  r.headers = { "content-type": "application/json" };
  // Use default Readable event emitter methods
  return r as unknown as IncomingMessage;
}

function makeRes(): ServerResponse & { _status?: number; _buf?: Buffer; _headers: Record<string, string> } {
  const res: any = {
    statusCode: 0,
    headersSent: false,
    writableEnded: false,
    _headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      this._headers[k.toLowerCase()] = v;
      this.headersSent = true;
    },
    write(payload?: any) {
      if (payload != null)
        this._buf = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
      this.headersSent = true;
    },
    end(payload?: any) {
      this._status = this.statusCode;
      if (payload != null) this.write(payload);
      this.writableEnded = true;
    },
    once(_e: string, _cb: Function) { return this; },
    on() { return this; },
  };
  return res as any;
}

describe("requestHandlers - event app error extras", () => {
  it("includes id and data for known application errors", async () => {
    const AppError = defineError<{ code: number; message: string }>({ id: "tests.errors.app.ev" });
    const store: any = {
      events: new Map([["e.app", { event: { id: "e.app" } }]]),
      errors: new Map([[AppError.id, AppError]]),
    };
    const deps: any = {
      store,
      taskRunner: {} as any,
      eventManager: { emit: async () => { AppError.throw({ code: 9, message: "Ev" }); } },
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      authenticator: () => ({ ok: true }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      router: {
        basePath: "/api",
        extract: (_p: string) => ({ kind: "event", id: "e.app" }),
        isUnderBase: () => true,
      },
      cors: undefined,
      serializer: getDefaultSerializer(),
    };

    const { handleEvent } = createRequestHandlers(deps);
    const req = makeReq("e.app", { x: 1 });
    const res = makeRes();
    await handleEvent(req, res);
    const json = (res as any)._buf
      ? JSON.parse(((res as any)._buf as Buffer).toString("utf8"))
      : undefined;
    expect((res as any)._status).toBe(500);
    expect(json?.ok).toBe(false);
    expect(json?.error?.code).toBe("INTERNAL_ERROR");
    expect(json?.error?.id).toBe("tests.errors.app.ev");
    expect(json?.error?.data).toEqual({ code: 9, message: "Ev" });
  });
});
