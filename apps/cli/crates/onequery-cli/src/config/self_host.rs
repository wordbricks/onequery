use std::fs;
use std::path::Path;
use std::path::PathBuf;

use serde::Deserialize;
use serde::Serialize;
use serde::de::DeserializeOwned;
use uuid::Uuid;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;

use super::config_dir;
use super::data_dir;
use crate::path_utils;

const SELF_HOST_CONFIG_DIR_NAME: &str = "self-host";
const CONFIG_FILENAME: &str = "config.toml";
const SECRETS_CONFIG_FILENAME: &str = "secrets.toml";
const SQLITE_FILENAME: &str = "onequery.sqlite";
const SERVER_LOG_FILENAME: &str = "server.log";
const PID_FILENAME: &str = "server.pid";
const LOCK_FILENAME: &str = "server.lock";

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct SelfHostRuntimePaths {
    pub(crate) config_dir: PathBuf,
    pub(crate) data_dir: PathBuf,
    pub(crate) config_path: PathBuf,
    pub(crate) secrets_path: PathBuf,
    pub(crate) sqlite_path: PathBuf,
    pub(crate) logs_dir: PathBuf,
    pub(crate) server_log_path: PathBuf,
    pub(crate) backups_dir: PathBuf,
    pub(crate) run_dir: PathBuf,
    pub(crate) pid_path: PathBuf,
    pub(crate) lock_path: PathBuf,
}

