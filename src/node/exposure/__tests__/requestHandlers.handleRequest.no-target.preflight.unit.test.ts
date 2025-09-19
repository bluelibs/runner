import type { IncomingMessage, ServerResponse } from "http";
import { createRequestHandlers } from "../requestHandlers";

function makeReq(): IncomingMessage {
  return { method: "OPTIONS", url: "/api/anything", headers: {} } as any;
}

function makeRes(): ServerResponse & { _ended?: boolean } {
  const headers: Record<string, string> = {};
  const res: any = {
    statusCode: 0,
    setHeader(k: string, v: string) {
      headers[k] = v;
    },
    getHeader(k: string) {
      return headers[k];
    },
    end() {
      this._ended = true;
    },
  };
  return res as any;
}

describe("requestHandlers - handleRequest preflight with no target under base (line 412)", () => {
  it("returns true after preflight end", async () => {
    const deps: any = {
      store: { tasks: new Map(), events: new Map() },
      taskRunner: {} as any,
      eventManager: {} as any,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      authenticator: () => ({ ok: true }),
      allowList: { ensureTask: () => null, ensureEvent: () => null },
      router: {
        basePath: "/api",
        extract: (_: string) => null,
        isUnderBase: () => true,
      },
      cors: {},
    };
    const { handleRequest } = createRequestHandlers(deps);
    const req = makeReq();
    const res = makeRes();
    const handled = await handleRequest(req, res);
    expect(handled).toBe(true);
    expect((res as any)._ended).toBe(true);
    expect((res as any).statusCode).toBe(204);
  });
});
