use std::fs;
use std::path::Path;
use std::path::PathBuf;

use base64::Engine as _;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use serde::Deserialize;
use serde::Serialize;
use serde::de::DeserializeOwned;
use uuid::Uuid;

use super::config_dir;
use super::data_dir;
use crate::path_utils;

const SELF_HOST_CONFIG_DIR_NAME: &str = "self-host";
const CONFIG_FILENAME: &str = "config.toml";
const SECRETS_CONFIG_FILENAME: &str = "secrets.toml";
const PGLITE_DIRNAME: &str = "onequery";
const SERVER_LOG_FILENAME: &str = "server.log";
const PID_FILENAME: &str = "server.pid";
const LOCK_FILENAME: &str = "server.lock";
const STOP_REQUEST_FILENAME: &str = "server.stop";
const LAUNCH_CONFIG_FILENAME: &str = "launch.json";
const MASTER_ENCRYPTION_KEY_BYTE_LENGTH: usize = 32;
pub(crate) const DEFAULT_SELF_HOST_LISTEN_HOST: &str = "127.0.0.1";
pub(crate) const DEFAULT_SELF_HOST_PORT: u16 = 5656;

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct SelfHostRuntimePaths {
    pub(crate) config_dir: PathBuf,
    pub(crate) data_dir: PathBuf,
    pub(crate) config_path: PathBuf,
    pub(crate) secrets_path: PathBuf,
    pub(crate) pglite_dir: PathBuf,
    pub(crate) logs_dir: PathBuf,
    pub(crate) server_log_path: PathBuf,
    pub(crate) backups_dir: PathBuf,
    pub(crate) run_dir: PathBuf,
    pub(crate) pid_path: PathBuf,
    pub(crate) lock_path: PathBuf,
    pub(crate) stop_request_path: PathBuf,
    pub(crate) launch_config_path: PathBuf,
}

impl SelfHostRuntimePaths {
    fn from_dirs(config_dir: PathBuf, data_dir: PathBuf) -> Self {
        let config_path = config_dir.join(CONFIG_FILENAME);
        let secrets_path = config_dir.join(SECRETS_CONFIG_FILENAME);
        let pglite_dir = data_dir.join("pglite").join(PGLITE_DIRNAME);
        let logs_dir = data_dir.join("logs");
        let server_log_path = logs_dir.join(SERVER_LOG_FILENAME);
        let backups_dir = data_dir.join("backups");
        let run_dir = data_dir.join("run");
        let pid_path = run_dir.join(PID_FILENAME);
        let lock_path = run_dir.join(LOCK_FILENAME);
        let stop_request_path = run_dir.join(STOP_REQUEST_FILENAME);
        let launch_config_path = run_dir.join(LAUNCH_CONFIG_FILENAME);

        Self {
            config_dir,
            data_dir,
            config_path,
            secrets_path,
            pglite_dir,
            logs_dir,
            server_log_path,
            backups_dir,
            run_dir,
            pid_path,
            lock_path,
            stop_request_path,
            launch_config_path,
        }
    }

    #[cfg(test)]
    pub(crate) fn for_test(config_dir: PathBuf, data_dir: PathBuf) -> Self {
        Self::from_dirs(config_dir, data_dir)
    }
}

pub(crate) fn self_host_runtime_paths(
    command_line: &str,
) -> Result<SelfHostRuntimePaths, CliError> {
    Ok(SelfHostRuntimePaths::from_dirs(
        config_dir(command_line)?.join(SELF_HOST_CONFIG_DIR_NAME),
        data_dir(command_line)?,
    ))
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default, deny_unknown_fields)]
#[derive(Default)]
pub(crate) struct SelfHostConfig {
    #[serde(default)]
    pub(crate) server: ServerSection,
    #[serde(default, skip_serializing_if = "SmtpConfig::is_empty")]
    pub(crate) smtp: SmtpConfig,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default, deny_unknown_fields)]
pub(crate) struct ServerSection {
    #[serde(default = "default_listen_host")]
    pub(crate) listen_host: String,
    #[serde(default = "default_port")]
    pub(crate) port: u16,
    #[serde(default)]
    pub(crate) public_origin: Option<String>,
}

