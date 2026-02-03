import * as http from "http";
import { defineResource, defineTask, defineEvent } from "../../../../define";
import { run } from "../../../../run";
import { nodeExposure } from "../../../exposure/resource";
import { globalTags } from "../../../../globals/globalTags";
import type { TunnelRunner } from "../../../../globals/resources/tunnel/types";
import { createMockReqRes } from "./resource.http.testkit";

describe("nodeExposure auto-discovery (server-mode http)", () => {
  function makeJsonReqRes(body: string, url: string) {
    const rrMock = createMockReqRes({
      method: "POST",
      url,
      headers: {
        "x-runner-token": "T",
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
      },
      manualPush: true,
      body: null,
    });
    setImmediate(() => {
      rrMock.req.push(Buffer.from(body));
      rrMock.req.push(null);
    });
    return rrMock;
  }

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
        dangerouslyAllowOpenExposure: true,
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
    const handlers = await rr.getResourceValue(exposure.resource);

    // Allowed task -> 200
    {
      const body = JSON.stringify({ input: { v: 1 } });
      const rrMock = makeJsonReqRes(
        body,
        `/__runner/task/${encodeURIComponent(allowed.id)}`,
      );
      await handlers.handleTask(rrMock.req, rrMock.res);
      expect(rrMock.resStatus).toBe(200);
    }

    // Not allowed task -> 403 (forbidden when not allowlisted)
    {
      const body = JSON.stringify({ input: { v: 1 } });
      const rrMock = makeJsonReqRes(
        body,
        `/__runner/task/${encodeURIComponent(notAllowed.id)}`,
      );
      await handlers.handleTask(rrMock.req, rrMock.res);
      expect(rrMock.resStatus).toBe(403);
    }

    // Allowed event -> 200
    {
      const body = JSON.stringify({ payload: { n: 1 } });
      const rrMock = makeJsonReqRes(
        body,
        `/__runner/event/${encodeURIComponent(allowedEvent.id)}`,
      );
      await handlers.handleEvent(rrMock.req, rrMock.res);
      expect(rrMock.resStatus).toBe(200);
    }

    await rr.dispose();
  });
});
