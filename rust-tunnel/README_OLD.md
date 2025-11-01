# Rust Tunnel Server

A high-performance HTTP tunnel server implementation in Rust, compatible with the Runner Tunnel HTTP Protocol (v1.0). This server enables remote task invocation and event emission over HTTP, providing an alternative to the TypeScript/Node.js implementation.

## Features

- **Full Protocol Compliance**: Implements the Runner Tunnel HTTP Protocol v1.0
- **High Performance**: Built with Axum and Tokio for async performance
- **Task Execution**: Remote task invocation via `POST /task/{taskId}`
- **Event Emission**: Fire-and-forget event emission via `POST /event/{eventId}`
- **Discovery**: Allow-list querying via `GET|POST /discovery`
- **Authentication**: Token-based auth with customizable headers
- **CORS Support**: Configurable cross-origin resource sharing
- **Type-Safe**: Leverages Rust's type system for reliability

## Architecture

```
rust-tunnel/
├── src/
│   ├── lib.rs              # Main library entry point
│   ├── main.rs             # Example server binary
│   ├── models.rs           # Protocol data models
│   ├── error.rs            # Error types and handling
│   ├── auth.rs             # Authentication middleware
│   ├── handlers.rs         # HTTP request handlers
│   └── task_registry.rs    # Task/event registration
└── Cargo.toml
```

## Installation

```bash
cd rust-tunnel
cargo build --release
```

## Quick Start

### Running the Example Server

```bash
cargo run
```

This starts a server on `http://localhost:7070` with sample tasks and events.

### Testing with curl

**Add Task:**
```bash
curl -X POST http://localhost:7070/__runner/task/app.tasks.add \
  -H 'x-runner-token: secret' \
  -H 'Content-Type: application/json' \
  -d '{"input": {"a": 5, "b": 3}}'
```

Response:
```json
{"ok": true, "result": 8}
```

**Greet Task:**
```bash
curl -X POST http://localhost:7070/__runner/task/app.tasks.greet \
  -H 'x-runner-token: secret' \
  -H 'Content-Type: application/json' \
  -d '{"input": {"name": "Alice"}}'
```

Response:
```json
{"ok": true, "result": "Hello, Alice!"}
```

**Notify Event:**
```bash
curl -X POST http://localhost:7070/__runner/event/app.events.notify \
  -H 'x-runner-token: secret' \
  -H 'Content-Type: application/json' \
  -d '{"payload": {"message": "Hello from event!"}}'
```

Response:
```json
{"ok": true}
```

**Discovery:**
```bash
curl -X GET http://localhost:7070/__runner/discovery \
  -H 'x-runner-token: secret'
```

Response:
```json
{
  "ok": true,
  "result": {
    "allowList": {
      "enabled": true,
      "tasks": ["app.tasks.add", "app.tasks.greet", "app.tasks.echo"],
      "events": ["app.events.notify", "app.events.log"]
    }
  }
}
```

## Usage as a Library

```rust
use rust_tunnel::{
    init_tracing,
    models::TunnelConfig,
    start_tunnel_server,
    task_registry::TaskRegistry,
};
use serde_json::{json, Value};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    init_tracing();

    // Configure the server
    let config = TunnelConfig {
        base_path: "/__runner".to_string(),
        port: 7070,
        auth_token: "your-secret-token".to_string(),
        auth_header: "x-runner-token".to_string(),
        allowed_tasks: vec!["app.tasks.process".to_string()],
        allowed_events: vec!["app.events.notify".to_string()],
        cors_origin: Some("*".to_string()),
    };

    // Create registry and register handlers
    let registry = TaskRegistry::new();

    // Register a task
    registry.register_task_fn("app.tasks.process", |input: Value| {
        // Process the input
        let result = json!({"status": "processed", "input": input});
        Ok(result)
    }).await;

    // Register an event
    registry.register_event_fn("app.events.notify", |payload: Value| {
        println!("Event received: {:?}", payload);
        Ok(())
    }).await;

    // Start the server
    start_tunnel_server(config, registry).await
}
```

## Protocol Details

### Request Format

**Tasks:**
```json
POST /task/{taskId}
Content-Type: application/json
x-runner-token: <token>

{"input": <any-json-value>}
```

**Events:**
```json
POST /event/{eventId}
Content-Type: application/json
x-runner-token: <token>

{"payload": <any-json-value>}
```

### Response Format

**Success:**
```json
{
  "ok": true,
  "result": <output-value>
}
```

**Error:**
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

### Error Codes

