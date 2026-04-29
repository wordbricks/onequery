use std::fs;
use std::path::Path;

use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;
use onequery_core::private_files;
use serde::Serialize;
use serde::de::DeserializeOwned;

pub(super) fn write_default_toml_if_absent<T>(
    path: &Path,
    create_value: impl FnOnce() -> Result<T, CliError>,
    command_line: &str,
    label: &str,
) -> Result<bool, CliError>
where
    T: Serialize,
{
    if path.exists() {
        return Ok(false);
    }

    let value = create_value()?;
    let serialized = toml::to_string_pretty(&value).map_err(|serialize_error| {
        CliError::new(
            format!("failed to serialize {label}"),
            command_line,
            ErrorStage::LoadConfig,
            serialize_error.to_string(),
            vec!["retry command".to_owned()],
        )
    })?;

    private_files::atomic_write_private_file(
        path,
        &serialized,
        command_line,
        ErrorStage::LoadConfig,
        label,
    )?;
    Ok(true)
}

pub(super) fn load_toml_file<T>(path: &Path, command_line: &str, label: &str) -> Result<T, CliError>
where
    T: DeserializeOwned,
{
    let contents = fs::read_to_string(path).map_err(|read_error| {
        CliError::new(
            format!("failed to read {label}"),
            command_line,
            ErrorStage::LoadConfig,
            format!("{read_error} ({})", path.display()),
            vec![format!("check {label} path {}", path.display())],
        )
    })?;

    toml::from_str(&contents).map_err(|parse_error| {
        CliError::new(
            format!("failed to parse {label}"),
            command_line,
            ErrorStage::LoadConfig,
            format!("{parse_error} ({})", path.display()),
            vec![format!("remove or fix {}", path.display())],
        )
    })
}
