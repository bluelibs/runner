import * as http from "http";
import { defineResource, defineTask } from "../../../../define";
import { run } from "../../../../run";
import { nodeExposure } from "../../../exposure/resource";
import { createReqRes } from "./security.test.utils";

describe("Security Limits - JSON", () => {
  it("rejects JSON body > 2MB with 413", async () => {
    const t = defineTask<any, Promise<string>>({ id: "tests.security.json", async run() { return "ok"; } });
    const exposure = nodeExposure.with({ http: { dangerouslyAllowOpenExposure: true, server: http.createServer(), basePath: "/__runner", auth: { allowAnonymous: true } } });
    const app = defineResource({ id: "tests.app.security.json", register: [t, exposure] });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);
      const largeBody = JSON.stringify({ data: "a".repeat(2 * 1024 * 1024 + 1) });
      const transport = createReqRes({ method: "POST", url: `/__runner/task/${encodeURIComponent(t.id)}`, headers: { "content-type": "application/json" }, body: largeBody });
      await handlers.handleTask(transport.req as any, transport.res as any);
      expect(transport.res.statusCode).toBe(413);
      expect(transport.json.error.code).toBe("PAYLOAD_TOO_LARGE");
    } finally {
      await rr.dispose();
    }
  });

  it("handles requestBody multi-chunk abortion and custom maxSize", async () => {
    const t = defineTask<any, Promise<string>>({ id: "tests.security.boundary.json.abort", async run() { return "ok"; } });
    const exposure = nodeExposure.with({ http: { dangerouslyAllowOpenExposure: true, limits: { json: { maxSize: 10 } }, auth: { allowAnonymous: true } } });
    const app = defineResource({ id: "tests.app.security.body.abort", register: [t, exposure] });
    const rr = await run(app);
    try {
      const handlers = await rr.getResourceValue(exposure.resource as any);
      const transport = createReqRes({ url: `/__runner/task/${encodeURIComponent(t.id)}`, headers: { "content-type": "application/json" } });
      setImmediate(() => {
        transport.req.push('{ "a": ');
        transport.req.push('"Too many characters in this string to fit in 10 bytes"');
        transport.req.push(" }");
        transport.req.push(null);
      });
      await handlers.handleTask(transport.req as any, transport.res as any);
      expect(transport.res.statusCode).toBe(413);
    } finally {
      await rr.dispose();
    }
  });
});
