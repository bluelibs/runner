# Runner Tunnels

Make tasks and events callable across processes – from a CLI, another service, or a browser – without changing your app’s core architecture.

## Table of Contents

1. Why tunnels
2. Architecture at a glance
3. Quick start (3 minutes)
4. Choose your client
   - Unified client (browser + node)
   - Node Smart client (streaming/duplex)
   - Node Mixed client (auto‑switch)
   - Pure fetch (globals.tunnels.http)
5. Auth (static & dynamic)
6. Uploads & files (EJSON sentinel, FormData, Node streams)
7. Abort & timeouts
8. CORS
9. Server allow‑lists
10. Examples you can run
11. Troubleshooting
12. Reference checklist
13. Compression (gzip/br)

---

## 1) Why tunnels

As your app grows, other processes need to call your tasks: workers, CLIs, browser UIs. Tunnels give you a consistent, secure wire: the server exposes a small HTTP surface; clients call it with JSON or streams.

## 2) Architecture at a glance

- Exposure: `nodeExposure` hosts `POST /task/{id}` and `POST /event/{id}`.
- Client: one of the HTTP clients calls those endpoints (fetch, unified, or Node smart/mixed for streaming).
- Optional server allow‑lists: restrict which ids are reachable.

## 3) Quick start (3 minutes)

Server: host an exposure next to your tasks/events.

```ts
import { r } from "@bluelibs/runner";
import { nodeExposure } from "@bluelibs/runner/node";

const add = r
  .task("app.tasks.add")
  .run(async ({ input }: { input: { a: number; b: number } }) => input.a + input.b)
  .build();

const notify = r.event("app.events.notify").payloadSchema<{ message: string }>({ parse: (v) => v }).build();

export const app = r
  .resource("app")
  .register([
    add,
    notify,
    nodeExposure.with({
      http: { basePath: "/__runner", listen: { port: 7070 } },
    }),
  ])
  .build();
```

Client: call it from Node or the browser.

```ts
import { createHttpClient } from "@bluelibs/runner";

const client = createHttpClient({ baseUrl: "http://127.0.0.1:7070/__runner" });
const sum = await client.task<{ a: number; b: number }, number>(
  "app.tasks.add",
  { a: 1, b: 2 },
);
```

## 4) Choose your client

### 4.1 Unified client (browser + node)

One API everywhere: JSON/EJSON, browser uploads (FormData), Node uploads (streaming), Node‑only duplex.

```ts
import { createHttpClient } from "@bluelibs/runner";
import { createFile as createWebFile } from "@bluelibs/runner/platform/createFile";
import { createNodeFile } from "@bluelibs/runner/node";
import { Readable } from "stream";

const client = createHttpClient({ baseUrl: "/__runner" });

// JSON/EJSON
await client.task("app.tasks.add", { a: 1, b: 2 });

// Browser upload (multipart/form-data)
await client.task("app.tasks.upload", {
  file: createWebFile({ name: "a.bin" }, new Blob([1])),
});

// Node upload (multipart) and duplex request stream
await client.task("app.tasks.upload", {
  file: createNodeFile({ name: "a.txt" }, { buffer: Buffer.from([1]) }),
});
await client.task("app.tasks.duplex", Readable.from("hello"));
```

### 4.2 Node Smart client (streaming/duplex)

```ts
import { createHttpSmartClient } from "@bluelibs/runner/node";

const client = createHttpSmartClient({
  baseUrl: "http://127.0.0.1:7070/__runner",
});

// JSON/EJSON tasks
const sum = await client.task<{ a: number; b: number }, number>(
  "app.tasks.add",
  { a: 1, b: 2 },
);

// Duplex: pass a Node Readable; receive streamed response
import { Readable } from "stream";
const reqStream = Readable.from("hello world");
const resStream = await client.task("app.tasks.duplex", reqStream);
resStream.on("data", (c) => process.stdout.write(c));
```

### 4.3 Node Mixed client (auto‑switch)

