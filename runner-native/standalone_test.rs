// Comprehensive standalone Rust protocol tests
// Tests all protocol types and error handling without external dependencies

#![allow(dead_code)]

use std::collections::HashMap;

// ============================================================================
// PROTOCOL TYPES (Simplified versions without serde)
// ============================================================================

#[derive(Debug, Clone, PartialEq)]
pub struct SuccessResponse<T> {
    pub ok: bool,
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

#[derive(Debug, Clone, PartialEq)]
pub struct ErrorDetails {
    pub code: u16,
    pub message: String,
    pub code_name: String,
}

#[derive(Debug, Clone, PartialEq)]
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

#[derive(Debug, PartialEq)]
pub enum TunnelError {
    Unauthorized,
    Forbidden,
    NotFound,
    MethodNotAllowed,
    InvalidJson(String),
    InternalError(String),
}

impl TunnelError {
    pub fn to_http_status(&self) -> u16 {
        match self {
            TunnelError::Unauthorized => 401,
            TunnelError::Forbidden => 403,
            TunnelError::NotFound => 404,
            TunnelError::MethodNotAllowed => 405,
            TunnelError::InvalidJson(_) => 400,
            TunnelError::InternalError(_) => 500,
        }
    }

    pub fn to_error_response(&self) -> ErrorResponse {
        match self {
            TunnelError::Unauthorized => ErrorResponse::unauthorized(),
            TunnelError::Forbidden => ErrorResponse::forbidden(),
            TunnelError::NotFound => ErrorResponse::not_found(),
            TunnelError::MethodNotAllowed => ErrorResponse::method_not_allowed(),
            TunnelError::InvalidJson(msg) => ErrorResponse::invalid_json(msg.clone()),
            TunnelError::InternalError(msg) => ErrorResponse::internal_error(msg.clone()),
        }
    }
}

pub type TunnelResult<T> = Result<T, TunnelError>;

#[derive(Debug, Clone)]
pub struct TunnelConfig {
    pub base_path: String,
    pub port: u16,
    pub cors_origins: Vec<String>,
}

impl Default for TunnelConfig {
    fn default() -> Self {
        Self {
            base_path: "/__runner".to_string(),
            port: 7070,
            cors_origins: vec!["*".to_string()],
        }
    }
}

#[derive(Debug, Clone)]
pub struct AllowList {
    pub enabled: bool,
    pub tasks: Vec<String>,
    pub events: Vec<String>,
}

impl AllowList {
    pub fn contains_task(&self, task_id: &str) -> bool {
        !self.enabled || self.tasks.iter().any(|t| t == task_id)
    }

    pub fn contains_event(&self, event_id: &str) -> bool {
        !self.enabled || self.events.iter().any(|e| e == event_id)
    }
}

// ============================================================================
// TESTS
// ============================================================================

fn test_success_response_new() {
    let resp = SuccessResponse::new(42);
    assert!(resp.ok);
    assert_eq!(resp.result, Some(42));
    println!("✓ SuccessResponse::new");
}

fn test_success_response_empty() {
    let resp: SuccessResponse<i32> = SuccessResponse::empty();
    assert!(resp.ok);
    assert_eq!(resp.result, None);
    println!("✓ SuccessResponse::empty");
}

fn test_error_response_all_variants() {
    let err = ErrorResponse::unauthorized();
    assert!(!err.ok);
    assert_eq!(err.error.code, 401);
    assert_eq!(err.error.code_name, "UNAUTHORIZED");

    let err = ErrorResponse::forbidden();
    assert_eq!(err.error.code, 403);
    assert_eq!(err.error.code_name, "FORBIDDEN");

    let err = ErrorResponse::not_found();
    assert_eq!(err.error.code, 404);
    assert_eq!(err.error.code_name, "NOT_FOUND");

    let err = ErrorResponse::method_not_allowed();
    assert_eq!(err.error.code, 405);
    assert_eq!(err.error.code_name, "METHOD_NOT_ALLOWED");

    let err = ErrorResponse::invalid_json("Bad JSON");
    assert_eq!(err.error.code, 400);
    assert!(err.error.message.contains("Bad JSON"));

    let err = ErrorResponse::internal_error("Server error");
    assert_eq!(err.error.code, 500);
    assert!(err.error.message.contains("Server error"));

    println!("✓ All ErrorResponse variants");
}

fn test_tunnel_error_to_http_status() {
    assert_eq!(TunnelError::Unauthorized.to_http_status(), 401);
    assert_eq!(TunnelError::Forbidden.to_http_status(), 403);
    assert_eq!(TunnelError::NotFound.to_http_status(), 404);
    assert_eq!(TunnelError::MethodNotAllowed.to_http_status(), 405);
    assert_eq!(TunnelError::InvalidJson("test".into()).to_http_status(), 400);
    assert_eq!(TunnelError::InternalError("test".into()).to_http_status(), 500);
    println!("✓ TunnelError HTTP status codes");
}

fn test_tunnel_error_to_error_response() {
    let err = TunnelError::Unauthorized;
    let resp = err.to_error_response();
    assert!(!resp.ok);
    assert_eq!(resp.error.code, 401);

    let err = TunnelError::InvalidJson("Bad format".to_string());
    let resp = err.to_error_response();
    assert_eq!(resp.error.code, 400);
    assert!(resp.error.message.contains("Bad format"));

    println!("✓ TunnelError to ErrorResponse conversion");
}

fn test_tunnel_result_ok() {
    let result: TunnelResult<i32> = Ok(42);
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), 42);
    println!("✓ TunnelResult Ok");
}

