import { z } from "zod";
import { defineTask, defineEvent, defineHook, defineResource } from "../define";
import { run } from "../run";
import { globals } from "../index";
import { nodeExposure } from "../node/exposure.resource";
import { httpFetchTunnel, createExposureFetch } from "../http-fetch-tunnel.resource";

describe("HTTP Exposure + Fetch Tunnel (POST JSON)", () => {
  const TOKEN = "super-secret";

  // Server-side definitions
  const sumTask = defineTask<{ a: number; b: number }, Promise<number>>({
    id: "fetch.test.tasks.sum",
    inputSchema: z.object({ a: z.number(), b: z.number() }).strict(),
    resultSchema: z.number(),
    run: async ({ a, b }) => a + b,
  });

  const mustBePositive = defineTask<{ n: number }, Promise<number>>({
    id: "fetch.test.tasks.mustBePositive",
    inputSchema: z.object({ n: z.number().min(0) }).strict(),
    resultSchema: z.number(),
    run: async ({ n }) => n,
  });

  const pingEvent = defineEvent<{ msg: string }>({
    id: "fetch.test.events.ping",
  });

  let serverEvents: string[];
  const serverHook = defineHook({
    id: "fetch.test.hooks.server",
    on: pingEvent,
    run: async (e) => {
      serverEvents.push(`server:${e.data.msg}`);
    },
  });

  // Helper to start the server runner with exposure listening on an ephemeral port
  async function startServer() {
    serverEvents = [];
    const exposure = nodeExposure.with({
      http: {
        basePath: "/__runner",
        listen: { port: 0 },
        auth: { token: TOKEN },
      },
    });

    const serverApp = defineResource({
      id: "fetch.test.server",
      register: [sumTask, mustBePositive, pingEvent, serverHook, exposure],
    });

    const rrServer = await run(serverApp);
    const handlers = await rrServer.getResourceValue(exposure.resource as any);
    const addr = handlers.server?.address();
    if (!addr || typeof addr === "string") throw new Error("No server address");
    const port = addr.port;
    const baseUrl = `http://127.0.0.1:${port}${handlers.basePath}`;
    return { rrServer, baseUrl } as const;
  }

  // Client-side local task shells (non-phantom) whose run() should never execute locally
  const sumClient = defineTask<{ a: number; b: number }, Promise<number>>({
    id: sumTask.id,
    run: async () => {
      throw new Error("local sumClient.run() should not be called");
    },
  });
  const mustBePositiveClient = defineTask<{ n: number }, Promise<number>>({
    id: mustBePositive.id,
    run: async () => {
      throw new Error("local mustBePositiveClient.run() should not be called");
    },
  });
  const missingClient = defineTask<{ x: number }, Promise<number>>({
    id: "fetch.test.tasks.missingOnServer",
    run: async () => {
      throw new Error("local missingClient.run() should not be called");
    },
  });

  let clientEvents: string[];
  const clientHook = defineHook({
    id: "fetch.test.hooks.client",
    on: pingEvent,
    run: async (e) => {
      clientEvents.push(`client:${e.data.msg}`);
    },
  });

  it("runs tasks over fetch() JSON with auth (resource)", async () => {
    const { rrServer, baseUrl } = await startServer();

    const fetchTunnel = httpFetchTunnel.with({ baseUrl, auth: { token: TOKEN } });
    const clientTunnel = defineResource({
      id: "fetch.test.client.tunnel.ok",
      tags: [
        globals.tags.tunnel.with({
          mode: "client",
          tasks: [sumClient.id, mustBePositiveClient.id],
        }),
      ],
      register: [fetchTunnel],
      dependencies: { fetchTunnel: httpFetchTunnel },
      init: async (_, { fetchTunnel }) => fetchTunnel,
    });
    const clientWithTunnel = defineResource({
      id: "fetch.test.client.wrapper",
      register: [sumClient, mustBePositiveClient, clientTunnel],
    });

    const rrClient = await run(clientWithTunnel);
    const sum = await rrClient.runTask(sumClient, { a: 2, b: 5 });
    expect(sum).toBe(7);

    await rrClient.dispose();
    await rrServer.dispose();
  });

  it("returns not found for missing task id on server (resource)", async () => {
    const { rrServer, baseUrl } = await startServer();
    const fetchTunnel = httpFetchTunnel.with({ baseUrl, auth: { token: TOKEN } });
    const clientTunnel = defineResource({
      id: "fetch.test.client.tunnel.notfound",
      tags: [globals.tags.tunnel.with({ mode: "client", tasks: [missingClient.id] })],
      register: [fetchTunnel],
      dependencies: { fetchTunnel: httpFetchTunnel },
      init: async (_, { fetchTunnel }) => fetchTunnel,
    });
    const client = defineResource({
      id: "fetch.test.client.notfound",
      register: [missingClient, clientTunnel],
    });
    const rrClient = await run(client);
    await expect(rrClient.runTask(missingClient, { x: 1 })).rejects.toThrow(
      /not found/i,
    );
    await rrClient.dispose();
    await rrServer.dispose();
  });

  it("returns unauthorized when token is wrong (resource)", async () => {
    const { rrServer, baseUrl } = await startServer();
    const fetchTunnel = httpFetchTunnel.with({ baseUrl, auth: { token: "WRONG" } });
    const clientTunnel = defineResource({
      id: "fetch.test.client.tunnel.unauth",
      tags: [globals.tags.tunnel.with({ mode: "client", tasks: [sumClient.id] })],
      register: [fetchTunnel],
      dependencies: { fetchTunnel: httpFetchTunnel },
      init: async (_, { fetchTunnel }) => fetchTunnel,
    });
    const client = defineResource({
      id: "fetch.test.client.unauth",
      register: [sumClient, clientTunnel],
    });
    const rrClient = await run(client);
    await expect(rrClient.runTask(sumClient, { a: 1, b: 1 })).rejects.toThrow(
      /unauthorized/i,
    );
    await rrClient.dispose();
    await rrServer.dispose();
  });

  it("surfaces server-side validation errors from remote (resource)", async () => {
    const { rrServer, baseUrl } = await startServer();
    const fetchTunnel = httpFetchTunnel.with({ baseUrl, auth: { token: TOKEN } });
    const clientTunnel = defineResource({
      id: "fetch.test.client.tunnel.validation",
      tags: [globals.tags.tunnel.with({ mode: "client", tasks: [mustBePositiveClient.id] })],
      register: [fetchTunnel],
      dependencies: { fetchTunnel: httpFetchTunnel },
      init: async (_, { fetchTunnel }) => fetchTunnel,
    });
    const client = defineResource({
      id: "fetch.test.client.validation",
      register: [mustBePositiveClient, clientTunnel],
    });
    const rrClient = await run(client);
    await expect(
      rrClient.runTask(mustBePositiveClient, { n: -1 } as any),
    ).rejects.toThrow(/validation failed/i);
    await rrClient.dispose();
    await rrServer.dispose();
  });

  it("routes events both locally and remotely (resource)", async () => {
    const { rrServer, baseUrl } = await startServer();
    clientEvents = [];

    const fetchTunnel = httpFetchTunnel.with({ baseUrl, auth: { token: TOKEN } });
    const clientTunnel = defineResource({
      id: "fetch.test.client.tunnel.events",
      tags: [globals.tags.tunnel.with({ mode: "client", events: [pingEvent.id] })],
      register: [fetchTunnel],
      dependencies: { fetchTunnel: httpFetchTunnel },
      init: async (_, { fetchTunnel }) => fetchTunnel,
    });
    const client = defineResource({
      id: "fetch.test.client.events",
      register: [pingEvent, clientHook, clientTunnel],
      dependencies: { pingEvent },
      init: async (_, { pingEvent }) => {
        await pingEvent({ msg: "E1" });
      },
    });

    const rrClient = await run(client);
    // Both local and remote fired
    expect(clientEvents).toEqual(["client:E1"]);
    expect(serverEvents).toEqual(["server:E1"]);
    await rrClient.dispose();
    await rrServer.dispose();
  });

  it("works via createExposureFetch() without a tunnel resource", async () => {
    const { rrServer, baseUrl } = await startServer();
    const client = createExposureFetch({ baseUrl, auth: { token: TOKEN } });
    const sum = await client.task<{ a: number; b: number }, number>(sumTask.id, {
      a: 3,
      b: 4,
    });
    expect(sum).toBe(7);

    await client.event(pingEvent.id, { msg: "E2" });
    expect(serverEvents).toContain("server:E2");
    await rrServer.dispose();
  });
});

