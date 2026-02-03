import * as http from "http";
import { defineResource } from "../../../../define";
import { run } from "../../../../run";
import { nodeExposure } from "../../../exposure/resource";
import {
  startExposureServer,
  request,
  testTask,
  testEvent,
  TOKEN,
} from "./resource.unit.test.utils";

const D = process.env.RUNNER_TEST_NET === "1" ? describe : describe.skip;

D("nodeExposure - unit core", () => {
  it("returns 405 for GET on task and event endpoints", async () => {
    const { rr, baseUrl } = await startExposureServer();
    const h = { "x-runner-token": TOKEN };
    const r1 = await request({
      method: "GET",
      url: `${baseUrl}/task/${encodeURIComponent(testTask.id)}`,
      headers: h,
    });
    expect(r1.status).toBe(405);
    const r2 = await request({
      method: "GET",
      url: `${baseUrl}/event/${encodeURIComponent(testEvent.id)}`,
      headers: h,
    });
    expect(r2.status).toBe(405);
    await rr.dispose();
  });

  it("returns 404 for target-less base path and for non-base paths (server wrapper)", async () => {
    const { rr, baseUrl } = await startExposureServer();
    const h = { "x-runner-token": TOKEN };
    const r1 = await request({
      method: "POST",
      url: `${baseUrl}`,
      headers: h,
      body: "{}",
    });
    expect(r1.status).toBe(404);
    const root = new URL(baseUrl);
    const r2 = await request({
      method: "POST",
      url: `${root.origin}/not-runner`,
      headers: h,
      body: "{}",
    });
    expect(r2.status).toBe(404);
    await rr.dispose();
  });

  it("returns 404 when calling task/event handlers with wrong paths (direct handlers)", async () => {
    const { rr, handlers } = await startExposureServer();
    const proxyToEvent = http.createServer((req, res) => {
      void handlers.handleEvent(req, res);
    });
    const proxyToTask = http.createServer((req, res) => {
      void handlers.handleTask(req, res);
    });

    await new Promise<void>((r) =>
      proxyToEvent.listen(0, "127.0.0.1", () => r()),
    );
    await new Promise<void>((r) =>
      proxyToTask.listen(0, "127.0.0.1", () => r()),
    );

    const a1 = proxyToEvent.address();
    const a2 = proxyToTask.address();
    if (!a1 || typeof a1 === "string" || !a2 || typeof a2 === "string")
      throw new Error("No address");

    const h = { "x-runner-token": TOKEN };
    const r1 = await request({
      method: "POST",
      url: `http://127.0.0.1:${a1.port}/__runner/task/${encodeURIComponent(testTask.id)}`,
      headers: h,
      body: "{}",
    });
    expect(r1.status).toBe(404);

    const r2 = await request({
      method: "POST",
      url: `http://127.0.0.1:${a2.port}/__runner/event/${encodeURIComponent(testEvent.id)}`,
      headers: h,
      body: "{}",
    });
    expect(r2.status).toBe(404);

    const r3 = await request({
      method: "POST",
      url: `http://127.0.0.1:${a2.port}/__runner/task/`,
      headers: h,
      body: "{}",
    });
    expect(r3.status).toBe(404);

    await new Promise<void>((r) => proxyToEvent.close(() => r()));
    await new Promise<void>((r) => proxyToTask.close(() => r()));
    await rr.dispose();
  });

  it("allows requests without auth when token is not configured", async () => {
    const exposure = nodeExposure.with({
      http: { basePath: "/__runner", listen: { port: 0 } },
    });
    const app = defineResource({
      id: "unit.exposure.noauth.app",
      register: [testEvent, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);
    const addr = handlers.server?.address();
    if (!addr || typeof addr === "string") throw new Error("No server address");
    const baseUrl = `http://127.0.0.1:${addr.port}${handlers.basePath}`;
    const r = await request({
      method: "POST",
      url: `${baseUrl}/event/${encodeURIComponent(testEvent.id)}`,
      body: "{}",
    });
    expect(r.status).toBe(200);
    await rr.dispose();
  });

  it("supports custom auth header name", async () => {
    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        basePath: "/__runner",
        listen: { port: 0 },
        auth: { header: "authorization", token: "Bearer XYZ" },
      },
    });
    const app = defineResource({
      id: "unit.exposure.custom-header.app",
      register: [testEvent, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);
    const addr = handlers.server?.address();
    if (!addr || typeof addr === "string") throw new Error("No server address");
    const baseUrl = `http://127.0.0.1:${addr.port}${handlers.basePath}`;

    let r = await request({
      method: "POST",
      url: `${baseUrl}/event/${encodeURIComponent(testEvent.id)}`,
      body: "{}",
    });
    expect(r.status).toBe(401);

    r = await request({
      method: "POST",
      url: `${baseUrl}/event/${encodeURIComponent(testEvent.id)}`,
      headers: { authorization: "Bearer XYZ" },
      body: "{}",
    });
    expect(r.status).toBe(200);
    await rr.dispose();
  });
});