| Code | HTTP | Code Name | Description |
|------|------|-----------|-------------|
| 400 | 400 | INVALID_JSON | Malformed JSON body |
| 401 | 401 | UNAUTHORIZED | Invalid/missing token |
| 403 | 403 | FORBIDDEN | ID not in allow-list |
| 404 | 404 | NOT_FOUND | Task/event not found |
| 405 | 405 | METHOD_NOT_ALLOWED | Invalid HTTP method |
| 500 | 500 | INTERNAL_ERROR | Server error |

## Configuration

### TunnelConfig

```rust
pub struct TunnelConfig {
    pub base_path: String,      // Default: "/__runner"
    pub port: u16,               // Default: 7070
    pub auth_token: String,      // Required
    pub auth_header: String,     // Default: "x-runner-token"
    pub allowed_tasks: Vec<String>,
    pub allowed_events: Vec<String>,
    pub cors_origin: Option<String>,  // "*" for permissive
}
```

## Task Registry API

### Registering Tasks

```rust
// Simple function handler
registry.register_task_fn("task.id", |input: Value| {
    Ok(json!({"result": "value"}))
}).await;

// Custom handler implementing TaskHandler trait
struct MyHandler;

#[async_trait]
impl TaskHandler for MyHandler {
    async fn execute(&self, input: Value) -> TunnelResult<Value> {
        Ok(json!({"custom": "result"}))
    }
}

registry.register_task("task.id", Arc::new(MyHandler)).await;
```

### Registering Events

```rust
// Simple function handler
registry.register_event_fn("event.id", |payload: Value| {
    println!("Event: {:?}", payload);
    Ok(())
}).await;

// Custom handler implementing EventHandler trait
struct MyEventHandler;

#[async_trait]
impl EventHandler for MyEventHandler {
    async fn emit(&self, payload: Value) -> TunnelResult<()> {
        // Custom event handling
        Ok(())
    }
}

registry.register_event("event.id", Arc::new(MyEventHandler)).await;
```

## Compatibility

This implementation is compatible with:
- Runner Tunnel HTTP Protocol v1.0
- The TypeScript/Node.js tunnel client implementations
- Any HTTP client that follows the protocol specification

See the full protocol specification in `/readmes/TUNNEL_HTTP_POLICY.md`.

## Current Limitations

This initial implementation supports:
- ✅ JSON/EJSON mode
- ✅ Task invocation
- ✅ Event emission
- ✅ Discovery endpoint
- ✅ Authentication
- ✅ CORS
- ✅ Error handling

Not yet implemented:
- ❌ Multipart mode (file uploads)
- ❌ Octet-stream mode (raw streaming)
- ❌ Context propagation
- ❌ Compression
- ❌ EJSON custom types (uses standard JSON)
- ❌ Abort/timeout handling

## Performance

Built on:
- **Axum**: Fast, ergonomic web framework
- **Tokio**: Async runtime for high concurrency
- **Tower**: Middleware and service abstractions
- **Serde**: Zero-copy JSON serialization

Expected to handle thousands of concurrent requests efficiently.

## Testing

Run the test suite:
```bash
cargo test
```

Run the example server and test with curl:
```bash
# Terminal 1
cargo run

# Terminal 2
curl -X POST http://localhost:7070/__runner/task/app.tasks.add \
  -H 'x-runner-token: secret' \
  -H 'Content-Type: application/json' \
  -d '{"input": {"a": 10, "b": 5}}'
```

## Integration with Node.js Clients

The Rust server works seamlessly with existing Node.js clients:

```typescript
import { createHttpClient } from "@bluelibs/runner";

const client = createHttpClient({
  baseUrl: "http://localhost:7070/__runner",
  auth: {
    token: "secret",
    header: "x-runner-token",
  },
  serializer: globals.resources.serializer,
});

// Call Rust-backed task
const result = await client.task("app.tasks.add", { a: 5, b: 3 });
console.log(result); // 8
```

## Security Considerations

- Always use HTTPS in production
- Use strong, random auth tokens
- Configure CORS appropriately for your use case
- Validate all inputs in task handlers
- Implement rate limiting if exposing to public internet
- Keep allow-lists minimal (principle of least privilege)

## License

Part of the BlueLibs Runner project.

## References

- [Runner Tunnel HTTP Protocol](../readmes/TUNNEL_HTTP_POLICY.md)
- [Tunnels Documentation](../readmes/TUNNELS.md)
- [Axum Documentation](https://docs.rs/axum)
- [Tokio Documentation](https://tokio.rs)
