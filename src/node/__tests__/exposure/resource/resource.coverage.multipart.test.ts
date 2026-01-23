import * as http from "http";
import { defineTask, defineResource } from "../../../../define";
import { run } from "../../../../run";
import { nodeExposure } from "../../../exposure/resource";
import { createReqRes } from "./resource.test.utils";

describe("nodeExposure Coverage - Multipart", () => {
  it("multipart success: hydrates files and merges manifest meta", async () => {
    const fileTask = defineTask<{ file: any }, Promise<{ name: string; type: string }>>({
      id: "ok.file.task",
      run: async ({ file }) => ({ name: file.name, type: file.type }),
    });
    const exposure = nodeExposure.with({
      http: { dangerouslyAllowOpenExposure: true, server: http.createServer(), basePath: "/__runner", auth: { token: "T" } },
    });
    const app = defineResource({ id: "unit.exposure.coverage.multipart.app3", register: [fileTask, exposure] });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const boundary = "----covboundaryOK";
    const manifest = JSON.stringify({
      input: { file: { $runnerFile: "File", id: "F1", meta: { name: "override.txt", type: "text/plain" } } },
    });
    const body = [
      `--${boundary}\r\nContent-Disposition: form-data; name="__manifest"\r\nContent-Type: application/json\r\n\r\n${manifest}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file:F1"; filename="x.txt"\r\nContent-Type: application/octet-stream\r\n\r\ncontent\r\n`,
      `--${boundary}--\r\n`,
    ].join("");

    const rrMock = createReqRes({
      url: `/__runner/task/${encodeURIComponent(fileTask.id)}`,
      headers: { "x-runner-token": "T", "content-type": `multipart/form-data; boundary=${boundary}` },
      body: Buffer.from(body, "utf8"),
    });

    await handlers.handleTask(rrMock.req, rrMock.res);
    expect(rrMock.status).toBe(200);
    expect(rrMock.json?.result).toEqual({ name: "override.txt", type: "text/plain" });
    await rr.dispose();
  });

  it("multipart meta.extra overrides and is exposed to task", async () => {
    const fileTask = defineTask<{ file: any }, Promise<{ extra: any }>>({
      id: "ok.file.extra.task",
      run: async ({ file }) => ({ extra: file.extra }),
    });
    const exposure = nodeExposure.with({
      http: { dangerouslyAllowOpenExposure: true, server: http.createServer(), basePath: "/__runner", auth: { token: "T" } },
    });
    const app = defineResource({ id: "unit.exposure.coverage.multipart.app12", register: [fileTask, exposure] });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const boundary = "----covboundaryExtra";
    const manifest = JSON.stringify({ input: { file: { $runnerFile: "File", id: "F1", meta: { extra: { foo: "bar" } } } } });
    const body = [
      `--${boundary}\r\nContent-Disposition: form-data; name="__manifest"\r\n\r\n${manifest}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file:F1"; filename="x.bin"\r\n\r\ncontent\r\n`,
      `--${boundary}--\r\n`,
    ].join("");

    const rrMock = createReqRes({
      url: `/__runner/task/${encodeURIComponent(fileTask.id)}`,
      headers: { "x-runner-token": "T", "content-type": `multipart/form-data; boundary=${boundary}` },
      body: Buffer.from(body, "utf8"),
    });

    await handlers.handleTask(rrMock.req, rrMock.res);
    expect(rrMock.json?.result).toEqual({ extra: { foo: "bar" } });
    await rr.dispose();
  });

  it("multipart error: missing file part referenced in manifest triggers 500", async () => {
    const fileTask = defineTask<{ file: any }, Promise<void>>({ id: "missing.file.task", run: async () => {} });
    const exposure = nodeExposure.with({
      http: { dangerouslyAllowOpenExposure: true, server: http.createServer(), basePath: "/__runner", auth: { token: "T" } },
    });
    const app = defineResource({ id: "unit.exposure.coverage.multipart.app4", register: [fileTask, exposure] });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const boundary = "----covboundaryMissing";
    const manifest = JSON.stringify({ input: { file: { $runnerFile: "File", id: "F1" } } });
    const body = [`--${boundary}\r\nContent-Disposition: form-data; name="__manifest"\r\n\r\n${manifest}\r\n`, `--${boundary}--\r\n`].join("");

    const rrMock = createReqRes({
      url: `/__runner/task/${encodeURIComponent(fileTask.id)}`,
      headers: { "x-runner-token": "T", "content-type": `multipart/form-data; boundary=${boundary}` },
      body: Buffer.from(body, "utf8"),
    });

    await handlers.handleTask(rrMock.req, rrMock.res);
    expect(rrMock.status).toBe(500);
    await rr.dispose();
  });

  it("hydrate array of files coverage", async () => {
    const fileTask = defineTask<{ files: any[] }, Promise<string[]>>({
      id: "ok.array.files.task",
      run: async ({ files }) => files.map((f) => f.name),
    });
    const exposure = nodeExposure.with({
      http: { dangerouslyAllowOpenExposure: true, server: http.createServer(), basePath: "/__runner", auth: { token: "T" } },
    });
    const app = defineResource({ id: "unit.exposure.coverage.multipart.app7", register: [fileTask, exposure] });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const boundary = "----covboundaryArray";
    const manifest = JSON.stringify({ input: { files: [{ $runnerFile: "File", id: "A", meta: { name: "a.txt" } }, { $runnerFile: "File", id: "B", meta: { name: "b.txt" } }] } });
    const body = [
      `--${boundary}\r\nContent-Disposition: form-data; name="__manifest"\r\n\r\n${manifest}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file:A"; filename="a.bin"\r\n\r\nabc\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file:B"; filename="b.bin"\r\n\r\ndef\r\n`,
      `--${boundary}--\r\n`,
    ].join("");

    const rrMock = createReqRes({
      url: `/__runner/task/${encodeURIComponent(fileTask.id)}`,
      headers: { "x-runner-token": "T", "content-type": `multipart/form-data; boundary=${boundary}` },
      body: Buffer.from(body, "utf8"),
    });

    await handlers.handleTask(rrMock.req, rrMock.res);
    expect(rrMock.json?.result).toEqual(["a.txt", "b.txt"]);
    await rr.dispose();
  });
});
