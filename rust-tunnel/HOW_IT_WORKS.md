# How Rust Talks to Node.js

## TL;DR: They use standard HTTP/JSON - no special bindings needed!

The Rust tunnel server and Node.js clients communicate using **plain HTTP requests with JSON bodies**. They don't need to "speak Rust" or use FFI (Foreign Function Interface) - they just use the web protocol.

## Communication Flow

```
┌─────────────────┐         HTTP/JSON          ┌─────────────────┐
│   Node.js App   │  ───────────────────────>   │  Rust Server    │
│                 │                              │                 │
│  TypeScript     │  <───────────────────────   │  Axum + Tokio   │
│  Fetch API      │         HTTP/JSON            │  JSON/Serde     │
└─────────────────┘                              └─────────────────┘

         │                                               │
         │  POST /task/app.tasks.add                    │
         │  {"input": {"a": 5, "b": 3}}                 │
         │  ──────────────────────────────────────────> │
         │                                               │
         │                                               │  Execute task
         │                                               │  handler
         │                                               │
         │  {"ok": true, "result": 8}                   │
         │  <────────────────────────────────────────── │
         │                                               │
```

## The Protocol (No Rust Knowledge Required!)

### 1. Node.js Client Makes HTTP Request

```typescript
// Node.js/TypeScript code
import { createHttpClient } from "@bluelibs/runner";

const client = createHttpClient({
  baseUrl: "http://localhost:7070/__runner",  // Rust server URL
  auth: { token: "secret" },
  serializer: globals.resources.serializer,
});

// This becomes an HTTP POST request
const result = await client.task("app.tasks.add", { a: 5, b: 3 });
```

**What actually happens:**
```http
POST http://localhost:7070/__runner/task/app.tasks.add
Content-Type: application/json
x-runner-token: secret

{"input": {"a": 5, "b": 3}}
```

### 2. Rust Server Receives HTTP Request

```rust
// Rust code - handles the HTTP request
pub async fn handle_task(
    State(state): State<Arc<AppState>>,
    Path(task_id): Path<String>,
    Json(request): Json<TaskRequest>,
) -> TunnelResult<Json<SuccessResponse<TaskResult>>> {
    // task_id = "app.tasks.add"
    // request.input = {"a": 5, "b": 3}

    let result = state.registry.execute_task(&task_id, request.input).await?;

    Ok(Json(SuccessResponse::new(result)))
}
```

### 3. Rust Server Returns HTTP Response

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"ok": true, "result": 8}
```

### 4. Node.js Client Receives Response

```typescript
// Back in Node.js - receives the JSON response
console.log(result); // 8
```

## Why This Works

### Protocol-Based Communication

Both sides agree on a **contract** (the protocol):

| Element | Node.js Side | Rust Side | Agreement |
|---------|-------------|-----------|-----------|
| Transport | HTTP | HTTP | ✅ Standard |
| Data Format | JSON | JSON | ✅ Standard |
| Endpoints | `/task/{id}` | `/task/{id}` | ✅ Protocol |
| Request Body | `{"input": {...}}` | `{"input": {...}}` | ✅ Protocol |
| Response | `{"ok": true, "result": ...}` | `{"ok": true, "result": ...}` | ✅ Protocol |
| Auth Header | `x-runner-token` | `x-runner-token` | ✅ Protocol |

### Language-Agnostic

The protocol doesn't care about implementation language:

```
Node.js ──┐
Python ───┼──> HTTP/JSON ───> Rust Server
Browser ──┤
cURL ─────┘
```

All of these can call the Rust server because they all speak HTTP/JSON!

## Real Example: Side-by-Side

### Node.js Client (TypeScript)

```typescript
// src/http-fetch-tunnel.resource.ts (lines 108-119)
async task<I, O>(id: string, input?: I): Promise<O> {
  const url = `${baseUrl}/task/${encodeURIComponent(id)}`;

  // POST JSON to Rust server
  const r: ProtocolEnvelope<O> = await postSerialized(
    fetchImpl,
    url,
    { input },        // Serializes to JSON
    buildHeaders(),   // Adds x-runner-token
    cfg?.timeoutMs,
    cfg.serializer,
  );

  return assertOkEnvelope<O>(r);
}
```

### Rust Server

```rust
// rust-tunnel/src/handlers.rs
pub async fn handle_task(
    State(state): State<Arc<AppState>>,
    Path(task_id): Path<String>,
    Json(request): Json<TaskRequest>,  // Deserializes from JSON
) -> TunnelResult<Json<SuccessResponse<TaskResult>>> {

    // Execute the task
    let result = state.registry.execute_task(&task_id, request.input).await?;

    // Returns JSON response
    Ok(Json(SuccessResponse::new(result)))
}
```

**Both use the same data structures in JSON!**

## Protocol Specification

The common language is defined in `/readmes/TUNNEL_HTTP_POLICY.md`:

### Request Format
```json
POST /task/{taskId}
Content-Type: application/json
x-runner-token: <token>

