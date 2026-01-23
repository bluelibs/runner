import * as http from "http";
import { defineResource, defineTask } from "../../../define";
import { run } from "../../../run";
import { globals } from "../../../index";
import type { TunnelRunner } from "../../../globals/resources/tunnel/types";
import { nodeExposure } from "../../exposure/resource";

describe("nodeExposure discovery endpoint", () => {
  it("returns allow-list derived from server http tunnels and enforces auth/methods", async () => {
    const t = defineTask<void, Promise<number>>({
      id: "discovery.ok.task",
      run: async () => 1,
    });

    const tunnelServer = defineResource({
      id: "discovery.tunnel",
      tags: [globals.tags.tunnel],
      async init(): Promise<TunnelRunner> {
        return {
          mode: "server",
          transport: "http",
          tasks: [t.id],
          events: [],
        } satisfies TunnelRunner;
      },
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
      id: "discovery.app",
      register: [t, tunnelServer, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    // Success: GET /discovery with correct token
    {
      const req: any = {
        method: "GET",
        url: "/__runner/discovery",
        headers: { "x-runner-token": "T" },
        on(ev: string, cb: Function) {
          if (ev === "end") setImmediate(() => cb());
          return this;
        },
      };
      let status = 0;
      let body = Buffer.alloc(0);
      const res: any = {
        setHeader() {},
        statusCode: 0,
        end(payload?: any) {
          status = this.statusCode;
          if (payload != null)
            body = Buffer.isBuffer(payload)
              ? payload
              : Buffer.from(String(payload));
        },
      };
      const handled = await handlers.handleRequest(req, res);
      expect(handled).toBe(true);
      expect(status).toBe(200);
      const json = JSON.parse(body.toString("utf8"));
      expect(json.ok).toBe(true);
      expect(json.result.allowList.enabled).toBe(true);
      expect(json.result.allowList.tasks).toContain(t.id);
    }

    // Unauthorized: wrong token
    {
      const req: any = {
        method: "GET",
        url: "/__runner/discovery",
        headers: { "x-runner-token": "WRONG" },
        on(ev: string, cb: Function) {
          if (ev === "end") setImmediate(() => cb());
          return this;
        },
      };
      let status = 0;
      const res: any = {
        setHeader() {},
        statusCode: 0,
        end() {
          status = this.statusCode;
        },
      };
      const handled = await handlers.handleRequest(req, res);
      expect(handled).toBe(true);
      expect(status).toBe(401);
    }

    // Method not allowed: PUT
    {
      const req: any = {
        method: "PUT",
        url: "/__runner/discovery",
        headers: { "x-runner-token": "T" },
        on(ev: string, cb: Function) {
          if (ev === "end") setImmediate(() => cb());
          return this;
        },
      };
      let status = 0;
      const res: any = {
        setHeader() {},
        statusCode: 0,
        end() {
          status = this.statusCode;
        },
      };
      const handled = await handlers.handleRequest(req, res);
      expect(handled).toBe(true);
      expect(status).toBe(405);
    }

    // Preflight: OPTIONS should be handled and return 204
    {
      const req: any = {
        method: "OPTIONS",
        url: "/__runner/discovery",
        headers: { origin: "http://example.test" },
        on(ev: string, cb: Function) {
          if (ev === "end") setImmediate(() => cb());
          return this;
        },
      };
      let status = 0;
      const res: any = {
        setHeader() {},
        statusCode: 0,
        end() {
          status = this.statusCode;
        },
      };
      const handled = await handlers.handleRequest(req, res);
      expect(handled).toBe(true);
      expect(status).toBe(204);
    }

    await rr.dispose();
  });
});
