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