```ts
import { createMixedHttpClient, createNodeFile } from "@bluelibs/runner/node";
import { Readable } from "stream";

const client = createMixedHttpClient({
  baseUrl: "http://127.0.0.1:7070/__runner",
});

// Plain JSON/EJSON → fetch path
await client.task("app.tasks.add", { a: 1, b: 2 });

// Streaming duplex → Smart path (octet-stream)
const reqStream = Readable.from("hello world");
const resStream = await client.task("app.tasks.duplex", reqStream);

// Multipart (Node file sentinel) → Smart path (multipart/form-data)
const file = createNodeFile(
  { name: "avatar.png", type: "image/png" },
  { stream: Readable.from("...") },
);
await client.task("app.tasks.uploadAvatar", { file });

// Events are always JSON/EJSON
await client.event("app.events.audit", { action: "ping" });
```

### 4.4 Pure fetch (globals.tunnels.http)

Lowest‑level HTTP client: portable, tiny surface, JSON/EJSON only.

```ts
import { globals } from "@bluelibs/runner";
const client = globals.tunnels.http.createClient({ url: "/__runner" });
await client.task("app.tasks.add", { a: 1, b: 2 });
await client.event("app.events.notify", { message: "hi" });
```

## 5) Auth (static & dynamic)

All clients support an auth header. Static config is easiest; for dynamic tokens (per request), use `onRequest` to set headers.

- Default header is `x-runner-token` (you can change it).
- Common patterns: custom header, or `Authorization: Bearer <token>`.

Static (unified):

```ts
const client = createHttpClient({
  baseUrl: "/__runner",
  auth: { token: getEnv("RUNNER_TOKEN")!, header: "x-runner-token" },
});
```

Dynamic (unified):

```ts
const client = createHttpClient({
  baseUrl: "/__runner",
  onRequest: ({ headers }) => {
    const token = localStorage.getItem("RUNNER_TOKEN") ?? "";
    headers["authorization"] = `Bearer ${token}`;
  },
});
```

Node Smart / Mixed:

```ts
const smart = createHttpSmartClient({
  baseUrl: "/__runner",
  onRequest: ({ headers }) => {
    headers["x-runner-token"] = process.env.RUNNER_TOKEN ?? "";
  },
});

const mixed = createMixedHttpClient({
  baseUrl: "/__runner",
  onRequest: ({ headers }) => {
    headers["authorization"] = `Bearer ${readToken()}`;
  },
});
```

Pure fetch client:

```ts
const client = globals.tunnels.http.createClient({
  url: "/__runner",
  onRequest: ({ headers }) => {
    headers["x-runner-token"] = getCookie("runner_token");
  },
});
```

Notes:

- If both `auth` and `onRequest` are provided, `onRequest` runs last and can override headers.
- Match the exposure’s auth settings (header name and expected token).

## 6) Uploads & files

Use EJSON “File” sentinels in your input. In Node, build them with `createNodeFile` (stream/buffer). In browsers, use `createFile` (Blob/File). The unified client turns browser files into multipart `FormData` automatically; Node clients stream bytes and support duplex.

Manifest shape (for reference):

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

Important: “File” is not an EJSON custom type. Runner uses a special `$ejson: "File"` sentinel to mark file fields, which the unified/Node clients translate into multipart uploads and the server hydrates into `InputFile` instances. We do not register `EJSON.addType("File")` by default (and you shouldn’t either) because files are handled by the tunnel/manifest logic, not by the serializer. Use `EJSON.addType` only for your own domain objects (for example, Distance, Money, etc.).

## 7) Abort & timeouts

Server: every request has an `AbortSignal` via `useExposureContext().signal`.

```ts
import { r } from "@bluelibs/runner";
import { useExposureContext } from "@bluelibs/runner/node";
import { CancellationError } from "@bluelibs/runner/errors";

export const streamy = r
  .task("app.tasks.streamy")
  .run(async () => {
    const { signal } = useExposureContext();
    if (signal.aborted) throw new CancellationError("Client Closed Request");
    await new Promise((_, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(new CancellationError("Client Closed Request")),
        { once: true },
      );
      // do work, write to res, or read req...
    });
  })
  .build();
```

Clients: pass `timeoutMs` (unified, smart, mixed). Fetch clients use `AbortController` under the hood. JSON parsing obeys the same signal; multipart errors are surfaced as `499`.

