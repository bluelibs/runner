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
import { createMessageError } from "../../../../errors";

const D = process.env.RUNNER_TEST_NET === "1" ? describe : describe.skip;

D("nodeExposure - unit server", () => {
  it("createRequestListener provides a standalone listener with automatic 404", async () => {
    const { rr, handlers } = await startExposureServer();
    const listener = handlers.createRequestListener();
    const server = http.createServer(listener);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const addr = server.address();
    if (!addr || typeof addr === "string")
      throw createMessageError("No server address");
    const origin = `http://127.0.0.1:${addr.port}`;

    const miss = await request({
      method: "POST",
      url: `${origin}/outside`,
      body: "{}",
    });
    expect(miss.status).toBe(404);

    const headers = {
      "x-runner-token": TOKEN,
      "content-type": "application/json",
    };
    const ok = await request({
      method: "POST",
      url: `${origin}${handlers.basePath}/task/${encodeURIComponent(testTask.id)}`,
      headers,
      body: JSON.stringify({ input: { v: 3 } }),
    });
    expect(ok.status).toBe(200);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rr.dispose();
  });

  it("attachTo mounts and detaches an external server", async () => {
    const { rr, handlers } = await startExposureServer();
    const external = http.createServer((_req, res) => {
      res.statusCode = 200;
      res.end("fallback");
    });
    await new Promise<void>((resolve) =>
      external.listen(0, "127.0.0.1", resolve),
    );
    const detach = handlers.attachTo(external);
    const addr = external.address();
    if (!addr || typeof addr === "string")
      throw createMessageError("No server address");
    const base = `http://127.0.0.1:${addr.port}${handlers.basePath}`;
    const headers = {
      "x-runner-token": TOKEN,
      "content-type": "application/json",
    };

    const first = await request({
      method: "POST",
      url: `${base}/task/${encodeURIComponent(testTask.id)}`,
      headers,
      body: JSON.stringify({ input: { v: 2 } }),
    });
    expect(first.status).toBe(200);
    const parsed = JSON.parse(first.text);
    expect(parsed.ok).toBe(true);

    detach();

    const fallback = await request({
      method: "POST",
      url: `${base}/task/${encodeURIComponent(testTask.id)}`,
      headers,
      body: JSON.stringify({ input: { v: 2 } }),
    });
    expect(fallback.text).toBe("fallback");
    expect(fallback.status).toBe(200);

    await new Promise<void>((resolve) => external.close(() => resolve()));
    await rr.dispose();
  });

  it("createServer returns a ready-to-use HTTP server", async () => {
    const { rr, handlers } = await startExposureServer();
    const extra = handlers.createServer();
    await new Promise<void>((resolve) => extra.listen(0, "127.0.0.1", resolve));
    const addr = extra.address();
    if (!addr || typeof addr === "string")
      throw createMessageError("No server address");
    const origin = `http://127.0.0.1:${addr.port}`;
    const headers = {
      "x-runner-token": TOKEN,
      "content-type": "application/json",
    };

    const ok = await request({
      method: "POST",
      url: `${origin}${handlers.basePath}/task/${encodeURIComponent(testTask.id)}`,
      headers,
      body: JSON.stringify({ input: { v: 9 } }),
    });
    expect(ok.status).toBe(200);

    const miss = await request({
      method: "POST",
      url: `${origin}/nope`,
      body: "{}",
    });
    expect(miss.status).toBe(404);

    await new Promise<void>((resolve) => extra.close(() => resolve()));
    await rr.dispose();
  });

  it("auto-attaches to a provided server and detaches on dispose", async () => {
    const externalServer = http.createServer((_req, res) => {
      res.statusCode = 200;
      res.end("external");
    });
    await new Promise<void>((resolve) =>
      externalServer.listen(0, "127.0.0.1", resolve),
    );
    const exposure = nodeExposure.with({
      http: { server: externalServer, auth: { token: TOKEN } },
    });
    const app = defineResource({
      id: "unit.exposure.serverProvided",
      register: [testTask, testEvent, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);
    expect(handlers.server).toBe(externalServer);
    const addr = externalServer.address();
    if (!addr || typeof addr === "string")
      throw createMessageError("No server address");
    const base = `http://127.0.0.1:${addr.port}${handlers.basePath}`;

    const headers = {
      "x-runner-token": TOKEN,
      "content-type": "application/json",
    };
    const first = await request({
      method: "POST",
      url: `${base}/task/${encodeURIComponent(testTask.id)}`,
      headers,
      body: JSON.stringify({ input: { v: 7 } }),
    });
    expect(first.status).toBe(200);

    await rr.dispose();

    const fallback = await request({
      method: "POST",
      url: `${base}/task/${encodeURIComponent(testTask.id)}`,
      headers,
      body: JSON.stringify({ input: { v: 7 } }),
    });
    expect(fallback.text).toBe("external");
    expect(fallback.status).toBe(200);

    await new Promise<void>((resolve) => externalServer.close(() => resolve()));
  });
});
