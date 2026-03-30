use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use serde_json::json;
use tokio::io::AsyncBufReadExt;
use tokio::io::AsyncReadExt;
use tokio::io::AsyncWriteExt;
use tokio::process::Child;
use tokio::process::ChildStdin;
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::sync::mpsc;
use tokio::sync::oneshot;

use crate::error::WtlError;
use crate::observer::Observer;
use crate::policy::ExecutionPlan;

use super::TurnFailure;
use super::TurnOutcome;
use super::TurnRuntime;

#[derive(Debug, Clone)]
pub struct CodexRuntimeConfig {
    pub cwd: PathBuf,
    pub codex_bin: String,
    pub model: String,
    pub turn_timeout: Duration,
    pub approval_policy: String,
    pub sandbox: String,
}

impl CodexRuntimeConfig {
    pub fn from_env(cwd: PathBuf) -> Self {
        Self {
            cwd,
            codex_bin: std::env::var("WTL_CODEX_BIN").unwrap_or_else(|_| "codex".to_owned()),
            model: std::env::var("WTL_CODEX_MODEL").unwrap_or_else(|_| "gpt-5.4".to_owned()),
            turn_timeout: Duration::from_secs(
                std::env::var("WTL_TURN_TIMEOUT_SEC")
                    .ok()
                    .and_then(|value| value.parse::<u64>().ok())
                    .unwrap_or(45),
            ),
            approval_policy: std::env::var("WTL_APPROVAL_POLICY")
                .unwrap_or_else(|_| "never".to_owned()),
            sandbox: std::env::var("WTL_SANDBOX").unwrap_or_else(|_| "workspace-write".to_owned()),
        }
    }
}

#[derive(Debug)]
pub struct CodexAppServerRuntime {
    config: CodexRuntimeConfig,
    child: Child,
    stdin: ChildStdin,
    notifications: mpsc::UnboundedReceiver<Value>,
    pending_requests: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, WtlError>>>>>,
    next_request_id: u64,
    shutdown_started: bool,
}

