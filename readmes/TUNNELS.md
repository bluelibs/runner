# Runner Tunnels

Make tasks and events callable across processes – from a CLI, another service, or a browser – without changing your app’s core architecture.

## Table of Contents

1. Why tunnels
2. Architecture at a glance
   2.1) Architecture deep dive
3. Quick start (3 minutes)
4. Choose your client
   - Unified client (browser + node)
   - Node Smart client (streaming/duplex)
   - Node Mixed client (auto‑switch)
   - Pure fetch (globals.tunnels.http)
5. Auth (static & dynamic)
6. Uploads & files (`$ejson: "File"` sentinel, FormData, Node streams)
7. Abort & timeouts
   7.1) useExposureContext API

8. CORS
9. Server allow‑lists
10. Examples you can run
11. Testing strategy
12. Troubleshooting
13. Reference checklist
14. Compression (gzip/br)
15. Phantom Tasks (fluent builder)
16. Typed Errors Over Tunnels
17. Async Context Propagation

---

## 1) Why tunnels

The "Tunnels" mechanism in Runner is essentially Direct HTTP RPC. And it works on the concept of 'distributed monolith'. The reason it exists is to try to make scaling easy for as long as it's technically possible.

Tunnels give you a consistent, secure wire: the server exposes a small HTTP surface; clients call it with JSON or streams. When you call a task: `processPayment()` you can route it via tunnels to other servers without changing semantics.

## 2) Architecture at a glance

- Exposure: `nodeExposure` hosts `POST /task/{id}` and `POST /event/{id}`.
- Client: one of the HTTP clients calls those endpoints (fetch, unified, or Node smart/mixed for streaming).
- Optional server allow‑lists: restrict which ids are reachable.
- Exclusivity: each task can be owned by at most one tunnel client. If two tunnel resources select the same task, Runner throws during init to prevent ambiguous routing.

`nodeExposure` is a Runner **resource** that starts a small HTTP server: when registered, it listens on a port and exposes a controlled HTTP surface that lets remote callers execute tasks and emit events by id (under a configured `basePath` like `/__runner`).

### 2.1 Architecture deep dive

The tunnel pipeline is split into three layers with clear responsibilities. This keeps transport concerns isolated from your task/event code and makes the system testable end-to-end.

1. Runner middleware and ownership

- Tunnel resources are tagged with `globals.tags.tunnel`.
- The resource middleware resolves the tunnel's task/event selectors (ids, defs, or predicates) and patches the matched definitions to delegate to the tunnel runner.
- Tasks are marked with an internal "owned by tunnel" symbol; a second tunnel selecting the same task throws immediately during init (exclusivity).
- Tunnel policy tags (`globals.tags.tunnelPolicy`) can whitelist which middlewares run on caller vs executor for a tunneled task.

2. Protocol envelope and routing

- HTTP clients send a `ProtocolEnvelope` `{ input }` or `{ payload, returnPayload }`.
- The exposure server validates auth, checks allow-lists (if any), and routes to the registered task/event.
- For events, optional `returnPayload` enables eventWithResult when supported by the server.
- Typed errors can flow across the tunnel if the client provides an `errorRegistry`.

3. Serialization and file/stream handling

- Standard DTOs go through the serializer (global serializer resource is the source of truth).
- File uploads use a `$ejson: "File"` sentinel that triggers multipart handling; files are not serializer types.
  - Mental model: the **serializer** handles values (Dates, RegExp, custom types), while the **tunnel client** chooses the **transport** (JSON vs multipart vs octet‑stream) based on your input shape.
- Raw duplex streaming uses `application/octet-stream` with `useExposureContext()` on the server.
- Async contexts propagate via `x-runner-context` and are hydrated server-side for the duration of the call.

## 3) Quick start (3 minutes)

Server: host an exposure next to your tasks/events.

