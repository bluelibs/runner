use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

/// HTTP request context sent to Node.js for auth/execution
#[derive(Debug, Serialize, Deserialize)]
pub struct RequestContext {
    pub method: String,
    pub path: String,
    pub headers: HashMap<String, String>,
    pub query: HashMap<String, String>,
}

/// Request from Rust to Node.js worker
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum WorkerRequest {
    /// Authenticate a request
    Auth {
        id: u64,
        context: RequestContext,
    },
    /// Execute a task (after auth passed)
    Task {
        id: u64,
        #[serde(rename = "taskId")]
        task_id: String,
        input: Value,
        context: RequestContext,
    },
    /// Emit an event
    Event {
        id: u64,
        #[serde(rename = "eventId")]
        event_id: String,
        payload: Value,
        context: RequestContext,
    },
    /// Shutdown the worker
    Shutdown {
        id: u64,
    },
}

/// Response from Node.js worker to Rust
#[derive(Debug, Serialize, Deserialize)]
pub struct WorkerResponse {
    pub id: u64,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<WorkerError>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkerError {
    pub message: String,
    pub code: u16,
    #[serde(rename = "codeName")]
    pub code_name: String,
}

impl WorkerRequest {
    pub fn id(&self) -> u64 {
        match self {
            WorkerRequest::Auth { id, .. } => *id,
            WorkerRequest::Task { id, .. } => *id,
            WorkerRequest::Event { id, .. } => *id,
            WorkerRequest::Shutdown { id } => *id,
        }
    }
}
