use rust_tunnel::{
    init_tracing,
    models::TunnelConfig,
    start_tunnel_server,
    task_registry::TaskRegistry,
};
use serde_json::{json, Value};

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
        ],
        allowed_events: vec![
            "app.events.notify".to_string(),
            "app.events.log".to_string(),
        ],
        cors_origin: Some("*".to_string()),
    };

    // Create task registry
    let registry = TaskRegistry::new();

    // Register sample tasks
    registry.register_task_fn("app.tasks.add", |input: Value| {
        // Extract numbers from input
        let a = input["a"].as_i64().unwrap_or(0);
        let b = input["b"].as_i64().unwrap_or(0);
        let result = a + b;

        println!("Task: add({}, {}) = {}", a, b, result);
        Ok(json!(result))
    }).await;

    registry.register_task_fn("app.tasks.greet", |input: Value| {
        let name = input["name"].as_str().unwrap_or("World");
        let greeting = format!("Hello, {}!", name);

        println!("Task: greet({}) = {}", name, greeting);
        Ok(json!(greeting))
    }).await;

    registry.register_task_fn("app.tasks.echo", |input: Value| {
        println!("Task: echo({:?})", input);
        Ok(input)
    }).await;

    // Register sample events
    registry.register_event_fn("app.events.notify", |payload: Value| {
        println!("Event: notify - {:?}", payload);
        Ok(())
    }).await;

    registry.register_event_fn("app.events.log", |payload: Value| {
        let message = payload["message"].as_str().unwrap_or("(no message)");
        println!("Event: log - {}", message);
        Ok(())
    }).await;

    // Start the server
    println!("Starting Rust Tunnel Server...");
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
    println!("\n  # Greet task:");
    println!("  curl -X POST http://localhost:7070/__runner/task/app.tasks.greet \\");
    println!("    -H 'x-runner-token: secret' \\");
    println!("    -H 'Content-Type: application/json' \\");
    println!("    -d '{{\"input\": {{\"name\": \"Alice\"}}}}'");
    println!("\n  # Notify event:");
    println!("  curl -X POST http://localhost:7070/__runner/event/app.events.notify \\");
    println!("    -H 'x-runner-token: secret' \\");
    println!("    -H 'Content-Type: application/json' \\");
    println!("    -d '{{\"payload\": {{\"message\": \"Hello from event!\"}}}}'");
    println!("\n  # Discovery:");
    println!("  curl -X GET http://localhost:7070/__runner/discovery \\");
    println!("    -H 'x-runner-token: secret'");
    println!("\n");

    start_tunnel_server(config, registry).await
}
