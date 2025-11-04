#![deny(clippy::all)]

use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use serde_json::Value;

mod models;
mod error;

use models::{SuccessResponse, ErrorResponse};
use error::TunnelError;

// ==============================================================================
// NAPI-RS TYPES (Exposed to JavaScript)
// ==============================================================================

/// Configuration for tunnel server
#[napi(object)]
pub struct TunnelConfig {
    /// Port to listen on
    pub port: u16,
    /// Base path for routes (default: /__runner)
    pub base_path: Option<String>,
    /// CORS allowed origins
    pub cors_origins: Option<Vec<String>>,
}

/// Task handler function type
pub type TaskHandler = napi::threadsafe_function::ThreadsafeFunction<Value, ErrorStrategy::Fatal>;

/// Route storage
struct TaskRoute {
    handler: TaskHandler,
}

// ==============================================================================
// TUNNEL SERVER
// ==============================================================================

/// High-performance HTTP tunnel server powered by Rust
#[napi]
pub struct TunnelServer {
    port: u16,
    base_path: String,
    cors_origins: Vec<String>,
    tasks: Arc<RwLock<HashMap<String, TaskRoute>>>,
    events: Arc<RwLock<HashMap<String, TaskHandler>>>,
}

#[napi]
impl TunnelServer {
    /// Create a new tunnel server
    ///
    /// Example:
    /// ```javascript
    /// const server = new TunnelServer({
    ///   port: 7070,
    ///   basePath: '/__runner',
    ///   corsOrigins: ['*']
    /// });
    /// ```
    #[napi(constructor)]
    pub fn new(config: TunnelConfig) -> Self {
        Self {
            port: config.port,
            base_path: config.base_path.unwrap_or_else(|| "/__runner".to_string()),
            cors_origins: config.cors_origins.unwrap_or_else(|| vec!["*".to_string()]),
            tasks: Arc::new(RwLock::new(HashMap::new())),
            events: Arc::new(RwLock::new(HashMap::new())),
        }
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
        &self,
        task_id: String,
        #[napi(ts_arg_type = "(input: any) => Promise<any>")] handler: JsFunction,
    ) -> Result<()> {
        // Create ThreadsafeFunction for calling JavaScript from Rust threads
        let tsfn: TaskHandler = handler
            .create_threadsafe_function(0, |ctx: ThreadSafeCallContext<Value>| {
                Ok(vec![ctx.value])
            })?;

        let tasks = self.tasks.clone();
        let task_id_clone = task_id.clone();

        // Store the handler
        std::thread::spawn(move || {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async move {
                let mut tasks = tasks.write().await;
                tasks.insert(task_id_clone, TaskRoute { handler: tsfn });
            });
        }).join().unwrap();

        Ok(())
    }

    /// Register an event handler
    ///
    /// Example:
    /// ```javascript
    /// server.registerEvent('app.events.notify', async (payload) => {
    ///   console.log('Event:', payload);
    /// });
    /// ```
    #[napi(ts_args_type = "eventId: string, handler: (payload: any) => Promise<void>")]
    pub fn register_event(
        &self,
        event_id: String,
        #[napi(ts_arg_type = "(payload: any) => Promise<void>")] handler: JsFunction,
    ) -> Result<()> {
        let tsfn: TaskHandler = handler
            .create_threadsafe_function(0, |ctx: ThreadSafeCallContext<Value>| {
                Ok(vec![ctx.value])
            })?;

        let events = self.events.clone();
        let event_id_clone = event_id.clone();

        std::thread::spawn(move || {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async move {
                let mut events = events.write().await;
                events.insert(event_id_clone, tsfn);
            });
        }).join().unwrap();

        Ok(())
    }

    /// Start the HTTP server
    ///
    /// Returns a promise that resolves when server is ready
    ///
    /// Example:
    /// ```javascript
    /// await server.listen();
    /// console.log('Server listening on port 7070');
    /// ```
    #[napi]
    pub async fn listen(&self) -> Result<()> {
        use axum::{
            extract::{Json as AxumJson, Path, State as AxumState},
            routing::{get, post},
            Router,
        };
        use tower_http::cors::{Any, CorsLayer};

        let tasks = self.tasks.clone();
        let events = self.events.clone();
        let base_path = self.base_path.clone();

        // Build Axum router
        let app = Router::new()
            .route(
                &format!("{}/task/:task_id", base_path),
                post({
                    let tasks = tasks.clone();
                    move |path, body| handle_task(tasks.clone(), path, body)
                }),
            )
            .route(
                &format!("{}/event/:event_id", base_path),
                post({
                    let events = events.clone();
                    move |path, body| handle_event(events.clone(), path, body)
                }),
            )
            .route(
                &format!("{}/discovery", base_path),
                get({
                    let tasks = tasks.clone();
                    let events = events.clone();
                    move || handle_discovery(tasks.clone(), events.clone())
                }).post({
                    let tasks = tasks.clone();
                    let events = events.clone();
                    move || handle_discovery(tasks.clone(), events.clone())
                }),
            )
            .layer(
                CorsLayer::new()
                    .allow_origin(Any)
                    .allow_methods(Any)
                    .allow_headers(Any),
            );

        // Start server
        let addr = std::net::SocketAddr::from(([0, 0, 0, 0], self.port));
        let listener = tokio::net::TcpListener::bind(addr)
            .await
            .map_err(|e| Error::from_reason(e.to_string()))?;

        println!("🦀 Rust HTTP server listening on http://{}", addr);
        println!("📡 Base path: {}", base_path);

        axum::serve(listener, app)
            .await
            .map_err(|e| Error::from_reason(e.to_string()))?;

        Ok(())
    }

    /// Get list of registered task IDs
    #[napi]
    pub async fn get_task_ids(&self) -> Vec<String> {
        let tasks = self.tasks.read().await;
        tasks.keys().cloned().collect()
    }

    /// Get list of registered event IDs
    #[napi]
    pub async fn get_event_ids(&self) -> Vec<String> {
        let events = self.events.read().await;
        events.keys().cloned().collect()
    }
}

