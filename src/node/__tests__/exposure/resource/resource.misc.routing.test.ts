import * as http from "http";
import { defineResource, defineTask, defineEvent } from "../../../../define";
import { run } from "../../../../run";
import { nodeExposure } from "../../../exposure/resource";

describe("nodeExposure - misc routing branches", () => {
  const TOKEN = "unit-secret";
  const noInputTask = defineTask<void, Promise<number>>({ id: "unit.exposure.misc.noInputTask", run: async () => 123 });
  const dummyEvent = defineEvent<{ x?: number }>({ id: "unit.exposure.misc.event" });

  it("direct handlers: extractTarget returns null for non-base paths and url fallback with undefined", async () => {
    const exposure = nodeExposure.with({ http: { server: http.createServer(), auth: { token: TOKEN } } });
    const app = defineResource({ id: "unit.exposure.misc.app5", register: [noInputTask, dummyEvent, exposure] });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);
    const headers = { "x-runner-token": TOKEN } as Record<string, string>;

    const req1: any = { method: "POST", url: `/not-runner/task/${encodeURIComponent(noInputTask.id)}`, headers, on(event: string, cb: Function) { if (event === "end") setImmediate(() => cb()); return this; } };
    let status1 = 0;
    const res1: any = { setHeader() {}, statusCode: 0, end() { status1 = this.statusCode; } };
    await handlers.handleTask(req1, res1);
    expect(status1).toBe(404);

    const req2: any = { method: "POST", url: undefined, headers, on(event: string, cb: Function) { if (event === "end") setImmediate(() => cb()); return this; } };
    let status2 = 0;
    const res2: any = { setHeader() {}, statusCode: 0, end() { status2 = this.statusCode; } };
    await handlers.handleEvent(req2, res2);
    expect(status2).toBe(404);
    await rr.dispose();
  });

  it("handleTask with undefined url falls back to '/' and returns 404", async () => {
    const exposure = nodeExposure.with({ http: { server: http.createServer(), auth: { token: TOKEN } } });
    const app = defineResource({ id: "unit.exposure.misc.app7", register: [noInputTask, exposure] });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource as any);
    const headers = { "x-runner-token": TOKEN } as Record<string, string>;
    const req: any = { method: "POST", url: undefined, headers, on(event: string, cb: Function) { if (event === "end") setImmediate(() => cb()); return this; } };
    let status = 0;
    const res: any = { setHeader() {}, statusCode: 0, end() { status = this.statusCode; } };
    await handlers.handleTask(req, res);
    expect(status).toBe(404);
    await rr.dispose();
  });

  it("handleEvent success branch returns 200 (direct)", async () => {
    const exposure = nodeExposure.with({ http: { dangerouslyAllowOpenExposure: true, server: http.createServer(), basePath: "/__runner", auth: { token: TOKEN } } });
    const app = defineResource({ id: "unit.exposure.misc.app8", register: [dummyEvent, exposure] });
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
        if (event === "end") setImmediate(() => { for (const d of this._listeners.get("data") ?? []) d('{"payload":{}}'); for (const e of this._listeners.get("end") ?? []) e(); });
        return this;
      },
    };
    let status = 0;
    const res: any = { setHeader() {}, statusCode: 0, end() { status = this.statusCode; } };
    await handlers.handleEvent(req, res);
    expect(status).toBe(200);
    await rr.dispose();
  });
});
