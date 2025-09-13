import { z } from "zod";
import {
  defineTask,
  defineEvent,
  defineHook,
  defineResource,
} from "../../define";
import { run } from "../../run";
import { nodeExposure } from "../exposure.resource";
import { nodeHttpTunnel } from "../";
import { globals } from "../../index";

describe("Node HTTP Exposure + Tunnel (POST JSON)", () => {
  const TOKEN = "super-secret";

  // Server-side definitions
  const sumTask = defineTask<{ a: number; b: number }, Promise<number>>({
    id: "node.test.tasks.sum",
    inputSchema: z.object({ a: z.number(), b: z.number() }).strict(),
    resultSchema: z.number(),
    run: async ({ a, b }) => a + b,
  });

  const mustBePositive = defineTask<{ n: number }, Promise<number>>({
    id: "node.test.tasks.mustBePositive",
    inputSchema: z.object({ n: z.number().min(0) }).strict(),
    resultSchema: z.number(),
    run: async ({ n }) => n,
  });

  const pingEvent = defineEvent<{ msg: string }>({
    id: "node.test.events.ping",
  });

  let serverEvents: string[];
  const serverHook = defineHook({
    id: "node.test.hooks.server",
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
      id: "node.test.server",
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
    // If tunnel patching fails, we want a loud error, not silent undefined
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
    id: "node.test.tasks.missingOnServer",
    run: async () => {
      throw new Error("local missingClient.run() should not be called");
    },
  });

  let clientEvents: string[];
  const clientHook = defineHook({
    id: "node.test.hooks.client",
    on: pingEvent,
    run: async (e) => {
      clientEvents.push(`client:${e.data.msg}`);
    },
  });

  it("runs tasks over HTTP JSON with auth", async () => {
    const { rrServer, baseUrl } = await startServer();

    const httpTunnel = nodeHttpTunnel.with({ baseUrl, auth: { token: TOKEN } });
    const clientTunnel = defineResource({
      id: "node.test.client.tunnel.ok",
      tags: [
        globals.tags.tunnel.with({
          mode: "client",
          tasks: [sumClient.id, mustBePositiveClient.id],
        }),
      ],
      register: [httpTunnel],
      dependencies: { httpTunnel: nodeHttpTunnel },
      init: async (_, { httpTunnel }) => httpTunnel,
    });
    const clientWithTunnel = defineResource({
      id: "node.test.client.wrapper",
      register: [sumClient, mustBePositiveClient, clientTunnel],
    });

    const rrClient = await run(clientWithTunnel);
    const sum = await rrClient.runTask(sumClient, { a: 2, b: 5 });
    expect(sum).toBe(7);

    // Clean up
    await rrClient.dispose();
    await rrServer.dispose();
  });

  it("returns not found for missing task id on server", async () => {
    const { rrServer, baseUrl } = await startServer();
    const httpTunnel = nodeHttpTunnel.with({ baseUrl, auth: { token: TOKEN } });
    const clientTunnel = defineResource({
      id: "node.test.client.tunnel.notfound",
      tags: [
        globals.tags.tunnel.with({ mode: "client", tasks: [missingClient.id] }),
      ],
      register: [httpTunnel],
      dependencies: { httpTunnel: nodeHttpTunnel },
      init: async (_, { httpTunnel }) => httpTunnel,
    });
    const client = defineResource({
      id: "node.test.client.notfound",
      register: [missingClient, clientTunnel],
    });
    const rrClient = await run(client);
    await expect(rrClient.runTask(missingClient, { x: 1 })).rejects.toThrow(
      /not found/i,
    );
    await rrClient.dispose();
    await rrServer.dispose();
  });

  it("returns unauthorized when token is wrong", async () => {
    const { rrServer, baseUrl } = await startServer();
    const httpTunnel = nodeHttpTunnel.with({
      baseUrl,
      auth: { token: "WRONG" },
    });
    const clientTunnel = defineResource({
      id: "node.test.client.tunnel.unauth",
      tags: [
        globals.tags.tunnel.with({ mode: "client", tasks: [sumClient.id] }),
      ],
      register: [httpTunnel],
      dependencies: { httpTunnel: nodeHttpTunnel },
      init: async (_, { httpTunnel }) => httpTunnel,
    });
    const client = defineResource({
      id: "node.test.client.unauth",
      register: [sumClient, clientTunnel],
    });
    const rrClient = await run(client);
    await expect(rrClient.runTask(sumClient, { a: 1, b: 1 })).rejects.toThrow(
      /unauthorized/i,
    );
    await rrClient.dispose();
    await rrServer.dispose();
  });

  it("surfaces server-side validation errors from remote", async () => {
    const { rrServer, baseUrl } = await startServer();
    const httpTunnel = nodeHttpTunnel.with({ baseUrl, auth: { token: TOKEN } });
    const clientTunnel = defineResource({
      id: "node.test.client.tunnel.validation",
      tags: [
        globals.tags.tunnel.with({
          mode: "client",
          tasks: [mustBePositiveClient.id],
        }),
      ],
      register: [httpTunnel],
      dependencies: { httpTunnel: nodeHttpTunnel },
      init: async (_, { httpTunnel }) => httpTunnel,
    });
    const client = defineResource({
      id: "node.test.client.validation",
      register: [mustBePositiveClient, clientTunnel],
    });
    const rrClient = await run(client);
    await expect(
      rrClient.runTask(mustBePositiveClient, { n: -1 } as any),
    ).rejects.toThrow(/validation failed/i);
    await rrClient.dispose();
    await rrServer.dispose();
  });

  it("routes events both locally and remotely", async () => {
    const { rrServer, baseUrl } = await startServer();
    clientEvents = [];

    const httpTunnel = nodeHttpTunnel.with({ baseUrl, auth: { token: TOKEN } });
    const clientTunnel = defineResource({
      id: "node.test.client.tunnel.events",
      tags: [
        globals.tags.tunnel.with({ mode: "client", events: [pingEvent.id] }),
      ],
      register: [httpTunnel],
      dependencies: { httpTunnel: nodeHttpTunnel },
      init: async (_, { httpTunnel }) => httpTunnel,
    });
    const client = defineResource({
      id: "node.test.client.events",
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

  it("errors on event not found and on unauthorized", async () => {
    const { rrServer, baseUrl } = await startServer();
    const missingEvent = defineEvent<{ msg: string }>({
      id: "node.test.events.missingOnServer",
    });

    // Not found
    const httpTunnel = nodeHttpTunnel.with({ baseUrl, auth: { token: TOKEN } });
    const clientTunnelNF = defineResource({
      id: "node.test.client.tunnel.events.notfound",
      tags: [
        globals.tags.tunnel.with({ mode: "client", events: [missingEvent.id] }),
      ],
      register: [httpTunnel],
      dependencies: { httpTunnel: nodeHttpTunnel },
      init: async (_, { httpTunnel }) => httpTunnel,
    });
    const clientNF = defineResource({
      id: "node.test.client.events.notfound",
      register: [missingEvent, clientTunnelNF],
      dependencies: { missingEvent },
      init: async (_, { missingEvent }) => {
        await missingEvent({ msg: "X" });
      },
    });

    await expect(run(clientNF)).rejects.toThrow(/not found/i);

    // Unauthorized
    const badHttpTunnel = nodeHttpTunnel.with({
      baseUrl,
      auth: { token: "WRONG" },
    });
    const clientTunnelUA = defineResource({
      id: "node.test.client.tunnel.events.unauth",
      tags: [
        globals.tags.tunnel.with({ mode: "client", events: [pingEvent.id] }),
      ],
      register: [badHttpTunnel],
      dependencies: { httpTunnel: nodeHttpTunnel },
      init: async (_, { httpTunnel }) => httpTunnel,
    });
    const clientUA = defineResource({
      id: "node.test.client.events.unauth",
      register: [pingEvent, clientTunnelUA],
      dependencies: { pingEvent },
      init: async (_, { pingEvent }) => {
        await pingEvent({ msg: "Z" });
      },
    });

    await expect(run(clientUA)).rejects.toThrow(/unauthorized/i);

    await rrServer.dispose();
  });
});
