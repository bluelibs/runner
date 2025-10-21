use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use std::sync::Arc;

use crate::{
    error::{TunnelError, TunnelResult},
    models::{
        AllowList, DiscoveryResult, EventRequest, SuccessResponse, TaskRequest, TaskResult,
        TunnelConfig,
    },
    task_registry::TaskRegistry,
};

/// Handler for task invocation: POST /task/{taskId}
pub async fn handle_task(
    State(state): State<Arc<AppState>>,
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

    // Execute the task
    let result = state.registry.execute_task(&task_id, request.input).await?;

    Ok(Json(SuccessResponse::new(result)))
}

/// Handler for event emission: POST /event/{eventId}
pub async fn handle_event(
    State(state): State<Arc<AppState>>,
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

    // Emit the event
    state.registry.emit_event(&event_id, request.payload).await?;

    Ok(Json(SuccessResponse::empty()))
}

/// Handler for discovery: GET|POST /discovery
pub async fn handle_discovery(
    State(state): State<Arc<AppState>>,
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

/// Application state shared across handlers
pub struct AppState {
    pub config: TunnelConfig,
    pub registry: TaskRegistry,
}

impl AppState {
    pub fn new(config: TunnelConfig, registry: TaskRegistry) -> Self {
        Self { config, registry }
    }
}
