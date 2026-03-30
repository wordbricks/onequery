use std::io;
use std::path::PathBuf;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum WtlError {
    #[error("failed to read the initial request: {0}")]
    ReadRequest(#[source] io::Error),
    #[error("initial request was empty")]
    EmptyRequest,
    #[error("observer output failed: {0}")]
    ObserverIo(#[source] io::Error),
    #[error("failed to start Codex App Server: {0}")]
    SpawnRuntime(#[source] io::Error),
    #[error("Codex App Server stdout was not piped")]
    MissingRuntimeStdout,
    #[error("Codex App Server stdin was not piped")]
    MissingRuntimeStdin,
    #[error("Codex App Server protocol error: {0}")]
    Protocol(String),
    #[error("Codex App Server request failed: {0}")]
    RequestFailed(String),
    #[error("failed to parse Codex App Server message: {0}")]
    ParseMessage(#[source] serde_json::Error),
    #[error("runtime I/O failed: {0}")]
    RuntimeIo(#[source] io::Error),
    #[error("failed to serialize JSON output: {0}")]
    SerializeJson(#[source] serde_json::Error),
    #[error("failed to resolve repository root from {cwd}: {message}")]
    ResolveRepoRoot { cwd: PathBuf, message: String },
    #[error("command failed: {program} {message}")]
    CommandFailed { program: String, message: String },
    #[error("invalid path: {0}")]
    InvalidPath(String),
}

impl WtlError {
    pub fn protocol(message: impl Into<String>) -> Self {
        Self::Protocol(message.into())
    }

    pub fn request_failed(message: impl Into<String>) -> Self {
        Self::RequestFailed(message.into())
    }
}
