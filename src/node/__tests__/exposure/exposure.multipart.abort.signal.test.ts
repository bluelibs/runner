import * as http from "http";
import { defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import { nodeExposure } from "../../exposure/resource";

describe("nodeExposure - multipart early abort via signal", () => {
  it("returns 499 when AbortSignal is already aborted before parsing", async () => {
    const t = defineTask<{ n: number }, Promise<number>>({
      id: "exposer.abort.multipart",
      run: async ({ n }) => n,
    });
    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "T" },
      },
    });
    const app = defineResource({
      id: "exposer.abort.app",
      register: [t, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    // Prepare a request that claims multipart but will be aborted immediately
    const boundary = "----abortedBoundary";
    const req: any = new (require("stream").Readable)({ read() {} });
    req.method = "POST";
    req.url = `/__runner/task/${encodeURIComponent(t.id)}`;
    req.headers = {
      "x-runner-token": "T",
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": "0",
    };

    // Simulate immediate abort
    setImmediate(() => {
      req.emit("aborted");
    });

    let status = 0;
    let payload: Buffer | null = null;
    const res: any = {
      statusCode: 0,
      setHeader() {},
      end(buf?: any) {
        status = this.statusCode;
        if (buf)
          payload = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
      },
      once(event: string, cb: Function) {
        // Allow requestHandlers to subscribe to 'close'
        if (event === "close") setImmediate(() => cb());
      },
    };

    await handlers.handleTask(req, res);
    expect(status).toBe(499);
    const out = payload
      ? JSON.parse((payload as Buffer).toString("utf8"))
      : undefined;
    expect(out?.error?.code).toBe("REQUEST_ABORTED");

    await rr.dispose();
  });
});