```ts
import { r } from "@bluelibs/runner";
import { nodeExposure } from "@bluelibs/runner/node";

const add = r
  .task("app.tasks.add")
  .run(async (input: { a: number; b: number }) => input.a + input.b)
  .build();

const notify = r
  .event("app.events.notify")
  .payloadSchema<{ message: string }>({ parse: (v) => v })
  .build();

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

Client: call it from Node or the browser using the factory (recommended) or direct client creation.

**Recommended: Use HTTP Client Factory with DI**

```ts
import { r, globals } from "@bluelibs/runner";

const callRemote = r
  .task("app.tasks.callRemote")
  .dependencies({ clientFactory: globals.resources.httpClientFactory })
  .run(async (input, { clientFactory }) => {
    // Factory auto-injects serializer, errorRegistry, and contexts
    const client = clientFactory({
      baseUrl: "http://127.0.0.1:7070/__runner",
    });
    return await client.task("app.tasks.add", { a: 1, b: 2 });
  })
  .build();
```

**Alternative: Direct client creation (legacy)**

```ts
import { createHttpClient } from "@bluelibs/runner";

const client = createHttpClient({
  baseUrl: "http://127.0.0.1:7070/__runner",
  serializer, // manual injection
  errorRegistry, // manual injection
  contexts, // manual injection
});
const sum = await client.task<{ a: number; b: number }, number>(
  "app.tasks.add",
  { a: 1, b: 2 },
);
```

## 4) Choose your client

### Quick decision guide

- Browser (or universal code): use **Unified** (`createHttpClient` or `globals.resources.httpClientFactory`).
- Node:
  - Default choice: use **Mixed** (it auto-selects JSON vs multipart vs duplex when possible).
  - Use **Smart** only when you want to force the streaming-capable path (or you don’t want the fetch fallback).
  - Use **Pure fetch** only when you want the tiniest JSON-only surface.

### 4.1 Unified client (browser + node)

One API for JSON and browser uploads (FormData). For Node streaming/multipart and duplex, use the Node clients (Smart/Mixed) below.

**With factory (recommended):**

```ts
// Use clientFactory(...) within your tasks
const client = clientFactory({ baseUrl: "/__runner" });
```

**Direct creation:**

```ts
import { createHttpClient } from "@bluelibs/runner";
import { createFile as createWebFile } from "@bluelibs/runner/platform/createFile";

const client = createHttpClient({
  baseUrl: "/__runner",
  serializer, // required
});

// JSON
await client.task("app.tasks.add", { a: 1, b: 2 });

// Browser upload (multipart/form-data)
await client.task("app.tasks.upload", {
  file: createWebFile({ name: "a.bin" }, new Blob([1])),
});
```

### 4.2 Node Smart client (streaming/duplex)

**With factory (recommended, Node DI):**

```ts
import { globals as nodeGlobals } from "@bluelibs/runner/node";

const nodeTask = r
  .task("app.tasks.useSmart")
  .dependencies({ smartFactory: nodeGlobals.resources.httpSmartClientFactory })
  .run(async (_, { smartFactory }) => {
    const client = smartFactory({
      baseUrl: "http://127.0.0.1:7070/__runner",
    });
    return await client.task("app.tasks.add", { a: 1, b: 2 });
  })
  .build();
```

**Direct creation:**

```ts
import { createHttpSmartClient } from "@bluelibs/runner/node";

const client = createHttpSmartClient({
  baseUrl: "http://127.0.0.1:7070/__runner",
  serializer, // required
});

// JSON tasks
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

**With factory (recommended, Node DI):**

```ts
import { globals as nodeGlobals } from "@bluelibs/runner/node";

const nodeTask = r
  .task("app.tasks.useMixed")
  .dependencies({ mixedFactory: nodeGlobals.resources.httpMixedClientFactory })
  .run(async (_, { mixedFactory }) => {
    const client = mixedFactory({
      baseUrl: "http://127.0.0.1:7070/__runner",
    });
    return await client.task("app.tasks.add", { a: 1, b: 2 });
  })
  .build();
```

**Direct creation:**

