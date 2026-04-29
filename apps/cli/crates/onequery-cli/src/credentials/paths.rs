use std::path::PathBuf;

use onequery_core::error::CliError;

use crate::config::config_dir;

pub(super) fn auth_path(command_line: &str) -> Result<PathBuf, CliError> {
    let mut path = config_dir(command_line)?;
    path.push("auth.json");
    Ok(path)
}