// ==============================================================================
// REQUEST HANDLERS
// ==============================================================================

#[derive(serde::Deserialize)]
struct TaskRequest {
    input: Value,
}

async fn handle_task(
    tasks: Arc<RwLock<HashMap<String, TaskRoute>>>,
    Path(task_id): Path<String>,
    AxumJson(request): AxumJson<TaskRequest>,
) -> Result<AxumJson<SuccessResponse<Value>>, (axum::http::StatusCode, AxumJson<ErrorResponse>)> {
    // Get task handler
    let tasks_guard = tasks.read().await;
    let route = tasks_guard.get(&task_id).ok_or_else(|| {
        (
            axum::http::StatusCode::NOT_FOUND,
            AxumJson(ErrorResponse::not_found()),
        )
    })?;

    // Call JavaScript handler via ThreadsafeFunction (ZERO IPC overhead!)
    let result = route
        .handler
        .call_async(Ok(request.input))
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                AxumJson(ErrorResponse::internal_error(e.to_string())),
            )
        })?;

    Ok(AxumJson(SuccessResponse::new(result)))
}

#[derive(serde::Deserialize)]
struct EventRequest {
    payload: Value,
}

async fn handle_event(
    events: Arc<RwLock<HashMap<String, TaskHandler>>>,
    Path(event_id): Path<String>,
    AxumJson(request): AxumJson<EventRequest>,
) -> Result<AxumJson<SuccessResponse<()>>, (axum::http::StatusCode, AxumJson<ErrorResponse>)> {
    let events_guard = events.read().await;
    let handler = events_guard.get(&event_id).ok_or_else(|| {
        (
            axum::http::StatusCode::NOT_FOUND,
            AxumJson(ErrorResponse::not_found()),
        )
    })?;

    handler
        .call_async(Ok(request.payload))
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                AxumJson(ErrorResponse::internal_error(e.to_string())),
            )
        })?;

    Ok(AxumJson(SuccessResponse::empty()))
}

#[derive(serde::Serialize)]
struct AllowList {
    enabled: bool,
    tasks: Vec<String>,
    events: Vec<String>,
}

#[derive(serde::Serialize)]
struct DiscoveryResult {
    #[serde(rename = "allowList")]
    allow_list: AllowList,
}

async fn handle_discovery(
    tasks: Arc<RwLock<HashMap<String, TaskRoute>>>,
    events: Arc<RwLock<HashMap<String, TaskHandler>>>,
) -> AxumJson<SuccessResponse<DiscoveryResult>> {
    let task_ids: Vec<String> = {
        let tasks_guard = tasks.read().await;
        tasks_guard.keys().cloned().collect()
    };

    let event_ids: Vec<String> = {
        let events_guard = events.read().await;
        events_guard.keys().cloned().collect()
    };

    let result = DiscoveryResult {
        allow_list: AllowList {
            enabled: true,
            tasks: task_ids,
            events: event_ids,
        },
    };

    AxumJson(SuccessResponse::new(result))
}