```ts
import { createHttpMixedClient, createNodeFile } from "@bluelibs/runner/node";
import { Readable } from "stream";

const client = createHttpMixedClient({
  baseUrl: "http://127.0.0.1:7070/__runner",
  serializer, // required
});

// Plain JSON → fetch path
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

// Events are always JSON
await client.event("app.events.audit", { action: "ping" });

// If you need the final (potentially mutated) payload back (requires server support):
// Note: for events marked `parallel: true`, the server rejects returnPayload.
const finalPayload = await client.eventWithResult?.("app.events.audit", {
  action: "ping",
});
```

### 4.4 Pure fetch (globals.tunnels.http)

Lowest‑level HTTP client: portable, tiny surface, JSON only.

```ts
import { globals } from "@bluelibs/runner";
import { getDefaultSerializer } from "@bluelibs/runner";

const client = globals.tunnels.http.createClient({
  url: "/__runner",
  serializer: getDefaultSerializer(),
});
await client.task("app.tasks.add", { a: 1, b: 2 });
await client.event("app.events.notify", { message: "hi" });
```

### 4.5 Serializer and DI

Runner ships with a serializer that you should access via DI. The `Serializer` surface is intentionally small: `stringify(value)`, `parse(text)`, and `addType(name, factory)` (for custom domain types).

- Prefer resolving the global serializer resource and passing it to clients.
- Use `getDefaultSerializer()` only outside DI (for standalone helpers, tests, etc.).

Example: register custom types once via the global serializer, then pass it into clients.

```ts
import { r, globals } from "@bluelibs/runner";
import { createHttpClient } from "@bluelibs/runner";
import {
  createHttpSmartClient,
  createHttpMixedClient,
} from "@bluelibs/runner/node";

// 1) Register custom types using the global serializer resource
const serializerSetup = r
  .resource("app.serialization.setup")
  .dependencies({ serializer: globals.resources.serializer })
  .init(async (_config, { serializer }) => {
    class Distance {
      constructor(public value: number, public unit: string) {}
      toJSONValue() {
        return { value: this.value, unit: this.unit } as const;
      }
      typeName() {
        return "Distance" as const;
      }
    }

    serializer.addType(
      "Distance",
      (j: { value: number; unit: string }) => new Distance(j.value, j.unit),
    );
  })
  .build();

// 2) Pass the serializer into any HTTP clients you create
const clientUnified = createHttpClient({ baseUrl: "/__runner", serializer });
const clientSmart = createHttpSmartClient({ baseUrl: "/__runner", serializer });
const clientMixed = createHttpMixedClient({
  baseUrl: "/__runner",
  serializer,
});
const clientFetch = globals.tunnels.http.createClient({
  url: "/__runner",
  serializer,
});
```

Notes:

- Files are not custom serializer types. Continue using File sentinels (see Uploads & files below).
- If you must use the serializer outside DI, call `getDefaultSerializer()`.

## 5) Auth (static & dynamic)

Authentication is handled via the `auth` config on `nodeExposure`. Default header is `x-runner-token`.

### 5.1 Server-Side Configuration

**Static Tokens (Single or Multiple):**

```ts
const exposure = nodeExposure.with({
  http: {
    auth: {
      token: ["secret1", "secret2"], // Array supported
      header: "x-api-key", // Optional custom header
    },
  },
});
```

**Custom Validators (Database/Logic):**

For dynamic checks (e.g., database lookup, JWT), mark a task with `globals.tags.authValidator`. Validators run if the static token check fails (OR logic).

```ts
import { r, globals } from "@bluelibs/runner";
import { AuthValidatorInput, AuthValidatorResult } from "@bluelibs/runner/node";

const dbAuthValidator = r
  .task("app.auth.validator")
  .tags([globals.tags.authValidator])
  .dependencies({ db: dbService })
  .run(async (input, { db }) => {
    // Input contains headers, method, url, path
    const token = input.headers["x-api-key"];
    const user = await db.users.findByToken(token);

    if (user) return { ok: true };
    return { ok: false, message: "Invalid token" };
  })
  .build();

// Register validator alongside exposure
r.resource("app").register([dbAuthValidator, exposure]).build();
```

