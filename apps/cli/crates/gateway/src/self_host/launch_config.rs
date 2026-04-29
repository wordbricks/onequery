use std::path::Path;
use std::path::PathBuf;

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use onequery_cli_core::path_utils;
use serde::Deserialize;
use serde::Serialize;

use super::bootstrap::SelfHostConfigBundle;
use super::bootstrap::load_self_host_config;
use super::config::SelfHostConfig;
use super::config::SmtpConfig;
use super::config::self_host_public_origin;
use super::paths::SelfHostRuntimePaths;
use super::paths::self_host_launch_config_path_for_launch;
use super::secrets::SecretsConfig;
use super::secrets::SmtpSecrets;

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerLaunchConfig {
    pub(crate) assets: ServerLaunchAssetsConfig,
    pub(crate) auth: ServerLaunchAuthConfig,
    pub(crate) connectors: ServerLaunchConnectorsConfig,
    pub(crate) crypto: ServerLaunchCryptoConfig,
    pub(crate) launch_id: String,
    pub(crate) listen: ServerLaunchListenConfig,
    pub(crate) mode: ServerLaunchMode,
    pub(crate) migrations: ServerLaunchMigrationsConfig,
    pub(crate) public_origin: String,
    pub(crate) rate_limit: ServerLaunchRateLimitConfig,
    pub(crate) runtime_control: ServerLaunchRuntimeControlConfig,
    pub(crate) runtime_paths: ServerLaunchRuntimePathsConfig,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) smtp: Option<ServerLaunchSmtpConfig>,
    pub(crate) storage: ServerLaunchStorageConfig,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerLaunchAssetsConfig {
    pub(crate) dist_dir: String,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerLaunchMigrationsConfig {
    pub(crate) dir: String,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct ServerLaunchAuthConfig {
    pub(crate) secret: String,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerLaunchConnectorsConfig {
    pub(crate) enrollment_token: String,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerLaunchCryptoConfig {
    pub(crate) master_encryption_key: String,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct ServerLaunchListenConfig {
    pub(crate) host: String,
    pub(crate) port: u16,
}

#[derive(Debug, Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ServerLaunchMode {
    SelfHost,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerLaunchRateLimitConfig {
    pub(crate) api: ServerLaunchApiRateLimitConfig,
    pub(crate) enabled: bool,
}

#[derive(Debug, Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ServerLaunchApiRateLimitStorage {
    Persistent,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerLaunchApiRateLimitConfig {
    pub(crate) storage: ServerLaunchApiRateLimitStorage,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerLaunchRuntimePathsConfig {
    pub(crate) backups_dir: String,
    pub(crate) data_dir: String,
    pub(crate) logs_dir: String,
    pub(crate) run_dir: String,
    pub(crate) runtime_lease_path: String,
    pub(crate) runtime_status_snapshot_path: String,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerLaunchRuntimeControlConfig {
    pub(crate) socket_path: String,
    pub(crate) transport: ServerLaunchRuntimeControlTransport,
}

#[derive(Debug, Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ServerLaunchRuntimeControlTransport {
    Unix,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerLaunchSmtpConfig {
    pub(crate) from_email: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) from_name: Option<String>,
    pub(crate) host: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) password: Option<String>,
    pub(crate) port: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) secure: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) username: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(crate) enum ServerLaunchStorageConfig {
    Pglite { dir: String },
}

pub(crate) fn write_self_host_launch_config(
    paths: &SelfHostRuntimePaths,
    command_line: &str,
    assets_dist_dir: &Path,
    migrations_dir: &Path,
    launch_id: &str,
) -> Result<PathBuf, CliError> {
    let bundle = load_self_host_config(paths, command_line)?;
    let launch_config_path = self_host_launch_config_path_for_launch(&bundle.paths, launch_id);
    let launch_config =
        resolve_self_host_launch_config(bundle, assets_dist_dir, migrations_dir, launch_id);
    let serialized = serde_json::to_string_pretty(&launch_config).map_err(|serialize_error| {
        CliError::new(
            "failed to serialize self-host launch config",
            command_line,
            ErrorStage::LoadConfig,
            serialize_error.to_string(),
            vec!["retry command".to_owned()],
        )
    })?;

    path_utils::atomic_write_private_file(
        &launch_config_path,
        &serialized,
        command_line,
        ErrorStage::LoadConfig,
        "self-host launch config",
    )?;

    Ok(launch_config_path)
}

fn resolve_self_host_launch_config(
    bundle: SelfHostConfigBundle,
    assets_dist_dir: &Path,
    migrations_dir: &Path,
    launch_id: &str,
) -> ServerLaunchConfig {
    let SelfHostConfigBundle {
        paths,
        config,
        secrets,
    } = bundle;
    let public_origin = self_host_public_origin(&config);
    let SelfHostConfig { server, smtp } = config;
    let SecretsConfig {
        smtp: smtp_secrets,
        auth,
        crypto,
        connectors,
    } = secrets;

    ServerLaunchConfig {
        assets: ServerLaunchAssetsConfig {
            dist_dir: assets_dist_dir.display().to_string(),
        },
        auth: ServerLaunchAuthConfig {
            secret: auth.secret,
        },
        connectors: ServerLaunchConnectorsConfig {
            enrollment_token: connectors.enrollment_token,
        },
        crypto: ServerLaunchCryptoConfig {
            master_encryption_key: crypto.master_encryption_key,
        },
        launch_id: launch_id.to_owned(),
        listen: ServerLaunchListenConfig {
            host: server.listen_host,
            port: server.port,
        },
        mode: ServerLaunchMode::SelfHost,
        migrations: ServerLaunchMigrationsConfig {
            dir: migrations_dir.display().to_string(),
        },
        public_origin,
        rate_limit: ServerLaunchRateLimitConfig {
            api: ServerLaunchApiRateLimitConfig {
                storage: ServerLaunchApiRateLimitStorage::Persistent,
            },
            enabled: true,
        },
        runtime_control: ServerLaunchRuntimeControlConfig {
            socket_path: paths.runtime_control_socket_path.display().to_string(),
            transport: ServerLaunchRuntimeControlTransport::Unix,
        },
        runtime_paths: ServerLaunchRuntimePathsConfig {
            backups_dir: paths.backups_dir.display().to_string(),
            data_dir: paths.data_dir.display().to_string(),
            logs_dir: paths.logs_dir.display().to_string(),
            run_dir: paths.run_dir.display().to_string(),
            runtime_lease_path: paths.runtime_lease_path.display().to_string(),
            runtime_status_snapshot_path: paths.runtime_status_snapshot_path.display().to_string(),
        },
        smtp: resolve_self_host_launch_smtp(smtp, smtp_secrets),
        storage: ServerLaunchStorageConfig::Pglite {
            dir: paths.pglite_dir.display().to_string(),
        },
    }
}

fn resolve_self_host_launch_smtp(
    config: SmtpConfig,
    secrets: SmtpSecrets,
) -> Option<ServerLaunchSmtpConfig> {
    let host = trimmed_non_empty(config.host)?;
    let from_email = trimmed_non_empty(config.from_email)?;
    let port = config.port?;

    Some(ServerLaunchSmtpConfig {
        from_email,
        from_name: trimmed_non_empty(config.from_name),
        host,
        password: trimmed_non_empty(secrets.password),
        port,
        secure: config.secure,
        username: trimmed_non_empty(config.username),
    })
}

fn trimmed_non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}
