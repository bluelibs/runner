use axum::{
    extract::{Path, State},
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
};

/// Handler for task invocation: POST /task/{taskId}
/// Validates request, then forwards to Node.js worker via IPC
pub async fn handle_task(
    State(state): State<Arc<AppStateIpc>>,
    Path(task_id): Path<String>,
    Json(request): Json<TaskRequest>,
) -> TunnelResult<Json<SuccessResponse<TaskResult>>> {
    tracing::info!("Task invocation: {}", task_id);

    // Check allow-list
    if !state.config.allowed_tasks.is_empty()
        && !state.config.allowed_tasks.contains(&task_id)
    {
        return Err(TunnelError::Forbidden);
    }

    // Forward to Node.js worker via IPC
    let result = state.worker.execute_task(task_id, request.input).await?;

    Ok(Json(SuccessResponse::new(result)))
}

/// Handler for event emission: POST /event/{eventId}
/// Validates request, then forwards to Node.js worker via IPC
pub async fn handle_event(
    State(state): State<Arc<AppStateIpc>>,
    Path(event_id): Path<String>,
    Json(request): Json<EventRequest>,
) -> TunnelResult<Json<SuccessResponse<()>>> {
    tracing::info!("Event emission: {}", event_id);

    // Check allow-list
    if !state.config.allowed_events.is_empty()
        && !state.config.allowed_events.contains(&event_id)
    {
        return Err(TunnelError::Forbidden);
    }

    // Forward to Node.js worker via IPC
    state.worker.emit_event(event_id, request.payload).await?;

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