impl CodexAppServerRuntime {
    pub async fn connect(config: CodexRuntimeConfig) -> Result<Self, WtlError> {
        let mut command = Command::new(&config.codex_bin);
        command
            .arg("--config")
            .arg("shell_environment_policy.inherit=all")
            .arg("--config")
            .arg("model_reasoning_effort=high")
            .arg("--model")
            .arg(&config.model)
            .arg("app-server")
            .current_dir(&config.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = command.spawn().map_err(WtlError::SpawnRuntime)?;
        let stdin = child.stdin.take().ok_or(WtlError::MissingRuntimeStdin)?;
        let stdout = child.stdout.take().ok_or(WtlError::MissingRuntimeStdout)?;
        let stderr = child.stderr.take().ok_or(WtlError::MissingRuntimeStdout)?;

        let pending_requests: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, WtlError>>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let (notification_tx, notification_rx) = mpsc::unbounded_channel();

        tokio::spawn(read_stdout_loop(
            stdout,
            Arc::clone(&pending_requests),
            notification_tx,
        ));
        tokio::spawn(read_stderr_loop(stderr));

        let mut runtime = Self {
            config,
            child,
            stdin,
            notifications: notification_rx,
            pending_requests,
            next_request_id: 1,
            shutdown_started: false,
        };

        runtime.initialize().await?;
        Ok(runtime)
    }

    async fn initialize(&mut self) -> Result<(), WtlError> {
        let _ = self
            .request(
                "initialize",
                json!({
                    "clientInfo": {
                        "name": "wtl",
                        "title": "WhatTheLoop CLI",
                        "version": env!("CARGO_PKG_VERSION"),
                    }
                }),
            )
            .await?;

        self.notify("initialized", json!({})).await
    }

    async fn request(&mut self, method: &str, params: Value) -> Result<Value, WtlError> {
        let id = self.next_request_id;
        self.next_request_id += 1;

        let (tx, rx) = oneshot::channel();
        self.pending_requests.lock().await.insert(id, tx);

        let payload = json!({
            "id": id,
            "method": method,
            "params": params,
        });
        tracing::debug!(request_id = id, method, "sending JSON-RPC request");
        self.write_message(&payload).await?;

        match rx.await {
            Ok(result) => result,
            Err(_recv_error) => Err(WtlError::protocol(format!(
                "{method} response channel closed unexpectedly"
            ))),
        }
    }

    async fn notify(&mut self, method: &str, params: Value) -> Result<(), WtlError> {
        let payload = json!({
            "method": method,
            "params": params,
        });
        tracing::debug!(method, "sending JSON-RPC notification");
        self.write_message(&payload).await
    }

    async fn write_message(&mut self, payload: &Value) -> Result<(), WtlError> {
        let line = serde_json::to_string(payload).map_err(WtlError::ParseMessage)?;
        self.stdin
            .write_all(line.as_bytes())
            .await
            .map_err(WtlError::RuntimeIo)?;
        self.stdin
            .write_all(b"\n")
            .await
            .map_err(WtlError::RuntimeIo)?;
        self.stdin.flush().await.map_err(WtlError::RuntimeIo)
    }

    fn cwd_string(&self) -> String {
        self.config.cwd.to_string_lossy().into_owned()
    }
}

impl TurnRuntime for CodexAppServerRuntime {
    async fn start_session(&mut self, developer_instructions: &str) -> Result<String, WtlError> {
        let response = self
            .request(
                "thread/start",
                json!({
                    "approvalPolicy": self.config.approval_policy.clone(),
                    "cwd": self.cwd_string(),
                    "developerInstructions": developer_instructions,
                    "model": self.config.model.clone(),
                    "personality": "pragmatic",
                    "sandbox": self.config.sandbox.clone(),
                    "serviceName": "wtl",
                }),
            )
            .await?;

        response
            .pointer("/thread/id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .ok_or_else(|| WtlError::protocol("thread/start response did not contain thread.id"))
    }

    async fn run_turn<O>(
        &mut self,
        thread_id: &str,
        plan: &ExecutionPlan,
        observer: &mut O,
    ) -> Result<TurnOutcome, WtlError>
    where
        O: Observer,
    {
        let response = self
            .request(
                "turn/start",
                json!({
                    "cwd": self.cwd_string(),
                    "input": [{ "type": "text", "text": plan.prompt }],
                    "threadId": thread_id,
                }),
            )
            .await?;

        let turn_id = response
            .pointer("/turn/id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .ok_or_else(|| WtlError::protocol("turn/start response did not contain turn.id"))?;

        let mut aggregated_output = String::new();
        let timeout = tokio::time::sleep(self.config.turn_timeout);
        tokio::pin!(timeout);

        loop {
            let message = tokio::select! {
                maybe_message = self.notifications.recv() => {
                    match maybe_message {
                        Some(message) => message,
                        None => {
                            return Err(WtlError::protocol(
                                "notification stream ended before turn/completed arrived",
                            ));
                        }
                    }
                }
                _ = &mut timeout => {
                    return Ok(TurnOutcome::Failure(TurnFailure {
                        message: format!(
                            "turn timed out after {} seconds",
                            self.config.turn_timeout.as_secs()
                        ),
                        code: None,
                    }));
                }
            };

            let Some(method) = message.get("method").and_then(Value::as_str) else {
                continue;
            };

            match method {
                "item/agentMessage/delta" => {
                    let params = &message["params"];
                    if params.get("threadId").and_then(Value::as_str) != Some(thread_id)
                        || params.get("turnId").and_then(Value::as_str) != Some(turn_id.as_str())
                    {
                        continue;
                    }

                    if let Some(delta) = params.get("delta").and_then(Value::as_str) {
                        tracing::debug!(
                            turn_id = turn_id.as_str(),
                            delta_len = delta.len(),
                            "received agent delta"
                        );
                        aggregated_output.push_str(delta);
                        observer.on_turn_delta(delta)?;
                    }
                }
                "turn/completed" => {
                    let params = &message["params"];
                    if params.get("threadId").and_then(Value::as_str) != Some(thread_id)
                        || params.pointer("/turn/id").and_then(Value::as_str)
                            != Some(turn_id.as_str())
                    {
                        continue;
                    }

                    let status = params
                        .pointer("/turn/status")
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            WtlError::protocol(
                                "turn/completed notification was missing turn.status",
                            )
                        })?;

                    tracing::debug!(
                        turn_id = turn_id.as_str(),
                        status,
                        "received turn completion"
                    );
                    return match status {
                        "completed" => Ok(TurnOutcome::Success {
                            response: aggregated_output,
                        }),
                        "failed" => {
                            let message = params
                                .pointer("/turn/error/message")
                                .and_then(Value::as_str)
                                .unwrap_or("Codex App Server reported a failed turn");
                            let code = params
                                .pointer("/turn/error/codexErrorInfo")
                                .and_then(Value::as_str)
                                .or_else(|| {
                                    params
                                        .pointer("/turn/codexErrorInfo")
                                        .and_then(Value::as_str)
                                })
                                .map(ToOwned::to_owned);
                            Ok(TurnOutcome::Failure(TurnFailure {
                                message: message.to_owned(),
                                code,
                            }))
                        }
                        "interrupted" => Ok(TurnOutcome::Failure(TurnFailure {
                            message: "turn interrupted".to_owned(),
                            code: None,
                        })),
                        other => Err(WtlError::protocol(format!(
                            "unsupported turn completion status: {other}"
                        ))),
                    };
                }
                _ => {
                    tracing::trace!(method, "ignoring app-server notification");
                    continue;
                }
            }
        }
    }

