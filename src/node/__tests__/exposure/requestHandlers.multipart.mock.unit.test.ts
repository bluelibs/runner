import { Readable } from "stream";
import type { IncomingMessage, ServerResponse } from "http";
import { createRequestHandlers } from "../../exposure/requestHandlers";

jest.mock("../../exposure/multipart", () => ({
  isMultipart: (ct: string) => /multipart\/form-data/i.test(ct),
  parseMultipartInput: async () => ({
    ok: false,
    response: {
      status: 400,
      body: { ok: false, error: { code: "INVALID_MULTIPART" } },
    },
  }),
}));

function makeReq(path: string): IncomingMessage {
  const r: any = new Readable({
    read() {
      this.push(null);
    },
  });
  r.method = "POST";
  r.url = path;
  r.headers = { "content-type": "multipart/form-data; boundary=abc" };
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

describe("requestHandlers - multipart mocked error", () => {
  it("responds with parse error when multipart fails", async () => {
    const deps: any = {
      store: { tasks: new Map([["t", { task: async () => 1 }]]) },
      taskRunner: { run: async () => 1 },
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
    const req = makeReq("/api/task/t");
    const res = makeRes();
    await handleTask(req, res);
    expect((res as any)._status).toBe(400);
    const json = (res as any)._buf
      ? JSON.parse(((res as any)._buf as Buffer).toString("utf8"))
      : undefined;
    expect(json?.error?.code).toBe("INVALID_MULTIPART");
  });
});
