import { Readable } from "stream";
import type { IncomingMessage, ServerResponse } from "http";
import { createRequestHandlers } from "../requestHandlers";

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

describe("requestHandlers - auth fail and missing task", () => {
  it("returns auth error when authenticator fails", async () => {
    const deps: any = {
      store: { tasks: new Map(), events: new Map() },
      taskRunner: { run: async () => 1 },
      eventManager: {} as any,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      authenticator: () => ({
        ok: false,
        response: {
          status: 401,
          body: { ok: false, error: { code: "UNAUTHORIZED" } },
        },
      }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      router: {
        basePath: "/api",
        extract: (_p: string) => ({ kind: "task", id: "t.id" }),
        isUnderBase: () => true,
      },
      cors: undefined,
    };
    const { handleTask } = createRequestHandlers(deps);
    const req: any = new Readable({
      read() {
        this.push(null);
      },
    });
    req.method = "POST";
    req.url = "/api/task/t.id";
    req.headers = { "content-type": "application/json" };
    const res = makeRes();
    await handleTask(req as any, res);
    expect((res as any)._status).toBe(401);
    const json = (res as any)._buf
      ? JSON.parse(((res as any)._buf as Buffer).toString("utf8"))
      : undefined;
    expect(json?.error?.code).toBe("UNAUTHORIZED");
  });

  it("returns 404 when task id missing from store", async () => {
    const deps: any = {
      store: { tasks: new Map(), events: new Map() },
      taskRunner: { run: async () => 1 },
      eventManager: {} as any,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      authenticator: () => ({ ok: true }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      router: {
        basePath: "/api",
        extract: (_p: string) => ({ kind: "task", id: "missing" }),
        isUnderBase: () => true,
      },
      cors: undefined,
    };
    const { handleTask } = createRequestHandlers(deps);
    const req: any = new Readable({
      read() {
        this.push(null);
      },
    });
    req.method = "POST";
    req.url = "/api/task/missing";
    req.headers = { "content-type": "application/json" };
    const res = makeRes();
    await handleTask(req as any, res);
    expect((res as any)._status).toBe(404);
    const json = (res as any)._buf
      ? JSON.parse(((res as any)._buf as Buffer).toString("utf8"))
      : undefined;
    expect(json?.error?.code).toBe("NOT_FOUND");
  });
});