### 5.2 Client-Side Configuration

All clients support an auth header. Static config is easiest; for dynamic tokens (per request), use `onRequest`.

```ts
// Static
const client = createHttpClient({
  baseUrl: "/__runner",
  auth: { token: "secret", header: "x-api-key" },
});

// Dynamic (e.g. from localStorage)
const client = createHttpClient({
  baseUrl: "/__runner",
  onRequest: ({ headers }) => {
    headers["authorization"] = `Bearer ${localStorage.getItem("token")}`;
  },
});
```

Match the exposure’s auth settings (header name and expected format).

## Security

The HTTP exposure includes several layers of security to ensure the safety of your Runner network.

### Authentication

- **Static Tokens**: Comparison is done using **timing-safe** algorithms to prevent side-channel attacks.
- **Custom Validators**: Mark tasks with `globals.tags.authValidator` for dynamic logic.

### Denial of Service (DoS) Protection

The server enforces configurable limits on request sizes:

- **JSON Body**: Default **2MB** limit.
- **Multipart Uploads**:
  - **fileSize**: Default **20MB** per file.
  - **files**: Default **10** files per request.
  - **fields**: Default **100** fields.
  - **fieldSize**: Default **1MB** per field value.

Example configuration:

```ts
nodeExposure.with({
  http: {
    limits: {
      json: { maxSize: 5 * 1024 * 1024 }, // 5MB
      multipart: { files: 2, fileSize: 100 * 1024 * 1024 }, // 2 files, 100MB each
    },
  },
});
```

### Information Leakage

To prevent leaking sensitive internal data:

- **Error Masking**: Internal server errors (status 500) that are not recognized `TypedError` instances are masked as "Internal Error".
- **Transparent Typed Errors**: Errors created via `error().build()` and explicitly thrown are transmitted transparently (payload + formatted message).

## 6) Uploads & files

Use “File” sentinels in your input (`$ejson: "File"`). In Node, build them with `createNodeFile` (stream/buffer). In browsers, use `createFile` (Blob/File). The unified client turns browser files into multipart `FormData` automatically; Node clients stream bytes and support duplex.

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

Important: “File” is not a custom serializer type. Runner uses a special `$ejson: "File"` sentinel to mark file fields, which the unified/Node clients translate into multipart uploads and the server hydrates into `InputFile` instances. Files are handled by the tunnel/manifest logic, not by the serializer.

### Transport modes at a glance

- JSON: default path when your input has no files. Great for simple DTOs.
- Multipart (recommended for JSON + files): any input that includes a File sentinel is sent as multipart/form-data with:
  - `__manifest`: JSON of your full input, where File fields are left as File stubs
  - `file:{id}` parts: the actual file bytes (stream or buffer in Node; Blob in browsers)
    This path lets you mix arbitrary JSON fields with one or more streamed files in a single request.
- Octet-stream (duplex): when the input itself is a Node `Readable`, the client uses `application/octet-stream`. This is for raw streaming and does not carry an additional JSON body. If you need JSON alongside a stream, wrap the stream in a File sentinel in a DTO and use the multipart path instead.

Node example (DTO + stream via File sentinel):

```ts
import { createHttpSmartClient, createNodeFile } from "@bluelibs/runner/node";
import { Readable } from "stream";

const client = createHttpSmartClient({ baseUrl: "/__runner" });
await client.task("app.tasks.upload", {
  info: { title: "demo" },
  file: createNodeFile(
    { name: "a.txt", type: "text/plain" },
    { stream: Readable.from("hello world") },
  ),
});
```

## 7) Abort & timeouts

Server: Access the full HTTP context via `useExposureContext()` from `@bluelibs/runner/node`, including `signal: AbortSignal` for aborts, `req` for request details, and `res` for streaming responses. This is available only in tasks exposed via `nodeExposure`.

