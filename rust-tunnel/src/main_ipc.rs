use rust_tunnel::{
    init_tracing,
    models::TunnelConfig,
    start_tunnel_server_ipc,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging
    init_tracing();

    // Create configuration
    let config = TunnelConfig {
        base_path: "/__runner".to_string(),
        port: 7070,
        auth_token: "secret".to_string(),
        auth_header: "x-runner-token".to_string(),
        allowed_tasks: vec![
            "app.tasks.add".to_string(),
            "app.tasks.greet".to_string(),
            "app.tasks.echo".to_string(),
            "app.tasks.admin.delete".to_string(),
        ],
        allowed_events: vec![
            "app.events.notify".to_string(),
            "app.events.log".to_string(),
        ],
        cors_origin: Some("*".to_string()),
        delegate_auth: true,  // Node.js handles auth!
    };

    println!("🦀 Starting Rust HTTP Server + Node.js Worker (IPC)");
    println!("===================================================");
    println!();
    println!("Architecture:");
    println!("  HTTP Request → [Rust] → IPC → [Node.js]");
    println!("                   ↓             ↓");
    println!("                 HTTP          Auth Logic");
    println!("                 CORS          Task Execution");
    println!("                 JSON          Your Code");
    println!();
    println!("Auth: DELEGATED to Node.js (flexible, customizable)");
    println!();
    println!("Base path: {}", config.base_path);
    println!("Port: {}", config.port);
    println!("Auth token: {}", config.auth_token);
    println!("\nRegistered tasks:");
    for task in &config.allowed_tasks {
        println!("  - {}", task);
    }
    println!("\nRegistered events:");
    for event in &config.allowed_events {
        println!("  - {}", event);
    }
    println!("\nExample curl commands:");
    println!("  # Add task:");
    println!("  curl -X POST http://localhost:7070/__runner/task/app.tasks.add \\");
    println!("    -H 'x-runner-token: secret' \\");
    println!("    -H 'Content-Type: application/json' \\");
    println!("    -d '{{\"input\": {{\"a\": 5, \"b\": 3}}}}'");
    println!();

    // Path to the Node.js worker script
    // Use flexible auth worker which supports JWT, API keys, OAuth, RBAC, etc.
    let worker_script = "node-worker-flexible-auth.js".to_string();

    // Start the IPC server
    start_tunnel_server_ipc(config, worker_script).await
}
