import * as http from "http";
import {
  startExposureServer,
  request,
  testTask,
  testEvent,
  noInputTask,
  TOKEN,
} from "./resource.unit.test.utils";
import { createReqRes } from "./resource.test.utils";

const D = process.env.RUNNER_TEST_NET === "1" ? describe : describe.skip;

D("nodeExposure - unit errors", () => {
  it("returns 400 INVALID_JSON when JSON parsing fails (task)", async () => {
    const { rr, baseUrl } = await startExposureServer();
    const h = { "x-runner-token": TOKEN, "content-type": "application/json" };
    const res = await request({
      method: "POST",
      url: `${baseUrl}/task/${encodeURIComponent(testTask.id)}`,
      headers: h,
      body: "{",
    });
    expect(res.status).toBe(400);
    const payload = JSON.parse(res.text);
    expect(payload?.error?.code).toBe("INVALID_JSON");
    await rr.dispose();
  });

  it("treats aborted JSON bodies as internal errors", async () => {
    const { rr, handlers } = await startExposureServer();
    const rrMock = createReqRes({
      url: `/__runner/task/${encodeURIComponent(testTask.id)}`,
      headers: {
        "x-runner-token": TOKEN,
        "content-type": "application/json",
      },
      manualPush: true,
      body: null,
    });
    setImmediate(() => {
      rrMock.req.emit("aborted");
      rrMock.req.push(null);
    });
    await handlers.handleTask(rrMock.req, rrMock.res);
    expect(rrMock.resStatus).toBe(500);
    await rr.dispose();
  });

  it("returns 500 for invalid JSON body when posting to event endpoint", async () => {
    const { rr, baseUrl } = await startExposureServer();
    const h = { "x-runner-token": TOKEN };
    const r = await request({
      method: "POST",
      url: `${baseUrl}/event/${encodeURIComponent(testEvent.id)}`,
      headers: h,
      body: "not-json",
    });
    expect(r.status).toBe(500);
    await rr.dispose();
  });

  it("returns 500 for task validation error (handleTask catch branch)", async () => {
    const { rr, handlers } = await startExposureServer();
    const proxyToTask = http.createServer((req, res) => {
      void handlers.handleTask(req, res);
    });
    await new Promise<void>((r) =>
      proxyToTask.listen(0, "127.0.0.1", () => r()),
    );
    const addr = proxyToTask.address();
    if (!addr || typeof addr === "string") throw new Error("No address");
    const url = `http://127.0.0.1:${addr.port}/__runner/task/${encodeURIComponent(testTask.id)}`;
    const h = { "x-runner-token": TOKEN };
    const r = await request({ method: "POST", url, headers: h, body: "{}" });
    expect(r.status).toBe(500);
    await new Promise<void>((r) => proxyToTask.close(() => r()));
    await rr.dispose();
  });

  it("handles task with empty body (readJson undefined branch)", async () => {
    const { rr, handlers } = await startExposureServer();
    const proxyToTask = http.createServer((req, res) => {
      void handlers.handleTask(req, res);
    });
    await new Promise<void>((r) =>
      proxyToTask.listen(0, "127.0.0.1", () => r()),
    );
    const addr = proxyToTask.address();
    if (!addr || typeof addr === "string") throw new Error("No address");
    const url = `http://127.0.0.1:${addr.port}/__runner/task/${encodeURIComponent(noInputTask.id)}`;
    const h = { "x-runner-token": TOKEN };
    const result = await request({ method: "POST", url, headers: h });
    expect(result.status).toBe(200);
    await new Promise<void>((r) => proxyToTask.close(() => r()));
    await rr.dispose();
  });

  it("returns 404 when posting to missing event id (store lookup)", async () => {
    const { rr, baseUrl } = await startExposureServer();
    const h = { "x-runner-token": TOKEN };
    const r = await request({
      method: "POST",
      url: `${baseUrl}/event/${encodeURIComponent("unit.exposure.missing-event")}`,
      headers: h,
      body: "{}",
    });
    expect(r.status).toBe(404);
    await rr.dispose();
  });
});