impl Default for ServerSection {
    fn default() -> Self {
        Self {
            listen_host: default_listen_host(),
            port: default_port(),
            public_origin: None,
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default, deny_unknown_fields)]
pub(crate) struct SmtpConfig {
    #[serde(default)]
    pub(crate) from_email: Option<String>,
    #[serde(default)]
    pub(crate) from_name: Option<String>,
    #[serde(default)]
    pub(crate) host: Option<String>,
    #[serde(default)]
    pub(crate) port: Option<u16>,
    #[serde(default)]
    pub(crate) secure: Option<bool>,
    #[serde(default)]
    pub(crate) username: Option<String>,
}

impl SmtpConfig {
    fn is_empty(&self) -> bool {
        self.from_email.is_none()
            && self.from_name.is_none()
            && self.host.is_none()
            && self.port.is_none()
            && self.secure.is_none()
            && self.username.is_none()
    }
}

fn default_listen_host() -> String {
    DEFAULT_SELF_HOST_LISTEN_HOST.to_owned()
}

pub(crate) fn default_port() -> u16 {
    DEFAULT_SELF_HOST_PORT
}

pub(crate) fn default_public_origin() -> String {
    resolve_default_public_origin(DEFAULT_SELF_HOST_LISTEN_HOST, DEFAULT_SELF_HOST_PORT)
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SecretsConfig {
    #[serde(default, skip_serializing_if = "SmtpSecrets::is_empty")]
    pub(crate) smtp: SmtpSecrets,
    pub(crate) auth: AuthSecrets,
    pub(crate) crypto: CryptoSecrets,
    pub(crate) connectors: ConnectorSecrets,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AuthSecrets {
    pub(crate) secret: String,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CryptoSecrets {
    pub(crate) master_encryption_key: String,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ConnectorSecrets {
    pub(crate) enrollment_token: String,
}

#[derive(Debug, Clone, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default, deny_unknown_fields)]
pub(crate) struct SmtpSecrets {
    #[serde(default)]
    pub(crate) password: Option<String>,
}

impl SmtpSecrets {
    fn is_empty(&self) -> bool {
        self.password.is_none()
    }
}

impl SecretsConfig {
    fn generate() -> Self {
        Self {
            smtp: SmtpSecrets::default(),
            auth: AuthSecrets {
                secret: generate_auth_secret(),
            },
            crypto: CryptoSecrets {
                master_encryption_key: generate_master_encryption_key(),
            },
            connectors: ConnectorSecrets {
                enrollment_token: generate_connector_enrollment_token(),
            },
        }
    }
}

fn generate_auth_secret() -> String {
    generate_base64url_secret()
}

fn generate_connector_enrollment_token() -> String {
    generate_base64url_secret()
}

fn generate_master_encryption_key() -> String {
    let random_bytes = generate_random_secret_bytes();
    base64::engine::general_purpose::STANDARD.encode(random_bytes)
}

fn generate_base64url_secret() -> String {
    let random_bytes = generate_random_secret_bytes();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(random_bytes)
}

fn generate_random_secret_bytes() -> [u8; MASTER_ENCRYPTION_KEY_BYTE_LENGTH] {
    let first = Uuid::new_v4();
    let second = Uuid::new_v4();
    let mut bytes = [0_u8; MASTER_ENCRYPTION_KEY_BYTE_LENGTH];
    bytes[..16].copy_from_slice(first.as_bytes());
    bytes[16..].copy_from_slice(second.as_bytes());
    bytes
}

fn validate_master_encryption_key(value: &str) -> Result<(), &'static str> {
    let normalized_value = value.trim();
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(normalized_value)
        .map_err(|_| "must be base64 that decodes to exactly 32 bytes")?;

    if decoded.len() != MASTER_ENCRYPTION_KEY_BYTE_LENGTH {
        return Err("must be base64 that decodes to exactly 32 bytes");
    }

    Ok(())
}

fn validate_self_host_secrets(
    secrets: &SecretsConfig,
    secrets_path: &Path,
    command_line: &str,
) -> Result<(), CliError> {
    validate_master_encryption_key(&secrets.crypto.master_encryption_key).map_err(|message| {
        CliError::new(
            "invalid self-host secrets config",
            command_line,
            ErrorStage::LoadConfig,
            format!(
                "{} -> crypto.master_encryption_key: {message}",
                secrets_path.display()
            ),
            vec![format!("fix {}", secrets_path.display())],
        )
    })
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct SelfHostConfigBundle {
    pub(crate) paths: SelfHostRuntimePaths,
    pub(crate) config: SelfHostConfig,
    pub(crate) secrets: SecretsConfig,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct SelfHostBootstrapResult {
    pub(crate) paths: SelfHostRuntimePaths,
    pub(crate) config_created: bool,
    pub(crate) secrets_created: bool,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerLaunchConfig {
    pub(crate) assets: ServerLaunchAssetsConfig,
    pub(crate) auth: ServerLaunchAuthConfig,
    pub(crate) connectors: ServerLaunchConnectorsConfig,
    pub(crate) crypto: ServerLaunchCryptoConfig,
    pub(crate) listen: ServerLaunchListenConfig,
    pub(crate) mode: ServerLaunchMode,
    pub(crate) migrations: ServerLaunchMigrationsConfig,
    pub(crate) public_origin: String,
    pub(crate) rate_limit: ServerLaunchRateLimitConfig,
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
    pub(crate) enabled: bool,
    pub(crate) storage: ServerLaunchRateLimitStorage,
}

#[derive(Debug, Clone, Copy, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ServerLaunchRateLimitStorage {
    Persistent,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerLaunchRuntimePathsConfig {
    pub(crate) backups_dir: String,
    pub(crate) data_dir: String,
    pub(crate) lock_path: String,
    pub(crate) logs_dir: String,
    pub(crate) pid_path: String,
    pub(crate) run_dir: String,
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

pub(crate) fn bootstrap_self_host_foundation(
    command_line: &str,
) -> Result<SelfHostBootstrapResult, CliError> {
    let paths = self_host_runtime_paths(command_line)?;
    bootstrap_self_host_foundation_with_paths(paths, command_line)
}

pub(crate) fn load_self_host_config(command_line: &str) -> Result<SelfHostConfigBundle, CliError> {
    let paths = self_host_runtime_paths(command_line)?;
    load_self_host_config_with_paths(paths, command_line)
}

pub(crate) fn write_self_host_launch_config(
    command_line: &str,
    assets_dist_dir: &Path,
    migrations_dir: &Path,
) -> Result<PathBuf, CliError> {
    let paths = self_host_runtime_paths(command_line)?;
    write_self_host_launch_config_with_paths(paths, assets_dist_dir, migrations_dir, command_line)
}

#[cfg(test)]
pub(crate) fn bootstrap_self_host_foundation_for_test(
    paths: SelfHostRuntimePaths,
    command_line: &str,
) -> Result<SelfHostBootstrapResult, CliError> {
    bootstrap_self_host_foundation_with_paths(paths, command_line)
}

#[cfg(test)]
pub(crate) fn load_self_host_config_for_test(
    paths: SelfHostRuntimePaths,
    command_line: &str,
) -> Result<SelfHostConfigBundle, CliError> {
    load_self_host_config_with_paths(paths, command_line)
}

#[cfg(test)]
pub(crate) fn write_self_host_launch_config_for_test(
    paths: SelfHostRuntimePaths,
    assets_dist_dir: &Path,
    migrations_dir: &Path,
    command_line: &str,
) -> Result<PathBuf, CliError> {
    write_self_host_launch_config_with_paths(paths, assets_dist_dir, migrations_dir, command_line)
}

fn bootstrap_self_host_foundation_with_paths(
    paths: SelfHostRuntimePaths,
    command_line: &str,
) -> Result<SelfHostBootstrapResult, CliError> {
    path_utils::create_private_dir(
        &paths.config_dir,
        command_line,
        ErrorStage::LoadConfig,
        "config",
    )?;
    path_utils::create_private_dir(
        &paths.data_dir,
        command_line,
        ErrorStage::LoadConfig,
        "data",
    )?;
    path_utils::create_private_dir(
        &paths.pglite_dir,
        command_line,
        ErrorStage::LoadConfig,
        "pglite",
    )?;
    path_utils::create_private_dir(
        &paths.logs_dir,
        command_line,
        ErrorStage::LoadConfig,
        "logs",
    )?;
    path_utils::create_private_dir(
        &paths.backups_dir,
        command_line,
        ErrorStage::LoadConfig,
        "backups",
    )?;
    path_utils::create_private_dir(
        &paths.run_dir,
        command_line,
        ErrorStage::LoadConfig,
        "runtime",
    )?;

    let config_created = write_default_toml_if_absent(
        &paths.config_path,
        &SelfHostConfig::default(),
        command_line,
        "self-host config",
    )?;
    let secrets_created = write_default_toml_if_absent(
        &paths.secrets_path,
        &SecretsConfig::generate(),
        command_line,
        "secrets config",
    )?;

    let _ = load_self_host_config_with_paths(paths.clone(), command_line)?;

    Ok(SelfHostBootstrapResult {
        paths,
        config_created,
        secrets_created,
    })
}

fn load_self_host_config_with_paths(
    paths: SelfHostRuntimePaths,
    command_line: &str,
) -> Result<SelfHostConfigBundle, CliError> {
    let config = load_toml_file(&paths.config_path, command_line, "self-host config")?;
    let secrets = load_toml_file(&paths.secrets_path, command_line, "secrets config")?;
    validate_self_host_secrets(&secrets, &paths.secrets_path, command_line)?;

    Ok(SelfHostConfigBundle {
        config,
        secrets,
        paths,
    })
}

fn write_self_host_launch_config_with_paths(
    paths: SelfHostRuntimePaths,
    assets_dist_dir: &Path,
    migrations_dir: &Path,
    command_line: &str,
) -> Result<PathBuf, CliError> {
    let bundle = load_self_host_config_with_paths(paths, command_line)?;
    let launch_config = resolve_self_host_launch_config(&bundle, assets_dist_dir, migrations_dir);
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
        &bundle.paths.launch_config_path,
        &serialized,
        command_line,
        ErrorStage::LoadConfig,
        "self-host launch config",
    )?;

    Ok(bundle.paths.launch_config_path)
}

fn resolve_self_host_launch_config(
    bundle: &SelfHostConfigBundle,
    assets_dist_dir: &Path,
    migrations_dir: &Path,
) -> ServerLaunchConfig {
    let public_origin = bundle
        .config
        .server
        .public_origin
        .clone()
        .unwrap_or_else(|| {
            resolve_default_public_origin(
                &bundle.config.server.listen_host,
                bundle.config.server.port,
            )
        });

    ServerLaunchConfig {
        assets: ServerLaunchAssetsConfig {
            dist_dir: assets_dist_dir.display().to_string(),
        },
        auth: ServerLaunchAuthConfig {
            secret: bundle.secrets.auth.secret.clone(),
        },
        connectors: ServerLaunchConnectorsConfig {
            enrollment_token: bundle.secrets.connectors.enrollment_token.clone(),
        },
        crypto: ServerLaunchCryptoConfig {
            master_encryption_key: bundle.secrets.crypto.master_encryption_key.clone(),
        },
        listen: ServerLaunchListenConfig {
            host: bundle.config.server.listen_host.clone(),
            port: bundle.config.server.port,
        },
        mode: ServerLaunchMode::SelfHost,
        migrations: ServerLaunchMigrationsConfig {
            dir: migrations_dir.display().to_string(),
        },
        public_origin,
        rate_limit: ServerLaunchRateLimitConfig {
            enabled: true,
            storage: ServerLaunchRateLimitStorage::Persistent,
        },
        runtime_paths: ServerLaunchRuntimePathsConfig {
            backups_dir: bundle.paths.backups_dir.display().to_string(),
            data_dir: bundle.paths.data_dir.display().to_string(),
            lock_path: bundle.paths.lock_path.display().to_string(),
            logs_dir: bundle.paths.logs_dir.display().to_string(),
            pid_path: bundle.paths.pid_path.display().to_string(),
            run_dir: bundle.paths.run_dir.display().to_string(),
        },
        smtp: resolve_self_host_launch_smtp(bundle),
        storage: ServerLaunchStorageConfig::Pglite {
            dir: bundle.paths.pglite_dir.display().to_string(),
        },
    }
}

fn resolve_self_host_launch_smtp(bundle: &SelfHostConfigBundle) -> Option<ServerLaunchSmtpConfig> {
    let host = bundle.config.smtp.host.as_ref()?.trim();
    let from_email = bundle.config.smtp.from_email.as_ref()?.trim();
    let port = bundle.config.smtp.port?;

    if host.is_empty() || from_email.is_empty() {
        return None;
    }

    Some(ServerLaunchSmtpConfig {
        from_email: from_email.to_owned(),
        from_name: bundle
            .config
            .smtp
            .from_name
            .as_ref()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty()),
        host: host.to_owned(),
        password: bundle
            .secrets
            .smtp
            .password
            .as_ref()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty()),
        port,
        secure: bundle.config.smtp.secure,
        username: bundle
            .config
            .smtp
            .username
            .as_ref()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty()),
    })
}

fn resolve_default_public_origin(listen_host: &str, port: u16) -> String {
    format!(
        "http://{}:{}",
        resolve_default_public_host(listen_host),
        port
    )
}

fn resolve_default_public_host(listen_host: &str) -> &str {
    if listen_host == "0.0.0.0" {
        return DEFAULT_SELF_HOST_LISTEN_HOST;
    }

    listen_host
}

fn write_default_toml_if_absent<T>(
    path: &Path,
    value: &T,
    command_line: &str,
    label: &str,
) -> Result<bool, CliError>
where
    T: Serialize,
{
    if path.exists() {
        return Ok(false);
    }

    let serialized = toml::to_string_pretty(value).map_err(|serialize_error| {
        CliError::new(
            format!("failed to serialize {label}"),
            command_line,
            ErrorStage::LoadConfig,
            serialize_error.to_string(),
            vec!["retry command".to_owned()],
        )
    })?;

    path_utils::atomic_write_private_file(
        path,
        &serialized,
        command_line,
        ErrorStage::LoadConfig,
        label,
    )?;
    Ok(true)
}

fn load_toml_file<T>(path: &Path, command_line: &str, label: &str) -> Result<T, CliError>
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

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::path::PathBuf;

    use base64::Engine as _;
    use pretty_assertions::assert_eq;
    use uuid::Uuid;

    use super::AuthSecrets;
    use super::ConnectorSecrets;
    use super::CryptoSecrets;
    use super::SecretsConfig;
    use super::SelfHostConfig;
    use super::SelfHostRuntimePaths;
    use super::ServerLaunchConfig;
    use super::ServerSection;
    use super::SmtpConfig;
    use super::SmtpSecrets;
    use super::bootstrap_self_host_foundation_with_paths;
    use super::default_port;
    use super::load_self_host_config_with_paths;
    use super::write_self_host_launch_config_for_test;

    const TEST_MASTER_ENCRYPTION_KEY: &str = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";

    fn create_test_paths(label: &str) -> (PathBuf, SelfHostRuntimePaths) {
        let test_dir = std::env::temp_dir().join(format!("onequery-{label}-{}", Uuid::new_v4()));
        let paths = SelfHostRuntimePaths::for_test(
            test_dir.join("config").join("self-host"),
            test_dir.join("data"),
        );

        (test_dir, paths)
    }

    fn write_valid_self_host_files(paths: &SelfHostRuntimePaths) {
        fs::create_dir_all(&paths.config_dir)
            .unwrap_or_else(|error| panic!("expected config dir creation to succeed: {error}"));
        fs::write(&paths.config_path, valid_self_host_config_toml())
            .unwrap_or_else(|error| panic!("expected config write to succeed: {error}"));
        fs::write(&paths.secrets_path, valid_self_host_secrets_toml())
            .unwrap_or_else(|error| panic!("expected secrets write to succeed: {error}"));
    }

    fn valid_self_host_config_toml() -> String {
        format!(
            "[server]\nlisten_host = \"127.0.0.1\"\nport = {}\n",
            default_port()
        )
    }

    fn valid_self_host_secrets_toml() -> String {
        format!(
            "[auth]\nsecret = \"better\"\n\n[crypto]\nmaster_encryption_key = \"{TEST_MASTER_ENCRYPTION_KEY}\"\n\n[connectors]\nenrollment_token = \"connector\"\n"
        )
    }

    #[test]
    fn runtime_paths_follow_the_phase_two_layout_contract() {
        let paths = SelfHostRuntimePaths::for_test(
            PathBuf::from("/config/onequery/self-host"),
            PathBuf::from("/data/onequery"),
        );

        assert_eq!(
            paths.config_path,
            PathBuf::from("/config/onequery/self-host/config.toml")
        );
        assert_eq!(
            paths.secrets_path,
            PathBuf::from("/config/onequery/self-host/secrets.toml")
        );
        assert_eq!(
            paths.pglite_dir,
            PathBuf::from("/data/onequery/pglite/onequery")
        );
        assert_eq!(paths.logs_dir, PathBuf::from("/data/onequery/logs"));
        assert_eq!(
            paths.server_log_path,
            PathBuf::from("/data/onequery/logs/server.log")
        );
        assert_eq!(paths.backups_dir, PathBuf::from("/data/onequery/backups"));
        assert_eq!(
            paths.pid_path,
            PathBuf::from("/data/onequery/run/server.pid")
        );
        assert_eq!(
            paths.lock_path,
            PathBuf::from("/data/onequery/run/server.lock")
        );
        assert_eq!(
            paths.stop_request_path,
            PathBuf::from("/data/onequery/run/server.stop")
        );
        assert_eq!(
            paths.launch_config_path,
            PathBuf::from("/data/onequery/run/launch.json")
        );
    }

    #[test]
    fn bootstrap_creates_self_host_config_files_and_runtime_directories() {
        let test_dir =
            std::env::temp_dir().join(format!("onequery-self-host-bootstrap-{}", Uuid::new_v4()));
        let paths = SelfHostRuntimePaths::for_test(
            test_dir.join("config").join("self-host"),
            test_dir.join("data"),
        );

        let bootstrap = bootstrap_self_host_foundation_with_paths(paths.clone(), "onequery serve")
            .unwrap_or_else(|error| panic!("expected bootstrap to succeed: {error}"));

        assert_eq!(bootstrap.config_created, true);
        assert_eq!(bootstrap.secrets_created, true);
        assert_eq!(bootstrap.paths, paths);
        assert_eq!(paths.config_dir.is_dir(), true);
        assert_eq!(paths.data_dir.is_dir(), true);
        assert_eq!(paths.logs_dir.is_dir(), true);
        assert_eq!(paths.backups_dir.is_dir(), true);
        assert_eq!(paths.run_dir.is_dir(), true);
        assert_eq!(paths.pglite_dir.is_dir(), true);

        let loaded = load_self_host_config_with_paths(paths.clone(), "onequery serve")
            .unwrap_or_else(|error| panic!("expected load to succeed after bootstrap: {error}"));

        assert_eq!(loaded.paths, paths);
        assert_eq!(loaded.config, SelfHostConfig::default());
        assert_eq!(loaded.secrets.auth.secret.is_empty(), false);
        assert_eq!(
            loaded.secrets.crypto.master_encryption_key.is_empty(),
            false
        );
        let generated_master_key = base64::engine::general_purpose::STANDARD
            .decode(loaded.secrets.crypto.master_encryption_key.as_bytes())
            .unwrap_or_else(|error| panic!("expected bootstrap master key to decode: {error}"));
        assert_eq!(
            generated_master_key.len(),
            super::MASTER_ENCRYPTION_KEY_BYTE_LENGTH
        );
        assert_eq!(loaded.secrets.connectors.enrollment_token.is_empty(), false);

        fs::remove_dir_all(test_dir)
            .unwrap_or_else(|error| panic!("expected temp self-host directory cleanup: {error}"));
    }

    #[test]
    fn bootstrap_preserves_existing_server_and_secrets_files() {
        let test_dir =
            std::env::temp_dir().join(format!("onequery-self-host-preserve-{}", Uuid::new_v4()));
        let paths = SelfHostRuntimePaths::for_test(
            test_dir.join("config").join("self-host"),
            test_dir.join("data"),
        );

        fs::create_dir_all(&paths.config_dir)
            .unwrap_or_else(|error| panic!("expected config dir creation to succeed: {error}"));
        fs::write(
            &paths.config_path,
            r#"[server]
listen_host = "0.0.0.0"
port = 7777
public_origin = "https://onequery.example.com"
"#,
        )
        .unwrap_or_else(|error| panic!("expected server config write to succeed: {error}"));
        fs::write(&paths.secrets_path, valid_self_host_secrets_toml())
            .unwrap_or_else(|error| panic!("expected secrets config write to succeed: {error}"));

        let bootstrap = bootstrap_self_host_foundation_with_paths(paths.clone(), "onequery serve")
            .unwrap_or_else(|error| panic!("expected bootstrap to preserve files: {error}"));
        let loaded = load_self_host_config_with_paths(paths, "onequery serve")
            .unwrap_or_else(|error| panic!("expected load to succeed after preserve: {error}"));

        assert_eq!(bootstrap.config_created, false);
        assert_eq!(bootstrap.secrets_created, false);
        assert_eq!(
            loaded.config,
            SelfHostConfig {
                server: ServerSection {
                    listen_host: "0.0.0.0".to_owned(),
                    port: 7777,
                    public_origin: Some("https://onequery.example.com".to_owned()),
                },
                smtp: SmtpConfig::default(),
            }
        );
        assert_eq!(
            loaded.secrets,
            SecretsConfig {
                smtp: SmtpSecrets::default(),
                auth: AuthSecrets {
                    secret: "better".to_owned(),
                },
                crypto: CryptoSecrets {
                    master_encryption_key: TEST_MASTER_ENCRYPTION_KEY.to_owned(),
                },
                connectors: ConnectorSecrets {
                    enrollment_token: "connector".to_owned(),
                },
            }
        );

        fs::remove_dir_all(test_dir)
            .unwrap_or_else(|error| panic!("expected temp self-host directory cleanup: {error}"));
    }

    #[test]
    fn rejects_removed_log_level_in_self_host_config_file() {
        let (test_dir, paths) = create_test_paths("self-host-config-log-level");

        write_valid_self_host_files(&paths);
        fs::write(
            &paths.config_path,
            format!(
                "[server]\nlisten_host = \"127.0.0.1\"\nport = {}\nlog_level = \"debug\"\n",
                default_port()
            ),
        )
        .unwrap_or_else(|error| panic!("expected config write to succeed: {error}"));

        let error = load_self_host_config_with_paths(paths, "onequery serve")
            .expect_err("expected removed log_level key to fail");

        assert_eq!(error.title, "failed to parse self-host config");
        assert_eq!(error.why.contains("log_level"), true);

        fs::remove_dir_all(test_dir)
            .unwrap_or_else(|error| panic!("expected temp self-host directory cleanup: {error}"));
    }

    #[test]
    fn rejects_unknown_keys_in_self_host_secrets_file() {
        let (test_dir, paths) = create_test_paths("self-host-secrets-unknown");

        write_valid_self_host_files(&paths);
        fs::write(
            &paths.secrets_path,
            r#"[auth]
secret = "better"
unexpected = true

[crypto]
master_encryption_key = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="

[connectors]
enrollment_token = "connector"
"#,
        )
        .unwrap_or_else(|error| panic!("expected secrets write to succeed: {error}"));

        let error = load_self_host_config_with_paths(paths, "onequery serve")
            .expect_err("expected unknown secrets key to fail");

        assert_eq!(error.title, "failed to parse secrets config");
        assert_eq!(error.why.contains("unexpected"), true);

        fs::remove_dir_all(test_dir)
            .unwrap_or_else(|error| panic!("expected temp self-host directory cleanup: {error}"));
    }

    #[test]
    fn rejects_secret_keys_in_self_host_config_file() {
        let (test_dir, paths) = create_test_paths("self-host-config-secret-key");

        write_valid_self_host_files(&paths);
        fs::write(
            &paths.config_path,
            format!(
                "[server]\nlisten_host = \"127.0.0.1\"\nport = {}\n\n[auth]\nsecret = \"wrong-file\"\n",
                default_port()
            ),
        )
        .unwrap_or_else(|error| panic!("expected config write to succeed: {error}"));

        let error = load_self_host_config_with_paths(paths, "onequery serve")
            .expect_err("expected misplaced secret key to fail");

        assert_eq!(error.title, "failed to parse self-host config");
        assert_eq!(error.why.contains("auth"), true);

        fs::remove_dir_all(test_dir)
            .unwrap_or_else(|error| panic!("expected temp self-host directory cleanup: {error}"));
    }

    #[test]
    fn rejects_config_keys_in_self_host_secrets_file() {
        let (test_dir, paths) = create_test_paths("self-host-secrets-config-key");

        write_valid_self_host_files(&paths);
        fs::write(
            &paths.secrets_path,
            format!(
                "[auth]\nsecret = \"better\"\n\n[crypto]\nmaster_encryption_key = \"{TEST_MASTER_ENCRYPTION_KEY}\"\n\n[connectors]\nenrollment_token = \"connector\"\n\n[server]\nport = {}\n",
                default_port()
            ),
        )
        .unwrap_or_else(|error| panic!("expected secrets write to succeed: {error}"));

        let error = load_self_host_config_with_paths(paths, "onequery serve")
            .expect_err("expected misplaced config key to fail");

        assert_eq!(error.title, "failed to parse secrets config");
        assert_eq!(error.why.contains("server"), true);

        fs::remove_dir_all(test_dir)
            .unwrap_or_else(|error| panic!("expected temp self-host directory cleanup: {error}"));
    }

    #[test]
    fn write_self_host_launch_config_serializes_runtime_contract() {
        let test_dir =
            std::env::temp_dir().join(format!("onequery-self-host-launch-{}", Uuid::new_v4()));
        let paths = SelfHostRuntimePaths::for_test(
            test_dir.join("config").join("self-host"),
            test_dir.join("data"),
        );
        let asset_dir = test_dir.join("runtime").join("web");

        fs::create_dir_all(&paths.config_dir)
            .unwrap_or_else(|error| panic!("expected config dir creation to succeed: {error}"));
        fs::create_dir_all(&paths.run_dir)
            .unwrap_or_else(|error| panic!("expected run dir creation to succeed: {error}"));
        fs::create_dir_all(&asset_dir)
            .unwrap_or_else(|error| panic!("expected asset dir creation to succeed: {error}"));
        fs::write(
            &paths.config_path,
            r#"[server]
listen_host = "0.0.0.0"
port = 7777

[smtp]
host = "smtp.example.com"
port = 587
from_email = "hello@example.com"
from_name = "OneQuery OSS"
username = "smtp-user"
secure = false
"#,
        )
        .unwrap_or_else(|error| panic!("expected server config write to succeed: {error}"));
        fs::write(
            &paths.secrets_path,
            format!(
                "[auth]\nsecret = \"better\"\n\n[crypto]\nmaster_encryption_key = \"{TEST_MASTER_ENCRYPTION_KEY}\"\n\n[connectors]\nenrollment_token = \"connector\"\n\n[smtp]\npassword = \"smtp-pass\"\n"
            ),
        )
        .unwrap_or_else(|error| panic!("expected secrets config write to succeed: {error}"));

        let launch_config_path = write_self_host_launch_config_for_test(
            paths.clone(),
            &asset_dir,
            Path::new("/tmp/onequery/runtime/migrations"),
            "onequery serve",
        )
        .unwrap_or_else(|error| {
            panic!("expected self-host launch config write to succeed: {error}")
        });
        let launch_config_contents = fs::read_to_string(&launch_config_path)
            .unwrap_or_else(|error| panic!("expected launch config read to succeed: {error}"));
        let launch_config: ServerLaunchConfig = serde_json::from_str(&launch_config_contents)
            .unwrap_or_else(|error| panic!("expected launch config JSON to parse: {error}"));

        assert_eq!(launch_config_path, paths.launch_config_path);
        assert_eq!(
            launch_config.assets.dist_dir,
            asset_dir.display().to_string()
        );
        assert_eq!(launch_config.listen.host, "0.0.0.0".to_owned());
        assert_eq!(launch_config.listen.port, 7777);
        assert_eq!(
            launch_config.migrations,
            super::ServerLaunchMigrationsConfig {
                dir: "/tmp/onequery/runtime/migrations".to_owned(),
            }
        );
        assert_eq!(
            launch_config.public_origin,
            "http://127.0.0.1:7777".to_owned()
        );
        assert_eq!(
            launch_config.runtime_paths.run_dir,
            paths.run_dir.display().to_string()
        );
        assert_eq!(
            launch_config.storage,
            super::ServerLaunchStorageConfig::Pglite {
                dir: paths.pglite_dir.display().to_string(),
            }
        );
        assert_eq!(
            launch_config.smtp,
            Some(super::ServerLaunchSmtpConfig {
                from_email: "hello@example.com".to_owned(),
                from_name: Some("OneQuery OSS".to_owned()),
                host: "smtp.example.com".to_owned(),
                password: Some("smtp-pass".to_owned()),
                port: 587,
                secure: Some(false),
                username: Some("smtp-user".to_owned()),
            })
        );

        fs::remove_dir_all(test_dir)
            .unwrap_or_else(|error| panic!("expected temp self-host directory cleanup: {error}"));
    }

    #[test]
    fn rejects_invalid_master_encryption_key_before_runtime_launch() {
        let (test_dir, paths) = create_test_paths("self-host-invalid-master-key");

        fs::create_dir_all(&paths.config_dir)
            .unwrap_or_else(|error| panic!("expected config dir creation to succeed: {error}"));
        fs::write(&paths.config_path, valid_self_host_config_toml())
            .unwrap_or_else(|error| panic!("expected config write to succeed: {error}"));
        fs::write(
            &paths.secrets_path,
            "[auth]\nsecret = \"better\"\n\n[crypto]\nmaster_encryption_key = \"master\"\n\n[connectors]\nenrollment_token = \"connector\"\n",
        )
        .unwrap_or_else(|error| panic!("expected secrets write to succeed: {error}"));

        let error = load_self_host_config_with_paths(paths.clone(), "onequery serve")
            .expect_err("expected invalid master key to fail before runtime launch");

        assert_eq!(error.title, "invalid self-host secrets config");
        assert_eq!(
            error.why,
            format!(
                "{} -> crypto.master_encryption_key: must be base64 that decodes to exactly 32 bytes",
                paths.secrets_path.display()
            )
        );

        fs::remove_dir_all(test_dir)
            .unwrap_or_else(|error| panic!("expected temp self-host directory cleanup: {error}"));
    }
}
