import * as http from "http";
import { defineResource, defineTask, defineEvent } from "../../../../define";
import { globalTags } from "../../../../globals/globalTags";
import type { TunnelRunner } from "../../../../globals/resources/tunnel/types";
import { run } from "../../../../run";
import { nodeExposure } from "../../../exposure/resource";
import { makeReqRes } from "./resource.more-coverage.test.utils";

describe("nodeExposure - more tunnel coverage", () => {
  it("auto-detects server-mode http tunnels and logs discovery", async () => {
    const allowedTask = defineTask<{ v: number }, Promise<number>>({ id: "exposer.auto.echo", run: async ({ v }) => v });
    const allowedEv = defineEvent<{ a: number }>({ id: "exposer.auto.ev" });
    const srvTunnel = defineResource({
      id: "exposer.more.server-tunnel",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({ mode: "server", transport: "http", tasks: [allowedTask.id], events: [allowedEv.id] }),
    });

    const createServerSpy = jest.spyOn(http, "createServer").mockImplementation(() => {
      const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
      return {
        on(event: string, handler: (...args: unknown[]) => void) {
          const arr = listeners.get(event) ?? [];
          arr.push(handler);
          listeners.set(event, arr);
          return this;
        },
        listen(_port: number, _host?: string, cb?: () => void) { cb?.(); return this; },
        close(cb?: () => void) { cb?.(); },
        address() { return { port: 0 }; },
      } as unknown as http.Server;
    });

    try {
      const exposure = require("../../../exposure/resource").nodeExposure.with({ http: { dangerouslyAllowOpenExposure: true, listen: { port: 0 }, basePath: "/__runner", auth: { token: "T" } } });
      const app = defineResource({ id: "exposer.more.app.autodetect", register: [allowedTask, allowedEv, srvTunnel, exposure] });
      const rr = await require("../../../../run").run(app);
      await rr.dispose();
    } finally {
      createServerSpy.mockRestore();
    }
  });

  it("serves only allowlisted ids when server-mode http tunnels exist", async () => {
    const allowed = defineTask<{ v: number }, Promise<number>>({ id: "exposer.auto.allowed", run: async ({ v }) => v });
    const ev = defineEvent<{ n: number }>({ id: "exposer.auto.allowed.ev" });
    const notAllowed = defineTask<{ v: number }, Promise<number>>({ id: "exposer.auto.notAllowed", run: async ({ v }) => v });

    const srvTunnel = defineResource({
      id: "exposer.auto.server",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({ mode: "server", transport: "http", tasks: [allowed.id], events: [ev] }),
    });

    const exposure = nodeExposure.with({ http: { dangerouslyAllowOpenExposure: true, server: http.createServer(), basePath: "/__runner", auth: { token: "T" } } });
    const app = defineResource({ id: "exposer.auto.app6", register: [srvTunnel, allowed, notAllowed, ev, exposure] });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource);

    // Allowed task -> 200
    {
      const body = JSON.stringify({ input: { v: 5 } });
      const { req, res } = makeReqRes(body, { "x-runner-token": "T", "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) });
      req.url = `/__runner/task/${encodeURIComponent(allowed.id)}`;
      await handlers.handleTask(req, res);
      expect(res.statusCode).toBe(200);
    }
    // Not allowed task -> 403
    {
      const body = JSON.stringify({ input: { v: 5 } });
      const { req, res } = makeReqRes(body, { "x-runner-token": "T", "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) });
      req.url = `/__runner/task/${encodeURIComponent(notAllowed.id)}`;
      await handlers.handleTask(req, res);
      expect(res.statusCode).toBe(403);
    }
    // Allowed event -> 200
    {
      const body = JSON.stringify({ payload: { n: 1 } });
      const { req, res } = makeReqRes(body, { "x-runner-token": "T", "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) });
      req.url = `/__runner/event/${encodeURIComponent(ev.id)}`;
      await handlers.handleEvent(req, res);
      expect(res.statusCode).toBe(200);
    }
    // Not allowed event -> 403
    {
      const ev2 = defineEvent<{ m: string }>({ id: "exposer.auto.notAllowed.ev" });
      const body = JSON.stringify({ payload: { m: "x" } });
      const { req, res } = makeReqRes(body, { "x-runner-token": "T", "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) });
      req.url = `/__runner/event/${encodeURIComponent(ev2.id)}`;
      await handlers.handleEvent(req, res);
      expect(res.statusCode).toBe(403);
    }
    await rr.dispose();
  });
});
