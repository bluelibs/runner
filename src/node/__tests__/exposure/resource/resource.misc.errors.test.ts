import * as http from "http";
import { z } from "zod";
import { defineResource, defineTask, defineEvent } from "../../../../define";
import { run } from "../../../../run";
import { nodeExposure } from "../../../exposure/resource";

describe("nodeExposure - misc error branches", () => {
  const TOKEN = "unit-secret";
  const noInputTask = defineTask<void, Promise<number>>({ id: "unit.exposure.misc.noInputTask", run: async () => 123 });
  const dummyEvent = defineEvent<{ x?: number }>({ id: "unit.exposure.misc.event" });

  it("readJson branch: accepts non-Buffer chunks (string)", async () => {
    const exposure = nodeExposure.with({ http: { dangerouslyAllowOpenExposure: true, server: http.createServer(), basePath: "/__runner", auth: { token: TOKEN } } });
    const app = defineResource({ id: "unit.exposure.misc.app3", register: [noInputTask, exposure] });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);
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
        if (event === "end") setImmediate(() => { for (const d of this._listeners.get("data") ?? []) d("{}"); for (const e of this._listeners.get("end") ?? []) e(); });
        return this;
      },
    };
    let statusCode = 0;
    const resBody: Buffer[] = [];
    const res: any = { setHeader() {}, getHeader() { return undefined; }, statusCode: 0, end(payload?: any) { statusCode = this.statusCode; if (payload != null) resBody.push(Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload))); } };
    await handlers.handleTask(req, res);
    expect(statusCode).toBe(200);
    const parsed = JSON.parse(Buffer.concat(resBody as readonly Uint8Array[]).toString("utf8"));
    expect(parsed.ok).toBe(true);
    await rr.dispose();
  });

  it("swallows logger errors inside catch blocks (task)", async () => {
    const badTask = defineTask<{ v: number }, Promise<number>>({ id: "unit.exposure.misc.badTask", inputSchema: z.object({ v: z.number() }).strict(), run: async ({ v }) => v });
    const exposure = nodeExposure.with({ http: { dangerouslyAllowOpenExposure: true, server: http.createServer(), basePath: "/__runner", auth: { token: TOKEN } } });
    const app = defineResource({ id: "unit.exposure.misc.app6", register: [badTask, exposure] });
    const rr = await run(app);
    (rr.logger as any).error = () => { throw new Error("logger-fail"); };
    const handlers = await rr.getResourceValue(exposure.resource as any);
    const headers = { "x-runner-token": TOKEN } as Record<string, string>;
    const req: any = { method: "POST", url: `/__runner/task/${encodeURIComponent(badTask.id)}`, headers, on(event: string, cb: Function) { if (event === "end") setImmediate(() => cb()); return this; } };
    let status = 0;
    const res: any = { setHeader() {}, statusCode: 0, end() { status = this.statusCode; } };
    await handlers.handleTask(req, res);
    expect(status).toBe(500);
    await rr.dispose();
  });

  it("swallows logger errors inside catch blocks (event)", async () => {
    const exposure = nodeExposure.with({ http: { dangerouslyAllowOpenExposure: true, server: http.createServer(), basePath: "/__runner", auth: { token: TOKEN } } });
    const app = defineResource({ id: "unit.exposure.misc.app9", register: [dummyEvent, exposure] });
    const rr = await run(app);
    (rr.logger as any).error = () => { throw new Error("logger-fail"); };
    const handlers = await rr.getResourceValue(exposure.resource as any);
    const headers = { "x-runner-token": TOKEN } as Record<string, string>;
    const req: any = { method: "POST", url: `/__runner/event/${encodeURIComponent(dummyEvent.id)}`, headers, on(event: string, cb: Function) { if (event === "end") setImmediate(() => cb(new Error("bad-json"))); if (event === "data") setImmediate(() => cb("not-json")); return this; } };
    let status = 0;
    const res: any = { setHeader() {}, statusCode: 0, end() { status = this.statusCode; } };
    await handlers.handleEvent(req, res);
    expect(status).toBe(400);
    await rr.dispose();
  });
});
