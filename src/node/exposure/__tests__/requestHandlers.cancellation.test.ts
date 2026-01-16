import * as http from "http";
import { Readable } from "stream";
import { defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import { nodeExposure } from "../../exposure.resource";
import { useExposureContext } from "../../exposure/requestContext";
import { cancellationError } from "../../../errors";

function createWritableRes() {
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
    once: (_ev: string, _cb: any) => {},
  };
  return {
    res,
    get text() {
      return Buffer.concat(chunks as readonly Uint8Array[]).toString("utf8");
    },
  };
}

describe("Node exposure cancellation", () => {
  it("JSON body: abort maps to 499 and task is not executed", async () => {
    let ran = false;
    const t = defineTask<{ x: number }, Promise<number>>({
      id: "tests.cancel.json",
      async run({ x }) {
        ran = true;
        return x + 1;
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
      id: "tests.app.cancel.json",
      register: [t, exposure],
    });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);
      // Minimal req that will abort before delivering the body
      const req: any = new Readable({ read() {} });
      req.method = "POST";
      req.url = `/__runner/task/${encodeURIComponent(t.id)}`;
      req.headers = { "content-type": "application/json" };
      const out = createWritableRes();
      const { res } = out;
      // Trigger abort promptly
      setImmediate(() => req.emit("aborted"));
      await handlers.handleTask(req, res);
      // Allow microtasks to flush
      await new Promise((r) => setImmediate(r));
      expect(res.statusCode).toBe(499);
      const body = JSON.parse(out.text);
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe("REQUEST_ABORTED");
      expect(ran).toBe(false);
    } finally {
      await rr.dispose();
    }
  });

  it("multipart: request error maps to 499 REQUEST_ABORTED", async () => {
    const t = defineTask<void, Promise<string>>({
      id: "tests.cancel.multipart",
      async run() {
        return "OK";
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
      id: "tests.app.cancel.multipart",
      register: [t, exposure],
    });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);
      const req: any = new Readable({ read() {} });
      req.method = "POST";
      req.url = `/__runner/task/${encodeURIComponent(t.id)}`;
      req.headers = {
        "content-type": `multipart/form-data; boundary=----jest`,
      };
      const out = createWritableRes();
      const { res } = out;
      // Emit error which should be treated as client abort for multipart
      setImmediate(() => req.emit("error", new Error("socket reset")));
      await handlers.handleTask(req, res);
      await new Promise((r) => setImmediate(r));
      expect(res.statusCode).toBe(499);
      const body = JSON.parse(out.text);
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe("REQUEST_ABORTED");
    } finally {
      await rr.dispose();
    }
  });

  it("octet-stream: task throws CancellationError on signal → 499", async () => {
    const t = defineTask<void, Promise<void>>({
      id: "tests.cancel.octet",
      async run() {
        const { signal } = useExposureContext();
        if (signal.aborted)
          cancellationError.throw({ reason: "Client Closed Request" });
        await new Promise((_res, rej) => {
          signal.addEventListener(
            "abort",
            () =>
              rej(
                (() => {
                  try {
                    cancellationError.throw({
                      reason: "Client Closed Request",
                    });
                  } catch (e) {
                    return e as any;
                  }
                })(),
              ),
            { once: true },
          );
        });
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
      id: "tests.app.cancel.octet",
      register: [t, exposure],
    });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);
      const req: any = new Readable({ read() {} });
      req.method = "POST";
      req.url = `/__runner/task/${encodeURIComponent(t.id)}`;
      req.headers = { "content-type": "application/octet-stream" };
      const out = createWritableRes();
      const { res } = out;
      setImmediate(() => req.emit("aborted"));
      await handlers.handleTask(req, res);
      await new Promise((r) => setImmediate(r));
      expect(res.statusCode).toBe(499);
      const body = JSON.parse(out.text);
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe("REQUEST_ABORTED");
    } finally {
      await rr.dispose();
    }
  });
});
