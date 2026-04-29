//! CLI path argument resolution helpers.

use std::io;
use std::path::Path;
use std::path::PathBuf;

use crate::error::CliError;
use crate::error::ErrorStage;
use onequery_utils_absolute_path::AbsolutePathBuf;

/// Resolves a user-supplied CLI path into an absolute path or a structured CLI error.
pub fn resolve_user_path_for_cli(
    path: &Path,
    command_line: &str,
    stage: ErrorStage,
    title: impl Into<String>,
    try_next: Vec<String>,
) -> Result<PathBuf, CliError> {
    match AbsolutePathBuf::from_absolute_path(path) {
        Ok(path) => Ok(path.into_path_buf()),
        Err(error) => Err(CliError::new(
            title,
            command_line,
            stage,
            format!("{error} ({})", path.display()),
            try_next,
        )),
    }
}

/// Resolves and validates a directory supplied through an environment variable.
pub fn resolve_env_directory_for_cli(
    env_name: &str,
    path: &Path,
    command_line: &str,
    stage: ErrorStage,
    title: &str,
    try_next: Vec<String>,
) -> Result<PathBuf, CliError> {
    let resolved_path =
        resolve_user_path_for_cli(path, command_line, stage, title, try_next.clone())?;
    let build_error = |why: String| {
        CliError::new(
            title.to_owned(),
            command_line.to_owned(),
            stage,
            why,
            try_next.clone(),
        )
    };

    let metadata = std::fs::metadata(&resolved_path).map_err(|error| match error.kind() {
        io::ErrorKind::NotFound => build_error(format!(
            "{env_name} points to {}, but that path does not exist",
            resolved_path.display()
        )),
        _ => build_error(format!(
            "failed to read {env_name} {}: {error}",
            resolved_path.display()
        )),
    })?;

    if !metadata.is_dir() {
        return Err(build_error(format!(
            "{env_name} points to {}, but that path is not a directory",
            resolved_path.display()
        )));
    }

    resolved_path.canonicalize().map_err(|error| {
        build_error(format!(
            "failed to canonicalize {env_name} {}: {error}",
            resolved_path.display()
        ))
    })
}
