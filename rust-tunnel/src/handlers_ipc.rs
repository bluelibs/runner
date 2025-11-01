use axum::{
    extract::{Path, Request, State},
    Json,
};
use std::sync::Arc;

use crate::{
    error::{TunnelError, TunnelResult},
    models::{
        AllowList, DiscoveryResult, EventRequest, SuccessResponse, TaskRequest, TaskResult,
        TunnelConfig,
    },
    node_worker::NodeWorker,
    worker_protocol::RequestContext,
};

/// Extract request context for Node.js
fn extract_context(req: &Request) -> RequestContext {
    let headers = req.headers()
        .iter()
        .filter_map(|(k, v)| {
            v.to_str().ok().map(|v| (k.as_str().to_lowercase(), v.to_string()))
        })
        .collect();

    RequestContext {
        method: req.method().to_string(),
        path: req.uri().path().to_string(),
        headers,
        query: Default::default(), // TODO: parse query params
    }
}

/// Handler for task invocation: POST /task/{taskId}
/// Forwards to Node.js worker which handles auth AND execution
pub async fn handle_task(
    State(state): State<Arc<AppStateIpc>>,
    Path(task_id): Path<String>,
    req: Request,
) -> TunnelResult<Json<SuccessResponse<TaskResult>>> {
    tracing::info!("Task invocation: {}", task_id);

    // Extract request context
    let context = extract_context(&req);

    // If auth is delegated to Node.js, ask it first
    if state.config.delegate_auth {
        state.worker.authenticate(context.clone()).await?;
    }

    // Parse body
    let (parts, body) = req.into_parts();
    let bytes = axum::body::to_bytes(body, usize::MAX).await
        .map_err(|e| TunnelError::InvalidJson(e.to_string()))?;

    let request: TaskRequest = serde_json::from_slice(&bytes)
        .map_err(|e| TunnelError::InvalidJson(e.to_string()))?;

    // Check allow-list (optional if using Node.js auth)
    if !state.config.allowed_tasks.is_empty()
        && !state.config.allowed_tasks.contains(&task_id)
    {
        return Err(TunnelError::Forbidden);
    }

    // Forward to Node.js worker via IPC
    let result = state.worker.execute_task(task_id, request.input, context).await?;

    Ok(Json(SuccessResponse::new(result)))
}

/// Handler for event emission: POST /event/{eventId}
pub async fn handle_event(
    State(state): State<Arc<AppStateIpc>>,
    Path(event_id): Path<String>,
    req: Request,
) -> TunnelResult<Json<SuccessResponse<()>>> {
    tracing::info!("Event emission: {}", event_id);

    // Extract request context
    let context = extract_context(&req);

    // If auth is delegated to Node.js, ask it first
    if state.config.delegate_auth {
        state.worker.authenticate(context.clone()).await?;
    }

    // Parse body
    let (parts, body) = req.into_parts();
    let bytes = axum::body::to_bytes(body, usize::MAX).await
        .map_err(|e| TunnelError::InvalidJson(e.to_string()))?;

    let request: EventRequest = serde_json::from_slice(&bytes)
        .map_err(|e| TunnelError::InvalidJson(e.to_string()))?;

    // Check allow-list
    if !state.config.allowed_events.is_empty()
        && !state.config.allowed_events.contains(&event_id)
    {
        return Err(TunnelError::Forbidden);
    }

    // Forward to Node.js worker via IPC
    state.worker.emit_event(event_id, request.payload, context).await?;

    Ok(Json(SuccessResponse::empty()))
}

/// Handler for discovery: GET|POST /discovery
pub async fn handle_discovery(
    State(state): State<Arc<AppStateIpc>>,
) -> TunnelResult<Json<SuccessResponse<DiscoveryResult>>> {
    tracing::info!("Discovery request");

    let allow_list = AllowList {
        enabled: true,
        tasks: state.config.allowed_tasks.clone(),
        events: state.config.allowed_events.clone(),
    };

    let result = DiscoveryResult { allow_list };

    Ok(Json(SuccessResponse::new(result)))
}

/// Application state for IPC-based server
pub struct AppStateIpc {
    pub config: TunnelConfig,
    pub worker: NodeWorker,
}

impl AppStateIpc {
    pub fn new(config: TunnelConfig, worker: NodeWorker) -> Self {
        Self { config, worker }
    }
}
