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

describe("exposure CORS - more branches", () => {
  it("supports regex origin, uppercase Origin header, and varyOrigin=false", async () => {
    const t = defineTask<void, Promise<number>>({
      id: "tests.cors.regex",
      async run() {
        return 42;
      },
    });
    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        server: http.createServer(),
        basePath: "/__runner",
        cors: {
          origin: /.*/,
          varyOrigin: false,
          methods: ["POST"],
        },
      },
    });
    const app = defineResource({
      id: "tests.app.cors.regex",
      register: [t, exposure],
    });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);

      // Preflight (lowercase origin header path)
      const pre = createReqRes({
        method: "OPTIONS",
        url: `/__runner/task/${encodeURIComponent(t.id)}`,
        headers: {
          origin: "https://sub.example.test",
          "access-control-request-headers": "x-one",
        },
      });
      const handled = await handlers.handleRequest(pre.req, pre.res);
      expect(handled).toBe(true);
      await new Promise((r) => setImmediate(r));
      expect(pre.res.statusCode).toBe(204);
      expect(pre.headers["access-control-allow-origin"]).toBe(
        "https://sub.example.test",
      );
      // varyOrigin=false should not set Vary: Origin even though value is dynamic
      expect(pre.headers["vary"]).toBeUndefined();

      // Actual request echoes origin and no Vary header
      const act = createReqRes({
        method: "POST",
        url: `/__runner/task/${encodeURIComponent(t.id)}`,
        headers: {
          origin: "https://sub.example.test",
          "content-type": "application/json",
        },
        body: "{}",
      });
      await handlers.handleRequest(act.req, act.res);
      expect(act.headers["access-control-allow-origin"]).toBe(
        "https://sub.example.test",
      );
      expect(act.headers["vary"]).toBeUndefined();
    } finally {
      await rr.dispose();
    }
  });

  it("supports function origin and Vary header de-duplication", async () => {
    const t = defineTask<void, Promise<string>>({
      id: "tests.cors.fn",
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
          origin: (o?: string) => (o?.endsWith(".ok.test") ? o : null),
          methods: ["POST"],
        },
      },
    });
    const app = defineResource({
      id: "tests.app.cors.fn",
      register: [t, exposure],
    });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);

      // Preflight with pre-existing Vary header; should append without dupes
      const pre = createReqRes({
        method: "OPTIONS",
        url: `/__runner/task/${encodeURIComponent(t.id)}`,
        headers: {
          origin: "https://site.ok.test",
          "access-control-request-headers": "x-two",
        },
      });
      // Prime Vary header
      pre.res.setHeader("Vary", "Accept-Encoding, Origin");
      const handled = await handlers.handleRequest(pre.req, pre.res);
      expect(handled).toBe(true);
      await new Promise((r) => setImmediate(r));
      expect(pre.res.statusCode).toBe(204);
      expect(pre.headers["access-control-allow-origin"]).toBe(
        "https://site.ok.test",
      );
      // Vary should still contain single Origin once
      const vary = pre.headers["vary"] || "";
      const parts = vary.split(",").map((s) => s.trim().toLowerCase());
      const countOrigin = parts.filter((p) => p === "origin").length;
      expect(countOrigin).toBe(1);
    } finally {
      await rr.dispose();
    }
  });
});
