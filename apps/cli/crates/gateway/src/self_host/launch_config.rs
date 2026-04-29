use std::path::Path;
use std::path::PathBuf;

use base64::Engine as _;
use buffa::MessageField;
use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;
use onequery_core::private_files;

use super::bootstrap::SelfHostConfigBundle;
use super::bootstrap::load_self_host_config;
use super::config::SelfHostConfig;
use super::config::SmtpConfig;
use super::config::self_host_public_origin;
use super::paths::SelfHostRuntimePaths;
use super::paths::self_host_launch_config_path_for_launch;
use super::secrets::SecretsConfig;
use super::secrets::SmtpSecrets;
use crate::supervisor_control_proto::types;
use crate::supervisor_control_protocol::SUPERVISOR_CONTROL_AUTHORITY;
use crate::supervisor_control_protocol::SUPERVISOR_CONTROL_MAX_MESSAGE_SIZE_BYTES;

pub(crate) type ServerLaunchConfig = types::ServerLaunchConfig;
pub(crate) type ServerLaunchSupervisorConfig = types::SupervisorIdentity;

pub(crate) fn read_self_host_launch_id(
    launch_config_path: &Path,
    command_line: &str,
    retry_hint: String,
) -> Result<String, CliError> {
    let contents = read_launch_config_contents(
        launch_config_path,
        command_line,
        "for supervisor status",
        ErrorStage::Internal,
        retry_hint.clone(),
    )?;
    let launch_config = parse_launch_config_contents(
        &contents,
        launch_config_path,
        command_line,
        "for supervisor status",
        ErrorStage::Internal,
        retry_hint.clone(),
    )?;
    let Some(types::server_launch_config::Profile::SelfHost(self_host)) = launch_config.profile
    else {
        return Err(launch_config_error(
            "self-host launch config omitted launch id for supervisor status",
            format!(
                "launch config {} must be a self-host launch config",
                launch_config_path.display()
            ),
            command_line,
            ErrorStage::Internal,
            retry_hint,
        ));
    };

    self_host
        .launch_id
        .filter(|launch_id| !launch_id.is_empty())
        .ok_or_else(|| {
            launch_config_error(
                "self-host launch config omitted launch id for supervisor status",
                launch_config_path.display().to_string(),
                command_line,
                ErrorStage::Internal,
                retry_hint,
            )
        })
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
    let launch_config = resolve_self_host_launch_config(
        bundle,
        assets_dist_dir,
        migrations_dir,
        launch_id,
        command_line,
    )?;
    let serialized = serde_json::to_string_pretty(&launch_config).map_err(|serialize_error| {
        CliError::new(
            "failed to serialize self-host launch config",
            command_line,
            ErrorStage::LoadConfig,
            serialize_error.to_string(),
            vec!["retry command".to_owned()],
        )
    })?;

    private_files::atomic_write_private_file(
        &launch_config_path,
        &serialized,
        command_line,
        ErrorStage::LoadConfig,
        "self-host launch config",
    )?;

    Ok(launch_config_path)
}

pub(crate) fn write_self_host_launch_supervisor_identity(
    launch_config_path: &Path,
    command_line: &str,
    supervisor: ServerLaunchSupervisorConfig,
) -> Result<(), CliError> {
    let retry_hint = "retry command".to_owned();
    let contents = read_launch_config_contents(
        launch_config_path,
        command_line,
        "for supervisor identity",
        ErrorStage::Internal,
        retry_hint.clone(),
    )?;
    let mut launch_config = parse_launch_config_contents(
        &contents,
        launch_config_path,
        command_line,
        "for supervisor identity",
        ErrorStage::Internal,
        retry_hint.clone(),
    )?;
    let Some(types::server_launch_config::Profile::SelfHost(self_host)) =
        launch_config.profile.as_mut()
    else {
        return Err(launch_config_error(
            "failed to stamp self-host launch config supervisor identity",
            format!(
                "launch config {} must be a self-host launch config",
                launch_config_path.display()
            ),
            command_line,
            ErrorStage::Internal,
            retry_hint,
        ));
    };
    self_host.supervisor = MessageField::some(supervisor);

    let serialized = serde_json::to_string_pretty(&launch_config).map_err(|serialize_error| {
        CliError::new(
            "failed to serialize self-host launch config with supervisor identity",
            command_line,
            ErrorStage::Internal,
            serialize_error.to_string(),
            vec!["retry command".to_owned()],
        )
    })?;

    private_files::atomic_write_private_file(
        launch_config_path,
        &serialized,
        command_line,
        ErrorStage::Internal,
        "self-host launch config supervisor identity",
    )
}

fn read_launch_config_contents(
    launch_config_path: &Path,
    command_line: &str,
    action: &str,
    stage: ErrorStage,
    retry_hint: String,
) -> Result<String, CliError> {
    std::fs::read_to_string(launch_config_path).map_err(|error| {
        CliError::new(
            format!("failed to read self-host launch config {action}"),
            command_line,
            stage,
            format!("{error} ({})", launch_config_path.display()),
            vec![retry_hint],
        )
    })
}

fn parse_launch_config_contents(
    contents: &str,
    launch_config_path: &Path,
    command_line: &str,
    action: &str,
    stage: ErrorStage,
    retry_hint: String,
) -> Result<ServerLaunchConfig, CliError> {
    serde_json::from_str::<ServerLaunchConfig>(contents).map_err(|error| {
        CliError::new(
            format!("failed to parse self-host launch config {action}"),
            command_line,
            stage,
            format!("{error} ({})", launch_config_path.display()),
            vec![retry_hint],
        )
    })
}

