import * as http from "http";
import { defineResource } from "../../define";
import { run } from "../../run";
import { defineTask } from "../../definers/defineTask";
import { nodeExposure, useExposureContext } from "../index";

describe("nodeExposure request context (raw-body)", () => {
  it("provides req/res via useExposureContext() and allows raw-body streaming when content-type is application/octet-stream", async () => {
    const rawTask = defineTask<void, Promise<string>>({
      id: "ctx.raw.task",
      run: async () => {
        const { req, basePath, url, method, headers } = useExposureContext();
        // Basic sanity assertions on context
        if (!basePath || !url || !method || !headers) throw new Error("no ctx");
        return await new Promise<string>((resolve, reject) => {
          const chunks: Buffer[] = [];
          req
            .on("data", (c: any) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))))
            .on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
            .on("error", reject);
        });
      },
    });

    const exposure = nodeExposure.with({ http: { server: http.createServer(), basePath: "/__runner" } });
    const app = defineResource({ id: "ctx.raw.app", register: [rawTask, exposure] });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    // Create raw-body request with content-type application/octet-stream
    const body = "streamme";
    const req: any = new (require("stream").Readable)({ read() {} });
    req.method = "POST";
    req.url = `/__runner/task/${encodeURIComponent(rawTask.id)}`;
    req.headers = {
      "content-type": "application/octet-stream",
    };
    setImmediate(() => {
      req.push(Buffer.from(body, "utf8"));
      req.push(null);
    });

    let status = 0;
    let payload: any = Buffer.alloc(0);
    const res: any = {
      setHeader() {},
      statusCode: 0,
      end(buf?: any) {
        status = this.statusCode;
        if (buf) payload = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
      },
      writeHead(code: number) {
        this.statusCode = code;
      },
      write() {},
    };

    await handlers.handleTask(req, res);
    expect(status).toBe(200);
    const out = JSON.parse(payload.toString("utf8"));
    expect(out.ok).toBe(true);
    expect(out.result).toBe(body);

    await rr.dispose();
  });
});

