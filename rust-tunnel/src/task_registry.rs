use async_trait::async_trait;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::error::{TunnelError, TunnelResult};

/// Trait for task handlers
#[async_trait]
pub trait TaskHandler: Send + Sync {
    async fn execute(&self, input: Value) -> TunnelResult<Value>;
}

/// Trait for event handlers
#[async_trait]
pub trait EventHandler: Send + Sync {
    async fn emit(&self, payload: Value) -> TunnelResult<()>;
}

/// Simple function-based task handler
pub struct FunctionTaskHandler<F>
where
    F: Fn(Value) -> TunnelResult<Value> + Send + Sync,
{
    func: F,
}

impl<F> FunctionTaskHandler<F>
where
    F: Fn(Value) -> TunnelResult<Value> + Send + Sync,
{
    pub fn new(func: F) -> Self {
        Self { func }
    }
}

#[async_trait]
impl<F> TaskHandler for FunctionTaskHandler<F>
where
    F: Fn(Value) -> TunnelResult<Value> + Send + Sync,
{
    async fn execute(&self, input: Value) -> TunnelResult<Value> {
        (self.func)(input)
    }
}

/// Simple function-based event handler
pub struct FunctionEventHandler<F>
where
    F: Fn(Value) -> TunnelResult<()> + Send + Sync,
{
    func: F,
}

impl<F> FunctionEventHandler<F>
where
    F: Fn(Value) -> TunnelResult<()> + Send + Sync,
{
    pub fn new(func: F) -> Self {
        Self { func }
    }
}

#[async_trait]
impl<F> EventHandler for FunctionEventHandler<F>
where
    F: Fn(Value) -> TunnelResult<()> + Send + Sync,
{
    async fn emit(&self, payload: Value) -> TunnelResult<()> {
        (self.func)(payload)
    }
}

/// Registry for tasks and events
pub struct TaskRegistry {
    tasks: Arc<RwLock<HashMap<String, Arc<dyn TaskHandler>>>>,
    events: Arc<RwLock<HashMap<String, Arc<dyn EventHandler>>>>,
}

impl TaskRegistry {
    pub fn new() -> Self {
        Self {
            tasks: Arc::new(RwLock::new(HashMap::new())),
            events: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Register a task handler
    pub async fn register_task(&self, id: impl Into<String>, handler: Arc<dyn TaskHandler>) {
        let mut tasks = self.tasks.write().await;
        tasks.insert(id.into(), handler);
    }

    /// Register a task with a simple function
    pub async fn register_task_fn<F>(&self, id: impl Into<String>, func: F)
    where
        F: Fn(Value) -> TunnelResult<Value> + Send + Sync + 'static,
    {
        self.register_task(id, Arc::new(FunctionTaskHandler::new(func)))
            .await;
    }

    /// Register an event handler
    pub async fn register_event(&self, id: impl Into<String>, handler: Arc<dyn EventHandler>) {
        let mut events = self.events.write().await;
        events.insert(id.into(), handler);
    }

    /// Register an event with a simple function
    pub async fn register_event_fn<F>(&self, id: impl Into<String>, func: F)
    where
        F: Fn(Value) -> TunnelResult<()> + Send + Sync + 'static,
    {
        self.register_event(id, Arc::new(FunctionEventHandler::new(func)))
            .await;
    }

    /// Execute a task
    pub async fn execute_task(&self, id: &str, input: Value) -> TunnelResult<Value> {
        let tasks = self.tasks.read().await;
        let handler = tasks
            .get(id)
            .ok_or_else(|| TunnelError::NotFound)?;

        handler.execute(input).await
    }

    /// Emit an event
    pub async fn emit_event(&self, id: &str, payload: Value) -> TunnelResult<()> {
        let events = self.events.read().await;
        let handler = events
            .get(id)
            .ok_or_else(|| TunnelError::NotFound)?;

        handler.emit(payload).await
    }

    /// Get all registered task IDs
    pub async fn get_task_ids(&self) -> Vec<String> {
        let tasks = self.tasks.read().await;
        tasks.keys().cloned().collect()
    }

    /// Get all registered event IDs
    pub async fn get_event_ids(&self) -> Vec<String> {
        let events = self.events.read().await;
        events.keys().cloned().collect()
    }
}

impl Default for TaskRegistry {
    fn default() -> Self {
        Self::new()
    }
}
