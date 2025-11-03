#![deny(clippy::all)]

use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use serde_json::Value;

// ==============================================================================
// REUSED FROM rust-tunnel/src/models.rs ✅
// ==============================================================================

#[derive(Debug, Clone)]
pub struct TunnelConfig {
    pub port: u16,
    pub base_path: String,
    pub cors_origins: Vec<String>,
}

// ==============================================================================
// NAPI-RS EXPOSED TYPES (NEW for native addon)
// ==============================================================================

/// Configuration for tunnel server (exposed to JavaScript)
#[napi(object)]
pub struct TunnelServerConfig {
    pub port: u16,
    pub base_path: Option<String>,
    pub cors_origins: Option<Vec<String>>,
}

impl From<TunnelServerConfig> for TunnelConfig {
    fn from(config: TunnelServerConfig) -> Self {
        Self {
            port: config.port,
            base_path: config.base_path.unwrap_or_else(|| "/__runner".to_string()),
            cors_origins: config.cors_origins.unwrap_or_else(|| vec!["*".to_string()]),
        }
    }
}

// ==============================================================================
// TASK HANDLER STORAGE (Adapted from rust-tunnel)
// ==============================================================================

/// Stores JavaScript function handlers
struct TaskRoute {
    /// JavaScript function to call
    handler: napi::threadsafe_function::ThreadsafeFunction<Value, Value>,
}

// ==============================================================================
// MAIN TUNNEL SERVER (NEW napi-rs wrapper)
// ==============================================================================

/// Main tunnel server exposed to JavaScript
#[napi]
pub struct TunnelServer {
    config: TunnelConfig,
    tasks: Arc<RwLock<HashMap<String, TaskRoute>>>,
    runtime: Option<tokio::runtime::Runtime>,
}

#[napi]
impl TunnelServer {
    /// Create a new tunnel server
    #[napi(constructor)]
    pub fn new(config: TunnelServerConfig) -> Result<Self> {
        Ok(Self {
            config: config.into(),
            tasks: Arc::new(RwLock::new(HashMap::new())),
            runtime: None,
        })
    }

    /// Register a task handler
    ///
    /// Example:
    /// ```javascript
    /// server.registerTask('app.tasks.add', async (input) => {
    ///   return input.a + input.b;
    /// });
    /// ```
    #[napi(ts_args_type = "taskId: string, handler: (input: any) => Promise<any>")]
    pub fn register_task(
        &mut self,
        task_id: String,
        #[napi(ts_arg_type = "(input: any) => Promise<any>")] handler: JsFunction,
    ) -> Result<()> {
        // Create ThreadsafeFunction to call JavaScript from Rust
        let tsfn: napi::threadsafe_function::ThreadsafeFunction<Value, Value> =
            handler.create_threadsafe_function(0, |ctx| {
                // Convert Rust Value to JsValue
                ctx.env.to_js_value(&ctx.value)
            })?;

        // Store the handler
        let tasks = self.tasks.clone();
        let task_id_clone = task_id.clone();

        // We need to use blocking runtime for now
        // In real implementation, use proper async handling
        tokio::runtime::Handle::current().block_on(async move {
            let mut tasks = tasks.write().await;
            tasks.insert(task_id_clone, TaskRoute { handler: tsfn });
        });

        Ok(())
    }

    /// Start the HTTP server
    ///
    /// This starts a Rust HTTP server (Axum) that handles all HTTP concerns
    /// and calls JavaScript handlers via ThreadsafeFunction (zero IPC!)
    #[napi]
    pub fn listen(&mut self, env: Env) -> Result<AsyncTask<ServerTask>> {
        let tasks = self.tasks.clone();
        let config = self.config.clone();

        Ok(AsyncTask::new(ServerTask {
            config,
            tasks,
        }))
    }
}

// ==============================================================================
// ASYNC SERVER TASK (Runs Rust HTTP server in background)
// ==============================================================================

pub struct ServerTask {
    config: TunnelConfig,
    tasks: Arc<RwLock<HashMap<String, TaskRoute>>>,
}

#[napi]
impl Task for ServerTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> Result<Self::Output> {
        // Create Tokio runtime for HTTP server
        let runtime = tokio::runtime::Runtime::new()
            .map_err(|e| Error::from_reason(e.to_string()))?;

        runtime.block_on(async {
            start_http_server(self.config.clone(), self.tasks.clone()).await
        })?;

        Ok(())
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> Result<Self::JsValue> {
        Ok(())
    }
}

// ==============================================================================
// HTTP SERVER (ADAPTED from rust-tunnel/src/lib.rs)
// ==============================================================================

async fn start_http_server(
    config: TunnelConfig,
    tasks: Arc<RwLock<HashMap<String, TaskRoute>>>,
) -> Result<()> {
    use axum::{
        extract::{Json, Path},
        routing::post,
        Router,
    };
    use tower_http::cors::{Any, CorsLayer};

    // Build router - SIMILAR to rust-tunnel but calls JS handlers!
    let app = Router::new()
        .route(
            &format!("{}/task/:task_id", config.base_path),
            post({
                let tasks = tasks.clone();
                move |path: Path<String>, body: Json<Value>| {
                    handle_task(tasks.clone(), path, body)
                }
            }),
        )
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        );

    // Start server
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], config.port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| Error::from_reason(e.to_string()))?;

    println!("🦀 Rust HTTP server listening on {}", addr);

    axum::serve(listener, app)
        .await
        .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(())
}

// ==============================================================================
// REQUEST HANDLER (NEW - calls JavaScript!)
// ==============================================================================

async fn handle_task(
    tasks: Arc<RwLock<HashMap<String, TaskRoute>>>,
    Path(task_id): Path<String>,
    Json(input): Json<Value>,
) -> Result<Json<Value>> {
    // Get task handler
    let tasks = tasks.read().await;
    let route = tasks
        .get(&task_id)
        .ok_or_else(|| Error::from_reason(format!("Task not found: {}", task_id)))?;

    // Call JavaScript handler via ThreadsafeFunction
    // This is a DIRECT CALL with ZERO IPC overhead!
    let result = route
        .handler
        .call_async::<Promise<Value>>(input)
        .await
        .map_err(|e| Error::from_reason(format!("Handler error: {}", e)))?;

    Ok(Json(result))
}
