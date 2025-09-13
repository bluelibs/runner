import * as http from "http";
import { defineResource } from "../../define";
import { run } from "../../run";
import { nodeHttpTunnel } from "../http-tunnel.resource";
import { defineTask } from "../../definers/defineTask";

describe("nodeHttpTunnel - unit edge cases", () => {
  const dummyTask = defineTask<{ x?: number }, Promise<any>>({
    id: "unit.tunnel.dummy",
    run: async () => 42,
  });

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

  it("rejects when server returns invalid JSON (postJson parse error)", async () => {
    const { server, baseUrl } = await startServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      // Intentionally invalid JSON body
      res.end("not-json");
    });

    const provider = defineResource({
      id: "unit.tunnel.invalidjson",
      register: [nodeHttpTunnel.with({ baseUrl })],
      dependencies: { httpTunnel: nodeHttpTunnel },
      init: async (_, { httpTunnel }) => httpTunnel,
    });

    const rr = await run(provider);
    const tunnel = await rr.getResourceValue(provider as any);

    await expect(tunnel.run!(dummyTask, { x: 1 })).rejects.toThrow(/Invalid JSON response/);

    await rr.dispose();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("triggers client-side request timeout (setTimeout -> destroy)", async () => {
    // Server accepts request but never responds to trigger client timeout branch
    const { server, baseUrl } = await startServer((_req, _res) => {
      // do nothing -> keep the socket open
    });

    const provider = defineResource({
      id: "unit.tunnel.timeout",
      register: [nodeHttpTunnel.with({ baseUrl, timeoutMs: 50 })],
      dependencies: { httpTunnel: nodeHttpTunnel },
      init: async (_, { httpTunnel }) => httpTunnel,
    });

    const rr = await run(provider);
    const tunnel = await rr.getResourceValue(provider as any);

    await expect(tunnel.run!(dummyTask, { x: 1 })).rejects.toThrow(/Request timeout/);

    await rr.dispose();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("succeeds when server returns ok:true with result", async () => {
    const { server, baseUrl } = await startServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: true, result: 7 }));
    });

    const provider = defineResource({
      id: "unit.tunnel.success",
      register: [nodeHttpTunnel.with({ baseUrl })],
      dependencies: { httpTunnel: nodeHttpTunnel },
      init: async (_, { httpTunnel }) => httpTunnel,
    });

    const rr = await run(provider);
    const tunnel = await rr.getResourceValue(provider as any);
    const result = await tunnel.run!(dummyTask, { x: 1 });
    expect(result).toBe(7);

    await rr.dispose();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("throws default error message when ok:false without message (task)", async () => {
    const { server, baseUrl } = await startServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false }));
    });

    const provider = defineResource({
      id: "unit.tunnel.default-task-error",
      register: [nodeHttpTunnel.with({ baseUrl })],
      dependencies: { httpTunnel: nodeHttpTunnel },
      init: async (_, { httpTunnel }) => httpTunnel,
    });

    const rr = await run(provider);
    const tunnel = await rr.getResourceValue(provider as any);
    await expect(tunnel.run!(dummyTask, {})).rejects.toThrow(/Tunnel task error/);

    await rr.dispose();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("throws default error message when ok:false without message (event)", async () => {
    const { server, baseUrl } = await startServer((_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false }));
    });

    const provider = defineResource({
      id: "unit.tunnel.default-event-error",
      register: [nodeHttpTunnel.with({ baseUrl })],
      dependencies: { httpTunnel: nodeHttpTunnel },
      init: async (_, { httpTunnel }) => httpTunnel,
    });

    const rr = await run(provider);
    const tunnel = await rr.getResourceValue(provider as any);
    await expect(tunnel.emit!({ id: "unit.ev", data: {} } as any)).rejects.toThrow(
      /Tunnel event error/,
    );

    await rr.dispose();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("throws on missing baseUrl", async () => {
    const provider = defineResource({
      id: "unit.tunnel.missing-base-url",
      register: [nodeHttpTunnel.with({ baseUrl: "" as any })],
      dependencies: { httpTunnel: nodeHttpTunnel },
      init: async (_, { httpTunnel }) => httpTunnel,
    });
    await expect(run(provider)).rejects.toThrow(/requires baseUrl/);
  });

  it("selects https module for https URLs and surfaces connection errors", async () => {
    const provider = defineResource({
      id: "unit.tunnel.https-error",
      register: [nodeHttpTunnel.with({ baseUrl: "https://127.0.0.1:1/__runner" })],
      dependencies: { httpTunnel: nodeHttpTunnel },
      init: async (_, { httpTunnel }) => httpTunnel,
    });
    const rr = await run(provider);
    const tunnel = await rr.getResourceValue(provider as any);
    await expect(tunnel.run!(dummyTask, {})).rejects.toThrow();
    await rr.dispose();
  });
});
