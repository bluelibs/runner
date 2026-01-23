import * as http from "http";
import { defineEvent, defineResource } from "../../../../define";
import { run } from "../../../../run";
import { nodeExposure } from "../../../exposure/resource";
import { createReqRes } from "./resource.test.utils";

describe("nodeExposure Coverage - Auth", () => {
  it("auth header override works and missing header rejects", async () => {
    const okEvent = defineEvent<{ v?: number }>({ id: "ok.event.custom" });
    const exposure = nodeExposure.with({
      http: { dangerouslyAllowOpenExposure: true, server: http.createServer(), basePath: "/__runner", auth: { token: "ABC", header: "x-custom-token" } },
    });
    const app = defineResource({ id: "unit.exposure.coverage.auth.app8", register: [okEvent, exposure] });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    {
      const rrMock = createReqRes({ url: `/__runner/event/${encodeURIComponent(okEvent.id)}`, headers: { "x-custom-token": "ABC" } });
      await handlers.handleEvent(rrMock.req, rrMock.res);
      expect(rrMock.status).toBe(200);
    }
    {
      const rrMock = createReqRes({ url: `/__runner/event/${encodeURIComponent(okEvent.id)}`, headers: {} });
      await handlers.handleEvent(rrMock.req, rrMock.res);
      expect(rrMock.status).toBe(401);
    }

    await rr.dispose();
  });

  it("accepts auth tokens provided as array headers", async () => {
    const evt = defineEvent<void>({ id: "coverage.header.arr" });
    const exposure = nodeExposure.with({
      http: { dangerouslyAllowOpenExposure: true, server: http.createServer(), basePath: "/__runner", auth: { token: "ARR" } },
    });
    const app = defineResource({ id: "coverage.header.app", register: [evt, exposure] });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const { req, res } = createReqRes({ url: `/__runner/event/${encodeURIComponent(evt.id)}`, headers: { "x-runner-token": "ARR" }, body: "{}" });
    req.headers["x-runner-token"] = ["ARR"];

    await handlers.handleEvent(req, res);
    expect(res.statusCode).toBe(200);

    await rr.dispose();
  });
});
