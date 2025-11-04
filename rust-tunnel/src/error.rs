use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};

use crate::models::ErrorResponse;

/// Custom error type for tunnel operations
#[derive(Debug)]
pub enum TunnelError {
    Unauthorized,
    Forbidden,
    NotFound,
    MethodNotAllowed,
    InvalidJson(String),
    InternalError(String),
}

impl IntoResponse for TunnelError {
    fn into_response(self) -> Response {
        let (status, error_response) = match self {
            TunnelError::Unauthorized => (StatusCode::UNAUTHORIZED, ErrorResponse::unauthorized()),
            TunnelError::Forbidden => (StatusCode::FORBIDDEN, ErrorResponse::forbidden()),
            TunnelError::NotFound => (StatusCode::NOT_FOUND, ErrorResponse::not_found()),
            TunnelError::MethodNotAllowed => {
                (StatusCode::METHOD_NOT_ALLOWED, ErrorResponse::method_not_allowed())
            }
            TunnelError::InvalidJson(msg) => {
                (StatusCode::BAD_REQUEST, ErrorResponse::invalid_json(msg))
            }
            TunnelError::InternalError(msg) => {
                (StatusCode::INTERNAL_SERVER_ERROR, ErrorResponse::internal_error(msg))
            }
        };

        (status, Json(error_response)).into_response()
    }
}

impl From<serde_json::Error> for TunnelError {
    fn from(err: serde_json::Error) -> Self {
        TunnelError::InvalidJson(err.to_string())
    }
}

/// Result type for tunnel operations
pub type TunnelResult<T> = Result<T, TunnelError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tunnel_error_unauthorized() {
        let err = TunnelError::Unauthorized;
        assert!(matches!(err, TunnelError::Unauthorized));
    }

    #[test]
    fn test_tunnel_error_forbidden() {
        let err = TunnelError::Forbidden;
        assert!(matches!(err, TunnelError::Forbidden));
    }

    #[test]
    fn test_tunnel_error_not_found() {
        let err = TunnelError::NotFound;
        assert!(matches!(err, TunnelError::NotFound));
    }

    #[test]
    fn test_tunnel_error_method_not_allowed() {
        let err = TunnelError::MethodNotAllowed;
        assert!(matches!(err, TunnelError::MethodNotAllowed));
    }

    #[test]
    fn test_tunnel_error_invalid_json() {
        let err = TunnelError::InvalidJson("test error".to_string());
        match err {
            TunnelError::InvalidJson(msg) => assert_eq!(msg, "test error"),
            _ => panic!("Expected InvalidJson variant"),
        }
    }

    #[test]
    fn test_tunnel_error_internal_error() {
        let err = TunnelError::InternalError("internal issue".to_string());
        match err {
            TunnelError::InternalError(msg) => assert_eq!(msg, "internal issue"),
            _ => panic!("Expected InternalError variant"),
        }
    }

    #[test]
    fn test_from_serde_json_error() {
        let json_err = serde_json::from_str::<serde_json::Value>("invalid json").unwrap_err();
        let tunnel_err: TunnelError = json_err.into();
        assert!(matches!(tunnel_err, TunnelError::InvalidJson(_)));
    }

    #[test]
    fn test_tunnel_result_ok() {
        let result: TunnelResult<i32> = Ok(42);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 42);
    }

    #[test]
    fn test_tunnel_result_err() {
        let result: TunnelResult<i32> = Err(TunnelError::NotFound);
        assert!(result.is_err());
    }

    #[test]
    fn test_error_debug_format() {
        let err = TunnelError::InvalidJson("test".to_string());
        let debug_str = format!("{:?}", err);
        assert!(debug_str.contains("InvalidJson"));
        assert!(debug_str.contains("test"));
    }
}
