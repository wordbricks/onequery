//! Application home path resolution.

use std::path::Path;
use std::path::PathBuf;

use crate::error::CliError;
use crate::error::ErrorStage;

const CONFIG_FILENAME: &str = "config.toml";

/// Resolves the persisted user config file path.
pub fn config_path(command_line: &str) -> Result<PathBuf, CliError> {
    Ok(config_path_from_home(config_dir(command_line)?.as_path()))
}

/// Resolves the application config directory.
pub fn config_dir(command_line: &str) -> Result<PathBuf, CliError> {
    onequery_home(command_line, "config")
}

/// Resolves the application data directory.
pub fn data_dir(command_line: &str) -> Result<PathBuf, CliError> {
    onequery_home(command_line, "data")
}

fn onequery_home(command_line: &str, label: &str) -> Result<PathBuf, CliError> {
    onequery_utils_home_dir::find_onequery_home()
        .map(onequery_utils_absolute_path::AbsolutePathBuf::into_path_buf)
        .map_err(|error| onequery_home_error(command_line, label, error))
}

fn config_path_from_home(home: &Path) -> PathBuf {
    home.join(CONFIG_FILENAME)
}

fn onequery_home_error(command_line: &str, label: &str, error: std::io::Error) -> CliError {
    CliError::new(
        format!("failed to resolve {label} directory"),
        command_line,
        ErrorStage::LoadConfig,
        error.to_string(),
        vec!["set ONEQUERY_HOME to a valid directory".to_owned()],
    )
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use std::path::PathBuf;

    use super::config_path_from_home;
    use super::onequery_home_error;

    #[test]
    fn config_path_lives_directly_under_onequery_home() {
        assert_eq!(
            config_path_from_home(PathBuf::from("/Users/alice/.onequery").as_path()),
            PathBuf::from("/Users/alice/.onequery/config.toml")
        );
    }

    #[test]
    fn onequery_home_error_maps_to_config_directory_error() {
        let error = std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "ONEQUERY_HOME points to \"/tmp/missing\", but that path does not exist",
        );
        let cli_error = onequery_home_error("onequery auth whoami", "config", error);

        assert_eq!(
            (
                cli_error.title.as_str(),
                cli_error.why.as_str(),
                cli_error.try_next.clone(),
            ),
            (
                "failed to resolve config directory",
                "ONEQUERY_HOME points to \"/tmp/missing\", but that path does not exist",
                vec!["set ONEQUERY_HOME to a valid directory".to_owned()],
            )
        );
    }
}
