use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;
use onequery_core::private_files;

use super::config::SelfHostConfig;
use super::file_io::load_toml_file;
use super::file_io::write_default_toml_if_absent;
use super::paths::SelfHostRuntimePaths;
use super::secrets::SecretsConfig;
use super::secrets::validate_self_host_secrets;

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct SelfHostConfigBundle {
    pub(crate) paths: SelfHostRuntimePaths,
    pub(crate) config: SelfHostConfig,
    pub(crate) secrets: SecretsConfig,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct SelfHostBootstrapResult {
    pub paths: SelfHostRuntimePaths,
    pub config_created: bool,
    pub secrets_created: bool,
}

pub fn bootstrap_self_host_foundation(
    paths: &SelfHostRuntimePaths,
    command_line: &str,
) -> Result<SelfHostBootstrapResult, CliError> {
    for (path, label) in [
        (&paths.config_dir, "config"),
        (&paths.data_dir, "data"),
        (&paths.pglite_dir, "pglite"),
        (&paths.logs_dir, "logs"),
        (&paths.backups_dir, "backups"),
        (&paths.releases_dir, "releases"),
        (&paths.recovery_points_dir, "recovery-points"),
        (&paths.run_dir, "runtime"),
    ] {
        private_files::create_private_dir(path, command_line, ErrorStage::LoadConfig, label)?;
    }

    let config_created = write_default_toml_if_absent(
        &paths.config_path,
        || Ok(SelfHostConfig::default()),
        command_line,
        "self-host config",
    )?;
    let secrets_created = write_default_toml_if_absent(
        &paths.secrets_path,
        || SecretsConfig::generate(command_line),
        command_line,
        "secrets config",
    )?;

    let _ = load_self_host_config(paths, command_line)?;

    Ok(SelfHostBootstrapResult {
        paths: paths.clone(),
        config_created,
        secrets_created,
    })
}

pub(crate) fn load_self_host_config(
    paths: &SelfHostRuntimePaths,
    command_line: &str,
) -> Result<SelfHostConfigBundle, CliError> {
    let config = load_self_host_public_config(paths, command_line)?;
    let secrets = load_toml_file(&paths.secrets_path, command_line, "secrets config")?;
    validate_self_host_secrets(&secrets, &paths.secrets_path, command_line)?;

    Ok(SelfHostConfigBundle {
        config,
        secrets,
        paths: paths.clone(),
    })
}

pub fn load_self_host_public_config(
    paths: &SelfHostRuntimePaths,
    command_line: &str,
) -> Result<SelfHostConfig, CliError> {
    load_toml_file(&paths.config_path, command_line, "self-host config")
}
