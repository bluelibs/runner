import * as http from "http";
import type { ServerResponse } from "http";
import { defineResource, defineTask } from "../../../../define";
import { run } from "../../../../run";
import { nodeExposure } from "../../../exposure/resource";
import {
  makeReqRes,
  createBaseReq,
  MockRes,
} from "./resource.more-coverage.test.utils";

describe("nodeExposure - more multipart coverage", () => {
  it("multipart: unknown file field triggers stream.resume() path", async () => {
    const echo = defineTask<{ n: number }, Promise<number>>({
      id: "exposer.more.echo",
      run: async ({ n }) => n,
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
      id: "exposer.more.app1",
      register: [echo, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource);

    const boundary = "----moreBoundary1";
    const manifest = JSON.stringify({ input: { n: 7 } });
    const body = [
      `--${boundary}\r\nContent-Disposition: form-data; name="__manifest"\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${manifest}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="junk"; filename="x.bin"\r\nContent-Type: application/octet-stream\r\n\r\nignoreme\r\n`,
      `--${boundary}--\r\n`,
    ].join("");

    const { req, res } = makeReqRes(body, {
      "x-runner-token": "T",
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(Buffer.byteLength(body)),
    });
    req.url = `/__runner/task/${encodeURIComponent(echo.id)}`;

    await handlers.handleTask(req, res);
    expect(res.statusCode).toBe(200);
    await rr.dispose();
  });

  it("multipart: file part with empty name is ignored (stream.resume path)", async () => {
    const echo = defineTask<{ n: number }, Promise<number>>({
      id: "exposer.more.emptyname",
      run: async ({ n }) => n,
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
      id: "exposer.more.app1b",
      register: [echo, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource);

    const boundary = "----moreBoundary1b";
    const manifest = JSON.stringify({ input: { n: 9 } });
    const body = [
      `--${boundary}\r\nContent-Disposition: form-data; name="__manifest"\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${manifest}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name=""; filename="x.bin"\r\nContent-Type: application/octet-stream\r\n\r\nignoreme\r\n`,
      `--${boundary}--\r\n`,
    ].join("");

    const ref = makeReqRes(body, {
      "x-runner-token": "T",
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(Buffer.byteLength(body)),
    });
    ref.req.url = `/__runner/task/${encodeURIComponent(echo.id)}`;

    await handlers.handleTask(ref.req, ref.res);
    expect(ref.res.statusCode).toBe(200);
    await rr.dispose();
  });

  it("multipart: request stream error triggers 499 (busboy error path)", async () => {
    const fileTask = defineTask<{ name: string }, Promise<string>>({
      id: "exposer.more.busboy.error",
      run: async ({ name }) => name,
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
      id: "exposer.more.app6",
      register: [fileTask, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource);

    const boundary = "----moreBoundary5";
    const req = createBaseReq();
    req.method = "POST";
    req.url = `/__runner/task/${encodeURIComponent(fileTask.id)}`;
    req.headers = {
      "x-runner-token": "T",
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": "0",
    };

    let status = 0;
    let payload: Buffer | null = null;
    const res = {
      statusCode: 0,
      setHeader(
        _name: string,
        _value: number | string | ReadonlyArray<string>,
      ) {
        return res as unknown as ServerResponse;
      },
      end(buf?: unknown) {
        status = this.statusCode;
        if (buf)
          payload = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
        return res as unknown as ServerResponse;
      },
    } as unknown as MockRes;

    setImmediate(() => req.emit("error", new Error("fail")));
    await handlers.handleTask(req, res);
    expect(status).toBe(499);
    const out = payload
      ? JSON.parse((payload as Buffer).toString("utf8"))
      : undefined;
    expect(out.ok).toBe(false);
    await rr.dispose();
  });
});
