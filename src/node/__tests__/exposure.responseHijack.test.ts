import * as http from "http";
import { defineResource } from "../../define";
import { run } from "../../run";
import { defineTask } from "../../definers/defineTask";
import { nodeExposure, useExposureContext } from "../index";

describe("nodeExposure response hijack (duplex)", () => {
  it("skips JSON envelope when task writes to res (raw-body)", async () => {
    const duplexTask = defineTask<void, Promise<string>>({
      id: "ctx.raw.duplex",
      run: async () => {
        const { req, res } = useExposureContext();

        // Prepare a streaming/plain response
        res.statusCode = 200;
        res.setHeader("content-type", "text/plain; charset=utf-8");

        // Stream transform: upcase and append '!'
        await new Promise<void>((resolve, reject) => {
          req
            .on("data", (c: any) => {
              const buf = Buffer.isBuffer(c) ? c : Buffer.from(String(c));
              const out = Buffer.from(
                buf.toString("utf8").toUpperCase() + "!",
                "utf8",
              );
              res.write(out);
            })
            .on("end", () => {
              res.end();
              resolve();
            })
            .on("error", reject);
        });

        // This result must be ignored by exposure because we've written the response
        return "IGNORED";
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
      id: "ctx.raw.duplex.app",
      register: [duplexTask, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    // Fake raw-body request
    const body = "abc";
    const req: any = new (require("stream").Readable)({ read() {} });
    req.method = "POST";
    req.url = `/__runner/task/${encodeURIComponent(duplexTask.id)}`;
    req.headers = { "content-type": "application/octet-stream" };
    setImmediate(() => {
      for (const ch of body) req.push(Buffer.from(ch));
      req.push(null);
    });

    let status = 0;
    const headers: Record<string, string> = {};
    let payload: Buffer = Buffer.alloc(0);
    const res: any = {
      statusCode: 0,
      headersSent: false,
      writableEnded: false,
      setHeader(name: string, value: string) {
        headers[name.toLowerCase()] = String(value);
      },
      writeHead(code: number, extra?: Record<string, string>) {
        this.statusCode = code;
        if (extra)
          for (const [k, v] of Object.entries(extra))
            this.setHeader(k, v as any);
        this.headersSent = true;
      },
      write(buf?: any) {
        this.headersSent = true;
        if (!buf) return true;
        const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
        payload = Buffer.concat([payload, b]);
        return true;
      },
      end(buf?: any) {
        if (buf) this.write(buf);
        this.writableEnded = true;
        status = this.statusCode || 200;
      },
    };

    await handlers.handleTask(req, res);
    expect(status).toBe(200);
    expect(headers["content-type"]).toMatch(/text\/plain/i);
    // Expect streamed transform: A!B!C!
    expect(payload.toString("utf8")).toBe("A!B!C!");

    await rr.dispose();
  });
});