impl SelfHostRuntimePaths {
    fn from_dirs(config_dir: PathBuf, data_dir: PathBuf) -> Self {
        let config_path = config_dir.join(CONFIG_FILENAME);
        let secrets_path = config_dir.join(SECRETS_CONFIG_FILENAME);
        let sqlite_path = data_dir.join("sqlite").join(SQLITE_FILENAME);
        let logs_dir = data_dir.join("logs");
        let server_log_path = logs_dir.join(SERVER_LOG_FILENAME);
        let backups_dir = data_dir.join("backups");
        let run_dir = data_dir.join("run");
        let pid_path = run_dir.join(PID_FILENAME);
        let lock_path = run_dir.join(LOCK_FILENAME);

        Self {
            config_dir,
            data_dir,
            config_path,
            secrets_path,
            sqlite_path,
            logs_dir,
            server_log_path,
            backups_dir,
            run_dir,
            pid_path,
            lock_path,
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
#[serde(default)]
#[derive(Default)]
pub(crate) struct SelfHostConfig {
    #[serde(default)]
    pub(crate) server: ServerSection,
    #[serde(default, skip_serializing_if = "SmtpConfig::is_empty")]
    pub(crate) smtp: SmtpConfig,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default)]
pub(crate) struct ServerSection {
    #[serde(default = "default_listen_host")]
    pub(crate) listen_host: String,
    #[serde(default = "default_port")]
    pub(crate) port: u16,
    #[serde(default = "default_log_level")]
    pub(crate) log_level: String,
    #[serde(default)]
    pub(crate) public_origin: Option<String>,
}

impl Default for ServerSection {
    fn default() -> Self {
        Self {
            listen_host: default_listen_host(),
            port: default_port(),
            log_level: default_log_level(),
            public_origin: None,
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default)]
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
    "127.0.0.1".to_owned()
}

fn default_port() -> u16 {
    4545
}

fn default_log_level() -> String {
    "info".to_owned()
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct SecretsConfig {
    #[serde(default, skip_serializing_if = "SmtpSecrets::is_empty")]
    pub(crate) smtp: SmtpSecrets,
    pub(crate) auth: AuthSecrets,
    pub(crate) crypto: CryptoSecrets,
    pub(crate) connectors: ConnectorSecrets,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct AuthSecrets {
    pub(crate) better_auth_secret: String,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct CryptoSecrets {
    pub(crate) master_encryption_key: String,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct ConnectorSecrets {
    pub(crate) enrollment_token: String,
}

#[derive(Debug, Clone, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(default)]
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
                better_auth_secret: generate_secret("better-auth"),
            },
            crypto: CryptoSecrets {
                master_encryption_key: generate_secret("master-encryption"),
            },
            connectors: ConnectorSecrets {
                enrollment_token: generate_secret("connector-enrollment"),
            },
        }
    }
}

fn generate_secret(label: &str) -> String {
    format!("{}_{}", label, Uuid::new_v4().simple())
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
        sqlite_dir(&paths),
        command_line,
        ErrorStage::LoadConfig,
        "sqlite",
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
    Ok(SelfHostConfigBundle {
        config: load_toml_file(&paths.config_path, command_line, "self-host config")?,
        secrets: load_toml_file(&paths.secrets_path, command_line, "secrets config")?,
        paths,
    })
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

fn sqlite_dir(paths: &SelfHostRuntimePaths) -> &Path {
    paths
        .sqlite_path
        .parent()
        .unwrap_or(paths.data_dir.as_path())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use pretty_assertions::assert_eq;

    use super::AuthSecrets;
    use super::ConnectorSecrets;
    use super::CryptoSecrets;
    use super::SecretsConfig;
    use super::SelfHostConfig;
    use super::SelfHostRuntimePaths;
    use super::ServerSection;
    use super::SmtpConfig;
    use super::SmtpSecrets;
    use super::bootstrap_self_host_foundation_with_paths;
    use super::load_self_host_config_with_paths;

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
            paths.sqlite_path,
            PathBuf::from("/data/onequery/sqlite/onequery.sqlite")
        );
        assert_eq!(paths.logs_dir, PathBuf::from("/data/onequery/logs"));
        assert_eq!(
            paths.server_log_path,
            PathBuf::from("/data/onequery/logs/server.log")
        );
        assert_eq!(paths.backups_dir, PathBuf::from("/data/onequery/backups"));
        assert_eq!(paths.pid_path, PathBuf::from("/data/onequery/run/server.pid"));
        assert_eq!(
            paths.lock_path,
            PathBuf::from("/data/onequery/run/server.lock")
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

        let bootstrap = bootstrap_self_host_foundation_with_paths(paths.clone(), "oneq serve")
            .unwrap_or_else(|error| panic!("expected bootstrap to succeed: {error}"));

        assert_eq!(bootstrap.config_created, true);
        assert_eq!(bootstrap.secrets_created, true);
        assert_eq!(bootstrap.paths, paths);
        assert_eq!(paths.config_dir.is_dir(), true);
        assert_eq!(paths.data_dir.is_dir(), true);
        assert_eq!(paths.logs_dir.is_dir(), true);
        assert_eq!(paths.backups_dir.is_dir(), true);
        assert_eq!(paths.run_dir.is_dir(), true);
        assert_eq!(
            paths.sqlite_path.parent().expect("sqlite parent").is_dir(),
            true
        );

        let loaded = load_self_host_config_with_paths(paths.clone(), "oneq serve")
            .unwrap_or_else(|error| panic!("expected load to succeed after bootstrap: {error}"));

        assert_eq!(loaded.paths, paths);
        assert_eq!(loaded.config, SelfHostConfig::default());
        assert_eq!(loaded.secrets.auth.better_auth_secret.is_empty(), false);
        assert_eq!(
            loaded.secrets.crypto.master_encryption_key.is_empty(),
            false
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
log_level = "debug"
public_origin = "https://onequery.example.com"
"#,
        )
        .unwrap_or_else(|error| panic!("expected server config write to succeed: {error}"));
        fs::write(
            &paths.secrets_path,
            r#"[auth]
better_auth_secret = "better"

[crypto]
master_encryption_key = "master"

[connectors]
enrollment_token = "connector"
"#,
        )
        .unwrap_or_else(|error| panic!("expected secrets config write to succeed: {error}"));

        let bootstrap = bootstrap_self_host_foundation_with_paths(paths.clone(), "oneq serve")
            .unwrap_or_else(|error| panic!("expected bootstrap to preserve files: {error}"));
        let loaded = load_self_host_config_with_paths(paths, "oneq serve")
            .unwrap_or_else(|error| panic!("expected load to succeed after preserve: {error}"));

        assert_eq!(bootstrap.config_created, false);
        assert_eq!(bootstrap.secrets_created, false);
        assert_eq!(
            loaded.config,
            SelfHostConfig {
                server: ServerSection {
                    listen_host: "0.0.0.0".to_owned(),
                    port: 7777,
                    log_level: "debug".to_owned(),
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
                    better_auth_secret: "better".to_owned(),
                },
                crypto: CryptoSecrets {
                    master_encryption_key: "master".to_owned(),
                },
                connectors: ConnectorSecrets {
                    enrollment_token: "connector".to_owned(),
                },
            }
        );

        fs::remove_dir_all(test_dir)
            .unwrap_or_else(|error| panic!("expected temp self-host directory cleanup: {error}"));
    }

    use std::path::PathBuf;
    use uuid::Uuid;
}
