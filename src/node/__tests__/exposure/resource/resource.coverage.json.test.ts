import * as http from "http";
import { defineTask, defineResource } from "../../../../define";
import { run } from "../../../../run";
import { nodeExposure } from "../../../exposure/resource";
import { createReqRes } from "./resource.test.utils";

describe("nodeExposure Coverage - JSON and Buffers", () => {
  it("readJson buffer branch and success: task JSON body succeeds", async () => {
    const okTask = defineTask<{ n?: number }, Promise<number>>({ id: "ok.task.buffer", run: async ({ n = 1 }) => n });
    const exposure = nodeExposure.with({
      http: { dangerouslyAllowOpenExposure: true, server: http.createServer(), basePath: "/__runner", auth: { allowAnonymous: true } },
    });
    const app = defineResource({ id: "unit.exposure.coverage.json.app5", register: [okTask, exposure] });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const rrMock = createReqRes({
      url: `/__runner/task/${encodeURIComponent(okTask.id)}`,
      headers: { "content-type": "application/json" },
      manualPush: true,
    });
    setImmediate(() => {
      rrMock.req.push(Buffer.from('{"input":{"n":2}}', "utf8"));
      rrMock.req.push(null);
    });

    await handlers.handleTask(rrMock.req, rrMock.res);
    expect(rrMock.json).toEqual({ ok: true, result: 2 });
    await rr.dispose();
  });

  it("returns 400 when task JSON parsing fails", async () => {
    const echo = defineTask<{ v: number }, Promise<number>>({ id: "coverage.json.fail", run: async ({ v }) => v });
    const exposure = nodeExposure.with({
      http: { dangerouslyAllowOpenExposure: true, server: http.createServer(), basePath: "/__runner", auth: { token: "ARR" } },
    });
    const app = defineResource({ id: "coverage.json.app", register: [echo, exposure] });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const rrMock = createReqRes({
      url: `/__runner/task/${encodeURIComponent(echo.id)}`,
      headers: { "x-runner-token": "ARR", "content-type": "application/json" },
      manualPush: true,
    });
    setImmediate(() => {
      rrMock.req.push("{");
      rrMock.req.push(null);
    });

    await handlers.handleTask(rrMock.req, rrMock.res);
    expect(rrMock.status).toBe(400);
    expect(rrMock.json?.error?.code).toBe("INVALID_JSON");
    await rr.dispose();
  });

  it("rejects JSON body when request is aborted", async () => {
    const echo = defineTask<void, Promise<number>>({ id: "coverage.abort.task", run: async () => 1 });
    const exposure = nodeExposure.with({
      http: { dangerouslyAllowOpenExposure: true, server: http.createServer(), basePath: "/__runner", auth: { token: "AB" } },
    });
    const app = defineResource({ id: "coverage.abort.app", register: [echo, exposure] });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const rrMock = createReqRes({
      url: `/__runner/task/${encodeURIComponent(echo.id)}`,
      headers: { "x-runner-token": "AB", "content-type": "application/json" },
      manualPush: true,
    });
    setImmediate(() => rrMock.req.emit("aborted"));

    await handlers.handleTask(rrMock.req, rrMock.res);
    expect(rrMock.status).toBe(499);
    expect(rrMock.json?.error?.code).toBe("REQUEST_ABORTED");
    await rr.dispose();
  });
});
