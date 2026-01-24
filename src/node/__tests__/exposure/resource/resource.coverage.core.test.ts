import * as http from "http";
import { defineTask, defineResource } from "../../../../define";
import { run } from "../../../../run";
import { nodeExposure } from "../../../exposure/resource";
import { createReqRes } from "./resource.test.utils";

describe("nodeExposure Coverage - Core Routing", () => {
  it("covers extractTarget fallback, method 405/401, and not-found branches for task", async () => {
    const okTask = defineTask<void, Promise<number>>({
      id: "ok.task",
      run: async () => 42,
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
      id: "unit.exposure.coverage.core.app1",
      register: [okTask, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    // handleTask: non-base path -> 404
    {
      const rrMock = createReqRes({
        method: "POST",
        url: `/not-runner/task/${encodeURIComponent(okTask.id)}`,
        headers: { "x-runner-token": "T" },
      });
      await handlers.handleTask(rrMock.req, rrMock.res);
      expect(rrMock.status).toBe(404);
    }

    // handleTask: method not allowed -> 405
    {
      const rrMock = createReqRes({
        method: "GET",
        url: `/__runner/task/${encodeURIComponent(okTask.id)}`,
        headers: { "x-runner-token": "T" },
      });
      await handlers.handleTask(rrMock.req, rrMock.res);
      expect(rrMock.status).toBe(405);
    }

    // handleTask: unknown kind inside basePath -> 404
    {
      const rrMock = createReqRes({
        url: "/__runner/unknown/something",
        headers: { "x-runner-token": "T" },
      });
      await handlers.handleTask(rrMock.req, rrMock.res);
      expect(rrMock.status).toBe(404);
    }

    await rr.dispose();
  });

  it("handleRequest dispatches correctly and returns false outside base", async () => {
    const okTask = defineTask<void, Promise<number>>({
      id: "hr.task",
      run: async () => 1,
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
      id: "unit.exposure.coverage.core.app2",
      register: [okTask, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    {
      const rrMock = createReqRes({
        url: "/not-runner",
        headers: { "x-runner-token": "T" },
      });
      const handled = await handlers.handleRequest(rrMock.req, rrMock.res);
      expect(handled).toBe(false);
    }

    {
      const rrMock = createReqRes({
        url: "/__runner/",
        headers: { "x-runner-token": "T" },
      });
      const handled = await handlers.handleRequest(rrMock.req, rrMock.res);
      expect(handled).toBe(true);
      expect(rrMock.status).toBe(404);
    }

    await rr.dispose();
  });

  it("attachTo and detachTo coverage", async () => {
    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "DET" },
      },
    });
    const app = defineResource({
      id: "coverage.detach.app",
      register: [exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const listeners = new Map<string, Function[]>();
    const fakeServer: any = {
      on(event: string, handler: Function) {
        const arr = listeners.get(event) ?? [];
        arr.push(handler);
        listeners.set(event, arr);
        return this;
      },
      off(event: string, handler: Function) {
        const arr = listeners.get(event) ?? [];
        const idx = arr.indexOf(handler);
        if (idx >= 0) arr.splice(idx, 1);
        listeners.set(event, arr);
        return this;
      },
    };

    const detach = handlers.attachTo(fakeServer as unknown as http.Server);
    expect(listeners.get("request")?.length).toBe(1);
    detach();
    detach(); // call again for !active branch
    expect(listeners.get("request")?.length ?? 0).toBe(0);

    await rr.dispose();
  });

  it("handleTask handles malformed paths via router guard branches", async () => {
    const okTask = defineTask<void, Promise<number>>({
      id: "coverage.router.task",
      run: async () => 1,
    });
    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "R" },
      },
    });
    const app = defineResource({
      id: "coverage.router.app",
      register: [okTask, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);
    const headers = { "x-runner-token": "R" };

    {
      const { req, res } = createReqRes({
        url: `/something/task/${encodeURIComponent(okTask.id)}`,
        headers,
      });
      await handlers.handleTask(req, res);
      expect(res.statusCode).toBe(404);
    }
    {
      const { req, res } = createReqRes({ url: `/__runner/task/`, headers });
      await handlers.handleTask(req, res);
      expect(res.statusCode).toBe(404);
    }
    {
      const { req, res } = createReqRes({
        url: `/__runner/foo/${encodeURIComponent(okTask.id)}`,
        headers,
      });
      await handlers.handleTask(req, res);
      expect(res.statusCode).toBe(404);
    }
    {
      const { req, res } = createReqRes({ url: `/__runner/task/%`, headers });
      await handlers.handleTask(req, res);
      expect(res.statusCode).toBe(404);
    }

    await rr.dispose();
  });
});
