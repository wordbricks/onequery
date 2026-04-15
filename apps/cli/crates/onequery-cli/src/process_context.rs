use std::path::Path;
use std::path::PathBuf;

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;

#[derive(Debug, Clone)]
enum CurrentExecutable {
    Resolved(PathBuf),
    Unavailable(String),
}

#[derive(Debug, Clone)]
pub(crate) struct ProcessContext {
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
    pub(crate) fn capture() -> Self {
        let current_executable = match std::env::current_exe() {
            Ok(current_executable) => CurrentExecutable::Resolved(current_executable),
            Err(error) => CurrentExecutable::Unavailable(error.to_string()),
        };

        Self { current_executable }
    }

    pub(crate) fn current_executable_or_error(
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
