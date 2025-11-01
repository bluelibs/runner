use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Request from Rust to Node.js worker
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum WorkerRequest {
    Task {
        id: u64,
        #[serde(rename = "taskId")]
        task_id: String,
        input: Value,
    },
    Event {
        id: u64,
        #[serde(rename = "eventId")]
        event_id: String,
        payload: Value,
    },
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

impl WorkerRequest {
    pub fn id(&self) -> u64 {
        match self {
            WorkerRequest::Task { id, .. } => *id,
            WorkerRequest::Event { id, .. } => *id,
            WorkerRequest::Shutdown { id } => *id,
        }
    }
}