## 8) CORS

Enable CORS on the Node exposure with `nodeExposure.with({ http: { cors } })`. Preflight (`OPTIONS`) requests are handled automatically and actual responses get appropriate CORS headers applied (including on errors like 401/404/500).

Config shape and defaults:

```ts
{
  origin?: string | string[] | RegExp | ((origin?: string) => string | null | undefined);
  methods?: string[];            // default ["POST", "OPTIONS"]
  allowedHeaders?: string[];     // default: echo Access-Control-Request-Headers
  exposedHeaders?: string[];     // default: none
  credentials?: boolean;         // adds Access-Control-Allow-Credentials: true
  maxAge?: number;               // seconds, preflight cache duration
  varyOrigin?: boolean;          // default true; adds Vary: Origin when echoing
}
```

Defaults are permissive: `Access-Control-Allow-Origin: *` unless `credentials` is true, in which case the request origin is echoed and `Vary: Origin` is appended. You can pass a string array or `RegExp` to allow-list origins, or a function to compute the allowed origin dynamically.

Example:

```ts
nodeExposure.with({
  http: {
    basePath: "/__runner",
    listen: { port: 7070 },
    cors: {
      origin: ["https://app.example.com", /\.example\.internal$/],
      credentials: true,
      methods: ["POST"],
      allowedHeaders: ["x-runner-token", "content-type"],
      exposedHeaders: ["content-type"],
      maxAge: 600,
    },
  },
});
```

## 9) Server-Side Allow Lists

When `nodeExposure` initializes, it inspects tunnel resources that return `mode: "server"` or `mode: "both"` and `transport: "http"`. The helper `computeAllowList` collects explicit task/event IDs from those resources so only allow-listed items are served when a server-mode HTTP tunnel is present.

To opt in, register a tunnel resource that returns server metadata:

```ts
export const serverTunnel = r
  .resource("app.tunnels.server")
  .tags([globals.tags.tunnel])
  .init(async () => ({
    mode: "server" as const,
    transport: "http" as const,
    tasks: ["app.tasks.add"],
    events: ["app.events.notify"],
  }))
  .build();
```

Add this resource to the same `register` list as `nodeExposure`.

## 10) Examples you can run

- `examples/tunnels/streaming-append.example.ts` – upload a stream and transform it
- `examples/tunnels/streaming-duplex.example.ts` – duplex raw‑body in, streamed response out

## InputFile (Quick Reference)

When requests contain files (multipart or via EJSON translation), Runner passes an `InputFile` handle to the task. It gives you a single‑use stream plus utilities for persistence.

- Core shape: `{ name: string; type?: string; size?: number; lastModified?: number; extra?: Record<string, unknown>; resolve(): Promise<{ stream: Readable }>; toTempFile(dir?): Promise<{ path, bytesWritten }>; }`
- Single use: `resolve()` and `stream()` produce a stream that can be consumed once; calling twice throws.
- Metadata precedence: manifest/EJSON meta overrides stream‑detected values; stream meta is used as fallback.

Example usage inside a task:

```ts
const processUpload = r
  .task("app.tasks.processUpload")
  .run(async ({ input }: { input: { file: InputFile<NodeJS.ReadableStream> } }) => {
    const { file } = input;
    // Option A: stream directly
    const { stream } = await file.resolve();
    let bytes = 0;
    await new Promise<void>((res, rej) => {
      stream.on("data", (c: any) => {
        bytes += Buffer.isBuffer(c) ? c.length : Buffer.byteLength(String(c));
      });
      stream.on("end", res);
      stream.on("error", rej);
    });

    // Option B: persist to a temp file
    // const { path, bytesWritten } = await file.toTempFile();

    return bytes;
  })
  .build();
```

Node helpers (see `src/node/inputFile.node.ts`):

- `NodeInputFile` constructor for building files from Node streams in tests/tools.
- `toPassThrough(stream)` returns a distinct pass‑through copy (keeps upstream reusable).

Read into memory / Write to path (Node):