fn launch_config_error(
    message: &'static str,
    detail: String,
    command_line: &str,
    stage: ErrorStage,
    retry_hint: String,
) -> CliError {
    CliError::new(message, command_line, stage, detail, vec![retry_hint])
}

fn resolve_self_host_launch_config(
    bundle: SelfHostConfigBundle,
    assets_dist_dir: &Path,
    migrations_dir: &Path,
    launch_id: &str,
    command_line: &str,
) -> Result<ServerLaunchConfig, CliError> {
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
    let supervisor_control_max_message_bytes =
        u32::try_from(SUPERVISOR_CONTROL_MAX_MESSAGE_SIZE_BYTES).map_err(|error| {
            CliError::new(
                "failed to build self-host launch config",
                command_line,
                ErrorStage::LoadConfig,
                format!("supervisor control max message size is out of range: {error}"),
                vec!["retry command".to_owned()],
            )
        })?;

    Ok(ServerLaunchConfig {
        profile: types::SelfHostServerLaunchConfig {
            common: MessageField::some(types::ServerLaunchCommonConfig {
                assets: MessageField::some(types::ServerLaunchAssetsConfig {
                    dist_dir: Some(assets_dist_dir.display().to_string()),
                    ..Default::default()
                }),
                auth: MessageField::some(types::ServerLaunchAuthConfig {
                    secret: Some(auth.secret),
                    ..Default::default()
                }),
                connectors: MessageField::some(types::ServerLaunchConnectorsConfig {
                    enrollment_token: Some(connectors.enrollment_token),
                    ..Default::default()
                }),
                crypto: MessageField::some(types::ServerLaunchCryptoConfig {
                    master_encryption_key: Some(decode_master_encryption_key(
                        &crypto.master_encryption_key,
                        command_line,
                    )?),
                    ..Default::default()
                }),
                listen: MessageField::some(types::ServerLaunchListenConfig {
                    host: Some(server.listen_host),
                    port: Some(u32::from(server.port)),
                    ..Default::default()
                }),
                migrations: MessageField::some(types::ServerLaunchMigrationsConfig {
                    dir: Some(migrations_dir.display().to_string()),
                    ..Default::default()
                }),
                public_origin: Some(public_origin),
                rate_limit: MessageField::some(types::ServerLaunchRateLimitConfig {
                    api: MessageField::some(types::ServerLaunchApiRateLimitConfig {
                        storage: Some(types::ServerLaunchApiRateLimitStorage::SERVER_LAUNCH_API_RATE_LIMIT_STORAGE_PERSISTENT.into()),
                        ..Default::default()
                    }),
                    enabled: Some(true),
                    ..Default::default()
                }),
                storage: MessageField::some(types::ServerLaunchStorageConfig {
                    kind: types::ServerLaunchPgliteStorageConfig {
                        dir: Some(paths.pglite_dir.display().to_string()),
                        ..Default::default()
                    }
                    .into(),
                    ..Default::default()
                }),
                smtp: resolve_self_host_launch_smtp(smtp, smtp_secrets)
                    .map(MessageField::some)
                    .unwrap_or_else(MessageField::none),
                ..Default::default()
            }),
            launch_id: Some(launch_id.to_owned()),
            runtime_paths: MessageField::some(types::ServerLaunchRuntimePathsConfig {
                backups_dir: Some(paths.backups_dir.display().to_string()),
                data_dir: Some(paths.data_dir.display().to_string()),
                lifecycle_event_log_path: Some(paths.lifecycle_event_log_path.display().to_string()),
                logs_dir: Some(paths.logs_dir.display().to_string()),
                run_dir: Some(paths.run_dir.display().to_string()),
                runtime_lease_path: Some(paths.runtime_lease_path.display().to_string()),
                runtime_status_snapshot_path: Some(
                    paths.runtime_status_snapshot_path.display().to_string(),
                ),
                ..Default::default()
            }),
            supervisor_control: MessageField::some(types::ServerLaunchSupervisorControlConfig {
                base_url: Some(SUPERVISOR_CONTROL_AUTHORITY.to_owned()),
                max_message_bytes: Some(supervisor_control_max_message_bytes),
                transport: MessageField::some(
                    types::ServerLaunchSupervisorControlTransportConfig {
                        kind: types::ServerLaunchUnixSupervisorControlTransportConfig {
                            socket_path: Some(
                                paths.supervisor_control_socket_path.display().to_string(),
                            ),
                            ..Default::default()
                        }
                        .into(),
                        ..Default::default()
                    },
                ),
                ..Default::default()
            }),
            supervisor: MessageField::none(),
            ..Default::default()
        }
        .into(),
        ..Default::default()
    })
}

fn decode_master_encryption_key(value: &str, command_line: &str) -> Result<Vec<u8>, CliError> {
    base64::engine::general_purpose::STANDARD
        .decode(value.trim())
        .map_err(|error| {
            CliError::new(
                "failed to build self-host launch config",
                command_line,
                ErrorStage::LoadConfig,
                format!("master encryption key is not valid base64: {error}"),
                vec!["retry command".to_owned()],
            )
        })
}

fn resolve_self_host_launch_smtp(
    config: SmtpConfig,
    secrets: SmtpSecrets,
) -> Option<types::ServerLaunchSmtpConfig> {
    let host = trimmed_non_empty(config.host)?;
    let from_email = trimmed_non_empty(config.from_email)?;
    let port = config.port?;

    Some(types::ServerLaunchSmtpConfig {
        from_email: Some(from_email),
        from_name: trimmed_non_empty(config.from_name),
        host: Some(host),
        password: trimmed_non_empty(secrets.password),
        port: Some(u32::from(port)),
        secure: config.secure,
        username: trimmed_non_empty(config.username),
        ..Default::default()
    })
}

fn trimmed_non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}