    async fn shutdown(&mut self) -> Result<(), WtlError> {
        if self.shutdown_started {
            return Ok(());
        }
        self.shutdown_started = true;

        if let Err(error) = self.child.start_kill()
            && error.kind() != std::io::ErrorKind::InvalidInput
        {
            return Err(WtlError::RuntimeIo(error));
        }

        let _status = self.child.wait().await.map_err(WtlError::RuntimeIo)?;
        Ok(())
    }
}

async fn read_stdout_loop(
    stdout: tokio::process::ChildStdout,
    pending_requests: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, WtlError>>>>>,
    notification_tx: mpsc::UnboundedSender<Value>,
) {
    let mut lines = tokio::io::BufReader::new(stdout).lines();

    loop {
        match lines.next_line().await {
            Ok(Some(line)) => match serde_json::from_str::<Value>(&line) {
                Ok(message) => {
                    if let Some(id) = message.get("id").and_then(Value::as_u64) {
                        tracing::debug!(request_id = id, "received JSON-RPC response");
                        let sender = pending_requests.lock().await.remove(&id);
                        if let Some(sender) = sender {
                            let response = if let Some(result) = message.get("result") {
                                Ok(result.clone())
                            } else if let Some(error) = message.get("error") {
                                Err(WtlError::request_failed(
                                    error
                                        .get("message")
                                        .and_then(Value::as_str)
                                        .unwrap_or("unknown JSON-RPC error"),
                                ))
                            } else {
                                Err(WtlError::protocol(
                                    "JSON-RPC response did not contain result or error",
                                ))
                            };
                            let _ = sender.send(response);
                        }
                    } else {
                        if let Some(method) = message.get("method").and_then(Value::as_str) {
                            tracing::trace!(method, "received JSON-RPC notification");
                        }
                        let _ = notification_tx.send(message);
                    }
                }
                Err(error) => {
                    tracing::error!(error = %error, "failed to parse JSON-RPC message from stdout");
                    fail_pending_requests(
                        Arc::clone(&pending_requests),
                        WtlError::ParseMessage(error),
                    )
                    .await;
                    break;
                }
            },
            Ok(None) => {
                tracing::error!("Codex App Server stdout closed");
                fail_pending_requests(
                    Arc::clone(&pending_requests),
                    WtlError::protocol("Codex App Server stdout closed"),
                )
                .await;
                break;
            }
            Err(error) => {
                tracing::error!(error = %error, "failed reading Codex App Server stdout");
                fail_pending_requests(Arc::clone(&pending_requests), WtlError::RuntimeIo(error))
                    .await;
                break;
            }
        }
    }
}

async fn fail_pending_requests(
    pending_requests: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, WtlError>>>>>,
    error: WtlError,
) {
    let mut pending = pending_requests.lock().await;
    for (_, sender) in pending.drain() {
        let _ = sender.send(Err(WtlError::protocol(error.to_string())));
    }
}

async fn read_stderr_loop(mut stderr: tokio::process::ChildStderr) {
    let mut sink = Vec::new();
    let _ = stderr.read_to_end(&mut sink).await;
}
