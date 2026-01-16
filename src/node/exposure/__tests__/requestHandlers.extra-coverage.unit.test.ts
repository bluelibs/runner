import * as http from "http";
import { Readable } from "stream";
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
    write(payload?: any) {
      if (payload != null)
        chunks.push(
          Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)),
        );
      this.headersSent = true;
    },
    end(payload?: any) {
      if (payload != null) this.write(payload);
      this.headersSent = true;
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

describe("requestHandlers - additional streaming coverage", () => {
  it("handles content-type as array and returns 405 for wrong method", async () => {
    const t = defineTask<void, Promise<string>>({
      id: "tests.requestHandlers.405",
      async run() {
        return "nope";
      },
    });
    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: { allowAnonymous: true },
      },
    });
    const app = defineResource({
      id: "tests.app.handlers.405",
      register: [t, exposure],
    });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);
      const transport = createReqRes({
        method: "GET",
        url: `/__runner/task/${encodeURIComponent(t.id)}`,
        headers: { "content-type": ["application/json"] as any },
      });
      await handlers.handleTask(transport.req as any, transport.res as any);
      expect(transport.res.statusCode).toBe(405);
    } finally {
      await rr.dispose();
    }
  });
  it("streams StreamingResponse wrapper on JSON path", async () => {
    const t = defineTask<
      void,
      Promise<{ stream: NodeJS.ReadableStream; contentType: string }>
    >({
      id: "tests.requestHandlers.wrapper.json",
      async run() {
        let i = 0;
        const stream = new Readable({
          read() {
            if (i >= 2) return this.push(null);
            this.push(Buffer.from(`J${++i}`, "utf8"));
          },
        });
        return { stream, contentType: "text/plain; charset=utf-8" };
      },
    });

    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: { allowAnonymous: true },
      },
    });
    const app = defineResource({
      id: "tests.app.handlers.json",
      register: [t, exposure],
    });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);
      const transport = createReqRes({
        method: "POST",
        url: `/__runner/task/${encodeURIComponent(t.id)}`,
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      await handlers.handleTask(transport.req, transport.res);
      await new Promise((r) => setImmediate(r));
      expect(transport.headers["content-type"]).toMatch(/text\/plain/);
      expect(transport.text).toBe("J1J2");
    } finally {
      await rr.dispose();
    }
  });

  it("streams plain Readable on octet-stream path", async () => {
    const t = defineTask<void, Promise<NodeJS.ReadableStream>>({
      id: "tests.requestHandlers.readable.octet",
      async run() {
        let i = 0;
        return new Readable({
          read() {
            if (i >= 2) return this.push(null);
            this.push(Buffer.from(`O${++i}`, "utf8"));
          },
        });
      },
    });

    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: { allowAnonymous: true },
      },
    });
    const app = defineResource({
      id: "tests.app.handlers.octet",
      register: [t, exposure],
    });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);
      const transport = createReqRes({
        method: "POST",
        url: `/__runner/task/${encodeURIComponent(t.id)}`,
        headers: { "content-type": "application/octet-stream" },
      });
      await handlers.handleTask(transport.req, transport.res);
      await new Promise((r) => setImmediate(r));
      expect(transport.headers["content-type"]).toMatch(
        /application\/octet-stream/i,
      );
      expect(transport.text).toBe("O1O2");
    } finally {
      await rr.dispose();
    }
  });

  it("multipart path: streams plain Readable when task returns Readable", async () => {
    // Helper to craft a minimal multipart request with only a manifest field
    const CRLF = "\r\n";
    const boundary = "----jest-boundary";
    const manifest = JSON.stringify({ input: {} });
    const body =
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="__manifest"${CRLF}` +
      `Content-Type: application/json; charset=utf-8${CRLF}${CRLF}` +
      `${manifest}${CRLF}` +
      `--${boundary}--${CRLF}`;

    const req: any = new Readable({
      read() {
        this.push(Buffer.from(body, "utf8"));
        this.push(null);
      },
    });
    req.method = "POST";
    req.headers = {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": Buffer.byteLength(body).toString(),
    };

    const chunks: Buffer[] = [];
    const res: any = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      setHeader(k: string, v: string) {
        this.headers[k.toLowerCase()] = v;
      },
      write(b: any) {
        chunks.push(Buffer.isBuffer(b) ? b : Buffer.from(String(b)));
      },
      end(b?: any) {
        if (b) this.write(b);
        this.writableEnded = true;
      },
    };

    const t = defineTask<void, Promise<NodeJS.ReadableStream>>({
      id: "tests.requestHandlers.multipart.plain",
      async run() {
        let i = 0;
        return new Readable({
          read() {
            if (i >= 2) return this.push(null);
            this.push(Buffer.from(`M${++i}`, "utf8"));
          },
        });
      },
    });

    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: { allowAnonymous: true },
      },
    });
    const app = defineResource({
      id: "tests.app.handlers.multipart.plain",
      register: [t, exposure],
    });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);
      req.url = `/__runner/task/${encodeURIComponent(t.id)}`;
      await handlers.handleTask(req, res);
      await new Promise((r) => setImmediate(r));
      expect(res.headers["content-type"]).toMatch(/application\/octet-stream/i);
      expect(Buffer.concat(chunks).toString("utf8")).toBe("M1M2");
    } finally {
      await rr.dispose();
    }
  });

  it("multipart path: streams wrapper when task returns { stream, contentType }", async () => {
    const CRLF = "\r\n";
    const boundary = "----jest-boundary";
    const manifest = JSON.stringify({ input: {} });
    const body =
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="__manifest"${CRLF}` +
      `Content-Type: application/json; charset=utf-8${CRLF}${CRLF}` +
      `${manifest}${CRLF}` +
      `--${boundary}--${CRLF}`;

    const req: any = new Readable({
      read() {
        this.push(Buffer.from(body, "utf8"));
        this.push(null);
      },
    });
    req.method = "POST";
    req.headers = {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": Buffer.byteLength(body).toString(),
    };

    const chunks: Buffer[] = [];
    const res: any = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      setHeader(k: string, v: string) {
        this.headers[k.toLowerCase()] = v;
      },
      write(b: any) {
        chunks.push(Buffer.isBuffer(b) ? b : Buffer.from(String(b)));
      },
      end(b?: any) {
        if (b) this.write(b);
        this.writableEnded = true;
      },
    };

    const t = defineTask<
      void,
      Promise<{ stream: NodeJS.ReadableStream; contentType: string }>
    >({
      id: "tests.requestHandlers.multipart.wrapper",
      async run() {
        let i = 0;
        const stream = new Readable({
          read() {
            if (i >= 2) return this.push(null);
            this.push(Buffer.from(`W${++i}`, "utf8"));
          },
        });
        return { stream, contentType: "text/plain; charset=utf-8" };
      },
    });

    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: { allowAnonymous: true },
      },
    });
    const app = defineResource({
      id: "tests.app.handlers.multipart.wrapper",
      register: [t, exposure],
    });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);
      req.url = `/__runner/task/${encodeURIComponent(t.id)}`;
      await handlers.handleTask(req, res);
      await new Promise((r) => setImmediate(r));
      expect(res.headers["content-type"]).toMatch(/text\/plain/);
      expect(Buffer.concat(chunks).toString("utf8")).toBe("W1W2");
    } finally {
      await rr.dispose();
    }
  });
});
