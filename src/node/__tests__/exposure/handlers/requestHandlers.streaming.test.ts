import * as http from "http";
import { Readable } from "stream";
import { defineResource, defineTask } from "../../../../define";
import { run } from "../../../../run";
import { nodeExposure } from "../../../exposure/resource";
import { createReqRes } from "./streaming.test.utils";

describe("requestHandlers - streaming", () => {
  it("handles content-type as array and returns 405 for wrong method", async () => {
    const t = defineTask<void, Promise<string>>({ id: "tests.streaming.405", async run() { return "nope"; } });
    const exposure = nodeExposure.with({ http: { dangerouslyAllowOpenExposure: true, server: http.createServer(), basePath: "/__runner", auth: { allowAnonymous: true } } });
    const app = defineResource({ id: "tests.app.streaming.405", register: [t, exposure] });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);
      const transport = createReqRes({ method: "GET", url: `/__runner/task/${encodeURIComponent(t.id)}`, headers: { "content-type": ["application/json"] as any } });
      await handlers.handleTask(transport.req as any, transport.res as any);
      expect(transport.res.statusCode).toBe(405);
    } finally {
      await rr.dispose();
    }
  });

  describe("JSON path streaming", () => {
    it("streams StreamingResponse wrapper", async () => {
      const t = defineTask<void, Promise<{ stream: NodeJS.ReadableStream; contentType: string }>>({
        id: "tests.streaming.wrapper.json",
        async run() {
          let i = 0;
          const stream = new Readable({ read() { if (i >= 2) return this.push(null); this.push(Buffer.from(`J${++i}`, "utf8")); } });
          return { stream, contentType: "text/plain; charset=utf-8" };
        },
      });
      const exposure = nodeExposure.with({ http: { dangerouslyAllowOpenExposure: true, server: http.createServer(), basePath: "/__runner", auth: { allowAnonymous: true } } });
      const app = defineResource({ id: "tests.app.streaming.json", register: [t, exposure] });
      const rr = await run(app);
      try {
        const handlers = await rr.getResourceValue(exposure.resource as any);
        const transport = createReqRes({ method: "POST", url: `/__runner/task/${encodeURIComponent(t.id)}`, headers: { "content-type": "application/json" }, body: "{}" });
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
        id: "tests.streaming.readable.octet",
        async run() {
          let i = 0;
          return new Readable({ read() { if (i >= 2) return this.push(null); this.push(Buffer.from(`O${++i}`, "utf8")); } });
        },
      });
      const exposure = nodeExposure.with({ http: { dangerouslyAllowOpenExposure: true, server: http.createServer(), basePath: "/__runner", auth: { allowAnonymous: true } } });
      const app = defineResource({ id: "tests.app.streaming.octet", register: [t, exposure] });
      const rr = await run(app);
      try {
        const handlers = await rr.getResourceValue(exposure.resource as any);
        const transport = createReqRes({ method: "POST", url: `/__runner/task/${encodeURIComponent(t.id)}`, headers: { "content-type": "application/octet-stream" } });
        await handlers.handleTask(transport.req, transport.res);
        await new Promise((r) => setImmediate(r));
        expect(transport.headers["content-type"]).toMatch(/application\/octet-stream/i);
        expect(transport.text).toBe("O1O2");
      } finally {
        await rr.dispose();
      }
    });
  });

  describe("Multipart path streaming", () => {
    const getMultipartReq = (boundary: string, manifest: string) => {
      const CRLF = "\r\n";
      const body = `--${boundary}${CRLF}Content-Disposition: form-data; name="__manifest"${CRLF}Content-Type: application/json; charset=utf-8${CRLF}${CRLF}${manifest}${CRLF}--${boundary}--${CRLF}`;
      const req: any = new Readable({ read() { this.push(Buffer.from(body, "utf8")); this.push(null); } });
      req.method = "POST";
      req.headers = { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": Buffer.byteLength(body).toString() };
      return req;
    };

    it("streams plain Readable when task returns Readable", async () => {
      const t = defineTask<void, Promise<NodeJS.ReadableStream>>({
        id: "tests.streaming.multipart.plain",
        async run() {
          let i = 0;
          return new Readable({ read() { if (i >= 2) return this.push(null); this.push(Buffer.from(`M${++i}`, "utf8")); } });
        },
      });
      const exposure = nodeExposure.with({ http: { dangerouslyAllowOpenExposure: true, server: http.createServer(), basePath: "/__runner", auth: { allowAnonymous: true } } });
      const app = defineResource({ id: "tests.app.streaming.mp.plain", register: [t, exposure] });
      const rr = await run(app);
      try {
        const handlers = await rr.getResourceValue(exposure.resource as any);
        const req = getMultipartReq("boundary1", JSON.stringify({ input: {} }));
        req.url = `/__runner/task/${encodeURIComponent(t.id)}`;
        const transport = createReqRes({ method: "POST", url: req.url });
        await handlers.handleTask(req, transport.res);
        await new Promise((r) => setImmediate(r));
        expect(transport.headers["content-type"]).toMatch(/application\/octet-stream/i);
        expect(transport.text).toBe("M1M2");
      } finally {
        await rr.dispose();
      }
    });

    it("streams wrapper when task returns { stream, contentType }", async () => {
      const t = defineTask<void, Promise<{ stream: NodeJS.ReadableStream; contentType: string }>>({
        id: "tests.streaming.multipart.wrapper",
        async run() {
          let i = 0;
          const stream = new Readable({ read() { if (i >= 2) return this.push(null); this.push(Buffer.from(`W${++i}`, "utf8")); } });
          return { stream, contentType: "text/plain; charset=utf-8" };
        },
      });
      const exposure = nodeExposure.with({ http: { dangerouslyAllowOpenExposure: true, server: http.createServer(), basePath: "/__runner", auth: { allowAnonymous: true } } });
      const app = defineResource({ id: "tests.app.streaming.mp.wrapper", register: [t, exposure] });
      const rr = await run(app);
      try {
        const handlers = await rr.getResourceValue(exposure.resource as any);
        const req = getMultipartReq("boundary2", JSON.stringify({ input: {} }));
        req.url = `/__runner/task/${encodeURIComponent(t.id)}`;
        const transport = createReqRes({ method: "POST", url: req.url });
        await handlers.handleTask(req, transport.res);
        await new Promise((r) => setImmediate(r));
        expect(transport.headers["content-type"]).toMatch(/text\/plain/);
        expect(transport.text).toBe("W1W2");
      } finally {
        await rr.dispose();
      }
    });
  });
});