#### Enhanced Abort Example with Error Handling

```ts
import { r } from "@bluelibs/runner";
import { useExposureContext } from "@bluelibs/runner/node";
import { CancellationError } from "@bluelibs/runner/errors";

// Example long-running task with full context
const longTask = r
  .task("app.tasks.longTask")
  .run(async (input: { workTime: number }) => {
    const ctx = useExposureContext(); // Destructure as needed: { signal, req, res }
    const { signal } = ctx;

    // Early check
    if (signal.aborted) {
      throw new CancellationError(
        "Task aborted before starting (client timeout/disconnect)",
      );
    }

    // Log request context
    console.log(
      `Task started for ${ctx.method} ${ctx.url.pathname}, User-Agent: ${
        ctx.headers["user-agent"] || "unknown"
      }`,
    );

    try {
      await new Promise<void>((resolve, reject) => {
        let aborted = false;
        const handler = () => {
          aborted = true;
          reject(new CancellationError("Processing aborted by client"));
        };
        signal.addEventListener("abort", handler, { once: true });

        // Simulate work (e.g., file processing, API calls)
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", handler);
          if (!aborted) resolve();
        }, input.workTime);

        // Optional: Stream progress
        if (typeof ctx.res.write === "function") {
          ctx.res.write(`Started processing for ${input.workTime}ms...\n`);
        }
      });

      // Success
      if (typeof ctx.res.end === "function") {
        ctx.res.write("Task completed successfully!");
      }

      return { status: "success", message: "Work done" };
    } catch (err) {
      if (err instanceof CancellationError) {
        // Log and re-throw
        console.warn(`Task longTask cancelled: ${err.message}`);
        throw err;
      }
      throw err; // Other errors propagate
    }
  })
  .build();
```

Key enhancements:

- Full context (`ctx = useExposureContext()`) for logging and response writing.
- Try-catch to handle `CancellationError` specifically (triggers HTTP 499).
- Listener cleanup to prevent leaks.
- Early aborted check and progress streaming.

Clients: Pass `timeoutMs` (e.g., `{ timeoutMs: 30000 }` in client options). Uses `AbortController`; aborts trigger server `signal`. JSON/multipart parsing respects it; errors like parse fails or disconnect return 499. For duplex, abort stops piping.

### 7.1) useExposureContext API

`useExposureContext()` is a Node-only hook in `@bluelibs/runner/node` for accessing HTTP context in exposed tasks: aborts (`signal`), request info (`req`), response streaming (`res`).

#### API Shape

```ts
import type { IncomingMessage, ServerResponse } from "http";

export interface ExposureRequestContextValue {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  basePath: string;
  headers: IncomingMessage["headers"];
  method?: string;
  signal: AbortSignal;
}
```

Use in task `.run()`: `const { signal, req, res } = useExposureContext();`

For conditional access without errors in non-exposed tasks, use `hasExposureContext()`: `if (hasExposureContext()) { const ctx = useExposureContext(); ... }`

Practical guidance:

- Keep domain logic transport-agnostic: put HTTP-specific code (headers, raw streams, status codes) in a thin wrapper task, then call a pure task/function for your business logic.
- If you need to reuse a task both internally and over HTTP, always gate `useExposureContext()` behind `hasExposureContext()`.

#### Examples

**Abort Handling:** (See expanded above.)

**Streaming Response:**

```ts
import { r } from "@bluelibs/runner";
import { useExposureContext } from "@bluelibs/runner/node";
import { createReadStream } from "fs";

// Task streaming a file
const streamFile = r
  .task("app.tasks.streamFile")
  .run(async (input: { filePath: string }) => {
    const { res, signal } = useExposureContext();

    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Transfer-Encoding": "chunked",
    });

    const stream = createReadStream(input.filePath);
    stream.pipe(res);

    signal.addEventListener("abort", () => stream.destroy(), { once: true });
  })
  .build();
```

