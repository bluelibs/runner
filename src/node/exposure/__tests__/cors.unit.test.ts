import * as http from "http";
import { defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import { nodeExposure } from "../../exposure.resource";

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
    setHeader(k: string, v: string) {
      this.headers[k.toLowerCase()] = v;
      this.headersSent = true;
    },
    getHeader(k: string) {
      return this.headers[k.toLowerCase()];
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

describe("exposure CORS", () => {
  it("default permissive: OPTIONS returns 204 with wildcard and echoes request headers", async () => {
    const t = defineTask<{ x?: number }, Promise<number>>({
      id: "tests.cors.default",
      async run() {
        return 1;
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
      id: "tests.app.cors.default",
      register: [t, exposure],
    });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);

      // Preflight
      const pre = createReqRes({
        method: "OPTIONS",
        url: `/__runner/task/${encodeURIComponent(t.id)}`,
        headers: {
          origin: "http://example.test",
          "access-control-request-headers": "x-custom, content-type",
        },
      });
      const handledPre = await handlers.handleRequest(pre.req, pre.res);
      expect(handledPre).toBe(true);
      await new Promise((r) => setImmediate(r));
      expect(pre.res.statusCode).toBe(204);
      expect(pre.headers["access-control-allow-origin"]).toBe("*");
      expect(pre.headers["access-control-allow-methods"]).toContain("POST");
      expect(pre.headers["access-control-allow-headers"]).toContain("x-custom");

      // Actual request
      const act = createReqRes({
        method: "POST",
        url: `/__runner/task/${encodeURIComponent(t.id)}`,
        headers: {
          origin: "http://example.test",
          "content-type": "application/json",
        },
        body: "{}",
      });
      const handledAct = await handlers.handleRequest(act.req, act.res);
      expect(handledAct).toBe(true);
      expect(act.headers["access-control-allow-origin"]).toBe("*");
    } finally {
      await rr.dispose();
    }
  });

  it("respects configured origin array and credentials on preflight", async () => {
    const t = defineTask<void, Promise<string>>({
      id: "tests.cors.allowed",
      async run() {
        return "ok";
      },
    });
    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        server: http.createServer(),
        basePath: "/__runner",
        cors: {
          origin: ["https://a.test", "https://b.test"],
          credentials: true,
          methods: ["POST"],
          allowedHeaders: ["x-token"],
          maxAge: 600,
        },
      },
    });
    const app = defineResource({
      id: "tests.app.cors.config",
      register: [t, exposure],
    });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);

      const pre = createReqRes({
        method: "OPTIONS",
        url: `/__runner/task/${encodeURIComponent(t.id)}`,
        headers: {
          origin: "https://b.test",
          "access-control-request-headers": "x-token",
        },
      });
      const handledPre = await handlers.handleRequest(pre.req, pre.res);
      expect(handledPre).toBe(true);
      await new Promise((r) => setImmediate(r));
      expect(pre.res.statusCode).toBe(204);
      expect(pre.headers["access-control-allow-origin"]).toBe("https://b.test");
      expect(pre.headers["access-control-allow-credentials"]).toBe("true");
      expect(pre.headers["access-control-allow-methods"]).toBe("POST");
      expect(pre.headers["access-control-allow-headers"]).toBe("x-token");
      expect(pre.headers["access-control-max-age"]).toBe("600");
      // Vary should include Origin when origin is dynamic
      expect((pre.headers["vary"] || "").toLowerCase()).toContain("origin");

      // Disallowed origin
      const preNo = createReqRes({
        method: "OPTIONS",
        url: `/__runner/task/${encodeURIComponent(t.id)}`,
        headers: { origin: "https://c.test" },
      });
      const handledNo = await handlers.handleRequest(preNo.req, preNo.res);
      expect(handledNo).toBe(true);
      await new Promise((r) => setImmediate(r));
      expect(preNo.res.statusCode).toBe(204);
      // No allow-origin when not matched
      expect(preNo.headers["access-control-allow-origin"]).toBeUndefined();
    } finally {
      await rr.dispose();
    }
  });

  it("actual response sets expose headers and credentials when configured", async () => {
    const t = defineTask<void, Promise<number>>({
      id: "tests.cors.actual",
      async run() {
        return 10;
      },
    });
    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        server: http.createServer(),
        basePath: "/__runner",
        cors: {
          origin: "https://site.test",
          exposedHeaders: ["x-one", "x-two"],
          credentials: true,
        },
      },
    });
    const app = defineResource({
      id: "tests.app.cors.actual",
      register: [t, exposure],
    });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);
      const tr = createReqRes({
        method: "POST",
        url: `/__runner/task/${encodeURIComponent(t.id)}`,
        headers: {
          origin: "https://site.test",
          "content-type": "application/json",
        },
        body: "{}",
      });
      await handlers.handleRequest(tr.req, tr.res);
      expect(tr.headers["access-control-allow-origin"]).toBe(
        "https://site.test",
      );
      expect(tr.headers["access-control-allow-credentials"]).toBe("true");
      expect(tr.headers["access-control-expose-headers"]).toBe("x-one, x-two");
    } finally {
      await rr.dispose();
    }
  });
});