fn test_tunnel_result_err() {
    let result: TunnelResult<i32> = Err(TunnelError::NotFound);
    assert!(result.is_err());
    if let Err(err) = result {
        assert_eq!(err.to_http_status(), 404);
    }
    println!("✓ TunnelResult Err");
}

fn test_tunnel_config_default() {
    let config = TunnelConfig::default();
    assert_eq!(config.base_path, "/__runner");
    assert_eq!(config.port, 7070);
    assert_eq!(config.cors_origins.len(), 1);
    assert_eq!(config.cors_origins[0], "*");
    println!("✓ TunnelConfig default values");
}

fn test_tunnel_config_custom() {
    let config = TunnelConfig {
        base_path: "/api".to_string(),
        port: 8080,
        cors_origins: vec!["http://localhost:3000".to_string()],
    };
    assert_eq!(config.base_path, "/api");
    assert_eq!(config.port, 8080);
    println!("✓ TunnelConfig custom values");
}

fn test_allow_list_contains_task() {
    let allow_list = AllowList {
        enabled: true,
        tasks: vec!["task1".to_string(), "task2".to_string()],
        events: vec![],
    };
    assert!(allow_list.contains_task("task1"));
    assert!(allow_list.contains_task("task2"));
    assert!(!allow_list.contains_task("task3"));
    println!("✓ AllowList task checking");
}

fn test_allow_list_disabled() {
    let allow_list = AllowList {
        enabled: false,
        tasks: vec![],
        events: vec![],
    };
    // When disabled, all tasks/events are allowed
    assert!(allow_list.contains_task("any_task"));
    assert!(allow_list.contains_event("any_event"));
    println!("✓ AllowList when disabled");
}

fn test_error_response_equality() {
    let err1 = ErrorResponse::not_found();
    let err2 = ErrorResponse::not_found();
    assert_eq!(err1, err2);
    println!("✓ ErrorResponse equality");
}

fn test_success_response_with_string() {
    let resp = SuccessResponse::new("Hello, World!".to_string());
    assert!(resp.ok);
    assert_eq!(resp.result, Some("Hello, World!".to_string()));
    println!("✓ SuccessResponse with String");
}

fn test_error_custom_code() {
    let err = ErrorResponse::new(418, "IM_A_TEAPOT", "I'm a teapot");
    assert_eq!(err.error.code, 418);
    assert_eq!(err.error.code_name, "IM_A_TEAPOT");
    assert_eq!(err.error.message, "I'm a teapot");
    println!("✓ Custom error codes");
}

fn test_tunnel_error_pattern_matching() {
    let error = TunnelError::InvalidJson("syntax error".to_string());
    match error {
        TunnelError::InvalidJson(msg) => {
            assert_eq!(msg, "syntax error");
            println!("✓ Pattern matching on TunnelError");
        }
        _ => panic!("Expected InvalidJson variant"),
    }
}

// ============================================================================
// MAIN
// ============================================================================

fn main() {
    println!("\n🦀 Rust Protocol Test Suite (No External Dependencies)");
    println!("{}", "=".repeat(70));
    println!();

    let tests: Vec<(&str, fn())> = vec![
        ("SuccessResponse::new", test_success_response_new),
        ("SuccessResponse::empty", test_success_response_empty),
        ("ErrorResponse variants", test_error_response_all_variants),
        ("TunnelError HTTP codes", test_tunnel_error_to_http_status),
        ("Error conversion", test_tunnel_error_to_error_response),
        ("TunnelResult Ok", test_tunnel_result_ok),
        ("TunnelResult Err", test_tunnel_result_err),
        ("TunnelConfig defaults", test_tunnel_config_default),
        ("TunnelConfig custom", test_tunnel_config_custom),
        ("AllowList task checking", test_allow_list_contains_task),
        ("AllowList disabled", test_allow_list_disabled),
        ("ErrorResponse equality", test_error_response_equality),
        ("SuccessResponse String", test_success_response_with_string),
        ("Custom error codes", test_error_custom_code),
        ("Pattern matching", test_tunnel_error_pattern_matching),
    ];

    let mut passed = 0;
    let mut failed = 0;

    for (name, test_fn) in tests {
        print!("  Testing: {:.<50} ", name);
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(test_fn)) {
            Ok(_) => {
                passed += 1;
            }
            Err(e) => {
                println!("✗ FAILED");
                if let Some(msg) = e.downcast_ref::<&str>() {
                    println!("    Error: {}", msg);
                } else if let Some(msg) = e.downcast_ref::<String>() {
                    println!("    Error: {}", msg);
                }
                failed += 1;
            }
        }
    }

    println!();
    println!("{}", "=".repeat(70));
    println!("\n📊 Protocol Test Results:");
    println!("   ✓ Passed:  {}", passed);
    println!("   ✗ Failed:  {}", failed);
    println!("   📝 Total:   {}", passed + failed);

    if failed == 0 {
        println!("\n🎉 All protocol tests passed!");
        println!("   Core error handling:     ✅");
        println!("   Protocol types:          ✅");
        println!("   HTTP status codes:       ✅");
        println!("   Allow-list logic:        ✅");
        println!("   Error conversions:       ✅\n");
        std::process::exit(0);
    } else {
        println!("\n💥 {} test(s) failed\n", failed);
        std::process::exit(1);
    }
}
