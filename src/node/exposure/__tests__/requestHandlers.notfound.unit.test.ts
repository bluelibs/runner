import { Readable } from "stream";
import type { IncomingMessage, ServerResponse } from "http";
import { createRequestHandlers } from "../requestHandlers";

function makeReq(pathname: string): IncomingMessage {
  const r: any = new Readable({
    read() {
      this.push(null);
    },
  });
  r.method = "GET";
  r.url = pathname;
  r.headers = {};
  return r as unknown as IncomingMessage;
}

function makeRes(): ServerResponse & {
  _status?: number;
  _buf?: Buffer;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  const res: any = {
    statusCode: 0,
    headers,
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
    },
    end(buf?: any) {
      if (buf)
        this._buf = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
      this._status = this.statusCode;
    },
  };
  return res as any;
}

describe("requestHandlers - not found paths", () => {
  it("handleRequest returns false for paths outside basePath", async () => {
    const deps: any = {
      store: { tasks: new Map(), events: new Map() },
      taskRunner: {} as any,
      eventManager: {} as any,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      authenticator: async () => ({ ok: true }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      router: {
        basePath: "/api",
        extract: (_: string) => null,
        isUnderBase: () => false,
      },
      cors: undefined,
    };
    const { handleRequest } = createRequestHandlers(deps);
    const req = makeReq("/outside");
    const res = makeRes();
    const handled = await handleRequest(req, res);
    expect(handled).toBe(false);
  });

  it("handleRequest returns true and 404 JSON when under base but no target", async () => {
    const deps: any = {
      store: { tasks: new Map(), events: new Map() },
      taskRunner: {} as any,
      eventManager: {} as any,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      authenticator: async () => ({ ok: true }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      router: {
        basePath: "/api",
        extract: (_: string) => null,
        isUnderBase: () => true,
      },
      cors: undefined,
    };
    const { handleRequest } = createRequestHandlers(deps);
    const req = makeReq("/api/");
    const res = makeRes();
    const handled = await handleRequest(req, res);
    expect(handled).toBe(true);
    expect((res as any)._status).toBe(404);
    const json = (res as any)._buf
      ? JSON.parse(((res as any)._buf as Buffer).toString("utf8"))
      : undefined;
    expect(json?.ok).toBe(false);
    expect(json?.error?.code).toBe("NOT_FOUND");
  });
});
