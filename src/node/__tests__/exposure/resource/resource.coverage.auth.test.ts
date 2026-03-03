import { defineEvent, defineResource, defineTask } from "../../../../define";
import { run } from "../../../../run";
import { globalTags } from "../../../../globals/globalTags";
import { rpcExposure } from "../testkit/rpcExposure";
import { createReqRes } from "./resource.test.utils";

describe("nodeExposure Coverage - Auth", () => {
  it("auth header override works and missing header rejects", async () => {
    const okEvent = defineEvent<{ v?: number }>({ id: "ok.event.custom" });
    const exposure = rpcExposure.with({
      http: {
        basePath: "/__runner",
        auth: { token: "ABC", header: "x-custom-token", allowAnonymous: true },
      },
    });
    const app = defineResource({
      id: "unit.exposure.coverage.auth.app8",
      register: [okEvent, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure as any);

    {
      const rrMock = createReqRes({
        url: `/__runner/event/${encodeURIComponent(okEvent.id)}`,
        headers: { "x-custom-token": "ABC" },
      });
      await handlers.handleEvent(rrMock.req, rrMock.res);
      expect(rrMock.status).toBe(200);
    }
    {
      const rrMock = createReqRes({
        url: `/__runner/event/${encodeURIComponent(okEvent.id)}`,
        headers: {},
      });
      await handlers.handleEvent(rrMock.req, rrMock.res);
      expect(rrMock.status).toBe(401);
    }

    await rr.dispose();
  });

  it("accepts auth tokens provided as array headers", async () => {
    const evt = defineEvent<void>({ id: "coverage.header.arr" });
    const exposure = rpcExposure.with({
      http: {
        basePath: "/__runner",
        auth: { token: "ARR", allowAnonymous: true },
      },
    });
    const app = defineResource({
      id: "coverage.header.app",
      register: [evt, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure as any);

    const { req, res } = createReqRes({
      url: `/__runner/event/${encodeURIComponent(evt.id)}`,
      headers: { "x-runner-token": "ARR" },
      body: "{}",
    });
    req.headers["x-runner-token"] = ["ARR"];

    await handlers.handleEvent(req, res);
    expect(res.statusCode).toBe(200);

    await rr.dispose();
  });

  it("discovers auth validator tasks via tag dependencies", async () => {
    const evt = defineEvent<void>({ id: "coverage.auth.validator.discovery" });
    const validatorTask = defineTask({
      id: "coverage.auth.validator.task",
      tags: [globalTags.authValidator],
      run: async () => ({ ok: true }),
    });
    const exposure = rpcExposure.with({
      http: {
        basePath: "/__runner",
        auth: { allowAnonymous: true },
      },
    });
    const app = defineResource({
      id: "coverage.auth.validator.app",
      register: [evt, validatorTask, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure as any);

    const { req, res } = createReqRes({
      url: `/__runner/event/${encodeURIComponent(evt.id)}`,
      headers: {},
      body: "{}",
    });

    await handlers.handleEvent(req, res);
    expect(res.statusCode).toBe(200);

    await rr.dispose();
  });
});
