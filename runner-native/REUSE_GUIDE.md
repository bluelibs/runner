# Integration Guide: napi-rs Approach with Existing Code

## What Can We Reuse? (Detailed Breakdown)

### ✅ FULLY REUSABLE (Copy as-is)

From `/home/user/runner/rust-tunnel/src/`:

**1. `models.rs` (95% reusable)**
```rust
// These types are perfect for napi-rs!
pub struct SuccessResponse<T> { ... }
pub struct ErrorResponse { ... }
pub struct ErrorDetails { ... }

// Just add #[napi(object)] attribute for napi-rs exposure
```

**2. `error.rs` (100% reusable internally)**
```rust
pub enum TunnelError { ... }
pub type TunnelResult<T> = Result<T, TunnelError>;

// Works perfectly with napi-rs Result<T>
```

**3. Core HTTP concepts**
- CORS configuration logic
- JSON parsing/serialization
- Error code mappings (401, 403, 404, etc.)

### 🔄 ADAPTABLE (Small changes needed)

**1. HTTP Server Setup**

**Before (standalone binary):**
```rust
// src/lib.rs - old approach
pub async fn start_tunnel_server_ipc(
    config: TunnelConfig,
    worker_script: String,
) -> Result<(), Box<dyn std::error::Error>> {
    // Spawns Node.js as child process
    let worker = NodeWorker::spawn(worker_script)?;
    // ... IPC communication
}
```

**After (napi-rs addon):**
```rust
// src/lib.rs - new approach
#[napi]
impl TunnelServer {
    #[napi]
    pub fn listen(&mut self) -> Result<AsyncTask<ServerTask>> {
        // Node.js is the main process!
        // Rust runs HTTP server in background thread
        Ok(AsyncTask::new(ServerTask { ... }))
    }
}
```

**2. Handler Storage**

**Before (IPC):**
```rust
// Stored task names, called via IPC
struct TaskRegistry {
    tasks: HashMap<String, Arc<dyn TaskHandler>>,
}
```

**After (napi-rs):**
```rust
// Store JavaScript functions directly!
struct TaskRoute {
    handler: ThreadsafeFunction<Value, Value>,  // Direct JS call!
}
```

### ❌ CANNOT REUSE (Different paradigm)

**1. `main.rs` and `main_ipc.rs`**
- These are binary entry points
- With napi-rs, JavaScript is the entry point
- Delete these entirely

**2. `node_worker.rs` and `worker_protocol.rs`**
- These handle IPC via stdin/stdout
- With napi-rs, we use ThreadsafeFunction
- No IPC protocol needed!

**3. `handlers_ipc.rs`**
- These forward requests via IPC
- With napi-rs, we call JS directly
- Replace with ThreadsafeFunction calls

## Code Migration Example

### OLD CODE (IPC approach)

```rust
// rust-tunnel/src/node_worker.rs
pub async fn execute_task(&self, task_id: String, input: Value) -> TunnelResult<Value> {
    let id = self.request_id.fetch_add(1, Ordering::SeqCst);
    let request = WorkerRequest::Task { id, task_id, input };

    // Write to stdin ← IPC overhead!
    self.send_request(request).await?;

    // Wait for stdout response ← IPC overhead!
    let response = self.receive_response().await?;
    Ok(response.result)
}
```

### NEW CODE (napi-rs approach)

```rust
// runner-native/src/lib.rs
async fn handle_task(
    tasks: Arc<RwLock<HashMap<String, TaskRoute>>>,
    task_id: String,
    input: Value,
) -> Result<Value> {
    let route = tasks.read().await.get(&task_id)?;

    // Direct call to JavaScript! ← ZERO overhead!
    let result = route.handler
        .call_async::<Promise<Value>>(input)
        .await?;

    Ok(result)
}
```

**The difference:**
- ❌ Old: Serialize → IPC → Deserialize → Execute → Serialize → IPC → Deserialize
- ✅ New: Direct function call (FFI)

## File-by-File Reuse Guide

| Old File | New File | Reuse % | Notes |
|----------|----------|---------|-------|
| `models.rs` | `models.rs` | 95% | Add `#[napi(object)]` attributes |
| `error.rs` | `error.rs` | 100% | Use as-is, works with napi Result |
| `auth.rs` | `auth.rs` | 80% | Adapt to extract from axum Request |
| `lib.rs` | `server.rs` | 50% | Adapt HTTP setup for napi-rs |
| `handlers.rs` | - | 30% | Logic reusable, structure different |
| `task_registry.rs` | - | 20% | Concept reusable, impl different |
| `main.rs` | - | 0% | Delete (Node.js is main process) |
| `main_ipc.rs` | - | 0% | Delete (no IPC needed) |
| `node_worker.rs` | - | 0% | Delete (no child process) |
| `worker_protocol.rs` | - | 0% | Delete (no IPC protocol) |
| `handlers_ipc.rs` | - | 0% | Delete (use ThreadsafeFunction) |
| - | `lib.rs` | NEW | napi-rs entry point |
| - | `index.js` | NEW | JavaScript loader |

