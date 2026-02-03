import * as http from "http";
import { defineEvent, defineHook, defineResource } from "../../../../define";
import { run } from "../../../../run";
import { nodeExposure } from "../../../exposure/resource";
import { createReqRes } from "./resource.test.utils";

describe("nodeExposure Coverage - Events", () => {
  it("covers event not-found branches", async () => {
    const okEvent = defineEvent<{ v?: number }>({ id: "ok.event" });
    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "T" },
      },
    });
    const app = defineResource({
      id: "unit.exposure.coverage.events.app1",
      register: [okEvent, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    // method not allowed
    {
      const rrMock = createReqRes({
        method: "GET",
        url: `/__runner/event/${encodeURIComponent(okEvent.id)}`,
        headers: { "x-runner-token": "T" },
      });
      await handlers.handleEvent(rrMock.req, rrMock.res);
      expect(rrMock.status).toBe(405);
    }
    // event not found
    {
      const rrMock = createReqRes({
        url: "/__runner/event/missing.event",
        headers: { "x-runner-token": "T" },
      });
      await handlers.handleEvent(rrMock.req, rrMock.res);
      expect(rrMock.status).toBe(404);
    }

    await rr.dispose();
  });

  it("processEventRequest handles non-Error and Error from emit failures", async () => {
    const evt = defineEvent<void>({ id: "coverage.event.error" });
    const hook = defineHook({
      id: "coverage.event.error.hook",
      on: evt,
      run: async () => {
        throw new Error("emit failure");
      },
    });
    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "EVERR" },
      },
    });
    const app = defineResource({
      id: "coverage.event.error.app",
      register: [evt, hook, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const container = createReqRes({
      url: `/__runner/event/${encodeURIComponent(evt.id)}`,
      headers: { "x-runner-token": "EVERR" },
      body: "{}",
    });
    await handlers.handleEvent(container.req, container.res);
    expect(container.status).toBe(500);

    await rr.dispose();
  });
});
