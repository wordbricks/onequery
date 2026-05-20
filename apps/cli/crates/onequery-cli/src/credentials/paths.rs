use std::path::PathBuf;

use onequery_core::error::CliError;

use crate::config::config_dir_for_profile;
use crate::profile::SelectedProfile;

pub(super) fn auth_path(
    command_line: &str,
    profile: &SelectedProfile,
) -> Result<PathBuf, CliError> {
    let mut path = config_dir_for_profile(command_line, profile)?;
    path.push("auth.json");
    Ok(path)
}