**Request Introspection:**

```ts
const secureTask = r
  .task("app.tasks.secure")
  .run(async () => {
    const { headers, req } = useExposureContext();

    if (!headers.authorization) throw new Error("Unauthorized");

    // Read body if needed
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    await new Promise((res) => req.on("end", res));

    // Process body...
    return { validated: true };
  })
  .build();
```

**Duplex:**

```ts
import { Transform } from "stream";

const duplexEcho = r
  .task("app.tasks.duplexEcho")
  .run(async () => {
    const { req, res, signal } = useExposureContext();

    const transform = new Transform({
      transform(chunk, _, cb) {
        this.push(chunk.toString().toUpperCase());
        cb();
      },
    });

    req.pipe(transform).pipe(res);

    signal.addEventListener(
      "abort",
      () => {
        req.destroy();
        res.end();
      },
      { once: true },
    );
  })
  .build();
```

#### Warnings

- Node-only; throws if called in browser or non-exposed tasks.
- Security: Sanitize logged headers; avoid exposing secrets.
- CORS: Misconfig can cause pre-aborts on signal.
- Links: `examples/tunnels/streaming-duplex.example.ts`; tests in `src/node/exposure/__tests__/requestContext.test.ts`.
- Errors: Use `CancellationError` for aborts.

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
    mode: "server",
    transport: "http",
    tasks: ["app.tasks.add"],
    events: ["app.events.notify"],
  }))
  .build();
