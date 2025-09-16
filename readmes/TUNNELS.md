# Runner Tunnels

Tunnels let a Runner app expose selected tasks and events to another process (often a worker, CLI, or remote service). They express **what** can be called remotely and **how** calls travel between environments. This guide explains the moving pieces so you can wire a tunnel quickly and confidently.

## When You Need a Tunnel

Reach for a tunnel when:

- When you want to scale up.
- Your runtime needs to execute Runner tasks from another machine or sandbox (CI workers, browser extensions, Electron, SaaS control planes).
- You want tight control over which tasks/events are reachable without revealing internal IDs.
- You must support both JSON payloads and file uploads over HTTP.

If all code runs in the same process, prefer direct `runTask`/`emitEvent` calls instead of tunneling—they’re simpler and faster.

## Core Concepts

| Concept                                | Responsibility                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tunnel resource**                    | Declares the surface area (tasks/events) and the client implementation used to call the exposure (for example `globals.tunnels.http`). Tagged with `globals.tags.tunnel`. |
| **Exposure resource (`nodeExposure`)** | Hosts HTTP endpoints that execute tasks or emit events for tunnel clients. Auto-discovers server-mode tunnel resources.                                                   |
| **Tunnel runner value**                | The object returned by a tunnel resource (`TunnelRunner`). It can operate in `mode: "client"` or `mode: "server"`.                                                        |

The simplest setup: a client-mode tunnel configured in the caller, and `nodeExposure` registered in the server app.

## Define a Client Tunnel

```ts
import { resource, globals } from "@bluelibs/runner";

export const httpTunnel = resource({
  id: "app.tunnels.http",
  tags: [globals.tags.tunnel],
  async init() {
    return {
      mode: "client",
      transport: "http",
      tasks: (task) => task.id.startsWith("app.tasks."),
      events: (event) => event.id.startsWith("app.events."),
      client: globals.tunnels.http.createClient({
        url: "https://api.example.com/__runner",
        auth: { token: process.env.RUNNER_TOKEN ?? "" },
      }),
    };
  },
});
```

Key points:

- `tasks` and `events` can be string IDs, arrays of definitions, or selector functions.
- The HTTP client sends `POST` requests to `/{basePath}/task/{taskId}` and `/{basePath}/event/{eventId}`.
- `globals.tunnels.http.createClient` returns helpers: `client.task(id, input?)` and `client.event(id, payload?)`.

## Host the Exposure (Node)

```ts
import { resource, defineTask, defineEvent } from "@bluelibs/runner";
import { nodeExposure } from "@bluelibs/runner/node";

const add = defineTask<{ a: number; b: number }, Promise<number>>({
  id: "app.tasks.add",
  run: async ({ a, b }) => a + b,
});

const notify = defineEvent<{ message: string }>({
  id: "app.events.notify",
});

export const app = resource({
  id: "app",
  register: [
    add,
    notify,
    nodeExposure.with({
      http: {
        basePath: "/__runner",
        listen: { port: 7070, host: "127.0.0.1" },
        auth: { token: "my-secret" },
      },
    }),
  ],
});
```

### HTTP Contract

- **Authentication**: Optional shared token (default header `x-runner-token`). Supplying `auth: { header, token }` enables it. Missing or mismatched tokens return `401`.
- **Endpoints**:
  - `POST /__runner/task/{taskId}` with body `{ "input": ... }` → returns `{ "result": ... }`.
  - `POST /__runner/event/{eventId}` with body `{ "payload": ... }` → returns `{ "ok": true }`.
- **Errors**: `404` for unknown ids, `405` for non-POST, `400` on invalid JSON, `500` on unhandled errors (message preserved when the error is an `Error`).

### Server Attachment Options

- Provide `http.listen` to spin up a dedicated `http.Server` (returned via `handlers.server`).
- Provide `http.server` to attach to an existing Node server; use `handlers.attachTo(server)` if you need manual control.
- Use `handlers.createRequestListener()` to integrate with custom frameworks.

## Server-Side Allow Lists

When `nodeExposure` initializes, it inspects tunnel resources that return `mode: "server"` and `transport: "http"`. The helper `computeAllowList` collects explicit task/event IDs from those resources so only allow-listed items are served when a server-mode HTTP tunnel is present. This protects multi-tenant deployments where you expose only a subset to remote clients.

To opt in, register a tunnel resource that returns server metadata:

```ts
export const serverTunnel = resource({
  id: "app.tunnels.server",
  tags: [globals.tags.tunnel],
  async init() {
    return {
      mode: "server",
      transport: "http",
      tasks: ["app.tasks.add"],
      events: ["app.events.notify"],
    } satisfies TunnelRunner;
  },
});
```

Add this resource to the same `register` list as `nodeExposure`.

## Multipart Uploads

HTTP tunnels support file inputs via `multipart/form-data`. Structure the request like this:

1. Add a JSON field named `__manifest` describing the payload, using file sentinels.
2. For every sentinel, include a binary part named `file:{id}` with the bytes.

Example manifest fragment:

```json
{
  "input": {
    "avatar": {
      "$ejson": "File",
      "id": "A1",
      "meta": { "name": "avatar.png", "type": "image/png" }
    }
  }
}
```

On the server, `InputFile` instances are delivered to tasks. They expose helpers like `toTempFile()` and `toPassThrough()` (see `src/node/inputFile.node.ts`). Metadata from the manifest wins over stream-derived values and supports custom `extra` fields.

## Testing Tips

- Use `nodeExposure.with({ http: { server: http.createServer(), auth: { token } } })` in tests to avoid binding real ports.
- When mocking requests, ensure `Buffer.concat(chunks as readonly Uint8Array[])` to satisfy the Node type definitions.
- The coverage suite includes examples in `src/node/__tests__/exposure.resource.*.test.ts`—follow those patterns for edge cases.

## Troubleshooting

- **401 responses**: Verify the client supplies the same token/header as the exposure.
- **404 responses**: Ensure the task/event id is registered and, when server tunnels exist, that it appears in the allow list.
- **Multipart errors**: Check the manifest (`__manifest`) for well-formed JSON, matching `file:{id}` parts, and correct `meta` entries.
- **Shared servers**: Always call the disposer returned by `handlers.attachTo(server)` when tearing down tests or staging servers to avoid leaking listeners.

That’s all you need to build, expose, and consume Runner tunnels. Keep tunnel resources lean, wrap exposure configuration next to your entry point, and lean on the provided helpers for transport details.
