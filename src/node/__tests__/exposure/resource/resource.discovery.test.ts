import { defineResource, defineTask } from "../../../../define";
import { run } from "../../../../run";
import { r } from "../../../../index";
import { rpcExposure } from "../testkit/rpcExposure";
import { createReqRes } from "./resource.test.utils";

describe("nodeExposure discovery endpoint", () => {
  it("returns allow-list derived from rpc lanes and enforces auth/methods", async () => {
    const t = defineTask<void, Promise<number>>({
      id: "discovery.ok.task",
      run: async () => 1,
    });

    const rpcLanesServer = defineResource({
      id: "discovery.rpc-lanes",
      tags: [r.runner.tags.rpcLanes],
      async init() {
        return {
          serveTaskIds: [t.id],
          serveEventIds: [],
        };
      },
    });

    const exposure = rpcExposure.with({
      http: {
        basePath: "/__runner",
        auth: { token: "T", allowAnonymous: true },
      },
    });

    const app = defineResource({
      id: "discovery.app",
      register: [t, rpcLanesServer, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure as any);

    // Success: GET /discovery with correct token
    {
      const rrMock = createReqRes({
        method: "GET",
        url: "/__runner/discovery",
        headers: { "x-runner-token": "T" },
        body: null,
      });
      const handled = await handlers.handleRequest(rrMock.req, rrMock.res);
      expect(handled).toBe(true);
      expect(rrMock.status).toBe(200);
      const json = JSON.parse(rrMock.text);
      expect(json.ok).toBe(true);
      expect(json.result.allowList.enabled).toBe(true);
      expect(json.result.allowList.tasks).toContain(t.id);
    }

    // Unauthorized: wrong token
    {
      const rrMock = createReqRes({
        method: "GET",
        url: "/__runner/discovery",
        headers: { "x-runner-token": "WRONG" },
        body: null,
      });
      const handled = await handlers.handleRequest(rrMock.req, rrMock.res);
      expect(handled).toBe(true);
      expect(rrMock.status).toBe(401);
    }

    // Method not allowed: PUT
    {
      const rrMock = createReqRes({
        method: "PUT",
        url: "/__runner/discovery",
        headers: { "x-runner-token": "T" },
        body: null,
      });
      const handled = await handlers.handleRequest(rrMock.req, rrMock.res);
      expect(handled).toBe(true);
      expect(rrMock.status).toBe(405);
    }

    // Preflight: OPTIONS should be handled and return 204
    {
      const rrMock = createReqRes({
        method: "OPTIONS",
        url: "/__runner/discovery",
        headers: { origin: "http://example.test" },
        body: null,
      });
      const handled = await handlers.handleRequest(rrMock.req, rrMock.res);
      expect(handled).toBe(true);
      expect(rrMock.status).toBe(204);
    }

    await rr.dispose();
  });

  it("returns 404 when disableDiscovery is set", async () => {
    const t = defineTask<void, Promise<number>>({
      id: "discovery.disabled.task",
      run: async () => 42,
    });

    const rpcLanesServer = defineResource({
      id: "discovery.disabled.rpc-lanes",
      tags: [r.runner.tags.rpcLanes],
      async init() {
        return {
          serveTaskIds: [t.id],
          serveEventIds: [],
        };
      },
    });

    const exposure = rpcExposure.with({
      http: {
        basePath: "/__runner",
        auth: { token: "T", allowAnonymous: true },
        disableDiscovery: true,
      },
    });

    const app = defineResource({
      id: "discovery.disabled.app",
      register: [t, rpcLanesServer, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure as any);

    const rrMock = createReqRes({
      method: "GET",
      url: "/__runner/discovery",
      headers: { "x-runner-token": "T" },
      body: null,
    });
    const handled = await handlers.handleRequest(rrMock.req, rrMock.res);
    expect(handled).toBe(true);
    expect(rrMock.status).toBe(404);

    await rr.dispose();
  });
});
