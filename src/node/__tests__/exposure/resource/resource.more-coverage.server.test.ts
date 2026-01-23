import * as http from "http";
import type { IncomingMessage, ServerResponse } from "http";
import { defineResource, defineTask } from "../../../../define";
import { run } from "../../../../run";
import { nodeExposure } from "../../../exposure/resource";
import { createBaseReq, MockRes } from "./resource.more-coverage.test.utils";

describe("nodeExposure - more server coverage", () => {
  it("server wrapper: if not handled, responds 404 (no sockets)", async () => {
    const httpWithMutableCreate = http as unknown as { createServer: typeof http.createServer };
    const realCreate = httpWithMutableCreate.createServer;
    let capturedHandler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;
    const server = {
      listen: (...args: unknown[]) => { const cb = args.find((arg) => typeof arg === "function") as (() => void) | undefined; cb?.(); return server as http.Server; },
      close: (cb?: () => void) => { cb?.(); return server as http.Server; },
      on() { return server as http.Server; },
      address() { return { port: 0 } as { port: number }; },
    } as unknown as http.Server;
    httpWithMutableCreate.createServer = ((requestListener?: http.RequestListener) => {
      capturedHandler = (requestListener ?? null) as ((req: IncomingMessage, res: ServerResponse) => void) | null;
      return server;
    }) as typeof http.createServer;

    const t = defineTask<void, Promise<void>>({ id: "exposer.more.server", run: async () => {} });
    const exposure = nodeExposure.with({ http: { dangerouslyAllowOpenExposure: true, listen: { port: 0 }, basePath: "/__runner", auth: { token: "T" } } });
    const app = defineResource({ id: "exposer.more.app4", register: [t, exposure] });
    const rr = await run(app);
    const handlers = await rr.getResourceValue(exposure.resource);

    expect(typeof capturedHandler).toBe("function");
    const req = createBaseReq();
    req.url = "/not-runner";
    req.headers = {};
    const chunks: Buffer[] = [];
    const res = {
      statusCode: 0,
      setHeader(_name: string, _value: number | string | ReadonlyArray<string>) { return res as unknown as ServerResponse; },
      end(buf?: unknown) { if (buf) chunks.push(Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf))); return res as unknown as ServerResponse; },
    } as unknown as MockRes;
    capturedHandler!(req, res);
    await new Promise((r) => setImmediate(r));
    expect(res.statusCode).toBe(404);

    await rr.dispose();
    httpWithMutableCreate.createServer = realCreate;
    expect(handlers.server).toBe(server);
  });
});
