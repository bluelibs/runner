import * as http from "http";
import { Readable } from "stream";
import { defineResource, defineEvent } from "../../../../define";
import { run } from "../../../../run";
import { nodeExposure } from "../../../exposure/resource";

function createWritableRes() {
  const chunks: Buffer[] = [];
  const res: any = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    headersSent: false,
    writableEnded: false,
    on(_e: string, _cb: Function) {},
    once(_e: string, _cb: Function) {},
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
    close() {
      this.writableEnded = true;
    },
  };
  return {
    res,
    get text() {
      return Buffer.concat(chunks as readonly Uint8Array[]).toString("utf8");
    },
    headers: res.headers,
  };
}

describe("requestHandlers - event abort listener wiring branch", () => {
  it("uses .on fallback when .once is missing and handles early res.close", async () => {
    const ev = defineEvent<{ payload?: unknown }>({
      id: "tests.requestHandlers.event.abort",
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
      id: "tests.app.handlers.event.abort",
      register: [ev, exposure],
    });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);
      const req: any = new Readable({ read() {} });
      req.method = "POST";
      req.url = `/__runner/event/${encodeURIComponent(ev.id)}`;
      req.headers = { "content-type": "application/json" };
      // Provide only .on, no .once
      req.once = undefined as any;
      const { res, text, headers } = createWritableRes();
      setImmediate(() => {
        // Close response before body is delivered; this triggers the listener wiring path
        (res as any).close?.();
        // Then end request
        req.emit("data", Buffer.from(JSON.stringify({ payload: {} }), "utf8"));
        req.emit("end");
      });
      await handlers.handleEvent(req, res);
      await new Promise((r) => setImmediate(r));
      // ensure no crash and either 200 or no explicit status set
      expect(res.statusCode === 0 || res.statusCode === 200).toBe(true);
    } finally {
      await rr.dispose();
    }
  });
});
