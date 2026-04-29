//! Captured process metadata shared by CLI command crates.

use std::path::Path;
use std::path::PathBuf;

use crate::error::CliError;
use crate::error::ErrorStage;

#[derive(Debug, Clone)]
enum CurrentExecutable {
    Resolved(PathBuf),
    Unavailable(String),
}

#[derive(Debug, Clone)]
/// Captured process metadata used by commands that need current executable details.
pub struct ProcessContext {
    current_executable: CurrentExecutable,
}

impl Default for ProcessContext {
    fn default() -> Self {
        Self {
            current_executable: CurrentExecutable::Unavailable(
                "process context was not captured".to_owned(),
            ),
        }
    }
}

impl ProcessContext {
    /// Captures process metadata from the current process.
    pub fn capture() -> Self {
        let current_executable = match std::env::current_exe() {
            Ok(current_executable) => CurrentExecutable::Resolved(current_executable),
            Err(error) => CurrentExecutable::Unavailable(error.to_string()),
        };

        Self { current_executable }
    }

    /// Returns the captured current executable path or a structured CLI error.
    pub fn current_executable_or_error(
        &self,
        title: &str,
        command_line: &str,
        stage: ErrorStage,
        try_next: Vec<String>,
    ) -> Result<&Path, CliError> {
        match &self.current_executable {
            CurrentExecutable::Resolved(current_executable) => Ok(current_executable.as_path()),
            CurrentExecutable::Unavailable(error) => Err(CliError::new(
                title,
                command_line,
                stage,
                format!("failed to read current executable path: {error}"),
                try_next,
            )),
        }
    }
}