{
  "input": <any-json-value>
}
```

### Response Format
```json
{
  "ok": true,
  "result": <output-value>
}
```

or

```json
{
  "ok": false,
  "error": {
    "code": 500,
    "message": "Error description",
    "codeName": "INTERNAL_ERROR"
  }
}
```

## Data Type Mapping

JSON is the common ground:

| JavaScript/TypeScript | JSON | Rust |
|----------------------|------|------|
| `number` | `42` | `i64`, `f64` |
| `string` | `"hello"` | `String` |
| `boolean` | `true` | `bool` |
| `null` | `null` | `Option::None` |
| `object` | `{"key": "value"}` | `serde_json::Value` |
| `array` | `[1, 2, 3]` | `Vec<T>` |

Both sides use JSON serialization libraries:
- **Node.js**: EJSON (Extended JSON)
- **Rust**: Serde JSON

## No FFI, No Bindings, No Complexity!

### ❌ What We DON'T Need:

- **No Node.js Native Addons** (N-API, node-gyp)
- **No FFI** (Foreign Function Interface)
- **No Shared Memory**
- **No Language Bindings**
- **No WASM** (WebAssembly)
- **No gRPC** (though we could use it)

### ✅ What We DO Need:

- **HTTP Server** (Rust has Axum)
- **HTTP Client** (Node has fetch)
- **JSON** (both have it)
- **Network** (TCP/IP)

That's it!

## Testing the Communication

You can test this with pure curl (no Node.js or Rust knowledge needed):

```bash
# Call the Rust server
curl -X POST http://localhost:7070/__runner/task/app.tasks.add \
  -H 'x-runner-token: secret' \
  -H 'Content-Type: application/json' \
  -d '{"input": {"a": 5, "b": 3}}'

# Response from Rust
{"ok":true,"result":8}
```

This proves it's just HTTP/JSON!

## Integration Example

Here's how you'd use the Rust server from Node.js:

```typescript
// Node.js application
import { createHttpClient } from "@bluelibs/runner";

// Point to Rust server
const client = createHttpClient({
  baseUrl: "http://localhost:7070/__runner",  // <-- Rust server
  auth: {
    token: "secret",
    header: "x-runner-token",
  },
  serializer: globals.resources.serializer,
});

// Call tasks (Rust handles them)
const sum = await client.task("app.tasks.add", { a: 10, b: 20 });
console.log(sum); // 30

const greeting = await client.task("app.tasks.greet", { name: "World" });
console.log(greeting); // "Hello, World!"

// Emit events (Rust handles them)
await client.event("app.events.notify", { message: "Task complete!" });
```

## Performance Benefits

### Why Use Rust for the Server?

1. **Speed**: Rust is 5-10x faster than Node.js for CPU-intensive tasks
2. **Memory**: Lower memory footprint, no GC pauses
3. **Concurrency**: Better handling of 10,000+ concurrent connections
4. **Type Safety**: Compile-time guarantees prevent runtime errors
5. **Deployment**: Single binary, no runtime dependencies

### Node.js Still Does What It's Best At

- Business logic in TypeScript
- Dependency injection
- Task definitions
- Event handling
- Rich ecosystem

## Architecture: Best of Both Worlds

```
┌─────────────────────────────────────────┐
│         Node.js Application             │
│  ┌───────────────────────────────────┐  │
│  │  Business Logic (TypeScript)      │  │
│  │  - Task definitions               │  │
│  │  - Event handlers                 │  │
│  │  - Dependency injection           │  │
│  └───────────────────────────────────┘  │
│                 │                        │
│                 │ HTTP/JSON              │
│                 ▼                        │
│  ┌───────────────────────────────────┐  │
│  │  Can talk to either:              │  │
│  │  • Node.js tunnel server (TS)     │  │
│  │  • Rust tunnel server (Rust)      │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
                  │
                  │ Same HTTP/JSON Protocol
                  │
    ┌─────────────┴─────────────┐
    │                           │
    ▼                           ▼
┌────────────┐           ┌────────────┐
│  Node.js   │           │   Rust     │
│  Server    │           │   Server   │
│            │           │            │
│  TypeScript│           │   Axum     │
│  Express   │           │   Tokio    │
└────────────┘           └────────────┘
```

## Summary

**How does Rust talk to Node?**

**It doesn't!** Both just talk HTTP/JSON over the network.

- **Transport**: HTTP (same as websites)
- **Format**: JSON (universal data format)
- **Protocol**: Runner Tunnel HTTP Protocol v1.0 (documented contract)

**Think of it like:**
- You don't need to know Chinese to read a Chinese website if it has an English API
- The "API" here is HTTP/JSON
- Rust implements the server-side
- Node.js implements the client-side
- They never need to understand each other's internals

**Analogy**: It's like two people texting:
- One uses an iPhone (Node.js)
- One uses Android (Rust)
- Both send SMS (HTTP/JSON)
- Neither needs to know how the other's phone works!