```ts
import {
  readInputFileToBuffer,
  writeInputFileToPath,
} from "@bluelibs/runner/node";

// Buffer in memory (consumes the InputFile stream)
const buf = await readInputFileToBuffer(file);

// Write to disk at a specific path
const { bytesWritten } = await writeInputFileToPath(file, "/tmp/upload.bin");
```

Note: In browsers, read with the File/Blob APIs at the edge of your app (e.g., `await blob.arrayBuffer()` before sending). Server‑side `InputFile` utilities above are for Node runtimes.

## 11) Troubleshooting

- 401: Verify the client supplies the same token/header as the exposure.
- 404: Ensure the id is registered and (when server tunnels exist) appears in the allow list.
- Multipart errors: Check `__manifest` and file parts (`file:{id}`) match.
- Shared servers: Always dispose handlers when tearing down tests/staging.

## 12) Reference Checklist

- [ ] Expose via `nodeExposure` (attach or listen)
- [ ] Choose a client: `createHttpClient` (unified), Node: `createMixedHttpClient` / `createHttpSmartClient`, or pure fetch: `globals.tunnels.http.createClient` / `createExposureFetch`
- [ ] File uploads: use `createNodeFile(...)` (Node) or `platform/createFile` (browser)
- [ ] Streaming: duplex via `useExposureContext()` or server‑push via `respondStream()`
- [ ] Serializer: extend EJSON types as needed; pass custom serializer to fetch‑based clients
- [ ] CORS: set `http.cors` when calling from browsers/cross‑origin clients
- [ ] Abort: handle `useExposureContext().signal` in tasks; configure `timeoutMs` in clients

## 13) Compression (gzip/br)

It is possible to introduce compression for both responses and requests, but it requires coordination between the Node exposure (server) and the Node Smart client. Browsers and most fetch implementations already auto‑decompress responses; request compression needs explicit support.

- Server responses (server → client)
  - Negotiate via `Accept-Encoding` and compress JSON and streamed responses (gzip/br/deflate).
  - JSON path: compress the serialized payload, set `Content-Encoding`, keep `content-type` as JSON. If you don’t pre‑buffer, omit `content-length` and use chunked transfer.
  - Stream path: wrap the outgoing stream in a zlib transform (gzip/brotli), set `Content-Encoding`, skip if the task already wrote a compressed stream.
  - Alternative: enable compression at a reverse proxy (nginx, Caddy, CDN). Easiest path for response compression, works for browsers and Node fetch clients; does not help request compression.

- Client requests (client → server)
  - Server: if `Content-Encoding` is present, transparently decompress before parsing JSON/multipart or forwarding duplex streams to tasks. Busboy expects plain multipart, so decompression must occur before piping to the parser.
  - Unified client (fetch): browsers typically do not gzip request bodies and disallow manual `Accept-Encoding`; keep using plain JSON/multipart in the browser.
  - Node Smart client: can optionally gzip request bodies.
    - JSON: gzip the serialized body and set `Content-Encoding: gzip`.
    - Multipart: gzip the multipart body stream and set `Content-Encoding: gzip` (server must decompress before Busboy).
    - Duplex/octet‑stream: optionally gzip the request stream and set `Content-Encoding: gzip` if the server supports it.

- Receiving compressed responses in Node clients
  - Fetch/unified client: generally auto‑decompresses when the server compresses.
  - Smart client: advertise `Accept-Encoding: gzip, deflate, br` and, on response, decompress based on `Content-Encoding` before JSON parsing; for streamed responses, return a decompressed stream to callers.

- Operational guidance
  - Default off; enable when the client advertises support and payloads are large enough (threshold) to justify CPU cost.
  - Skip already‑compressed formats (images, archives); compress `application/json` and other text types.
  - Security: be mindful of compression side‑channel risks (for example, BREACH‑style issues) when reflecting attacker‑controlled data next to secrets in compressed responses.

- Practical paths
  - Fastest win: reverse proxy response compression (no code changes, immediate benefit to browsers and fetch clients).
  - Full stack: exposure negotiates/compresses responses and decompresses requests; Smart client advertises `Accept-Encoding`, decompresses responses, and can optionally compress requests.
