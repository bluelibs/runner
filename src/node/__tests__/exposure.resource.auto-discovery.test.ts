import * as http from "http";
import { defineResource, defineTask, defineEvent } from "../../define";
import { run } from "../../run";
import { nodeExposure } from "../exposure.resource";
import { globalTags } from "../../globals/globalTags";
import type { TunnelRunner } from "../../globals/resources/tunnel/types";

describe("nodeExposure auto-discovery (server-mode http)", () => {
  it("allows only server-tunnel-allowlisted ids and uses store.resources.get() values", async () => {
    const allowed = defineTask<{ v: number }, Promise<number>>({
      id: "auto.disc.allowed",
      run: async ({ v }) => v,
    });
    const notAllowed = defineTask<{ v: number }, Promise<number>>({
      id: "auto.disc.notAllowed",
      run: async ({ v }) => v,
    });
    const allowedEvent = defineEvent<{ n: number }>({
      id: "auto.disc.allowed.ev",
    });

    const srvTunnel = defineResource({
      id: "auto.disc.tunnel",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "server",
        transport: "http",
        tasks: [allowed.id],
        events: [allowedEvent.id],
      }),
    });

    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "T" },
      },
    });

    const app = defineResource({
      id: "auto.disc.app",
      register: [srvTunnel, allowed, notAllowed, allowedEvent, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    // Allowed task -> 200
    {
      const body = JSON.stringify({ input: { v: 1 } });
      const req: any = new (require("stream").Readable)({ read() {} });
      req.method = "POST";
      req.url = `/__runner/task/${encodeURIComponent(allowed.id)}`;
      req.headers = {
        "x-runner-token": "T",
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
      };
      setImmediate(() => {
        req.push(Buffer.from(body));
        req.push(null);
      });
      const res: any = { statusCode: 0, setHeader() {}, end() {} };
      await handlers.handleTask(req, res);
      expect(res.statusCode).toBe(200);
    }

    // Not allowed task -> 404
    {
      const body = JSON.stringify({ input: { v: 1 } });
      const req: any = new (require("stream").Readable)({ read() {} });
      req.method = "POST";
      req.url = `/__runner/task/${encodeURIComponent(notAllowed.id)}`;
      req.headers = {
        "x-runner-token": "T",
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
      };
      setImmediate(() => {
        req.push(Buffer.from(body));
        req.push(null);
      });
      const res: any = { statusCode: 0, setHeader() {}, end() {} };
      await handlers.handleTask(req, res);
      expect(res.statusCode).toBe(404);
    }

    // Allowed event -> 200
    {
      const body = JSON.stringify({ payload: { n: 1 } });
      const req: any = new (require("stream").Readable)({ read() {} });
      req.method = "POST";
      req.url = `/__runner/event/${encodeURIComponent(allowedEvent.id)}`;
      req.headers = {
        "x-runner-token": "T",
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
      };
      setImmediate(() => {
        req.push(Buffer.from(body));
        req.push(null);
      });
      const res: any = { statusCode: 0, setHeader() {}, end() {} };
      await handlers.handleEvent(req, res);
      expect(res.statusCode).toBe(200);
    }

    await rr.dispose();
  });
});

