# Runner Tunnels (Codex Draft)

<- [Back to main README](../README.md) | [Tunnels section in FULL_GUIDE](./FULL_GUIDE.md#tunnels-bridging-runners)

---

This version is intentionally easy-first for readers who already know `readmes/AI.md`.

## One-Minute Mental Model

Tunnels let you execute a known task id in another process.

- Your task id stays the same (`app.tasks.add`).
- Runner behavior stays the same (validation, middleware, typed errors, async context).
- Only execution location changes (local runtime vs remote runtime).

## Read This First: Exposure Rule

`nodeExposure` opens the HTTP entrypoints, but it does not by itself decide which tasks are callable.

Server allow-listing comes from a resource tagged with `globals.tags.tunnel` in `mode: "server"` (or `"both"`), where you set `tasks`/`events`.

If you do not register that server-mode tunnel resource, task/event calls are rejected with 403 (fail-closed behavior).

## The Simplification: One Tunnel Resource, Mode From Env

You do not need separate "server policy" and "client router" resources.
Use one resource tagged with `globals.tags.tunnel`, and return different values based on `process.env`.

- The same resource can always return `run(...)`.
- `mode` is what decides behavior (`server` allow-listing vs `client` routing).

Same resource id, same code, different mode per process.

## Smallest Working Example (Same Code, Two Runtimes)

Keep it simple: you have the same tasks in both processes. A client-mode tunnel decides whether a task call runs locally or remotely.

### 1) Shared tasks (exists in both server and client codebases)

```ts
import { r } from "@bluelibs/runner";

export const add = r
  .task("app.tasks.add")
  .run(async (input: { a: number; b: number }) => input.a + input.b)
  .build();

export const compute = r
  .task("app.tasks.compute")
  .dependencies({ add })
  // The selling point: unchanged call-site.
  .run(async (input: { a: number; b: number }, { add }) => add(input))
  .build();
```

### 2) One unified tunnel resource (exists in both server and client codebases)

```ts
import { r, globals } from "@bluelibs/runner";

// import { add, compute } from "./tasks";

enum EnvVar {
  TunnelMode = "RUNNER_TUNNEL_MODE", // "server" | "client" | "none"
  TunnelBaseUrl = "RUNNER_TUNNEL_BASE_URL", // required for client mode
  TunnelToken = "RUNNER_TUNNEL_TOKEN", // shared secret
}

export const httpTunnel = r
  .resource("app.tunnels.http")
  .tags([globals.tags.tunnel])
  .dependencies({ clientFactory: globals.resources.httpClientFactory })
  .init(async (_cfg, { clientFactory }) => {
    const mode = process.env[EnvVar.TunnelMode] as "server" | "client" | "none";
    const baseUrl = process.env[EnvVar.TunnelBaseUrl];
    const token = process.env[EnvVar.TunnelToken] ?? "dev-secret";

    const client =
      mode === "client"
        ? clientFactory({ baseUrl, auth: { token } })
        : undefined;

    return {
      transport: "http",
      mode,
      tasks: [add.id],
      run: async (task, input) =>
        mode === "client" ? client?.task(task.id, input) : task(input),
    };
  })
  .build();
```

### 3) Server runtime (Node-only: opens HTTP)

```ts
import { r, run } from "@bluelibs/runner";
import { nodeExposure } from "@bluelibs/runner/node";

const app = r
  .resource("app")
  .register([
    add,
    compute,
    httpTunnel,
    // Node exposure is what opens the HTTP entrypoints, but it does not decide routing or allow-listing by itself.
    nodeExposure.with({
      http: {
        basePath: "/__runner",
        listen: { port: 7070 },
        auth: { token: process.env.RUNNER_TUNNEL_TOKEN ?? "dev-secret" },
      },
    }),
  ])
  .build();

await run(app);
```

### 4) Client runtime (same tasks, same call-sites; routing is env-driven)

```ts
import { r, run } from "@bluelibs/runner";

const app = r
  .resource("app")
  // let the system know about them
  .register([add, compute, httpTunnel])
  .build();

const { runTask, logger } = await run(app);

const sum = await runTask(compute, { a: 1, b: 2 });
logger.info(sum); // 3 (computed remotely if routed)
```

Minimal env:

```bash
# Server process
RUNNER_TUNNEL_MODE=server
RUNNER_TUNNEL_TOKEN=dev-secret

# Client process
RUNNER_TUNNEL_MODE=client
RUNNER_TUNNEL_TOKEN=dev-secret
RUNNER_TUNNEL_BASE_URL=http://127.0.0.1:7070/__runner
```

## Alternative: Explicit Client Calls

If you want explicit RPC boundaries at call sites, call the client directly:

```ts
import { Serializer } from "@bluelibs/runner";
import { createHttpMixedClient } from "@bluelibs/runner/node";

const client = createHttpMixedClient({
  baseUrl: "http://127.0.0.1:7070/__runner",
  auth: { token: "dev-secret" },
  serializer: new Serializer(),
});

const sum = await client.task<{ a: number; b: number }, number>(
  "app.tasks.add",
  { a: 1, b: 2 },
);

console.log(sum); // 3
```

If the tunnel client does not select the task id, `add(...)` runs locally (because the task exists locally too).

Use phantom tasks only when you want strict remote-only failure.

## What Happens on Each Request

1. Client sends `taskId` + serialized input.
2. `nodeExposure` authenticates the request.
3. `nodeExposure` checks server allow-list from tunnel resources whose value has `mode: "server"` (or `"both"`).
4. Allowed task executes in server runtime.
5. Result or typed error is returned.

## Choose Your Boundary Style

| Style                                             | Best For                          | Tradeoff                                |
| ------------------------------------------------- | --------------------------------- | --------------------------------------- |
| Transparent routing (real task + tunnel resource) | No call-site changes in app logic | Client controls routing via composition |
| Explicit client (`client.task`)                   | Maximum clarity at call sites     | Call sites are tied to transport        |

## Choose the Right Client

If you are in Node, default to `createHttpMixedClient`.

| Need                      | Client                                             | Notes                         |
| ------------------------- | -------------------------------------------------- | ----------------------------- |
| Normal JSON calls in Node | `createHttpMixedClient`                            | Fast JSON path when possible  |
| Node streams / duplex     | `createHttpSmartClient` or Mixed with `forceSmart` | Uses Node `http.request` path |
| Browser/edge runtime      | `createHttpClient`                                 | Universal `fetch` client      |
| Smallest JSON-only client | `globals.tunnels.http.createClient`                | Minimal JSON-only surface     |

## Production Checklist

1. Configure `http.auth` (token and/or validator tasks).
2. In the server process, set `RUNNER_TUNNEL_MODE=server` and allow-list ids in the tunnel resource `tasks`/`events`.
3. Keep `/discovery` behind auth.
4. Set body limits (`http.limits`) for your payload sizes.
5. Enforce rate limiting at your edge/proxy/API gateway.
6. Forward and index `x-runner-request-id` in logs for incident correlation.

## Exposure Hardening (Simple Defaults)

Use request correlation by default:

```ts
nodeExposure.with({
  http: {
    auth: { token: process.env.RUNNER_TUNNEL_TOKEN },
  },
});
```

- `x-runner-request-id` is echoed on responses; if missing/invalid, server generates one.
- Use infra-level rate limiting for multi-instance consistency and better throughput.

### HTTP Header Reference

| Header | Direction | Required | Purpose |
| --- | --- | --- | --- |
| `x-runner-token` | client -> server | Yes (unless `allowAnonymous: true`) | Tunnel authentication token (`http.auth.token`). |
| `x-runner-request-id` | client <-> server | Optional | Request correlation id. Server validates incoming value and generates one when missing/invalid; response echoes final value. |
| `x-runner-context` | client -> server | Optional | Serialized async-context map for context propagation. |
| `content-type` | client -> server | Yes | Request mode selection (`application/json`, `multipart/form-data`, or `application/octet-stream`). |

Notes:
- `x-runner-token` can be renamed via `http.auth.header`.
- `x-runner-context` is generated by clients when configured with `contexts`.

## Authentication (Not Just A String)

`nodeExposure` auth supports more than a single token:

- The `token` can be `string` or `string[]` (token rotation / multiple clients).
- The `header` setting lets you override `x-runner-token`.
- Validator tasks tagged `globals.tags.authValidator` authorize incoming requests on the server exposure path (`nodeExposure` with tunnel `mode: "server"` or `"both"`).
- The default is fail-closed: if no token and no validators, requests are rejected unless `allowAnonymous: true`.

In short: validator tasks are a server-side gate for exposed HTTP calls, not a client-side tunnel selector.

Static tokens with custom header:

```ts
nodeExposure.with({
  http: {
    auth: {
      header: "x-api-key",
      token: ["key-v1", "key-v2"],
    },
  },
});
```

Dynamic validation task:

```ts
import { r, globals } from "@bluelibs/runner";

const authValidator = r
  .task("app.tasks.auth.validate")
  .tags([globals.tags.authValidator])
  .run(async ({ headers }) => ({ ok: headers["x-tenant"] === "acme" }))
  .build();
```

## Typed Errors Over Tunnels

If the server throws a Runner registered error (`r.error(...)`), response can include `{ id, data }`.
With `errorRegistry`, clients can rethrow local typed errors.

```ts
import { createHttpClient, Serializer, r } from "@bluelibs/runner";

const AppError = r.error<{ code: string }>("app.errors.AppError").build();

const client = createHttpClient({
  baseUrl: "http://127.0.0.1:7070/__runner",
  serializer: new Serializer(),
  errorRegistry: new Map([[AppError.id, AppError]]),
});
```

## Async Context Propagation

Active async contexts are serialized into `x-runner-context` and hydrated on the server for that execution.

## Files and Uploads (Multipart)

Runner uploads use tunnel multipart behavior (manifest + file parts), not serializer custom types.

### Browser/universal input

```ts
const file = {
  $runnerFile: "File" as const,
  id: "F1",
  meta: { name: "a.bin" },
  _web: { blob: new Blob([1, 2, 3]) },
};

await client.task("app.tasks.upload", { file });
```

### Node input

```ts
import { Readable } from "stream";
import { createHttpMixedClient, createNodeFile } from "@bluelibs/runner/node";
import { Serializer } from "@bluelibs/runner";

const client = createHttpMixedClient({
  baseUrl: "http://127.0.0.1:7070/__runner",
  auth: { token: "dev-secret" },
  serializer: new Serializer(),
});

await client.task("app.tasks.upload", {
  file: createNodeFile(
    { name: "a.bin", type: "application/octet-stream" },
    { stream: Readable.from([Buffer.from("hello")]) },
    "F1",
  ),
});
```

## Streaming and Duplex (`application/octet-stream`)

Use Node Smart (or Mixed forced to Smart) when you need stream request/response behavior.

```ts
import { r } from "@bluelibs/runner";
import { useExposureContext } from "@bluelibs/runner/node";

const streamTask = r
  .task("app.tasks.stream")
  .run(async () => {
    const { req, res, signal } = useExposureContext();
    if (signal.aborted) return;
    req.pipe(res);
  })
  .build();
```

## Events and Delivery Modes

Tunnel resources can route events with `emit`.

`eventDeliveryMode`:

- `"local-only"`
- `"remote-only"`
- `"remote-first"`
- `"mirror"` (default)

## Tunnel Middleware Policy

By default, caller-side task middleware is skipped for tunneled tasks.
Use `globals.tags.tunnelTaskPolicy` to allow selected caller middleware.

```ts
import { r, globals } from "@bluelibs/runner";

const riskyTask = r
  .task("app.tasks.risky")
  .tags([
    globals.tags.tunnelTaskPolicy.with({
      client: { middlewareAllowList: ["app.middleware.task.auth"] },
    }),
  ])
  .run(async () => "ok")
  .build();
```

## Versioning Strategy

Treat task ids as RPC surface. For breaking changes, publish a new task id suffix:

- `app.tasks.invoice.create`
- `app.tasks.invoice.create.2`

Keep both during migration and remove old ids after consumers migrate.

## Testing Playbook

Use 3 fast layers. Keep each test tiny.

### 1) Client contract test (mocked fetch)

```ts
const client = createHttpClient({
  baseUrl: "http://example.test/__runner",
  auth: { token: "dev-secret" },
  serializer: new Serializer(),
  fetchImpl: async () =>
    new Response('{"ok":true,"result":3}', {
      headers: { "content-type": "application/json" },
    }),
});

await expect(client.task("app.tasks.add", { a: 1, b: 2 })).resolves.toBe(3);
```

### 2) Routing behavior test (no HTTP)

```ts
const add = r
  .task("app.tasks.add")
  .run(async () => 1)
  .build();
const tunnel = r
  .resource("tests.tunnel")
  .tags([globals.tags.tunnel])
  .init(async () => ({ mode: "client", tasks: [add.id], run: async () => 99 }))
  .build();

const rt = await run(r.resource("app").register([add, tunnel]).build());
await expect(rt.runTask(add)).resolves.toBe(99);
await rt.dispose();
```

### 3) Real HTTP smoke (one end-to-end)

```ts
// Start app with nodeExposure + server-mode allow-list.
// Build client with valid token.
// Assert: allow-listed task succeeds.
// Assert: unknown task or wrong token fails (401/403/404 as expected).
```

### Failure Matrix

1. `401` wrong/missing token.
2. `403` id not allow-listed.
3. `404` unknown id.
4. Local fallback when client tunnel does not select task.
5. `413` payload over limit (`http.limits`).
6. Optional strict-remote: phantom throws `runner.errors.phantomTaskNotRouted`.

## Troubleshooting

1. `401 Unauthorized`
   - Token missing/wrong, or no validator approves.
2. `403 Forbidden`
   - Server-mode tunnel allow-list missing, or task id not listed.
3. `404 Not Found`
   - Task id not registered in the server runtime.
4. Task runs local instead of remote
   - Client-mode tunnel did not select that task id.
   - Verify client tunnel `tasks` includes the task id.
   - If you need fail-fast remote-only behavior, use a phantom task.
5. Upload/stream issues
   - Use Node Mixed/Smart for Node streams.

## Reference

- Protocol details: `readmes/TUNNEL_HTTP_POLICY.md`
- Tunnel middleware internals: `src/globals/middleware/tunnel.middleware.ts`
- Node exposure internals: `src/node/exposure/*`
