// Standalone tests that can run without external dependencies
// These test the core protocol types using only std and serde_json

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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_success_response_new() {
        let response = SuccessResponse::new(42);
        assert!(response.ok);
        assert_eq!(response.result, Some(42));
        println!("✓ SuccessResponse::new works");
    }

    #[test]
    fn test_success_response_empty() {
        let response: SuccessResponse<()> = SuccessResponse::empty();
        assert!(response.ok);
        assert!(response.result.is_none());
        println!("✓ SuccessResponse::empty works");
    }

    #[test]
    fn test_error_response_unauthorized() {
        let err = ErrorResponse::unauthorized();
        assert!(!err.ok);
        assert_eq!(err.error.code, 401);
        assert_eq!(err.error.code_name, "UNAUTHORIZED");
        println!("✓ ErrorResponse::unauthorized works");
    }

    #[test]
    fn test_error_response_forbidden() {
        let err = ErrorResponse::forbidden();
        assert_eq!(err.error.code, 403);
        assert_eq!(err.error.code_name, "FORBIDDEN");
        println!("✓ ErrorResponse::forbidden works");
    }

    #[test]
    fn test_error_response_not_found() {
        let err = ErrorResponse::not_found();
        assert_eq!(err.error.code, 404);
        assert_eq!(err.error.code_name, "NOT_FOUND");
        println!("✓ ErrorResponse::not_found works");
    }

    #[test]
    fn test_error_response_custom() {
        let err = ErrorResponse::new(500, "TEST_ERROR", "Custom error message");
        assert!(!err.ok);
        assert_eq!(err.error.code, 500);
        assert_eq!(err.error.code_name, "TEST_ERROR");
        assert_eq!(err.error.message, "Custom error message");
        println!("✓ ErrorResponse::new works");
    }
}
