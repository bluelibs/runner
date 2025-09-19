import * as http from "http";
import {
  defineResource,
  defineTask,
  defineEvent,
  defineHook,
} from "../../define";
import { z } from "zod";
import { run } from "../../run";
import { nodeExposure } from "../exposure.resource";

// This test suite targets 100% line/branch/function coverage for exposure.resource.ts
// without opening sockets (the sandbox forbids listen()). We mock http.createServer
// to capture and invoke the server wrapper handler directly.

describe("nodeExposure - isolated branch coverage (no sockets)", () => {
  function createReqRes(init: {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: string | Buffer;
  }) {
    const { method = "POST", url = "/", headers = {}, body } = init;

    // Minimal IncomingMessage and ServerResponse stubs for unit-level testing
    const req: any = {
      method,
      url,
      headers,
      _listeners: new Map<string, Function[]>(),
      on(event: string, cb: Function) {
        const arr = this._listeners.get(event) ?? [];
        arr.push(cb);
        this._listeners.set(event, arr);
        if (event === "end") {
          setImmediate(() => {
            if (body != null) {
              for (const d of this._listeners.get("data") ?? [])
                d(Buffer.isBuffer(body) ? body : Buffer.from(String(body)));
            }
            for (const e of this._listeners.get("end") ?? []) e();
          });
        }
        return this;
      },
    };

    let statusCode = 0;
    const chunks: Buffer[] = [];
    const res: any = {
      statusCode: 0,
      setHeader() {
        /* no-op */
      },
      end(payload?: any) {
        statusCode = this.statusCode;
        if (payload != null) {
          chunks.push(
            Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)),
          );
        }
      },
    };

    return {
      req,
      res,
      get status() {
        return statusCode;
      },
      get resStatus() {
        return res.statusCode as number;
      },
      get json() {
        if (chunks.length === 0) return undefined;
        try {
          return JSON.parse(
            Buffer.concat(chunks as readonly Uint8Array[]).toString("utf8"),
          );
        } catch {
          return undefined;
        }
      },
    };
  }

  it("covers extractTarget fallback, method 405/401, and not-found branches for task/event", async () => {
    // Define a real task/event for the store via runner
    const okTask = defineTask<void, Promise<number>>({
      id: "ok.task",
      run: async () => 42,
    });
    const badTask = defineTask<{ v: number }, Promise<number>>({
      id: "bad.task",
      inputSchema: z.object({ v: z.number() }).strict(),
      resultSchema: z.number(),
      run: async ({ v }) => v,
    });
    const throwTask = defineTask<void, Promise<void>>({
      id: "oops.task",
      run: async () => {
        throw {} as any;
      },
    });
    const okEvent = defineEvent<{ v?: number }>({ id: "ok.event" });

    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "T" },
      },
    });
    const app = defineResource({
      id: "unit.exposure.coverage.app1",
      register: [okTask, badTask, throwTask, okEvent, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    // handleTask: non-base path -> 404 (mirror misc-branches style)
    {
      const headers = { "x-runner-token": "T" } as Record<string, string>;
      const req1: any = {
        method: "POST",
        url: `/not-runner/task/${encodeURIComponent(okTask.id)}`,
        headers,
        on(event: string, cb: Function) {
          if (event === "end") setImmediate(() => cb());
          return this;
        },
      };
      let status1 = 0;
      const res1: any = {
        setHeader() {},
        statusCode: 0,
        end() {
          status1 = this.statusCode;
        },
      };
      await handlers.handleTask(req1, res1);
      expect(status1).toBe(404);
    }

    // handleTask: method not allowed -> 405 (mirror misc-branches style)
    {
      const headers = { "x-runner-token": "T" } as Record<string, string>;
      const req: any = {
        method: "GET",
        url: `/__runner/task/${encodeURIComponent(okTask.id)}`,
        headers,
        on(event: string, cb: Function) {
          if (event === "end") setImmediate(() => cb());
          return this;
        },
      };
      let status = 0;
      const res: any = {
        setHeader() {},
        statusCode: 0,
        end() {
          status = this.statusCode;
        },
      };
      await handlers.handleTask(req, res);
      expect(status).toBe(405);
    }

    // handleTask: unauthorized -> 401
    {
      const headers = { "x-runner-token": "WRONG" } as Record<string, string>;
      const req: any = {
        method: "POST",
        url: `/__runner/task/${encodeURIComponent(okTask.id)}`,
        headers,
        on(event: string, cb: Function) {
          if (event === "end") setImmediate(() => cb());
          return this;
        },
      };
      let status = 0;
      const res: any = {
        setHeader() {},
        statusCode: 0,
        end() {
          status = this.statusCode;
        },
      };
      await handlers.handleTask(req, res);
      expect(status).toBe(401);
    }

    // handleTask: unknown kind inside basePath -> extractTarget returns null (fallback) -> 404
    {
      const headers = { "x-runner-token": "T" } as Record<string, string>;
      const req: any = {
        method: "POST",
        url: "/__runner/unknown/something",
        headers,
        on(event: string, cb: Function) {
          if (event === "end") setImmediate(() => cb());
          return this;
        },
      };
      let status = 0;
      const res: any = {
        setHeader() {},
        statusCode: 0,
        end() {
          status = this.statusCode;
        },
      };
      await handlers.handleTask(req, res);
      expect(status).toBe(404);
    }

    // handleTask: task not found -> 404
    {
      const headers = { "x-runner-token": "T" } as Record<string, string>;
      const req: any = {
        method: "POST",
        url: "/__runner/task/missing.task",
        headers,
        on(event: string, cb: Function) {
          if (event === "end") setImmediate(() => cb());
          return this;
        },
      };
      let status = 0;
      const res: any = {
        setHeader() {},
        statusCode: 0,
        end() {
          status = this.statusCode;
        },
      };
      await handlers.handleTask(req, res);
      expect(status).toBe(404);
    }

    // handleEvent: method not allowed -> 405
    {
      const headers = { "x-runner-token": "T" } as Record<string, string>;
      const req: any = {
        method: "GET",
        url: `/__runner/event/${encodeURIComponent(okEvent.id)}`,
        headers,
        on(event: string, cb: Function) {
          if (event === "end") setImmediate(() => cb());
          return this;
        },
      };
      let status = 0;
      const res: any = {
        setHeader() {},
        statusCode: 0,
        end() {
          status = this.statusCode;
        },
      };
      await handlers.handleEvent(req, res);
      expect(status).toBe(405);
    }

    // handleEvent: unauthorized -> 401
    {
      const headers = { "x-runner-token": "WRONG" } as Record<string, string>;
      const req: any = {
        method: "POST",
        url: `/__runner/event/${encodeURIComponent(okEvent.id)}`,
        headers,
        on(event: string, cb: Function) {
          if (event === "end") setImmediate(() => cb());
          return this;
        },
      };
      let status = 0;
      const res: any = {
        setHeader() {},
        statusCode: 0,
        end() {
          status = this.statusCode;
        },
      };
      await handlers.handleEvent(req, res);
      expect(status).toBe(401);
    }

    // handleEvent: event not found -> 404
    {
      const headers = { "x-runner-token": "T" } as Record<string, string>;
      const req: any = {
        method: "POST",
        url: "/__runner/event/missing.event",
        headers,
        on(event: string, cb: Function) {
          if (event === "end") setImmediate(() => cb());
          return this;
        },
      };
      let status = 0;
      const res: any = {
        setHeader() {},
        statusCode: 0,
        end() {
          status = this.statusCode;
        },
      };
      await handlers.handleEvent(req, res);
      expect(status).toBe(404);
    }

    // handleTask: catch branch (validation error) -> 500
    {
      const headers = { "x-runner-token": "T" } as Record<string, string>;
      const req: any = {
        method: "POST",
        url: "/__runner/task/bad.task",
        headers,
        on(event: string, cb: Function) {
          if (event === "end") setImmediate(() => cb(Buffer.from("{}")));
          return this;
        },
      };
      let status = 0;
      const res: any = {
        setHeader() {},
        statusCode: 0,
        end() {
          status = this.statusCode;
        },
      };
      await handlers.handleTask(req, res);
      expect(status).toBe(500);
    }

    // handleEvent: invalid JSON surfaces as 400 with INVALID_JSON code
    {
      const headers = { "x-runner-token": "T" } as Record<string, string>;
      const req: any = {
        method: "POST",
        url: "/__runner/event/ok.event",
        headers,
        on(event: string, cb: Function) {
          if (event === "data") setImmediate(() => cb("not-json"));
          if (event === "end") setImmediate(() => cb());
          return this;
        },
      };
      let status = 0;
      let body: any;
      const res: any = {
        setHeader() {},
        statusCode: 0,
        end(buf?: any) {
          status = this.statusCode;
          if (buf != null) {
            const text = Buffer.isBuffer(buf)
              ? buf.toString("utf8")
              : String(buf);
            body = JSON.parse(text);
          }
        },
      };
      await handlers.handleEvent(req, res);
      expect(status).toBe(400);
      expect(body?.error?.code).toBe("INVALID_JSON");
    }

    // handleTask: catch branch with non-Error thrown -> response message fallback "Internal Error"
    {
      const headers = { "x-runner-token": "T" } as Record<string, string>;
      const req: any = {
        method: "POST",
        url: `/__runner/task/${encodeURIComponent(throwTask.id)}`,
        headers,
        on(event: string, cb: Function) {
          if (event === "end") setImmediate(() => cb());
          return this;
        },
      };
      const chunks: Buffer[] = [];
      let status = 0;
      const res: any = {
        setHeader() {},
        statusCode: 0,
        end(payload?: any) {
          status = this.statusCode;
          if (payload != null)
            chunks.push(
              Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)),
            );
        },
      };
      await handlers.handleTask(req, res);
      const body = chunks.length
        ? JSON.parse(
            Buffer.concat(chunks as readonly Uint8Array[]).toString("utf8"),
          )
        : undefined;
      expect(status).toBe(500);
      expect(body?.error?.message).toBe("Internal Error");
    }

    // handleEvent: catch branch via req error with non-Error value -> response message fallback "Internal Error"
    {
      const headers = { "x-runner-token": "T" } as Record<string, string>;
      const req: any = {
        method: "POST",
        url: `/__runner/event/${encodeURIComponent(okEvent.id)}`,
        headers,
        on(event: string, cb: Function) {
          if (event === "error") setImmediate(() => cb("oops"));
          return this;
        },
      };
      const chunks: Buffer[] = [];
      let status = 0;
      const res: any = {
        setHeader() {},
        statusCode: 0,
        end(payload?: any) {
          status = this.statusCode;
          if (payload != null)
            chunks.push(
              Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)),
            );
        },
      };
      await handlers.handleEvent(req, res);
      const body = chunks.length
        ? JSON.parse(
            Buffer.concat(chunks as readonly Uint8Array[]).toString("utf8"),
          )
        : undefined;
      expect(status).toBe(500);
      expect(body?.error?.message).toBe("Internal Error");
    }

    // handleTask: success -> 200
    {
      const headers = { "x-runner-token": "T" } as Record<string, string>;
      const req: any = {
        method: "POST",
        url: `/__runner/task/${encodeURIComponent(okTask.id)}`,
        headers,
        on(event: string, cb: Function) {
          if (event === "end") setImmediate(() => cb());
          return this;
        },
      };
      let status = 0;
      const res: any = {
        setHeader() {},
        statusCode: 0,
        end() {
          status = this.statusCode;
        },
      };
      await handlers.handleTask(req, res);
      expect(status).toBe(200);
    }

    // handleEvent: wrong kind under base -> 404
    {
      const headers = { "x-runner-token": "T" } as Record<string, string>;
      const req: any = {
        method: "POST",
        url: `/__runner/task/${encodeURIComponent(okTask.id)}`,
        headers,
        on(event: string, cb: Function) {
          if (event === "end") setImmediate(() => cb());
          return this;
        },
      };
      let status = 0;
      const res: any = {
        setHeader() {},
        statusCode: 0,
        end() {
          status = this.statusCode;
        },
      };
      await handlers.handleEvent(req, res);
      expect(status).toBe(404);
    }

    // handleEvent: success -> 200
    {
      const headers = { "x-runner-token": "T" } as Record<string, string>;
      const req: any = {
        method: "POST",
        url: `/__runner/event/${encodeURIComponent(okEvent.id)}`,
        headers,
        on(event: string, cb: Function) {
          if (event === "end") setImmediate(() => cb(Buffer.from("{}")));
          return this;
        },
      };
      let status = 0;
      const res: any = {
        setHeader() {},
        statusCode: 0,
        end() {
          status = this.statusCode;
        },
      };
      await handlers.handleEvent(req, res);
      expect(status).toBe(200);
    }

    await rr.dispose();
  });

  it("handleRequest dispatches correctly and returns false outside base", async () => {
    const okTask = defineTask<void, Promise<number>>({
      id: "hr.task",
      run: async () => 1,
    });
    const okEvent = defineEvent<void>({ id: "hr.event" });
    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "T" },
      },
    });
    const app = defineResource({
      id: "unit.exposure.coverage.app2",
      register: [okTask, okEvent, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    // Outside base
    {
      const headers = { "x-runner-token": "T" } as Record<string, string>;
      const req: any = { method: "POST", url: "/not-runner", headers };
      const res: any = { setHeader() {}, statusCode: 0, end() {} };
      const handled = await handlers.handleRequest(req, res);
      expect(handled).toBe(false);
    }

    // Inside base but no target -> 404 + handled = true
    {
      const headers = { "x-runner-token": "T" } as Record<string, string>;
      const req: any = { method: "POST", url: "/__runner/", headers };
      let status = 0;
      const res: any = {
        setHeader() {},
        statusCode: 0,
        end() {
          status = this.statusCode;
        },
      };
      const handled = await handlers.handleRequest(req, res);
      expect(handled).toBe(true);
      expect(status).toBe(404);
    }

    // Dispatch to task
    {
      const headers = { "x-runner-token": "T" } as Record<string, string>;
      const req: any = {
        method: "POST",
        url: `/__runner/task/${encodeURIComponent(okTask.id)}`,
        headers,
        on(ev: string, cb: Function) {
          if (ev === "end") setImmediate(() => cb());
          return this;
        },
      };
      let status = 0;
      const res: any = {
        setHeader() {},
        statusCode: 0,
        end() {
          status = this.statusCode;
        },
      };
      const handled = await handlers.handleRequest(req, res);
      expect(handled).toBe(true);
      expect(status).toBe(200);
    }

    // Dispatch to event
    {
      const headers = { "x-runner-token": "T" } as Record<string, string>;
      const req: any = {
        method: "POST",
        url: `/__runner/event/${encodeURIComponent(okEvent.id)}`,
        headers,
        on(ev: string, cb: Function) {
          if (ev === "end") setImmediate(() => cb());
          return this;
        },
      };
      let status = 0;
      const res: any = {
        setHeader() {},
        statusCode: 0,
        end() {
          status = this.statusCode;
        },
      };
      const handled = await handlers.handleRequest(req, res);
      expect(handled).toBe(true);
      expect(status).toBe(200);
    }

    await rr.dispose();
  });

  it("multipart success: hydrates files and merges manifest meta", async () => {
    const fileTask = defineTask<
      { file: any },
      Promise<{ name: string; type: string }>
    >({
      id: "ok.file.task",
      run: async ({ file }) => ({ name: file.name, type: file.type }),
    });
    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "T" },
      },
    });
    const app = defineResource({
      id: "unit.exposure.coverage.app3",
      register: [fileTask, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    // Build a minimal multipart body with one file and a matching manifest
    const boundary = "----covboundaryOK";
    const manifest = JSON.stringify({
      input: {
        file: {
          $ejson: "File",
          id: "F1",
          meta: { name: "override.txt", type: "text/plain", extra: { a: 1 } },
        },
      },
    });
    const body = [
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="__manifest"\r\n' +
        "Content-Type: application/json; charset=utf-8\r\n\r\n" +
        manifest +
        "\r\n",
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file:F1"; filename="x.txt"\r\n' +
        "Content-Type: application/octet-stream\r\n\r\n" +
        "abc\r\n",
      `--${boundary}--\r\n`,
    ].join("");

    // Create a Readable req that Busboy can consume via req.pipe(bb)
    const req: any = new (require("stream").Readable)({
      read() {},
    });
    req.method = "POST";
    req.url = `/__runner/task/${encodeURIComponent(fileTask.id)}`;
    req.headers = {
      "x-runner-token": "T",
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(Buffer.byteLength(body)),
    };
    setImmediate(() => {
      req.push(Buffer.from(body, "utf8"));
      req.push(null);
    });

    let status = 0;
    let payload: any = Buffer.alloc(0);
    const res: any = {
      setHeader() {},
      statusCode: 0,
      end(buf?: any) {
        status = this.statusCode;
        if (buf)
          payload = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
      },
    };

    await handlers.handleTask(req, res);
    expect(status).toBe(200);
    const out = JSON.parse(payload.toString("utf8"));
    expect(out.ok).toBe(true);
    expect(out.result).toEqual({ name: "override.txt", type: "text/plain" });

    await rr.dispose();
  });

  it("multipart meta.extra overrides and is exposed to task", async () => {
    const fileTask = defineTask<{ file: any }, Promise<{ extra: any }>>({
      id: "ok.file.extra.task",
      run: async ({ file }) => ({ extra: file.extra }),
    });
    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "T" },
      },
    });
    const app = defineResource({
      id: "unit.exposure.coverage.app12",
      register: [fileTask, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const boundary = "----covboundaryExtra";
    const manifest = JSON.stringify({
      input: {
        file: { $ejson: "File", id: "F1", meta: { extra: { foo: "bar" } } },
      },
    });
    const body = [
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="__manifest"\r\n' +
        "Content-Type: application/json; charset=utf-8\r\n\r\n" +
        manifest +
        "\r\n",
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file:F1"; filename="x.bin"\r\n' +
        "Content-Type: application/octet-stream\r\n\r\n" +
        "abc\r\n",
      `--${boundary}--\r\n`,
    ].join("");

    const req: any = new (require("stream").Readable)({ read() {} });
    req.method = "POST";
    req.url = `/__runner/task/${encodeURIComponent(fileTask.id)}`;
    req.headers = {
      "x-runner-token": "T",
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(Buffer.byteLength(body)),
    };
    setImmediate(() => {
      req.push(Buffer.from(body, "utf8"));
      req.push(null);
    });

    let status = 0;
    let payload: any = Buffer.alloc(0);
    const res: any = {
      setHeader() {},
      statusCode: 0,
      end(buf?: any) {
        status = this.statusCode;
        if (buf)
          payload = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
      },
    };

    await handlers.handleTask(req, res);
    expect(status).toBe(200);
    const out = JSON.parse(payload.toString("utf8"));
    expect(out.ok).toBe(true);
    expect(out.result).toEqual({ extra: { foo: "bar" } });

    await rr.dispose();
  });

  it("multipart error: missing file part referenced in manifest triggers 500", async () => {
    const fileTask = defineTask<{ file: any }, Promise<void>>({
      id: "missing.file.task",
      run: async () => {
        // Should not reach here because hydration fails earlier
      },
    });
    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "T" },
      },
    });
    const app = defineResource({
      id: "unit.exposure.coverage.app4",
      register: [fileTask, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    // Manifest references a file id F1, but no corresponding file:F1 part is provided
    const boundary = "----covboundaryMissing";
    const manifest = JSON.stringify({
      input: {
        file: { $ejson: "File", id: "F1" },
      },
    });
    const body = [
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="__manifest"\r\n' +
        "Content-Type: application/json; charset=utf-8\r\n\r\n" +
        manifest +
        "\r\n",
      `--${boundary}--\r\n`,
    ].join("");

    const req: any = new (require("stream").Readable)({ read() {} });
    req.method = "POST";
    req.url = `/__runner/task/${encodeURIComponent(fileTask.id)}`;
    req.headers = {
      "x-runner-token": "T",
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(Buffer.byteLength(body)),
    };
    setImmediate(() => {
      req.push(Buffer.from(body, "utf8"));
      req.push(null);
    });

    let status = 0;
    let payload: any = Buffer.alloc(0);
    const res: any = {
      setHeader() {},
      statusCode: 0,
      end(buf?: any) {
        status = this.statusCode;
        if (buf)
          payload = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
      },
    };

    await handlers.handleTask(req, res);
    expect(status).toBe(500);
    const out = JSON.parse(payload.toString("utf8"));
    expect(out.ok).toBe(false);
    expect(out.error.message).toBe("Missing file part for id F1");

    await rr.dispose();
  });

  it("readJson buffer branch and no-auth path: task JSON body succeeds", async () => {
    const okTask = defineTask<{ n?: number }, Promise<number>>({
      id: "ok.task.buffer",
      run: async ({ n = 1 }) => n,
    });
    // No auth configured -> authenticate() returns ok: true via !authCfg?.token
    const exposure = nodeExposure.with({
      http: { server: http.createServer(), basePath: "/__runner" },
    });
    const app = defineResource({
      id: "unit.exposure.coverage.app5",
      register: [okTask, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    // Build request that emits Buffer chunks to exercise Buffer.isBuffer true branch in readJson
    const req: any = {
      method: "POST",
      url: `/__runner/task/${encodeURIComponent(okTask.id)}`,
      headers: { "content-type": "application/json" },
      _listeners: new Map<string, Function[]>(),
      on(ev: string, cb: Function) {
        const arr = this._listeners.get(ev) ?? [];
        arr.push(cb);
        this._listeners.set(ev, arr);
        if (ev === "end") {
          setImmediate(() => {
            for (const d of this._listeners.get("data") ?? [])
              d(Buffer.from('{"input":{"n":2}}', "utf8"));
            for (const e of this._listeners.get("end") ?? []) e();
          });
        }
        return this;
      },
    };
    let status = 0;
    let body = Buffer.alloc(0);
    const res: any = {
      setHeader() {},
      statusCode: 0,
      end(buf?: any) {
        status = this.statusCode;
        if (buf) body = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
      },
    };

    await handlers.handleTask(req, res);
    expect(status).toBe(200);
    const out = JSON.parse(body.toString("utf8"));
    expect(out).toEqual({ ok: true, result: 2 });
    await rr.dispose();
  });

  it("close() covers server branch when created via listen (stubbed)", async () => {
    // Stub http.createServer to avoid real sockets but still mark server as non-null
    const realCreate = (http as any).createServer;
    const server = {
      listen: (_port: number, _host?: string, cb?: Function) => {
        if (typeof cb === "function") cb();
      },
      close: (cb: Function) => cb(),
    } as any;
    (http as any).createServer = () => server;

    const okTask = defineTask<void, Promise<number>>({
      id: "ok.listen.task",
      run: async () => 1,
    });
    const exposure = nodeExposure.with({
      http: {
        listen: { port: 0 },
        basePath: "/__runner",
        auth: { token: "T" },
      },
    });
    const app = defineResource({
      id: "unit.exposure.coverage.app6",
      register: [okTask, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);
    // Call dispose which triggers value.close() and enters if (server) branch
    await rr.dispose();
    // Restore
    (http as any).createServer = realCreate;
    // ensure server reference is preserved in handlers for sanity
    expect(handlers.server).toBe(server);
  });

  it("hydrate array of files and set type/size via meta", async () => {
    const fileTask = defineTask<
      { files: any[] },
      Promise<{ names: string[]; types: string[] }>
    >({
      id: "ok.array.files.task",
      run: async ({ files }) => ({
        names: files.map((f) => f.name),
        types: files.map((f) => f.type),
      }),
    });
    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "T" },
      },
    });
    const app = defineResource({
      id: "unit.exposure.coverage.app7",
      register: [fileTask, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const boundary = "----covboundaryArray";
    const manifest = JSON.stringify({
      input: {
        files: [
          {
            $ejson: "File",
            id: "A",
            meta: { name: "a.txt", type: "text/a", size: 3 },
          },
          {
            $ejson: "File",
            id: "B",
            meta: { name: "b.txt", type: "text/b", size: 3 },
          },
        ],
      },
    });
    const body = [
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="__manifest"\r\n' +
        "Content-Type: application/json; charset=utf-8\r\n\r\n" +
        manifest +
        "\r\n",
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file:A"; filename="a.bin"\r\n' +
        "Content-Type: application/octet-stream\r\n\r\n" +
        "abc\r\n",
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file:B"; filename="b.bin"\r\n' +
        "Content-Type: application/octet-stream\r\n\r\n" +
        "def\r\n",
      `--${boundary}--\r\n`,
    ].join("");

    const req: any = new (require("stream").Readable)({ read() {} });
    req.method = "POST";
    req.url = `/__runner/task/${encodeURIComponent(fileTask.id)}`;
    req.headers = {
      "x-runner-token": "T",
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(Buffer.byteLength(body)),
    };
    setImmediate(() => {
      req.push(Buffer.from(body, "utf8"));
      req.push(null);
    });

    let status = 0;
    let payload: any = Buffer.alloc(0);
    const res: any = {
      setHeader() {},
      statusCode: 0,
      end(buf?: any) {
        status = this.statusCode;
        if (buf)
          payload = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
      },
    };

    await handlers.handleTask(req, res);
    expect(status).toBe(200);
    const out = JSON.parse(payload.toString("utf8"));
    expect(out.ok).toBe(true);
    expect(out.result.names).toEqual(["a.txt", "b.txt"]);
    expect(out.result.types).toEqual(["text/a", "text/b"]);

    await rr.dispose();
  });

  it("auth header override works and missing header rejects", async () => {
    const okEvent = defineEvent<{ v?: number }>({ id: "ok.event.custom" });
    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "ABC", header: "x-custom-token" },
      },
    });
    const app = defineResource({
      id: "unit.exposure.coverage.app8",
      register: [okEvent, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    // Success with custom header
    {
      const req: any = {
        method: "POST",
        url: `/__runner/event/${encodeURIComponent(okEvent.id)}`,
        headers: { "x-custom-token": "ABC" },
        on(ev: string, cb: Function) {
          if (ev === "end") setImmediate(() => cb());
          return this;
        },
      };
      let status = 0;
      const res: any = {
        setHeader() {},
        statusCode: 0,
        end() {
          status = this.statusCode;
        },
      };
      await handlers.handleEvent(req, res);
      expect(status).toBe(200);
    }

    // Missing header should reject (exercise provided === "")
    {
      const req: any = {
        method: "POST",
        url: `/__runner/event/${encodeURIComponent(okEvent.id)}`,
        headers: {},
        on(ev: string, cb: Function) {
          if (ev === "end") setImmediate(() => cb());
          return this;
        },
      };
      let status = 0;
      const res: any = {
        setHeader() {},
        statusCode: 0,
        end() {
          status = this.statusCode;
        },
      };
      await handlers.handleEvent(req, res);
      expect(status).toBe(401);
    }

    await rr.dispose();
  });

  it("multipart with array of primitives and objects (no sentinels)", async () => {
    const passTask = defineTask<{ list: any[] }, Promise<number>>({
      id: "ok.no.file.array",
      run: async ({ list }) => list.length,
    });
    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "T" },
      },
    });
    const app = defineResource({
      id: "unit.exposure.coverage.app9",
      register: [passTask, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const boundary = "----covboundaryNoFiles";
    const manifest = JSON.stringify({ input: { list: [1, { k: 2 }, "s"] } });
    const body = [
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="__manifest"\r\n' +
        "Content-Type: application/json; charset=utf-8\r\n\r\n" +
        manifest +
        "\r\n",
      `--${boundary}--\r\n`,
    ].join("");

    const req: any = new (require("stream").Readable)({ read() {} });
    req.method = "POST";
    req.url = `/__runner/task/${encodeURIComponent(passTask.id)}`;
    req.headers = {
      "x-runner-token": "T",
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(Buffer.byteLength(body)),
    };
    setImmediate(() => {
      req.push(Buffer.from(body, "utf8"));
      req.push(null);
    });

    let status = 0;
    let payload = Buffer.alloc(0);
    const res: any = {
      setHeader() {},
      statusCode: 0,
      end(buf?: any) {
        status = this.statusCode;
        if (buf)
          payload = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
      },
    };

    await handlers.handleTask(req, res);
    expect(status).toBe(200);
    const out = JSON.parse(payload.toString("utf8"));
    expect(out.ok).toBe(true);
    expect(out.result).toBe(3);

    await rr.dispose();
  });

  it("handleRequest returns false when req.url is undefined", async () => {
    const okTask = defineTask<void, Promise<void>>({
      id: "ok.empty.task",
      run: async () => {},
    });
    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "T" },
      },
    });
    const app = defineResource({
      id: "unit.exposure.coverage.app10",
      register: [okTask, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const req: any = {
      method: "POST",
      url: undefined,
      headers: {},
      on(ev: string, cb: Function) {
        if (ev === "end") setImmediate(() => cb());
        return this;
      },
    };
    const res: any = { setHeader() {}, statusCode: 0, end() {} };
    const handled = await handlers.handleRequest(req, res);
    expect(handled).toBe(false);

    await rr.dispose();
  });

  it("multipart meta fallbacks: uses existing file.type when meta.type/size missing", async () => {
    const fileTask = defineTask<{ file: any }, Promise<string>>({
      id: "ok.file.meta.fallback",
      run: async ({ file }) => file.type,
    });
    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "T" },
      },
    });
    const app = defineResource({
      id: "unit.exposure.coverage.app11",
      register: [fileTask, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const boundary = "----covboundaryMetaFallback";
    const manifest = JSON.stringify({
      input: {
        file: { $ejson: "File", id: "F1", meta: { name: "onlyname.txt" } },
      },
    });
    const body = [
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="__manifest"\r\n' +
        "Content-Type: application/json; charset=utf-8\r\n\r\n" +
        manifest +
        "\r\n",
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file:F1"; filename="x.bin"\r\n' +
        "Content-Type: application/octet-stream\r\n\r\n" +
        "abc\r\n",
      `--${boundary}--\r\n`,
    ].join("");

    const req: any = new (require("stream").Readable)({ read() {} });
    req.method = "POST";
    req.url = `/__runner/task/${encodeURIComponent(fileTask.id)}`;
    req.headers = {
      "x-runner-token": "T",
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(Buffer.byteLength(body)),
    };
    setImmediate(() => {
      req.push(Buffer.from(body, "utf8"));
      req.push(null);
    });

    let status = 0;
    let payload = Buffer.alloc(0);
    const res: any = {
      setHeader() {},
      statusCode: 0,
      end(buf?: any) {
        status = this.statusCode;
        if (buf)
          payload = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
      },
    };

    await handlers.handleTask(req, res);
    expect(status).toBe(200);
    const out = JSON.parse(payload.toString("utf8"));
    expect(out.ok).toBe(true);
    // falls back to busboy-provided default application/octet-stream
    expect(out.result).toBe("application/octet-stream");

    await rr.dispose();
  });

  // Note: We intentionally avoid testing the network listen() + wrapper code here
  // due to sandbox socket restrictions. Those lines are explicitly excluded via
  // istanbul ignore directives in the implementation.

  it("returns 400 when task JSON parsing fails (body.ok branch)", async () => {
    const echo = defineTask<{ v: number }, Promise<number>>({
      id: "coverage.json.fail",
      run: async ({ v }) => v,
    });
    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "ARR" },
      },
    });
    const app = defineResource({
      id: "coverage.json.app",
      register: [echo, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const { Readable } = require("stream");
    const req: any = new Readable({ read() {} });
    req.method = "POST";
    req.url = `/__runner/task/${encodeURIComponent(echo.id)}`;
    req.headers = {
      "x-runner-token": "ARR",
      "content-type": "application/json",
    };
    setImmediate(() => {
      req.push("{");
      req.push(null);
    });

    let status = 0;
    let payload: any;
    const res: any = {
      writableEnded: false,
      statusCode: 0,
      setHeader() {},
      end(buf?: any) {
        status = this.statusCode;
        if (buf != null) {
          payload = JSON.parse(
            Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf),
          );
        }
      },
    };

    await handlers.handleTask(req, res);
    expect(status).toBe(400);
    expect(payload?.error?.code).toBe("INVALID_JSON");

    await rr.dispose();
  });

  it("registerDetach detaches only once and removes attachment", async () => {
    const noopTask = defineTask<void, Promise<void>>({
      id: "coverage.detach.task",
      run: async () => {},
    });
    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "DET" },
      },
    });
    const app = defineResource({
      id: "coverage.detach.app",
      register: [noopTask, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const listeners = new Map<string, Function[]>();
    const fakeServer: any = {
      on(event: string, handler: Function) {
        const arr = listeners.get(event) ?? [];
        arr.push(handler);
        listeners.set(event, arr);
        return this;
      },
      off(event: string, handler: Function) {
        const arr = listeners.get(event) ?? [];
        const idx = arr.indexOf(handler);
        if (idx >= 0) arr.splice(idx, 1);
        listeners.set(event, arr);
        return this;
      },
    };

    const detach = handlers.attachTo(fakeServer as unknown as http.Server);
    expect(listeners.get("request")?.length).toBe(1);
    detach();
    detach(); // second call should be a no-op (covers !active branch)
    expect(listeners.get("request")?.length ?? 0).toBe(0);

    await rr.dispose();
  });

  it("rejects JSON body when request is aborted", async () => {
    const echo = defineTask<void, Promise<number>>({
      id: "coverage.abort.task",
      run: async () => 1,
    });
    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "AB" },
      },
    });
    const app = defineResource({
      id: "coverage.abort.app",
      register: [echo, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const { Readable } = require("stream");
    const req: any = new Readable({ read() {} });
    req.method = "POST";
    req.url = `/__runner/task/${encodeURIComponent(echo.id)}`;
    req.headers = {
      "x-runner-token": "AB",
      "content-type": "application/json",
    };
    setImmediate(() => {
      req.emit("aborted");
      req.push(null);
    });

    let status = 0;
    let payload: any;
    const res: any = {
      statusCode: 0,
      setHeader() {},
      end(buf?: any) {
        status = this.statusCode;
        if (buf != null) {
          payload = JSON.parse(
            Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf),
          );
        }
      },
    };

    await handlers.handleTask(req, res);
    expect(status).toBe(499);
    expect(payload?.error?.code).toBe("REQUEST_ABORTED");

    await rr.dispose();
  });

  it("createRequestListener surfaces handler errors via 500 response", async () => {
    const echo = defineTask<void, Promise<number>>({
      id: "coverage.listener.task",
      run: async () => 1,
    });
    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "L" },
      },
    });
    const app = defineResource({
      id: "coverage.listener.app",
      register: [echo, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const listener = handlers.createRequestListener();
    const { req } = createReqRes({
      url: `/__runner/task/${encodeURIComponent(echo.id)}`,
      headers: { "x-runner-token": "L" },
      body: "{}",
    });
    (req as any).headers = null;
    let status = 0;
    let payload: any;
    const res: any = {
      writableEnded: false,
      statusCode: 0,
      setHeader() {},
      end(buf?: any) {
        status = this.statusCode;
        if (buf != null) {
          payload = JSON.parse(
            Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf),
          );
        }
      },
    };

    listener(req, res);
    await new Promise((resolve) => setImmediate(resolve));
    expect(status).toBe(500);
    expect(payload?.error?.message).toBe("Internal Error");

    await rr.dispose();
  });

  it("processEventRequest handles non-Error thrown during response", async () => {
    const evt = defineEvent<void>({ id: "coverage.event.nonerror" });
    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "EV" },
      },
    });
    const app = defineResource({
      id: "coverage.event.nonerror.app",
      register: [evt, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const container = createReqRes({
      url: `/__runner/event/${encodeURIComponent(evt.id)}`,
      headers: { "x-runner-token": "EV" },
      body: "{}",
    });
    let failFirst = true;
    container.res.setHeader = function () {
      if (failFirst) {
        failFirst = false;
        throw "oops";
      }
    };

    await handlers.handleEvent(container.req, container.res);
    expect(container.status).toBe(500);
    expect(container.json?.error?.message).toBe("Internal Error");

    await rr.dispose();
  });

  it("processEventRequest preserves Error messages from emit failures", async () => {
    const evt = defineEvent<void>({ id: "coverage.event.error" });
    const hook = defineHook({
      id: "coverage.event.error.hook",
      on: evt,
      run: async () => {
        throw new Error("emit failure");
      },
    });
    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "EVERR" },
      },
    });
    const app = defineResource({
      id: "coverage.event.error.app",
      register: [evt, hook, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const container = createReqRes({
      url: `/__runner/event/${encodeURIComponent(evt.id)}`,
      headers: { "x-runner-token": "EVERR" },
      body: "{}",
    });

    await handlers.handleEvent(container.req, container.res);
    expect(container.status).toBe(500);
    expect(container.json?.error?.message).toBe("emit failure");

    await rr.dispose();
  });

  it("createServer returns a server wired to the exposure handler", async () => {
    const echo = defineTask<void, Promise<number>>({
      id: "coverage.createServer.task",
      run: async () => 7,
    });
    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "CS" },
      },
    });
    const app = defineResource({
      id: "coverage.createServer.app",
      register: [echo, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const server = handlers.createServer();
    const { req, res } = createReqRes({
      url: `/__runner/task/${encodeURIComponent(echo.id)}`,
      headers: { "x-runner-token": "CS" },
      body: "{}",
    });

    server.emit("request", req, res);
    await new Promise((resolve) => setImmediate(resolve));
    expect(res.statusCode).toBe(200);

    server.close();
    await rr.dispose();
  });

  it("respondJson returns early when response already ended", async () => {
    const echo = defineTask<void, Promise<number>>({
      id: "coverage.writable.task",
      run: async () => 1,
    });
    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "W" },
      },
    });
    const app = defineResource({
      id: "coverage.writable.app",
      register: [echo, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const { Readable } = require("stream");
    const req: any = new Readable({ read() {} });
    req.method = "POST";
    req.url = `/__runner/task/${encodeURIComponent(echo.id)}`;
    req.headers = { "x-runner-token": "W" };
    setImmediate(() => req.push(null));

    const res: any = {
      writableEnded: true,
      statusCode: 123,
      setHeader() {
        throw new Error("should not be called");
      },
      end() {
        throw new Error("should not be called");
      },
    };

    await handlers.handleTask(req, res);
    expect(res.statusCode).toBe(123);

    await rr.dispose();
  });

  it("accepts auth tokens provided as array headers", async () => {
    const evt = defineEvent<void>({ id: "coverage.header.arr" });
    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "ARR" },
      },
    });
    const app = defineResource({
      id: "coverage.header.app",
      register: [evt, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

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

  it("handleTask handles malformed paths via router guard branches", async () => {
    const okTask = defineTask<void, Promise<number>>({
      id: "coverage.router.task",
      run: async () => 1,
    });
    const exposure = nodeExposure.with({
      http: {
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: "R" },
      },
    });
    const app = defineResource({
      id: "coverage.router.app",
      register: [okTask, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const headers = { "x-runner-token": "R" } as Record<string, string>;

    // Not under base path
    {
      const { req, res } = createReqRes({
        url: `/something/task/${encodeURIComponent(okTask.id)}`,
        headers,
      });
      await handlers.handleTask(req, res);
      expect(res.statusCode).toBe(404);
    }

    // Missing id segment
    {
      const { req, res } = createReqRes({ url: `/__runner/task/`, headers });
      await handlers.handleTask(req, res);
      expect(res.statusCode).toBe(404);
    }

    // Invalid kind segment
    {
      const { req, res } = createReqRes({
        url: `/__runner/foo/${encodeURIComponent(okTask.id)}`,
        headers,
      });
      await handlers.handleTask(req, res);
      expect(res.statusCode).toBe(404);
    }

    // Malformed encoded id triggers decodeURIComponent catch
    {
      const { req, res } = createReqRes({ url: `/__runner/task/%`, headers });
      await handlers.handleTask(req, res);
      expect(res.statusCode).toBe(404);
    }

    await rr.dispose();
  });
});