```

Add this resource and nodeExposure will scan all resources with this tag which are in the mode `server` and expose things properly.

## 10) Examples you can run

- `examples/tunnels/streaming-append.example.ts` – upload a stream and transform it
- `examples/tunnels/streaming-duplex.example.ts` – duplex raw‑body in, streamed response out

## InputFile (Quick Reference)

When requests contain files (multipart or via File sentinel translation), Runner passes an `InputFile` handle to the task. It gives you a single‑use stream plus utilities for persistence.

- Core shape: `{ name: string; type?: string; size?: number; lastModified?: number; extra?: Record<string, unknown>; resolve(): Promise<{ stream: Readable }>; toTempFile(dir?): Promise<{ path, bytesWritten }>; }`
- Single use: `resolve()` and `stream()` produce a stream that can be consumed once; calling twice throws.
- Metadata precedence: manifest meta overrides stream‑detected values; stream meta is used as fallback.

Example usage inside a task:

```ts
const processUpload = r
  .task("app.tasks.processUpload")
  .run(async (input: { file: InputFile<NodeJS.ReadableStream> }) => {
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

Node helpers (see `src/node/inputFile.model.ts`):

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

## 11) Testing strategy

Aim for layered coverage so failures are easy to localize:

1. Unit tests for protocol and client behavior

- Validate envelope shapes and error parsing (for example, `eventWithResult` return payload handling).
- Mock fetch for the unified/pure clients to assert headers, payloads, and error paths.
- For Node smart/mixed clients, test stream detection and the JSON vs multipart path selection.

2. Integration tests for exposure + clients

- Run a minimal root with a task, a tunnel resource, and `nodeExposure`.
- Assert allow-list enforcement when server-mode tunnels exist.
- Exercise typed errors over tunnels by registering an error and rethrowing on the client.
- Include at least one streaming/duplex test when adding stream behaviors.

3. Regression tests for ownership and policies

- Confirm tunnel exclusivity at init time when two tunnels select the same task.
- Validate `globals.tags.tunnelPolicy` whitelist behavior for caller/executor middleware paths.

Local commands:

- Full suite: `npm run coverage:ai`
- Focused runs: `npm run test -- tunnel` or `npm run test -- exposure`

## 12) Troubleshooting

- 401: Verify the client supplies the same token/header as the exposure.
- 404: Ensure the id is registered and (when server tunnels exist) appears in the allow list.
- Multipart errors: Check `__manifest` and file parts (`file:{id}`) match.
- Shared servers: Always dispose handlers when tearing down tests/staging.

## 13) Reference Checklist

- [ ] Expose via `nodeExposure` (attach or listen)
- [ ] Choose a client: `createHttpClient` (unified), Node: `createMixedHttpClient` / `createHttpSmartClient`, or pure fetch: `globals.tunnels.http.createClient` / `createExposureFetch`
- [ ] File uploads: use `createNodeFile(...)` (Node) or `platform/createFile` (browser)
- [ ] Streaming: duplex via `useExposureContext().req/res` or server-push via `respondStream()`
- [ ] Serializer: register custom types via `globals.resources.serializer`; pass the serializer to all HTTP clients (unified, smart, mixed, pure fetch)
- [ ] CORS: set `http.cors` when calling from browsers/cross‑origin clients
- [ ] Abort: handle `useExposureContext()` (signal, req, res) in tasks; configure `timeoutMs` in clients

## 14) Compression (gzip/br)

It is possible to introduce compression for both responses and requests, but it requires coordination between the Node exposure (server) and the Node Smart client. Browsers and most fetch implementations already auto‑decompress responses; request compression needs explicit support.

- Server responses (server → client)

  - Negotiate via `Accept-Encoding` and compress JSON and streamed responses (gzip/br/deflate).
  - JSON path: compress the serialized payload, set `Content-Encoding`, keep `content-type` as JSON. If you don’t pre‑buffer, omit `content-length` and use chunked transfer.
  - Stream path: wrap the outgoing stream in a zlib transform (gzip/brotli), set `Content-Encoding`, skip if the task already wrote a compressed stream.
  - Alternative: enable compression at a reverse proxy (nginx, Caddy, CDN). Easiest path for response compression, works for browsers and Node fetch clients; does not help request compression.

- Client requests (client → server)

  - Server: if `Content-Encoding` is present, transparently decompress before parsing JSON/multipart or forwarding duplex streams to tasks. Busboy expects plain multipart, so decompression must occur before piping to the parser.
  - Unified client (fetch): browsers typically do not gzip request bodies and disallow manual `Accept-Encoding`; keep using plain JSON/multipart in the browser.
  - Node Smart client: can optionally gzip request bodies (there is no automatic request-compression negotiation).
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

## 15) Phantom Tasks (fluent builder)

Phantom tasks are typed placeholders that you intend to execute through a tunnel. They don’t implement `.run()`; instead, when a matching tunnel client is registered, the tunnel middleware routes calls to the remote Runner. If no tunnel matches, calling a phantom task returns `undefined` — a safe signal that routing is not configured.

Why use them:

- Typed contracts for remote actions without local implementations.
- Clean separation of concerns: app code calls tasks; tunnels handle transport.
- Works with allow‑lists; integrates with all HTTP clients in this guide.

Define a phantom task and route via an HTTP tunnel client:

```ts
import { r, run, globals } from "@bluelibs/runner";

// 1) Define a phantom task
const remoteHello = r.task
  .phantom<{ name: string }, string>("remote.tasks.hello")
  .build();

// 2) Register a tunnel client resource that knows how to run it remotely
const httpClientTunnel = r
  .resource("app.tunnels.httpClient")
  .tags([globals.tags.tunnel])
  .init(async () => {
    const http = globals.tunnels.http.createClient({
      url: process.env.REMOTE_URL ?? "http://127.0.0.1:7070/__runner",
      onRequest: ({ headers }) => {
        headers["x-runner-token"] = process.env.RUNNER_TOKEN ?? "";
      },
    });
    return {
      mode: "client" as const,
      tasks: [remoteHello.id], // or a predicate: (t) => t.id.startsWith("remote.tasks.")
      run: (task, input) => http.task(task.id, input),
    };
  })
  .build();

// 3) Compose your app
const app = r.resource("app").register([remoteHello, httpClientTunnel]).build();

// 4) Use it anywhere in your app
const rr = await run(app);
const greeting = await rr.runTask(remoteHello, { name: "Ada" });
// → "Hello Ada!" (assuming the remote Runner exposes this task)
await rr.dispose();
```

Notes:

- Phantom builders expose `.dependencies()`, `.middleware()`, `.tags()`, `.meta()`, `.inputSchema()`, and `.resultSchema()`. They intentionally do not expose `.run()`.
- Without a matching tunnel, calling the task resolves to `undefined`. This helps catch misconfiguration early (for example, missing client or wrong allow‑list).
- If you want a hard failure instead of `undefined`, use `assertTaskRouted()` from `@bluelibs/runner`:

```ts
import { assertTaskRouted } from "@bluelibs/runner";

const result = assertTaskRouted(
  await remoteHello({ name: "Ada" }),
  remoteHello.id,
);
```

- You can combine phantom tasks with server allow‑lists (see section 9) to control what’s reachable when you host an exposure.
- Single-owner rule: phantom or regular tasks routed through tunnels still follow exclusivity. The first tunnel that selects a task becomes its owner; subsequent tunnels attempting to select the same task cause init to fail with a clear error message.

## 16) Typed Errors Over Tunnels

You can surface your application errors end‑to‑end with type safety. Server tasks/events throw typed errors; clients can rethrow them as the exact same type — not just a generic `TunnelError`.

What’s included (works cross‑tunnel as long as data is serializable):

- The JSON envelope can include `error.id` and `error.data` next to `code`/`message` when the server catches a known app error.
- Clients can opt‑in to rethrow typed errors by passing an `errorRegistry` to HTTP clients.

Define an app error:

```ts
import { r } from "@bluelibs/runner";
export const AppError = r
  .error<{ code: number; message: string }>("app.errors.generic")
  .build();
```

Throw it server‑side:

```ts
const dangerous = r
  .task("app.tasks.dangerous")
  .run(async () => {
    AppError.throw({ code: 123, message: "Boom" });
  })
  .build();
```

Rethrow typed on the client (opt‑in):

```ts
import { createHttpClient } from "@bluelibs/runner";
const client = createHttpClient({
  baseUrl: "/__runner",
  serializer,
  errorRegistry: new Map([[AppError.id, AppError]]),
});
await client.task("app.tasks.dangerous");
```

Notes:

- Error `data` must be serializable by Runner’s serializer. Register custom domain types on the global serializer resource if needed.
- Without `errorRegistry`, clients keep throwing `TunnelError` with `code/message` — no breaking changes.
- Server status codes remain the same (e.g., `500 INTERNAL_ERROR`); `id`/`data` in the envelope are for richer client handling.

## 17) Async Context Propagation

Send request‑scoped context from client to server automatically — useful for tracing, request ids, and other non‑sensitive metadata.

Define an async context:

```ts
import { asyncContext } from "@bluelibs/runner";
export const requestInfo = asyncContext<{ requestId: string }>(
  "app.contexts.requestInfo",
).build();
```

Provide and send from the client:

```ts
const client = createHttpClient({
  baseUrl: "/__runner",
  serializer,
  contexts: [requestInfo],
});
await requestInfo.provide({ requestId: "abc-123" }, async () => {
  await client.task("app.tasks.work");
});
```

Use on the server:

```ts
const work = r
  .task("app.tasks.work")
  .run(async () => {
    const { requestId } = requestInfo.use();
    // requestId === "abc-123"
  })
  .build();
```

Transport and serialization (works cross‑tunnel as long as values are serializable):

- The client attaches `x-runner-context` header with a serializer‑stringified map `{ [context.id]: serializedValue }` for JSON, multipart, and octet‑stream.
- The Node exposure parses `x-runner-context` and hydrates known contexts for the duration of the task/event execution.
- By default, contexts serialize via Runner’s serializer; you can override `serialize/parse` per context if needed.
- Only include non‑sensitive metadata; use HTTPS; allow `x-runner-context` in your CORS config when using custom rules.
