# Elegant Rust + Node.js Architecture

## The Problem

**Current approach is wasteful:**
```
HTTP Request (JSON body)
  ↓
[Rust] Parse JSON           ← 1st parse
[Rust] Serialize to JSON    ← Wasteful!
  ↓ IPC
[Node.js] Parse JSON        ← 2nd parse (wasteful!)
[Node.js] Execute
[Node.js] Serialize JSON
  ↓ IPC
[Rust] Parse JSON           ← 3rd parse (wasteful!)
[Rust] Serialize JSON
  ↓
HTTP Response (JSON)
```

**4 JSON operations when we only need 1!**

## The Question

If Rust handles HTTP and JSON parsing (fast), how does it talk to Node.js efficiently?

## Option 1: Zero-Copy Raw Bytes (Simplest)

**Don't parse in Rust at all** - just forward raw bytes:

```
HTTP Request (raw JSON bytes)
  ↓
[Rust] HTTP handling (routing, CORS, headers)
[Rust] Forward raw bytes ────────────────────┐
  ↓ IPC (raw bytes, zero-copy)              │
[Node.js] Parse JSON (once!)                 │ Only 2 JSON operations!
[Node.js] Execute                            │
[Node.js] Serialize JSON                     │
  ↓ IPC (raw bytes, zero-copy)              │
[Rust] Forward raw bytes ────────────────────┘
  ↓
HTTP Response (raw JSON bytes)
```

**Benefits:**
- JSON parsed only ONCE (in Node.js)
- Rust doesn't need to understand JSON structure
- Zero serialization overhead
- Very fast

**Rust's role:**
- HTTP server (accept connections, routing)
- CORS headers
- Authentication (simple token check in headers)
- Forward raw request body to Node.js
- Forward raw response body to HTTP client

## Option 2: N-API / NAPI-RS (Most Elegant)

Use Rust as a **Node.js native addon** - no IPC at all!

```rust
// Rust compiled as Node.js native module

#[napi]
fn handle_http_request(
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Buffer,  // Raw bytes
) -> Result<HttpResponse> {
    // Rust handles HTTP/CORS/routing
    // Calls Node.js callback directly
    node_callback(body)?  // No serialization!
}
```

```javascript
// Node.js uses Rust module
const { startHttpServer } = require('./rust-http.node');

startHttpServer({
  port: 7070,
  onRequest: async (body) => {
    // body is already a Buffer, parse once
    const input = JSON.parse(body);
    const result = await executeTask(input);
    return JSON.stringify(result);
  }
});
```

**Benefits:**
- No IPC overhead
- Shared memory
- Direct function calls
- JSON parsed once in Node.js
- Rust handles HTTP, Node.js handles logic

## Option 3: Binary Protocol (Complex but Fast)

Use MessagePack or Protocol Buffers instead of JSON:

```
HTTP Request (JSON)
  ↓
[Rust] Parse JSON
[Rust] Encode to MessagePack  ← Binary, very fast
  ↓ IPC
[Node.js] Decode MessagePack  ← Faster than JSON
[Node.js] Execute
[Node.js] Encode to MessagePack
  ↓ IPC
[Rust] Decode MessagePack
[Rust] Serialize to JSON
  ↓
HTTP Response (JSON)
```

**Benefits:**
- Smaller payload over IPC
- Faster serialization than JSON
- Still 4 operations but each is faster

## Recommendation: Zero-Copy (Option 1)

**Simplest and most efficient for your use case:**

```rust
// Rust HTTP server - just forwards bytes

async fn handle_request(req: Request) -> Response {
    // 1. Extract headers for auth/routing
    let headers = extract_headers(&req);

    // 2. Forward raw body bytes to Node.js (zero-copy)
    let raw_body = req.into_body().collect().await?;

    // 3. Send to Node.js via IPC
    let response_bytes = worker.execute(raw_body).await?;

    // 4. Forward raw response bytes back
    Response::new(response_bytes)
}
```

```javascript
// Node.js worker - parses once

rl.on('line', async (line) => {
    // Receive raw JSON bytes (base64 encoded over IPC)
    const requestBytes = Buffer.from(line, 'base64');

    // Parse JSON ONCE
    const { taskId, input } = JSON.parse(requestBytes);

    // Execute
    const result = await executeTask(taskId, input);

    // Serialize JSON ONCE
    const responseBytes = Buffer.from(JSON.stringify(result));

    // Send back (base64 encoded)
    console.log(responseBytes.toString('base64'));
});
```

**What Rust does:**
- ✅ HTTP server (routing, connections)
- ✅ CORS headers
- ✅ Simple auth (token check)
- ✅ Forward bytes (no parsing)

**What Node.js does:**
- ✅ Parse JSON (once!)
- ✅ Execute business logic
- ✅ Serialize JSON (once!)

## Even Simpler: HTTP Proxy Mode

Maybe the simplest is just a **Rust HTTP proxy**:

```rust
// Rust is just a fast proxy

async fn handle_request(req: Request) -> Response {
    // Add CORS
    let mut headers = HeaderMap::new();
    headers.insert("Access-Control-Allow-Origin", "*");

    // Check auth
    if !check_token(&req) {
        return Response::builder()
            .status(401)
            .body("Unauthorized")
            .unwrap();
    }

    // Proxy to Node.js HTTP server
    let response = reqwest::post("http://localhost:3000")
        .headers(req.headers().clone())
        .body(req.into_body())
        .send()
        .await?;

    Response::new(response.bytes().await?)
}
```

**Node.js runs normal HTTP server:**
```javascript
app.post('/task/:taskId', async (req, res) => {
    const input = req.body;  // Express parses JSON
    const result = await executeTask(req.params.taskId, input);
    res.json(result);
});
```

**Benefits:**
- Node.js is just a normal Express/Fastify server
- Rust is a transparent proxy (CORS, auth, routing)
- No special IPC protocol needed
- Can switch between Rust proxy and direct Node.js easily

## What Should We Build?

Which approach do you prefer?

1. **Zero-Copy IPC** (raw bytes, no parsing in Rust)
2. **N-API Native Module** (no IPC, shared memory)
3. **HTTP Proxy** (Rust proxies to Node.js HTTP server)
4. **Something else?**

Tell me which direction and I'll implement it cleanly!
