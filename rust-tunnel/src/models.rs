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
    /// If true, delegate authentication to Node.js worker
    /// If false, use simple token auth in Rust
    pub delegate_auth: bool,
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
            delegate_auth: true,  // Default to Node.js auth
        }
    }
}

/// Task execution result
pub type TaskResult = serde_json::Value;

/// Event emission result (always empty)
pub type EventResult = ();

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_success_response_new() {
        let response = SuccessResponse::new(42);
        assert!(response.ok);
        assert_eq!(response.result, Some(42));
    }

    #[test]
    fn test_success_response_empty() {
        let response: SuccessResponse<()> = SuccessResponse::empty();
        assert!(response.ok);
        assert!(response.result.is_none());
    }

    #[test]
    fn test_success_response_serialization() {
        let response = SuccessResponse::new(json!({"value": 123}));
        let serialized = serde_json::to_string(&response).unwrap();
        assert!(serialized.contains("\"ok\":true"));
        assert!(serialized.contains("\"value\":123"));
    }

    #[test]
    fn test_error_response_unauthorized() {
        let err = ErrorResponse::unauthorized();
        assert!(!err.ok);
        assert_eq!(err.error.code, 401);
        assert_eq!(err.error.code_name, "UNAUTHORIZED");
    }

    #[test]
    fn test_error_response_forbidden() {
        let err = ErrorResponse::forbidden();
        assert_eq!(err.error.code, 403);
        assert_eq!(err.error.code_name, "FORBIDDEN");
    }

    #[test]
    fn test_error_response_not_found() {
        let err = ErrorResponse::not_found();
        assert_eq!(err.error.code, 404);
        assert_eq!(err.error.code_name, "NOT_FOUND");
    }

    #[test]
    fn test_error_response_method_not_allowed() {
        let err = ErrorResponse::method_not_allowed();
        assert_eq!(err.error.code, 405);
        assert_eq!(err.error.code_name, "METHOD_NOT_ALLOWED");
    }

    #[test]
    fn test_error_response_invalid_json() {
        let err = ErrorResponse::invalid_json("Bad JSON");
        assert_eq!(err.error.code, 400);
        assert_eq!(err.error.code_name, "INVALID_JSON");
        assert!(err.error.message.contains("Bad JSON"));
    }

    #[test]
    fn test_error_response_internal_error() {
        let err = ErrorResponse::internal_error("Something broke");
        assert_eq!(err.error.code, 500);
        assert_eq!(err.error.code_name, "INTERNAL_ERROR");
        assert!(err.error.message.contains("Something broke"));
    }

    #[test]
    fn test_task_request_deserialization() {
        let json = json!({"input": {"a": 5, "b": 3}});
        let req: TaskRequest = serde_json::from_value(json).unwrap();
        assert_eq!(req.input["a"], 5);
        assert_eq!(req.input["b"], 3);
    }

    #[test]
    fn test_event_request_deserialization() {
        let json = json!({"payload": {"message": "Hello"}});
        let req: EventRequest = serde_json::from_value(json).unwrap();
        assert_eq!(req.payload["message"], "Hello");
    }

    #[test]
    fn test_allow_list_serialization() {
        let allow_list = AllowList {
            enabled: true,
            tasks: vec!["task1".to_string(), "task2".to_string()],
            events: vec!["event1".to_string()],
        };
        let serialized = serde_json::to_value(&allow_list).unwrap();
        assert_eq!(serialized["enabled"], true);
        assert_eq!(serialized["tasks"][0], "task1");
        assert_eq!(serialized["events"][0], "event1");
    }

    #[test]
    fn test_discovery_result_serialization() {
        let discovery = DiscoveryResult {
            allow_list: AllowList {
                enabled: true,
                tasks: vec!["test.task".to_string()],
                events: vec![],
            },
        };
        let serialized = serde_json::to_value(&discovery).unwrap();
        assert!(serialized["allowList"]["enabled"].as_bool().unwrap());
        assert_eq!(serialized["allowList"]["tasks"][0], "test.task");
    }

    #[test]
    fn test_tunnel_config_default() {
        let config = TunnelConfig::default();
        assert_eq!(config.base_path, "/__runner");
        assert_eq!(config.port, 7070);
        assert_eq!(config.auth_header, "x-runner-token");
        assert!(config.delegate_auth);
    }

    #[test]
    fn test_tunnel_config_clone() {
        let config = TunnelConfig::default();
        let cloned = config.clone();
        assert_eq!(config.port, cloned.port);
        assert_eq!(config.base_path, cloned.base_path);
    }
}
