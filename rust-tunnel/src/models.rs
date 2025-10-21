use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Protocol envelope for successful responses
#[derive(Debug, Serialize)]
pub struct SuccessResponse<T> {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<T>,
}

impl<T> SuccessResponse<T> {
    pub fn new(result: T) -> Self {
        Self {
            ok: true,
            result: Some(result),
        }
    }

    pub fn empty() -> Self {
        Self {
            ok: true,
            result: None,
        }
    }
}

/// Error details in the protocol envelope
#[derive(Debug, Serialize, Deserialize)]
pub struct ErrorDetails {
    pub code: u16,
    pub message: String,
    #[serde(rename = "codeName")]
    pub code_name: String,
}

/// Protocol envelope for error responses
#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub ok: bool,
    pub error: ErrorDetails,
}

impl ErrorResponse {
    pub fn new(code: u16, code_name: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            ok: false,
            error: ErrorDetails {
                code,
                code_name: code_name.into(),
                message: message.into(),
            },
        }
    }

    pub fn unauthorized() -> Self {
        Self::new(401, "UNAUTHORIZED", "Invalid or missing token")
    }

    pub fn forbidden() -> Self {
        Self::new(403, "FORBIDDEN", "Task or event not in allow-list")
    }

    pub fn not_found() -> Self {
        Self::new(404, "NOT_FOUND", "Task or event not found")
    }

    pub fn method_not_allowed() -> Self {
        Self::new(405, "METHOD_NOT_ALLOWED", "Method not allowed")
    }

    pub fn invalid_json(msg: impl Into<String>) -> Self {
        Self::new(400, "INVALID_JSON", msg)
    }

    pub fn internal_error(msg: impl Into<String>) -> Self {
        Self::new(500, "INTERNAL_ERROR", msg)
    }
}

/// Request body for task invocation
#[derive(Debug, Deserialize)]
pub struct TaskRequest {
    pub input: serde_json::Value,
}

/// Request body for event emission
#[derive(Debug, Deserialize)]
pub struct EventRequest {
    pub payload: serde_json::Value,
}

/// Allow-list information
#[derive(Debug, Serialize)]
pub struct AllowList {
    pub enabled: bool,
    pub tasks: Vec<String>,
    pub events: Vec<String>,
}

/// Discovery response
#[derive(Debug, Serialize)]
pub struct DiscoveryResult {
    #[serde(rename = "allowList")]
    pub allow_list: AllowList,
}

/// Configuration for the tunnel server
#[derive(Debug, Clone)]
pub struct TunnelConfig {
    pub base_path: String,
    pub port: u16,
    pub auth_token: String,
    pub auth_header: String,
    pub allowed_tasks: Vec<String>,
    pub allowed_events: Vec<String>,
    pub cors_origin: Option<String>,
}

impl Default for TunnelConfig {
    fn default() -> Self {
        Self {
            base_path: "/__runner".to_string(),
            port: 7070,
            auth_token: "secret".to_string(),
            auth_header: "x-runner-token".to_string(),
            allowed_tasks: vec![],
            allowed_events: vec![],
            cors_origin: Some("*".to_string()),
        }
    }
}

/// Task execution result
pub type TaskResult = serde_json::Value;

/// Event emission result (always empty)
pub type EventResult = ();
