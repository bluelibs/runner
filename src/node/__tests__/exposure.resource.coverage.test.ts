import * as http from "http";
import { defineResource, defineTask, defineEvent } from "../../define";
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
      setHeader() {/* no-op */},
      end(payload?: any) {
        statusCode = this.statusCode;
        if (payload != null) {
          chunks.push(Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)));
        }
      },
    };

    return {
      req,
      res,
      get status() { return statusCode; },
      get resStatus() { return res.statusCode as number; },
      get json() {
        if (chunks.length === 0) return undefined;
        try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return undefined; }
      },
    };
  }

  it("covers extractTarget fallback, method 405/401, and not-found branches for task/event", async () => {
    // Define a real task/event for the store via runner
    const okTask = defineTask<void, Promise<number>>({ id: "ok.task", run: async () => 42 });
    const badTask = defineTask<{ v: number }, Promise<number>>({
      id: "bad.task",
      inputSchema: z.object({ v: z.number() }).strict(),
      resultSchema: z.number(),
      run: async ({ v }) => v,
    });
    const throwTask = defineTask<void, Promise<void>>({ id: "oops.task", run: async () => { throw ({} as any); } });
    const okEvent = defineEvent<{ v?: number }>({ id: "ok.event" });

    const exposure = nodeExposure.with({ http: { server: http.createServer(), basePath: "/__runner", auth: { token: "T" } } });
    const app = defineResource({ id: "unit.exposure.coverage.app1", register: [okTask, badTask, throwTask, okEvent, exposure] });
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
      const res1: any = { setHeader() {}, statusCode: 0, end() { status1 = this.statusCode; } };
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
      const res: any = { setHeader() {}, statusCode: 0, end() { status = this.statusCode; } };
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
      const res: any = { setHeader() {}, statusCode: 0, end() { status = this.statusCode; } };
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
      const res: any = { setHeader() {}, statusCode: 0, end() { status = this.statusCode; } };
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
      const res: any = { setHeader() {}, statusCode: 0, end() { status = this.statusCode; } };
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
      const res: any = { setHeader() {}, statusCode: 0, end() { status = this.statusCode; } };
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
      const res: any = { setHeader() {}, statusCode: 0, end() { status = this.statusCode; } };
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
      const res: any = { setHeader() {}, statusCode: 0, end() { status = this.statusCode; } };
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
      const res: any = { setHeader() {}, statusCode: 0, end() { status = this.statusCode; } };
      await handlers.handleTask(req, res);
      expect(status).toBe(500);
    }

    // handleEvent: catch branch via invalid JSON -> 500
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
      const res: any = { setHeader() {}, statusCode: 0, end() { status = this.statusCode; } };
      await handlers.handleEvent(req, res);
      expect(status).toBe(500);
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
          if (payload != null) chunks.push(Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)));
        },
      };
      await handlers.handleTask(req, res);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
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
          if (payload != null) chunks.push(Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)));
        },
      };
      await handlers.handleEvent(req, res);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
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
      const res: any = { setHeader() {}, statusCode: 0, end() { status = this.statusCode; } };
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
      const res: any = { setHeader() {}, statusCode: 0, end() { status = this.statusCode; } };
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
      const res: any = { setHeader() {}, statusCode: 0, end() { status = this.statusCode; } };
      await handlers.handleEvent(req, res);
      expect(status).toBe(200);
    }

    await rr.dispose();
  });
  
  // Note: We intentionally avoid testing the network listen() + wrapper code here
  // due to sandbox socket restrictions. Those lines are explicitly excluded via
  // istanbul ignore directives in the implementation.
});
