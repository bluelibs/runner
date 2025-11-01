use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::{mpsc, oneshot};

use crate::error::{TunnelError, TunnelResult};
use crate::worker_protocol::{WorkerRequest, WorkerResponse};
use serde_json::Value;

type PendingResponses = Arc<Mutex<HashMap<u64, oneshot::Sender<WorkerResponse>>>>;

/// Manages communication with a Node.js worker process via stdin/stdout
pub struct NodeWorker {
    request_id: AtomicU64,
    stdin_tx: mpsc::UnboundedSender<(WorkerRequest, oneshot::Sender<WorkerResponse>)>,
}

impl NodeWorker {
    /// Spawn a new Node.js worker process
    pub fn spawn(script_path: String) -> TunnelResult<Self> {
        let mut child = Command::new("node")
            .arg(&script_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| TunnelError::InternalError(format!("Failed to spawn Node.js worker: {}", e)))?;

        let stdin = child.stdin.take()
            .ok_or_else(|| TunnelError::InternalError("Failed to get worker stdin".to_string()))?;
        let stdout = child.stdout.take()
            .ok_or_else(|| TunnelError::InternalError("Failed to get worker stdout".to_string()))?;

        let (stdin_tx, stdin_rx) = mpsc::unbounded_channel();
        let pending_responses: PendingResponses = Arc::new(Mutex::new(HashMap::new()));

        // Spawn writer task
        Self::spawn_writer_task(stdin, stdin_rx, pending_responses.clone());

        // Spawn reader task
        Self::spawn_reader_task(stdout, pending_responses);

        Ok(Self {
            request_id: AtomicU64::new(1),
            stdin_tx,
        })
    }

    /// Execute a task in the Node.js worker
    pub async fn execute_task(&self, task_id: String, input: Value) -> TunnelResult<Value> {
        let id = self.request_id.fetch_add(1, Ordering::SeqCst);
        let request = WorkerRequest::Task { id, task_id, input };

        let response = self.send_request(request).await?;

        if response.ok {
            Ok(response.result.unwrap_or(Value::Null))
        } else {
            let error_msg = response.error
                .map(|e| e.message)
                .unwrap_or_else(|| "Unknown error".to_string());
            Err(TunnelError::InternalError(error_msg))
        }
    }

    /// Emit an event in the Node.js worker
    pub async fn emit_event(&self, event_id: String, payload: Value) -> TunnelResult<()> {
        let id = self.request_id.fetch_add(1, Ordering::SeqCst);
        let request = WorkerRequest::Event { id, event_id, payload };

        let response = self.send_request(request).await?;

        if response.ok {
            Ok(())
        } else {
            let error_msg = response.error
                .map(|e| e.message)
                .unwrap_or_else(|| "Unknown error".to_string());
            Err(TunnelError::InternalError(error_msg))
        }
    }

    async fn send_request(&self, request: WorkerRequest) -> TunnelResult<WorkerResponse> {
        let (response_tx, response_rx) = oneshot::channel();

        self.stdin_tx.send((request, response_tx))
            .map_err(|_| TunnelError::InternalError("Worker channel closed".to_string()))?;

        response_rx.await
            .map_err(|_| TunnelError::InternalError("Worker response channel closed".to_string()))
    }

    fn spawn_writer_task(
        mut stdin: ChildStdin,
        mut rx: mpsc::UnboundedReceiver<(WorkerRequest, oneshot::Sender<WorkerResponse>)>,
        pending_responses: PendingResponses,
    ) {
        std::thread::spawn(move || {
            while let Some((request, response_tx)) = rx.blocking_recv() {
                let id = request.id();

                // Store the response channel
                pending_responses.lock().unwrap().insert(id, response_tx);

                // Send request to Node.js
                if let Ok(json) = serde_json::to_string(&request) {
                    if stdin.write_all(json.as_bytes()).is_err() {
                        break;
                    }
                    if stdin.write_all(b"\n").is_err() {
                        break;
                    }
                    if stdin.flush().is_err() {
                        break;
                    }
                } else {
                    break;
                }
            }
        });
    }

    fn spawn_reader_task(stdout: ChildStdout, pending_responses: PendingResponses) {
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);

            for line in reader.lines() {
                if let Ok(line) = line {
                    if let Ok(response) = serde_json::from_str::<WorkerResponse>(&line) {
                        // Find and send to the corresponding response channel
                        if let Some(response_tx) = pending_responses.lock().unwrap().remove(&response.id) {
                            let _ = response_tx.send(response);
                        }
                    }
                }
            }
        });
    }
}
