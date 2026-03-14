import { defineEvent, defineHook, defineResource } from "../../../../define";
import { run } from "../../../../run";
import { rpcExposure } from "../testkit/rpcExposure";
import { createReqRes } from "./resource.test.utils";
import { createMessageError } from "../../../../errors";

describe("nodeExposure Coverage - Events", () => {
  it("covers event not-found branches", async () => {
    const okEvent = defineEvent<{ v?: number }>({ id: "ok-event" });
    const exposure = rpcExposure.with({
      http: {
        basePath: "/__runner",
        auth: { token: "T", allowAnonymous: true },
      },
    });
    const app = defineResource({
      id: "unit-exposure-coverage-events-app1",
      register: [okEvent, exposure],
    });
    const rr = await run(app);
    const okEventId = rr.store.findIdByDefinition(okEvent);
    const handlers = await rr.getResourceValue(exposure as any);

    // method not allowed
    {
      const rrMock = createReqRes({
        method: "GET",
        url: `/__runner/event/${encodeURIComponent(okEventId)}`,
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
      expect(rrMock.status).toBe(403);
    }

    await rr.dispose();
  });

  it("processEventRequest handles non-Error and Error from emit failures", async () => {
    const evt = defineEvent<void>({ id: "coverage-event-error" });
    const hook = defineHook({
      id: "coverage-event-error-hook",
      on: evt,
      run: async () => {
        throw createMessageError("emit failure");
      },
    });
    const exposure = rpcExposure.with({
      http: {
        basePath: "/__runner",
        auth: { token: "EVERR", allowAnonymous: true },
      },
    });
    const app = defineResource({
      id: "coverage-event-error-app",
      register: [evt, hook, exposure],
    });
    const rr = await run(app);
    const eventId = rr.store.findIdByDefinition(evt);
    const handlers = await rr.getResourceValue(exposure as any);

    const container = createReqRes({
      url: `/__runner/event/${encodeURIComponent(eventId)}`,
      headers: { "x-runner-token": "EVERR" },
      body: "{}",
    });
    await handlers.handleEvent(container.req, container.res);
    expect(container.status).toBe(500);

    await rr.dispose();
  });
});
