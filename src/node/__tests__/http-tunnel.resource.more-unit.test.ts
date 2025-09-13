import * as http from "http";
import { defineResource } from "../../define";
import { run } from "../../run";
import { nodeHttpTunnel } from "../http-tunnel.resource";
import { defineTask } from "../../definers/defineTask";

describe("nodeHttpTunnel - additional branch coverage", () => {
  const dummyTask = defineTask<void, Promise<number>>({ id: "unit.tunnel.more.dummy", run: async () => 1 });

  function startServer(handler: http.RequestListener) {
    const server = http.createServer(handler);
    return new Promise<{ server: http.Server; baseUrl: string }>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") throw new Error("No address");
        resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}/__runner` });
      });
    });
  }

  it("treats empty response body as error (raw -> undefined)", async () => {
    const { server, baseUrl } = await startServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(); // no body -> postJson returns undefined
    });

    const provider = defineResource({
      id: "unit.tunnel.more.empty-body",
      register: [nodeHttpTunnel.with({ baseUrl })],
      dependencies: { httpTunnel: nodeHttpTunnel },
      init: async (_, { httpTunnel }) => httpTunnel,
    });

    const rr = await run(provider);
    const tunnel = await rr.getResourceValue(provider as any);

    await expect(tunnel.emit!({ id: "unit.ev", data: {} } as any)).rejects.toThrow(/Tunnel event error/);

    await rr.dispose();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("uses default port when URL omits it (http) and surfaces errors", async () => {
    const provider = defineResource({
      id: "unit.tunnel.more.default-port",
      register: [nodeHttpTunnel.with({ baseUrl: "http://127.0.0.1/__runner", timeoutMs: 50 })],
      dependencies: { httpTunnel: nodeHttpTunnel },
      init: async (_, { httpTunnel }) => httpTunnel,
    });

    const rr = await run(provider);
    const tunnel = await rr.getResourceValue(provider as any);
    await expect(tunnel.run!(dummyTask, {})).rejects.toThrow();
    await rr.dispose();
  });

  it("throws on missing baseUrl when property is undefined (cfg?.baseUrl ?? '') branch", async () => {
    const provider = defineResource({
      id: "unit.tunnel.more.no-base",
      register: [nodeHttpTunnel.with({} as any)],
      dependencies: { httpTunnel: nodeHttpTunnel },
      init: async (_, { httpTunnel }) => httpTunnel,
    });
    await expect(run(provider)).rejects.toThrow(/requires baseUrl/);
  });

  it("handles non-Buffer response chunks (string) via mocked http.request", async () => {
    const spy = jest.spyOn(http, "request").mockImplementation(((opts: any, cb: any) => {
      // Minimal req/res fakes
      const res: any = {
        _listeners: new Map<string, Function[]>(),
        on(event: string, fn: Function) {
          const arr = this._listeners.get(event) ?? [];
          arr.push(fn);
          this._listeners.set(event, arr);
          return this;
        },
      };
      // Invoke callback immediately, then emit string chunk/end on next tick
      cb(res);
      setImmediate(() => {
        for (const d of res._listeners.get("data") ?? []) d('{"ok":true}'); // string chunk
        for (const e of res._listeners.get("end") ?? []) e();
      });
      const req: any = {
        on() { return this; },
        setTimeout() { return this; },
        write() {},
        end() {},
        destroy() {},
      };
      return req;
    }) as any);

    const provider = defineResource({
      id: "unit.tunnel.more.string-chunk",
      register: [nodeHttpTunnel.with({ baseUrl: "http://example.com/__runner" })],
      dependencies: { httpTunnel: nodeHttpTunnel },
      init: async (_, { httpTunnel }) => httpTunnel,
    });
    const rr = await run(provider);
    const tunnel = await rr.getResourceValue(provider as any);
    await expect(tunnel.emit!({ id: "ev", data: {} } as any)).resolves.toBeUndefined();
    spy.mockRestore();
    await rr.dispose();
  });
});
