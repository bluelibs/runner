import * as http from "http";
import { defineResource } from "../../define";
import { run } from "../../run";
import { defineTask } from "../../definers/defineTask";
import { nodeExposure, useExposureContext } from "../index";

describe("nodeExposure multipart hijack", () => {
  it("skips JSON when multipart task writes to res directly", async () => {
    const t = defineTask<{ any?: string }, Promise<string>>({
      id: "multipart.hijack",
      run: async () => {
        const { res } = useExposureContext();
        res.statusCode = 200;
        res.setHeader("content-type", "text/plain");
        res.write("X");
        res.end();
        return "IGNORED";
      },
    });

    const exposure = nodeExposure.with({ http: { server: http.createServer(), basePath: "/__runner" } });
    const app = defineResource({ id: "multipart.hijack.app", register: [t, exposure] });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const boundary = "----jest-boundary";
    const manifest = JSON.stringify({ input: { any: "ok" } });
    const crlf = "\r\n";
    const body = Buffer.from(
      `--${boundary}${crlf}` +
        `Content-Disposition: form-data; name="__manifest"${crlf}` +
        `Content-Type: application/json; charset=utf-8${crlf}${crlf}` +
        manifest +
        `${crlf}--${boundary}--${crlf}`,
      "utf8",
    );

    const req: any = new (require("stream").Readable)({ read() {} });
    req.method = "POST";
    req.url = `/__runner/task/${encodeURIComponent(t.id)}`;
    req.headers = { "content-type": `multipart/form-data; boundary=${boundary}` };
    setImmediate(() => {
      req.push(body);
      req.push(null);
    });

    let status = 0;
    let payload: Buffer = Buffer.alloc(0);
    const res: any = {
      statusCode: 0,
      headersSent: false,
      writableEnded: false,
      setHeader() {},
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
    expect(payload.toString("utf8")).toBe("X");

    await rr.dispose();
  });
});

