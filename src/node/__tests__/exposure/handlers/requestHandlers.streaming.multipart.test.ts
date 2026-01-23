import * as http from "http";
import { Readable } from "stream";
import { defineResource, defineTask } from "../../../../define";
import { run } from "../../../../run";
import { nodeExposure } from "../../../exposure/resource";

describe("requestHandlers - multipart streaming coverage", () => {
  it("multipart path: streams plain Readable when task returns Readable", async () => {
    const CRLF = "\r\n";
    const boundary = "----jest-boundary";
    const manifest = JSON.stringify({ input: {} });
    const body = `--${boundary}${CRLF}Content-Disposition: form-data; name="__manifest"${CRLF}Content-Type: application/json; charset=utf-8${CRLF}${CRLF}${manifest}${CRLF}--${boundary}--${CRLF}`;
    const req: any = new Readable({ read() { this.push(Buffer.from(body, "utf8")); this.push(null); } });
    req.method = "POST";
    req.headers = { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": Buffer.byteLength(body).toString() };

    const chunks: Buffer[] = [];
    const res: any = { statusCode: 0, headers: {} as Record<string, string>, setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; }, write(b: any) { chunks.push(Buffer.isBuffer(b) ? b : Buffer.from(String(b))); }, end(b?: any) { if (b) this.write(b); this.writableEnded = true; } };

    const t = defineTask<void, Promise<NodeJS.ReadableStream>>({
      id: "tests.requestHandlers.multipart.plain",
      async run() {
        let i = 0;
        return new Readable({ read() { if (i >= 2) return this.push(null); this.push(Buffer.from(`M${++i}`, "utf8")); } });
      },
    });
    const exposure = nodeExposure.with({ http: { dangerouslyAllowOpenExposure: true, server: http.createServer(), basePath: "/__runner", auth: { allowAnonymous: true } } });
    const app = defineResource({ id: "tests.app.handlers.multipart.plain", register: [t, exposure] });
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
    const body = `--${boundary}${CRLF}Content-Disposition: form-data; name="__manifest"${CRLF}Content-Type: application/json; charset=utf-8${CRLF}${CRLF}${manifest}${CRLF}--${boundary}--${CRLF}`;
    const req: any = new Readable({ read() { this.push(Buffer.from(body, "utf8")); this.push(null); } });
    req.method = "POST";
    req.headers = { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": Buffer.byteLength(body).toString() };

    const chunks: Buffer[] = [];
    const res: any = { statusCode: 0, headers: {} as Record<string, string>, setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; }, write(b: any) { chunks.push(Buffer.isBuffer(b) ? b : Buffer.from(String(b))); }, end(b?: any) { if (b) this.write(b); this.writableEnded = true; } };

    const t = defineTask<void, Promise<{ stream: NodeJS.ReadableStream; contentType: string }>>({
      id: "tests.requestHandlers.multipart.wrapper",
      async run() {
        let i = 0;
        const stream = new Readable({ read() { if (i >= 2) return this.push(null); this.push(Buffer.from(`W${++i}`, "utf8")); } });
        return { stream, contentType: "text/plain; charset=utf-8" };
      },
    });
    const exposure = nodeExposure.with({ http: { dangerouslyAllowOpenExposure: true, server: http.createServer(), basePath: "/__runner", auth: { allowAnonymous: true } } });
    const app = defineResource({ id: "tests.app.handlers.multipart.wrapper", register: [t, exposure] });
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
