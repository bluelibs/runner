import * as http from "http";
import { z } from "zod";
import { defineResource } from "../../define";
import { defineTask } from "../../definers/defineTask";
import { defineEvent } from "../../definers/defineEvent";
import { run } from "../../run";
import { nodeExposure } from "../exposure.resource";

describe("nodeExposure - misc branches", () => {
  const TOKEN = "unit-secret";

  const noInputTask = defineTask<void, Promise<number>>({
    id: "unit.exposure.misc.noInputTask",
    run: async () => 123,
  });

  const dummyEvent = defineEvent<{ x?: number }>({
    id: "unit.exposure.misc.event",
  });

  it("normalizes basePath (ensure leading slash + trim trailing)", async () => {
    const externalServer = http.createServer();

    // basePath without leading slash -> should be prefixed with '/'
    const exposure1 = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        server: externalServer,
        basePath: "runner",
        auth: { token: TOKEN },
      },
    });
    const app1 = defineResource({
      id: "unit.exposure.misc.app1",
      register: [dummyEvent, exposure1],
    });
    const rr1 = await run(app1);
    const handlers1 = await rr1.getResourceValue(exposure1.resource as any);
    expect(handlers1.basePath).toBe("/runner");
    await rr1.dispose();

    // basePath with trailing slash -> should be trimmed
    const exposure2 = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        server: externalServer,
        basePath: "/trimmed/",
        auth: { token: TOKEN },
      },
    });
    const app2 = defineResource({
      id: "unit.exposure.misc.app2",
      register: [dummyEvent, exposure2],
    });
    const rr2 = await run(app2);
    const handlers2 = await rr2.getResourceValue(exposure2.resource as any);
    expect(handlers2.basePath).toBe("/trimmed");
    await rr2.dispose();

    externalServer.close();
  });

  it("readJson branch: accepts non-Buffer chunks (string)", async () => {
    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: TOKEN },
      },
    });
    const app = defineResource({
      id: "unit.exposure.misc.app3",
      register: [noInputTask, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    // Minimal IncomingMessage/ServerResponse fakes
    const headers = { "x-runner-token": TOKEN } as Record<string, string>;

    const req: any = {
      method: "POST",
      url: `/__runner/task/${encodeURIComponent(noInputTask.id)}`,
      headers,
      _listeners: new Map<string, Function[]>(),
      on(event: string, cb: Function) {
        const arr = this._listeners.get(event) ?? [];
        arr.push(cb);
        this._listeners.set(event, arr);
        // When 'end' is registered, emit a string chunk then end to exercise the string branch
        if (event === "end") {
          // ensure data listener was added first
          setImmediate(() => {
            const datas = this._listeners.get("data") ?? [];
            for (const d of datas) d("{}"); // string chunk
            for (const e of this._listeners.get("end") ?? []) e();
          });
        }
        return this;
      },
    };

    let statusCode = 0;
    const resBody: Buffer[] = [];
    const res: any = {
      setHeader() {},
      getHeader() {
        return undefined;
      },
      statusCode: 0,
      end(payload?: any) {
        statusCode = this.statusCode;
        if (payload != null)
          resBody.push(
            Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload)),
          );
      },
    };

    await handlers.handleTask(req, res);
    expect(statusCode).toBe(200);
    const parsed = JSON.parse(
      Buffer.concat(resBody as readonly Uint8Array[]).toString("utf8"),
    );
    expect(parsed.ok).toBe(true);

    await rr.dispose();
  });

  it("init handles undefined http config and defaults basePath", async () => {
    const exposure = nodeExposure.with({});
    const app = defineResource({
      id: "unit.exposure.misc.app4",
      register: [dummyEvent, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);
    expect(handlers.basePath).toBe("/__runner");
    expect(handlers.server).toBeNull();
    await rr.dispose();
  });

  it("direct handlers: extractTarget returns null for non-base paths and url fallback with undefined", async () => {
    const exposure = nodeExposure.with({
      http: { server: http.createServer(), auth: { token: TOKEN } },
    });
    const app = defineResource({
      id: "unit.exposure.misc.app5",
      register: [noInputTask, dummyEvent, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const headers = { "x-runner-token": TOKEN } as Record<string, string>;

    // handleTask with non-base path -> extractTarget(!isUnderBase) -> null -> 404
    const req1: any = {
      method: "POST",
      url: `/not-runner/task/${encodeURIComponent(noInputTask.id)}`,
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

    // handleEvent with undefined url -> defaults to '/' -> not under base -> 404
    const req2: any = {
      method: "POST",
      url: undefined,
      headers,
      on(event: string, cb: Function) {
        if (event === "end") setImmediate(() => cb());
        return this;
      },
    };
    let status2 = 0;
    const res2: any = {
      setHeader() {},
      statusCode: 0,
      end() {
        status2 = this.statusCode;
      },
    };
    await handlers.handleEvent(req2, res2);
    expect(status2).toBe(404);

    await rr.dispose();
  });

  it("swallows logger errors inside catch blocks (task)", async () => {
    const TOKEN2 = "unit-secret-2";
    const badTask = defineTask<{ v: number }, Promise<number>>({
      id: "unit.exposure.misc.badTask",
      inputSchema: z.object({ v: z.number() }).strict(),
      run: async ({ v }) => v,
    });

    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: TOKEN2 },
      },
    });
    const app = defineResource({
      id: "unit.exposure.misc.app6",
      register: [badTask, exposure],
    });
    const rr = await run(app);
    // Monkey-patch logger.error to throw to exercise inner try/catch
    (rr.logger as any).error = () => {
      throw new Error("logger-fail");
    };
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const headers = { "x-runner-token": TOKEN2 } as Record<string, string>;
    const req: any = {
      method: "POST",
      url: `/__runner/task/${encodeURIComponent(badTask.id)}`,
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
    expect(status).toBe(500);

    await rr.dispose();
  });

  it("handleTask with undefined url falls back to '/' and returns 404", async () => {
    const exposure = nodeExposure.with({
      http: { server: http.createServer(), auth: { token: TOKEN } },
    });
    const app = defineResource({
      id: "unit.exposure.misc.app7",
      register: [noInputTask, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const headers = { "x-runner-token": TOKEN } as Record<string, string>;
    const req: any = {
      method: "POST",
      url: undefined,
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

    await rr.dispose();
  });

  it("handleEvent success branch returns 200 (direct)", async () => {
    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: TOKEN },
      },
    });
    const app = defineResource({
      id: "unit.exposure.misc.app8",
      register: [dummyEvent, exposure],
    });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const headers = { "x-runner-token": TOKEN } as Record<string, string>;
    const req: any = {
      method: "POST",
      url: `/__runner/event/${encodeURIComponent(dummyEvent.id)}`,
      headers,
      _listeners: new Map<string, Function[]>(),
      on(event: string, cb: Function) {
        const arr = this._listeners.get(event) ?? [];
        arr.push(cb);
        this._listeners.set(event, arr);
        if (event === "end") {
          setImmediate(() => {
            for (const d of this._listeners.get("data") ?? [])
              d('{"payload":{}}');
            for (const e of this._listeners.get("end") ?? []) e();
          });
        }
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

    await rr.dispose();
  });

  it("swallows logger errors inside catch blocks (event)", async () => {
    const exposure = nodeExposure.with({
      http: {
        dangerouslyAllowOpenExposure: true,
        server: http.createServer(),
        basePath: "/__runner",
        auth: { token: TOKEN },
      },
    });
    const app = defineResource({
      id: "unit.exposure.misc.app9",
      register: [dummyEvent, exposure],
    });
    const rr = await run(app);
    (rr.logger as any).error = () => {
      throw new Error("logger-fail");
    };
    const handlers = await rr.getResourceValue(exposure.resource as any);

    const headers = { "x-runner-token": TOKEN } as Record<string, string>;
    const req: any = {
      method: "POST",
      url: `/__runner/event/${encodeURIComponent(dummyEvent.id)}`,
      headers,
      on(event: string, cb: Function) {
        if (event === "end") setImmediate(() => cb(new Error("bad-json")));
        if (event === "data") setImmediate(() => cb("not-json"));
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
    expect(status).toBe(400);
    await rr.dispose();
  });
});
