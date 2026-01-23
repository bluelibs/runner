import * as http from "http";
import { Readable } from "stream";
import { defineResource, defineTask } from "../../../../define";
import { run } from "../../../../run";
import { nodeExposure } from "../../../exposure/resource";
import { createReqRes } from "./streaming.test.utils";

describe("requestHandlers - streaming coverage", () => {
  it("handles content-type as array and returns 405 for wrong method", async () => {
    const t = defineTask<void, Promise<string>>({ id: "tests.requestHandlers.405", async run() { return "nope"; } });
    const exposure = nodeExposure.with({ http: { dangerouslyAllowOpenExposure: true, server: http.createServer(), basePath: "/__runner", auth: { allowAnonymous: true } } });
    const app = defineResource({ id: "tests.app.handlers.405", register: [t, exposure] });
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

  it("streams StreamingResponse wrapper on JSON path", async () => {
    const t = defineTask<void, Promise<{ stream: NodeJS.ReadableStream; contentType: string }>>({
      id: "tests.requestHandlers.wrapper.json",
      async run() {
        let i = 0;
        const stream = new Readable({ read() { if (i >= 2) return this.push(null); this.push(Buffer.from(`J${++i}`, "utf8")); } });
        return { stream, contentType: "text/plain; charset=utf-8" };
      },
    });
    const exposure = nodeExposure.with({ http: { dangerouslyAllowOpenExposure: true, server: http.createServer(), basePath: "/__runner", auth: { allowAnonymous: true } } });
    const app = defineResource({ id: "tests.app.handlers.json", register: [t, exposure] });
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
      id: "tests.requestHandlers.readable.octet",
      async run() {
        let i = 0;
        return new Readable({ read() { if (i >= 2) return this.push(null); this.push(Buffer.from(`O${++i}`, "utf8")); } });
      },
    });
    const exposure = nodeExposure.with({ http: { dangerouslyAllowOpenExposure: true, server: http.createServer(), basePath: "/__runner", auth: { allowAnonymous: true } } });
    const app = defineResource({ id: "tests.app.handlers.octet", register: [t, exposure] });
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
