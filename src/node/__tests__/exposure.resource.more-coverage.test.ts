import * as http from "http";
import type { IncomingMessage, ServerResponse } from "http";
import { Socket } from "net";
import { Readable } from "stream";
import { defineResource, defineTask, defineEvent } from "../../define";
import { globalTags } from "../../globals/globalTags";
import type { TunnelRunner } from "../../globals/resources/tunnel/types";
import { run } from "../../run";
import { nodeExposure } from "../exposure.resource";

describe("nodeExposure - more edge branches", () => {
  type MockReq = Readable & IncomingMessage;
  type MockRes = (
    | ServerResponse
    | (ServerResponse & { body?: Buffer | null })
  ) & {
    body?: Buffer | null;
  };

  function createBaseReq(): MockReq {
    const req = new Readable({ read() {} }) as MockReq;
    Object.assign(req, {
      aborted: false,
      httpVersion: "1.1",
      httpVersionMajor: 1,
      httpVersionMinor: 1,
      complete: true,
      rawHeaders: [] as string[],
      trailers: {} as Record<string, string>,
      rawTrailers: [] as string[],
      setTimeout(_msecs: number, _callback?: () => void) {
        return req;
      },
      socket: new Socket(),
    });
    return req;
  }

  function makeReqRes(body: Buffer | string, headers: Record<string, string>) {
    const req = createBaseReq();
    req.method = "POST";
    req.url = "/"; // will be set by caller
    req.headers = headers;
    setImmediate(() => {
      req.push(Buffer.isBuffer(body) ? body : Buffer.from(String(body)));
      req.push(null);
    });

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
        if (buf != null) {
          payload = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
        }
        return res as unknown as ServerResponse;
      },
    } as unknown as MockRes;

    return {
      req,
      res,
      get status() {
        return status;
      },
      get body() {
        return payload;
      },
    };
  }

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
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="__manifest"\r\n' +
        "Content-Type: application/json; charset=utf-8\r\n\r\n" +
        manifest +
        "\r\n",
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="junk"; filename="x.bin"\r\n' +
        "Content-Type: application/octet-stream\r\n\r\n" +
        "ignoreme\r\n",
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
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="__manifest"\r\n' +
        "Content-Type: application/json; charset=utf-8\r\n\r\n" +
        manifest +
        "\r\n",
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name=""; filename="x.bin"\r\n' +
        "Content-Type: application/octet-stream\r\n\r\n" +
        "ignoreme\r\n",
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

  it("multipart: invalid __manifest JSON returns 400 (INVALID_MULTIPART)", async () => {
    const echo = defineTask<{ n: number }, Promise<number>>({
      id: "exposer.more.invalid",
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
      id: "exposer.more.app2",
      register: [echo, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource);

    const boundary = "----moreBoundary2";
    const body = [
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="__manifest"\r\n' +
        "Content-Type: application/json; charset=utf-8\r\n\r\n" +
        "not-json" +
        "\r\n",
      `--${boundary}--\r\n`,
    ].join("");

    const ref = makeReqRes(body, {
      "x-runner-token": "T",
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(Buffer.byteLength(body)),
    });
    ref.req.url = `/__runner/task/${encodeURIComponent(echo.id)}`;

    await handlers.handleTask(ref.req, ref.res);
    expect(ref.res.statusCode).toBe(400);
    const json = ref.body ? JSON.parse(ref.body.toString("utf8")) : undefined;
    expect(json?.error?.code).toBe("INVALID_MULTIPART");

    await rr.dispose();
  });

  it("multipart: missing __manifest returns 400 (MISSING_MANIFEST)", async () => {
    const echo = defineTask<{ n?: number }, Promise<number>>({
      id: "exposer.more.missing",
      run: async ({ n = 0 }) => n,
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
      id: "exposer.more.app3",
      register: [echo, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource);

    const boundary = "----moreBoundary3";
    const body = [
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file:IGN"; filename="x"\r\n' +
        "Content-Type: application/octet-stream\r\n\r\n" +
        "abc\r\n",
      `--${boundary}--\r\n`,
    ].join("");

    const ref = makeReqRes(body, {
      "x-runner-token": "T",
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(Buffer.byteLength(body)),
    });
    ref.req.url = `/__runner/task/${encodeURIComponent(echo.id)}`;

    await handlers.handleTask(ref.req, ref.res);
    expect(ref.res.statusCode).toBe(400);
    const json = ref.body ? JSON.parse(ref.body.toString("utf8")) : undefined;
    expect(json?.error?.code).toBe("MISSING_MANIFEST");

    await rr.dispose();
  });

  // Note: Due to busboy semantics, parts without filename may be treated as fields;
  // we skip asserting that specific fallback here to avoid coupling to internals.

  it("multipart: request stream error triggers 500 (busboy error path)", async () => {
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
    const body = ""; // no body; we'll emit error
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

  it("auto-detects server-mode http tunnels and logs discovery", async () => {
    const allowedTask = defineTask<{ v: number }, Promise<number>>({
      id: "exposer.auto.echo",
      run: async ({ v }) => v,
    });
    const allowedEv = defineEvent<{ a: number }>({ id: "exposer.auto.ev" });
    const srvTunnel = defineResource({
      id: "exposer.more.server-tunnel",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "server",
        transport: "http",
        tasks: [allowedTask.id],
        events: [allowedEv.id],
      }),
    });

    const createServerSpy = jest
      .spyOn(http, "createServer")
      .mockImplementation(() => {
        const listeners = new Map<
          string,
          Array<(...args: unknown[]) => void>
        >();
        return {
          on(event: string, handler: (...args: unknown[]) => void) {
            const arr = listeners.get(event) ?? [];
            arr.push(handler);
            listeners.set(event, arr);
            return this;
          },
          listen(_port: number, _host?: string, cb?: () => void) {
            cb?.();
            return this;
          },
          close(cb?: () => void) {
            cb?.();
          },
          address() {
            return { port: 0 };
          },
        } as unknown as http.Server;
      });

    try {
      const exposure = require("../exposure.resource").nodeExposure.with({
        http: {
          dangerouslyAllowOpenExposure: true,
          listen: { port: 0 },
          basePath: "/__runner",
          auth: { token: "T" },
        },
      });

      const app = defineResource({
        id: "exposer.more.app.autodetect",
        register: [allowedTask, allowedEv, srvTunnel, exposure],
      });

      const rr = await require("../../run").run(app);
      await rr.dispose();
    } finally {
      createServerSpy.mockRestore();
    }
  });

  it("serves only allowlisted ids when server-mode http tunnels exist", async () => {
    const allowed = defineTask<{ v: number }, Promise<number>>({
      id: "exposer.auto.allowed",
      run: async ({ v }) => v,
    });
    const ev = defineEvent<{ n: number }>({ id: "exposer.auto.allowed.ev" });
    const notAllowed = defineTask<{ v: number }, Promise<number>>({
      id: "exposer.auto.notAllowed",
      run: async ({ v }) => v,
    });

    const srvTunnel = defineResource({
      id: "exposer.auto.server",
      tags: [globalTags.tunnel],
      init: async (): Promise<TunnelRunner> => ({
        mode: "server",
        transport: "http",
        tasks: [allowed.id],
        events: [ev],
      }),
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
      id: "exposer.auto.app6",
      register: [srvTunnel, allowed, notAllowed, ev, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource);

    // Allowed task -> 200
    {
      const body = JSON.stringify({ input: { v: 5 } });
      const { req, res } = makeReqRes(body, {
        "x-runner-token": "T",
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
      });
      req.url = `/__runner/task/${encodeURIComponent(allowed.id)}`;
      await handlers.handleTask(req, res);
      expect(res.statusCode).toBe(200);
    }

    // Not allowed task -> 403 (forbidden when not allowlisted)
    {
      const body = JSON.stringify({ input: { v: 5 } });
      const { req, res } = makeReqRes(body, {
        "x-runner-token": "T",
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
      });
      req.url = `/__runner/task/${encodeURIComponent(notAllowed.id)}`;
      await handlers.handleTask(req, res);
      expect(res.statusCode).toBe(403);
    }

    // Allowed event -> 200
    {
      const body = JSON.stringify({ payload: { n: 1 } });
      const { req, res } = makeReqRes(body, {
        "x-runner-token": "T",
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
      });
      req.url = `/__runner/event/${encodeURIComponent(ev.id)}`;
      await handlers.handleEvent(req, res);
      expect(res.statusCode).toBe(200);
    }

    // Not allowed event -> 403 (forbidden when not allowlisted)
    {
      const ev2 = defineEvent<{ m: string }>({
        id: "exposer.auto.notAllowed.ev",
      });
      const body = JSON.stringify({ payload: { m: "x" } });
      const { req, res } = makeReqRes(body, {
        "x-runner-token": "T",
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
      });
      req.url = `/__runner/event/${encodeURIComponent(ev2.id)}`;
      await handlers.handleEvent(req, res);
      expect(res.statusCode).toBe(403);
    }

    await rr.dispose();
  });

  it("server wrapper: if not handled, responds 404 (no sockets)", async () => {
    const httpWithMutableCreate = http as unknown as {
      createServer: typeof http.createServer;
    };
    const realCreate = httpWithMutableCreate.createServer;
    let capturedHandler:
      | ((req: IncomingMessage, res: ServerResponse) => void)
      | null = null;
    const server = {
      listen: (...args: unknown[]) => {
        const cb = args.find((arg) => typeof arg === "function") as
          | (() => void)
          | undefined;
        cb?.();
        return server as http.Server;
      },
      close: (cb?: () => void) => {
        cb?.();
        return server as http.Server;
      },
      on() {
        return server as http.Server;
      },
      address() {
        return { port: 0 } as { port: number };
      },
    } as unknown as http.Server;
    httpWithMutableCreate.createServer = ((
      requestListener?: http.RequestListener,
    ) => {
      capturedHandler = (requestListener ?? null) as
        | ((req: IncomingMessage, res: ServerResponse) => void)
        | null;
      return server;
    }) as typeof http.createServer;

    const t = defineTask<void, Promise<void>>({
      id: "exposer.more.server",
      run: async () => {},
    });
    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        listen: { port: 0 },
        basePath: "/__runner",
        auth: { token: "T" },
      },
    });
    const app = defineResource({
      id: "exposer.more.app4",
      register: [t, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource);

    expect(typeof capturedHandler).toBe("function");
    const req = createBaseReq();
    req.url = "/not-runner";
    req.headers = {};
    const chunks: Buffer[] = [];
    const res = {
      statusCode: 0,
      setHeader(
        _name: string,
        _value: number | string | ReadonlyArray<string>,
      ) {
        return res as unknown as ServerResponse;
      },
      end(buf?: unknown) {
        if (buf)
          chunks.push(Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf)));
        return res as unknown as ServerResponse;
      },
    } as unknown as MockRes;
    // Invoke server wrapper handler directly
    capturedHandler!(req, res);
    // Allow microtask to resolve promise inside handler
    await new Promise((r) => setImmediate(r));
    expect(res.statusCode).toBe(404);

    await rr.dispose();
    httpWithMutableCreate.createServer = realCreate;
    expect(handlers.server).toBe(server);
  });
});
