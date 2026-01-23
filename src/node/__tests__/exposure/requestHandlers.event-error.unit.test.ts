import * as http from "http";
import { defineResource, defineEvent, defineHook } from "../../../define";
import { run } from "../../../run";
import { nodeExposure } from "../../exposure/resource";

function createReqRes(init: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
}) {
  const { method = "POST", url = "/", headers = {}, body } = init;
  const req: any = {
    method,
    url,
    headers,
    _listeners: new Map<string, Function[]>(),
    on(event: string, cb: Function) {
      const arr = this._listeners.get(event) ?? [];
      arr.push(cb);
      this._listeners.set(event, arr);
      if (event === "end") {
        setImmediate(() => {
          if (body != null) {
            for (const d of this._listeners.get("data") ?? [])
              d(Buffer.isBuffer(body) ? body : Buffer.from(String(body)));
          }
          for (const e of this._listeners.get("end") ?? []) e();
        });
      }
      return this;
    },
  };

  const chunks: Buffer[] = [];
  const res: any = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    headersSent: false,
    writableEnded: false,
    setHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v;
      this.headersSent = true;
    },
    write(payload?: any) {
      if (payload != null)
        chunks.push(
          Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)),
        );
      this.headersSent = true;
    },
    end(payload?: any) {
      if (payload != null) this.write(payload);
      this.writableEnded = true;
    },
  };

  return {
    req,
    res,
    get text() {
      return Buffer.concat(chunks as readonly Uint8Array[]).toString("utf8");
    },
    get headers() {
      return res.headers as Record<string, string>;
    },
  };
}

describe("requestHandlers - event non-cancellation error path", () => {
  it("returns 500 when an event hook throws a normal error", async () => {
    const ev = defineEvent<{ payload?: unknown }>({
      id: "tests.requestHandlers.event.error",
    });
    const hook = defineHook({
      id: "tests.requestHandlers.event.error.hook",
      on: ev,
      async run() {
        throw new Error("boom");
      },
    });

    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        server: http.createServer(),
        basePath: "/__runner",
        auth: { allowAnonymous: true },
      },
    });
    const app = defineResource({
      id: "tests.app.handlers.event.error",
      register: [ev, hook, exposure],
    });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);
      const transport = createReqRes({
        method: "POST",
        url: `/__runner/event/${encodeURIComponent(ev.id)}`,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: {} }),
      });
      await handlers.handleEvent(transport.req as any, transport.res as any);
      await new Promise((r) => setImmediate(r));
      expect(transport.res.statusCode).toBe(500);
      const body = JSON.parse(transport.text);
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe("INTERNAL_ERROR");
      // CORS header applied
      expect(transport.headers["content-type"]).toMatch(/application\/json/);
    } finally {
      await rr.dispose();
    }
  });
  it("returns 500 with generic message when hook throws a string (displayMessage fallback)", async () => {
    const ev = defineEvent<{ payload?: unknown }>({
      id: "tests.requestHandlers.event.error.string",
    });
    const hook = defineHook({
      id: "tests.requestHandlers.event.error.string.hook",
      on: ev,
      run: async () => {
        throw "bad";
      },
    });
    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        server: http.createServer(),
        basePath: "/__runner",
        auth: { allowAnonymous: true },
      },
    });
    const app = defineResource({
      id: "tests.app.handlers.event.error.string",
      register: [ev, hook, exposure],
    });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);
      const transport = createReqRes({
        method: "POST",
        url: `/__runner/event/${encodeURIComponent(ev.id)}`,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: {} }),
      });
      await handlers.handleEvent(transport.req as any, transport.res as any);
      await new Promise((r) => setImmediate(r));
      expect(transport.res.statusCode).toBe(500);
      const body = JSON.parse(transport.text);
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe("INTERNAL_ERROR");
    } finally {
      await rr.dispose();
    }
  });
});
