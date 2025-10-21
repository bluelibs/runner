pub mod auth;
pub mod error;
pub mod handlers;
pub mod models;
pub mod task_registry;

use axum::{
    middleware,
    routing::{get, post},
    Router,
};
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use auth::{auth_middleware, AuthConfig};
use handlers::{handle_discovery, handle_event, handle_task, AppState};
use models::TunnelConfig;
use task_registry::TaskRegistry;

/// Creates a new tunnel server with the given configuration and task registry
pub fn create_tunnel_app(config: TunnelConfig, registry: TaskRegistry) -> Router {
    // Create shared state
    let state = Arc::new(AppState::new(config.clone(), registry));

    // Create auth config
    let auth_config = AuthConfig {
        token: config.auth_token.clone(),
        header: config.auth_header.clone(),
    };

    // Create CORS layer
    let cors = if let Some(origin) = &config.cors_origin {
        if origin == "*" {
            CorsLayer::permissive()
        } else {
            CorsLayer::new()
                .allow_origin(origin.parse::<axum::http::HeaderValue>().unwrap())
                .allow_methods(Any)
                .allow_headers(Any)
        }
    } else {
        CorsLayer::permissive()
    };

    // Build router with base path
    let api_routes = Router::new()
        .route("/task/:task_id", post(handle_task))
        .route("/event/:event_id", post(handle_event))
        .route("/discovery", get(handle_discovery).post(handle_discovery))
        .layer(middleware::from_fn(move |req, next| {
            auth_middleware(auth_config.clone(), req, next)
        }))
        .with_state(state);

    // Nest under base path
    Router::new()
        .nest(&config.base_path, api_routes)
        .layer(cors)
        .layer(tower_http::trace::TraceLayer::new_for_http())
}

/// Initialize tracing (call once at startup)
pub fn init_tracing() {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "rust_tunnel=info,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();
}

/// Starts the tunnel server with the given configuration and registry
pub async fn start_tunnel_server(
    config: TunnelConfig,
    registry: TaskRegistry,
) -> Result<(), Box<dyn std::error::Error>> {
    let app = create_tunnel_app(config.clone(), registry);

    let addr = format!("0.0.0.0:{}", config.port);
    tracing::info!("Starting tunnel server on {} (base path: {})", addr, config.base_path);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
