use axum::{
    extract::Request,
    http::HeaderMap,
    middleware::Next,
    response::Response,
};

use crate::error::{TunnelError, TunnelResult};

/// Authentication configuration
#[derive(Clone)]
pub struct AuthConfig {
    pub token: String,
    pub header: String,
}

/// Validates authentication token from request headers
pub fn validate_auth(headers: &HeaderMap, config: &AuthConfig) -> TunnelResult<()> {
    let token = headers
        .get(&config.header)
        .and_then(|v| v.to_str().ok())
        .ok_or(TunnelError::Unauthorized)?;

    if token != config.token {
        return Err(TunnelError::Unauthorized);
    }

    Ok(())
}

/// Middleware function for authentication
pub async fn auth_middleware(
    config: AuthConfig,
    request: Request,
    next: Next,
) -> Result<Response, TunnelError> {
    // Skip auth for OPTIONS (CORS preflight)
    if request.method() == "OPTIONS" {
        return Ok(next.run(request).await);
    }

    validate_auth(request.headers(), &config)?;
    Ok(next.run(request).await)
}