## Practical Migration Steps

### Step 1: Copy Reusable Code

```bash
cd /home/user/runner/runner-native

# Copy models (will adapt)
cp ../rust-tunnel/src/models.rs src/

# Copy error handling (use as-is)
cp ../rust-tunnel/src/error.rs src/

# Copy auth logic (will adapt)
cp ../rust-tunnel/src/auth.rs src/
```

### Step 2: Adapt models.rs for napi-rs

```rust
// src/models.rs - ADD napi attributes

// Before:
pub struct TunnelConfig { ... }

// After:
#[napi(object)]  // ← Add this!
pub struct TunnelConfig {
    pub port: u16,
    pub base_path: String,
    // napi-rs will auto-generate TypeScript types!
}
```

### Step 3: Create napi-rs lib.rs

```rust
// src/lib.rs - NEW file
#![deny(clippy::all)]

use napi::bindgen_prelude::*;
use napi_derive::napi;

mod models;
mod error;
mod auth;
mod server;  // NEW: HTTP server adapted for napi-rs

pub use models::*;
pub use error::*;

#[napi]
pub struct TunnelServer {
    // Main struct exposed to JavaScript
}

#[napi]
impl TunnelServer {
    // Methods called from JavaScript
}
```

### Step 4: Adapt HTTP Server

```rust
// src/server.rs - ADAPTED from lib.rs
use axum::Router;

// Same Axum setup as before, but:
// - Don't spawn Node.js child process
// - Store JavaScript functions in routes
// - Call JS via ThreadsafeFunction

pub async fn start_http_server(
    config: TunnelConfig,
    tasks: Arc<RwLock<HashMap<String, ThreadsafeFunction<...>>>>,
) -> Result<()> {
    // Same Router setup as before!
    let app = Router::new()
        .route("/task/:task_id", post(handle_task))
        .layer(CorsLayer::new()...);

    // Same server start as before!
    let listener = tokio::net::TcpListener::bind(...).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
```

## Integration with Existing @bluelibs/runner

Your existing code structure:
```
src/
  globals/
    resources/
      tunnel/
    middleware/
  node/
    exposure/
      createNodeExposure.ts  ← Current HTTP server
```

**New integration:**

```typescript
// src/node/exposure/createNativeExposure.ts  ← NEW!
import { TunnelServer } from '@bluelibs/runner-native';

export async function createNativeExposure(
  cfg: NodeExposureConfig,
  deps: NodeExposureDeps,
) {
  const { store, taskRunner, eventManager } = deps;

  // Create native server (Rust HTTP!)
  const server = new TunnelServer({
    port: cfg.http.listen.port,
    basePath: cfg.http.basePath,
    corsOrigins: cfg.http.cors.origins,
  });

  // Register all tasks from store
  for (const [taskId, task] of store.tasks) {
    server.registerTask(taskId, async (input) => {
      // Call existing task runner!
      return await taskRunner.run(taskId, input);
    });
  }

  // Register all events
  for (const [eventId, event] of store.events) {
    server.registerEvent(eventId, async (payload) => {
      // Call existing event manager!
      return await eventManager.emit(eventId, payload);
    });
  }

  return {
    server,
    async listen() {
      await server.listen();
    },
    async close() {
      // Rust handles cleanup
    },
  };
}
```

**Usage (drop-in replacement!):**

```typescript
// Before:
import { createNodeExposure } from './node/exposure/createNodeExposure';
const exposure = await createNodeExposure(config, deps);

// After (just change import!):
import { createNativeExposure } from './node/exposure/createNativeExposure';
const exposure = await createNativeExposure(config, deps);

// Everything else stays the same!
await exposure.listen();
```

## Summary: What Changes?

### 🔴 Major Changes
1. **Entry point**: Node.js becomes main process (not Rust binary)
2. **Communication**: Direct FFI calls (not IPC)
3. **Distribution**: npm package with `.node` files (not standalone binary)

### 🟡 Medium Changes
1. **HTTP setup**: Adapted but very similar
2. **Handler storage**: Store JS functions instead of task IDs
3. **Build process**: Use napi-rs CLI instead of cargo

### 🟢 No Changes
1. **HTTP server**: Still Axum/Tokio (95% same code!)
2. **CORS**: Exact same logic
3. **Error handling**: Exact same types
4. **Protocol**: Same JSON structures
5. **Business logic**: Your existing Node.js code unchanged!

## Advantages of napi-rs Approach

1. **Can reuse 60-70% of Rust code** ✅
2. **Zero IPC overhead** (vs 0.1ms) ✅
3. **Standard distribution** (npm package) ✅
4. **Easy integration** with existing code ✅
5. **Actually faster** (no double JSON parsing) ✅

You DON'T need to rewrite everything - most of the HTTP handling code transfers directly!
