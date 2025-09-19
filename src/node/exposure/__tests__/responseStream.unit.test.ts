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
    setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; },
    write(payload?: any) {
      if (payload != null)
        chunks.push(Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)));
    },
    end(payload?: any) {
      if (payload != null) this.write(payload);
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

describe("nodeExposure - task returned stream", () => {
  it("pipes plain Readable result (JSON path)", async () => {
    const streamTask = defineTask<void, Promise<NodeJS.ReadableStream>>({
      id: "tests.stream.task",
      async run() {
        const { Readable } = require("stream") as typeof import("stream");
        let i = 0;
        return new Readable({
          read() {
            if (i >= 3) return this.push(null);
            this.push(Buffer.from(`c${++i}`, "utf8"));
          },
        });
      },
    });

    const exposure = nodeExposure.with({ http: { server: http.createServer(), basePath: "/__runner" } });
    const app = defineResource({ id: "tests.app.stream.json", register: [streamTask, exposure] });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);
      const transport = createReqRes({
        method: "POST",
        url: `/__runner/task/${encodeURIComponent(streamTask.id)}`,
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      await handlers.handleTask(transport.req, transport.res);
      await new Promise((r) => setImmediate(r));
      expect(transport.headers["content-type"]).toMatch(/application\/octet-stream/i);
      expect(transport.text).toBe("c1c2c3");
    } finally {
      await rr.dispose();
    }
  });

  it("pipes StreamingResponse wrapper (octet-stream path)", async () => {
    const streamTask = defineTask<void, Promise<{ stream: NodeJS.ReadableStream; contentType: string }>>({
      id: "tests.stream.wrapper",
      async run() {
        const { Readable } = require("stream") as typeof import("stream");
        let i = 0;
        const stream = new Readable({
          read() {
            if (i >= 2) return this.push(null);
            this.push(Buffer.from(`X${++i}`, "utf8"));
          },
        });
        return { stream, contentType: "text/plain; charset=utf-8" };
      },
    });

    const exposure = nodeExposure.with({ http: { server: http.createServer(), basePath: "/__runner" } });
    const app = defineResource({ id: "tests.app.stream.octet", register: [streamTask, exposure] });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);
      const transport = createReqRes({
        method: "POST",
        url: `/__runner/task/${encodeURIComponent(streamTask.id)}`,
        headers: { "content-type": "application/octet-stream" },
      });
      await handlers.handleTask(transport.req, transport.res);
      await new Promise((r) => setImmediate(r));
      expect(transport.headers["content-type"]).toMatch(/text\/plain/i);
      expect(transport.text).toBe("X1X2");
    } finally {
      await rr.dispose();
    }
  });
});
