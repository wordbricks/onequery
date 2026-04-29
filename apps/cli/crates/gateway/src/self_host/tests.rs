use std::fs;
use std::path::Path;
use std::path::PathBuf;

use base64::Engine as _;
use pretty_assertions::assert_eq;
use pretty_assertions::assert_ne;
use uuid::Uuid;

use super::bootstrap::bootstrap_self_host_foundation;
use super::bootstrap::load_self_host_config;
use super::bootstrap::load_self_host_public_config;
use super::config::SelfHostConfig;
use super::config::ServerSection;
use super::config::SmtpConfig;
use super::config::default_port;
use super::launch_config::ServerLaunchApiRateLimitConfig;
use super::launch_config::ServerLaunchApiRateLimitStorage;
use super::launch_config::ServerLaunchConfig;
use super::launch_config::ServerLaunchMigrationsConfig;
use super::launch_config::ServerLaunchRateLimitConfig;
use super::launch_config::ServerLaunchSmtpConfig;
use super::launch_config::ServerLaunchStorageConfig;
use super::launch_config::ServerLaunchSupervisorConfig;
use super::launch_config::write_self_host_launch_config;
use super::launch_config::write_self_host_launch_supervisor_identity;
use super::paths::SelfHostRuntimePaths;
use super::paths::self_host_launch_config_path_for_launch;
use super::secrets::AuthSecrets;
use super::secrets::ConnectorSecrets;
use super::secrets::CryptoSecrets;
use super::secrets::MASTER_ENCRYPTION_KEY_BYTE_LENGTH;
use super::secrets::SecretsConfig;
use super::secrets::SmtpSecrets;
use crate::self_host_paths::runtime_control_socket_path_for_runtime;

const TEST_MASTER_ENCRYPTION_KEY: &str = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";

fn create_test_paths(label: &str) -> (PathBuf, SelfHostRuntimePaths) {
    let test_dir = std::env::temp_dir().join(format!("onequery-{label}-{}", Uuid::new_v4()));
    let paths = SelfHostRuntimePaths::from_dirs(test_dir.join("self-host"), test_dir.clone());

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
fn runtime_paths_follow_self_host_layout_contract() {
    let paths = SelfHostRuntimePaths::from_dirs(
        PathBuf::from("/home/alice/.onequery/self-host"),
        PathBuf::from("/home/alice/.onequery"),
    );

    let expected = SelfHostRuntimePaths {
        config_dir: PathBuf::from("/home/alice/.onequery/self-host"),
        data_dir: PathBuf::from("/home/alice/.onequery"),
        config_path: PathBuf::from("/home/alice/.onequery/self-host/config.toml"),
        secrets_path: PathBuf::from("/home/alice/.onequery/self-host/secrets.toml"),
        pglite_dir: PathBuf::from("/home/alice/.onequery/pglite/onequery"),
        logs_dir: PathBuf::from("/home/alice/.onequery/logs"),
        server_log_path: PathBuf::from("/home/alice/.onequery/logs/server.log"),
        backups_dir: PathBuf::from("/home/alice/.onequery/backups"),
        run_dir: PathBuf::from("/home/alice/.onequery/run"),
        runtime_control_socket_path: runtime_control_socket_path_for_runtime(
            Path::new("/home/alice/.onequery"),
            Path::new("/home/alice/.onequery/run"),
        ),
        runtime_lease_path: PathBuf::from("/home/alice/.onequery/run/runtime.lease.json"),
        runtime_status_snapshot_path: PathBuf::from(
            "/home/alice/.onequery/run/runtime.status.json",
        ),
        supervisor_status_snapshot_path: PathBuf::from(
            "/home/alice/.onequery/run/supervisor.status.json",
        ),
        lifecycle_event_log_path: PathBuf::from("/home/alice/.onequery/run/lifecycle.events.pb"),
        releases_dir: PathBuf::from("/home/alice/.onequery/releases"),
        active_release_path: PathBuf::from("/home/alice/.onequery/releases/active.json"),
        recovery_points_dir: PathBuf::from("/home/alice/.onequery/recovery-points"),
        upgrade_transaction_path: PathBuf::from(
            "/home/alice/.onequery/run/upgrade-transaction.json",
        ),
    };

    assert_eq!(paths, expected);
}

#[test]
fn bootstrap_creates_self_host_config_files_and_runtime_directories() {
    let test_dir =
        std::env::temp_dir().join(format!("onequery-self-host-bootstrap-{}", Uuid::new_v4()));
    let paths = SelfHostRuntimePaths::from_dirs(test_dir.join("self-host"), test_dir.clone());

    let bootstrap = bootstrap_self_host_foundation(&paths, "onequery gateway")
        .unwrap_or_else(|error| panic!("expected bootstrap to succeed: {error}"));

    assert!(bootstrap.config_created);
    assert!(bootstrap.secrets_created);
    assert_eq!(bootstrap.paths, paths);
    assert!(paths.config_dir.is_dir());
    assert!(paths.data_dir.is_dir());
    assert!(paths.logs_dir.is_dir());
    assert!(paths.backups_dir.is_dir());
    assert!(paths.releases_dir.is_dir());
    assert!(paths.recovery_points_dir.is_dir());
    assert!(paths.run_dir.is_dir());
    assert!(paths.pglite_dir.is_dir());

    let loaded = load_self_host_config(&paths, "onequery gateway")
        .unwrap_or_else(|error| panic!("expected load to succeed after bootstrap: {error}"));

    assert_eq!(loaded.paths, paths);
    assert_eq!(loaded.config, SelfHostConfig::default());
    assert!(!loaded.secrets.auth.secret.is_empty());
    assert!(!loaded.secrets.crypto.master_encryption_key.is_empty());
    let generated_master_key = base64::engine::general_purpose::STANDARD
        .decode(loaded.secrets.crypto.master_encryption_key.as_bytes())
        .unwrap_or_else(|error| panic!("expected bootstrap master key to decode: {error}"));
    assert_eq!(
        generated_master_key.len(),
        MASTER_ENCRYPTION_KEY_BYTE_LENGTH
    );
    let generated_auth_secret = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(loaded.secrets.auth.secret.as_bytes())
        .unwrap_or_else(|error| panic!("expected bootstrap auth secret to decode: {error}"));
    assert_eq!(
        generated_auth_secret.len(),
        MASTER_ENCRYPTION_KEY_BYTE_LENGTH
    );
    let generated_enrollment_token = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(loaded.secrets.connectors.enrollment_token.as_bytes())
        .unwrap_or_else(|error| panic!("expected bootstrap enrollment token to decode: {error}"));
    assert_eq!(
        generated_enrollment_token.len(),
        MASTER_ENCRYPTION_KEY_BYTE_LENGTH
    );

    fs::remove_dir_all(test_dir)
        .unwrap_or_else(|error| panic!("expected temp self-host directory cleanup: {error}"));
}

#[test]
fn bootstrap_preserves_existing_server_and_secrets_files() {
    let test_dir =
        std::env::temp_dir().join(format!("onequery-self-host-preserve-{}", Uuid::new_v4()));
    let paths = SelfHostRuntimePaths::from_dirs(test_dir.join("self-host"), test_dir.clone());

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

    let bootstrap = bootstrap_self_host_foundation(&paths, "onequery gateway")
        .unwrap_or_else(|error| panic!("expected bootstrap to preserve files: {error}"));
    let loaded = load_self_host_config(&paths, "onequery gateway")
        .unwrap_or_else(|error| panic!("expected load to succeed after preserve: {error}"));

    assert!(!bootstrap.config_created);
    assert!(!bootstrap.secrets_created);
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
fn public_config_can_load_without_secrets_file() {
    let (test_dir, paths) = create_test_paths("self-host-public-config");

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
    .unwrap_or_else(|error| panic!("expected config write to succeed: {error}"));

    let config = load_self_host_public_config(&paths, "onequery gateway").unwrap_or_else(|error| {
        panic!("expected self-host public config load to succeed: {error}")
    });

    assert_eq!(
        config,
        SelfHostConfig {
            server: ServerSection {
                listen_host: "0.0.0.0".to_owned(),
                port: 7777,
                public_origin: Some("https://onequery.example.com".to_owned()),
            },
            smtp: SmtpConfig::default(),
        }
    );

    fs::remove_dir_all(test_dir)
        .unwrap_or_else(|error| panic!("expected temp self-host directory cleanup: {error}"));
}

#[test]
fn rejects_unsupported_log_level_in_self_host_config_file() {
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

    let error = load_self_host_config(&paths, "onequery gateway")
        .expect_err("expected unsupported log_level key to fail");

    assert_eq!(error.title, "failed to parse self-host config");
    assert!(error.why.contains("log_level"));

    fs::remove_dir_all(test_dir)
        .unwrap_or_else(|error| panic!("expected temp self-host directory cleanup: {error}"));
}

#[test]
fn rejects_unknown_keys_in_self_host_secrets_file() {
    let (test_dir, paths) = create_test_paths("self-host-secrets-unknown");

    write_valid_self_host_files(&paths);
    fs::write(
        &paths.secrets_path,
        format!(
            "[auth]\nsecret = \"better\"\nunexpected = true\n\n[crypto]\nmaster_encryption_key = \"{TEST_MASTER_ENCRYPTION_KEY}\"\n\n[connectors]\nenrollment_token = \"connector\"\n"
        ),
    )
    .unwrap_or_else(|error| panic!("expected secrets write to succeed: {error}"));

    let error = load_self_host_config(&paths, "onequery gateway")
        .expect_err("expected unknown secrets key to fail");

    assert_eq!(error.title, "failed to parse secrets config");
    assert!(error.why.contains("unexpected"));

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

    let error = load_self_host_config(&paths, "onequery gateway")
        .expect_err("expected misplaced secret key to fail");

    assert_eq!(error.title, "failed to parse self-host config");
    assert!(error.why.contains("auth"));

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

    let error = load_self_host_config(&paths, "onequery gateway")
        .expect_err("expected misplaced config key to fail");

    assert_eq!(error.title, "failed to parse secrets config");
    assert!(error.why.contains("server"));

    fs::remove_dir_all(test_dir)
        .unwrap_or_else(|error| panic!("expected temp self-host directory cleanup: {error}"));
}

#[test]
fn write_self_host_launch_config_serializes_runtime_contract() {
    let test_dir =
        std::env::temp_dir().join(format!("onequery-self-host-launch-{}", Uuid::new_v4()));
    let paths = SelfHostRuntimePaths::from_dirs(test_dir.join("self-host"), test_dir.clone());
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

    let launch_config_path = write_self_host_launch_config(
        &paths,
        "onequery gateway",
        &asset_dir,
        Path::new("/tmp/onequery/runtime/migrations"),
        "launch-a",
    )
    .unwrap_or_else(|error| panic!("expected self-host launch config write to succeed: {error}"));
    let launch_config_contents = fs::read_to_string(&launch_config_path)
        .unwrap_or_else(|error| panic!("expected launch config read to succeed: {error}"));
    let launch_config: ServerLaunchConfig = serde_json::from_str(&launch_config_contents)
        .unwrap_or_else(|error| panic!("expected launch config JSON to parse: {error}"));

    assert_eq!(
        launch_config_path,
        self_host_launch_config_path_for_launch(&paths, "launch-a")
    );
    assert!(!paths.run_dir.join("launch.json").is_file());
    assert_eq!(
        launch_config.assets.dist_dir,
        asset_dir.display().to_string()
    );
    assert_eq!(launch_config.listen.host, "0.0.0.0".to_owned());
    assert_eq!(launch_config.listen.port, 7777);
    assert_eq!(
        launch_config.migrations,
        ServerLaunchMigrationsConfig {
            dir: "/tmp/onequery/runtime/migrations".to_owned(),
        }
    );
    assert_eq!(launch_config.launch_id, "launch-a".to_owned());
    assert_eq!(launch_config.supervisor, None);
    assert_eq!(
        launch_config.public_origin,
        "http://127.0.0.1:7777".to_owned()
    );
    assert_eq!(
        launch_config.rate_limit,
        ServerLaunchRateLimitConfig {
            api: ServerLaunchApiRateLimitConfig {
                storage: ServerLaunchApiRateLimitStorage::Persistent,
            },
            enabled: true,
        }
    );
    assert_eq!(
        launch_config.runtime_paths.run_dir,
        paths.run_dir.display().to_string()
    );
    assert_eq!(
        launch_config.storage,
        ServerLaunchStorageConfig::Pglite {
            dir: paths.pglite_dir.display().to_string(),
        }
    );
    assert_eq!(
        launch_config.smtp,
        Some(ServerLaunchSmtpConfig {
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
fn write_self_host_launch_supervisor_identity_stamps_runtime_launch_config() {
    let (test_dir, paths) = create_test_paths("self-host-launch-supervisor");
    let asset_dir = test_dir.join("runtime").join("web");
    let migrations_dir = test_dir.join("runtime").join("migrations");

    write_valid_self_host_files(&paths);
    fs::create_dir_all(&paths.run_dir)
        .unwrap_or_else(|error| panic!("expected run dir creation to succeed: {error}"));
    fs::create_dir_all(&asset_dir)
        .unwrap_or_else(|error| panic!("expected asset dir creation to succeed: {error}"));

    let launch_config_path = write_self_host_launch_config(
        &paths,
        "onequery gateway",
        &asset_dir,
        &migrations_dir,
        "launch-a",
    )
    .unwrap_or_else(|error| panic!("expected launch config write to succeed: {error}"));

    write_self_host_launch_supervisor_identity(
        launch_config_path.as_path(),
        "onequery gateway",
        ServerLaunchSupervisorConfig {
            generation: "42".to_owned(),
            pid: 1001,
            supervisor_id: "gateway-supervisor:1001".to_owned(),
        },
    )
    .unwrap_or_else(|error| panic!("expected supervisor identity stamp to succeed: {error}"));

    let launch_config_contents = fs::read_to_string(&launch_config_path)
        .unwrap_or_else(|error| panic!("expected launch config read to succeed: {error}"));
    let launch_config: ServerLaunchConfig = serde_json::from_str(&launch_config_contents)
        .unwrap_or_else(|error| panic!("expected launch config JSON to parse: {error}"));

    assert_eq!(
        launch_config.supervisor,
        Some(ServerLaunchSupervisorConfig {
            generation: "42".to_owned(),
            pid: 1001,
            supervisor_id: "gateway-supervisor:1001".to_owned(),
        })
    );
    assert_eq!(launch_config.launch_id, "launch-a".to_owned());

    fs::remove_dir_all(test_dir)
        .unwrap_or_else(|error| panic!("expected temp self-host directory cleanup: {error}"));
}

#[test]
fn write_self_host_launch_config_does_not_overwrite_other_launches() {
    let (test_dir, paths) = create_test_paths("self-host-launch-scoped");
    let asset_dir = test_dir.join("runtime").join("web");
    let migrations_dir = test_dir.join("runtime").join("migrations");

    write_valid_self_host_files(&paths);
    fs::create_dir_all(&paths.run_dir)
        .unwrap_or_else(|error| panic!("expected run dir creation to succeed: {error}"));
    fs::create_dir_all(&asset_dir)
        .unwrap_or_else(|error| panic!("expected asset dir creation to succeed: {error}"));

    let launch_a_path = write_self_host_launch_config(
        &paths,
        "onequery gateway",
        &asset_dir,
        &migrations_dir,
        "launch-a",
    )
    .unwrap_or_else(|error| panic!("expected launch-a config write to succeed: {error}"));
    let launch_b_path = write_self_host_launch_config(
        &paths,
        "onequery gateway",
        &asset_dir,
        &migrations_dir,
        "launch-b",
    )
    .unwrap_or_else(|error| panic!("expected launch-b config write to succeed: {error}"));

    let launch_a_contents = fs::read_to_string(&launch_a_path)
        .unwrap_or_else(|error| panic!("expected launch-a config read: {error}"));
    let launch_a_config: ServerLaunchConfig = serde_json::from_str(&launch_a_contents)
        .unwrap_or_else(|error| panic!("expected launch-a config parse: {error}"));
    let launch_b_contents = fs::read_to_string(&launch_b_path)
        .unwrap_or_else(|error| panic!("expected launch-b config read: {error}"));
    let launch_b_config: ServerLaunchConfig = serde_json::from_str(&launch_b_contents)
        .unwrap_or_else(|error| panic!("expected launch-b config parse: {error}"));

    assert_ne!(launch_a_path, launch_b_path);
    assert_eq!(
        launch_a_path,
        self_host_launch_config_path_for_launch(&paths, "launch-a")
    );
    assert_eq!(
        launch_b_path,
        self_host_launch_config_path_for_launch(&paths, "launch-b")
    );
    assert_eq!(launch_a_config.launch_id, "launch-a".to_owned());
    assert_eq!(launch_b_config.launch_id, "launch-b".to_owned());
    assert!(!paths.run_dir.join("launch.json").is_file());

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

    let error = load_self_host_config(&paths, "onequery gateway")
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

#[test]
fn rejects_empty_auth_secret_before_runtime_launch() {
    let (test_dir, paths) = create_test_paths("self-host-empty-auth-secret");

    fs::create_dir_all(&paths.config_dir)
        .unwrap_or_else(|error| panic!("expected config dir creation to succeed: {error}"));
    fs::write(&paths.config_path, valid_self_host_config_toml())
        .unwrap_or_else(|error| panic!("expected config write to succeed: {error}"));
    fs::write(
        &paths.secrets_path,
        format!(
            "[auth]\nsecret = \"\"\n\n[crypto]\nmaster_encryption_key = \"{TEST_MASTER_ENCRYPTION_KEY}\"\n\n[connectors]\nenrollment_token = \"connector\"\n"
        ),
    )
    .unwrap_or_else(|error| panic!("expected secrets write to succeed: {error}"));

    let error = load_self_host_config(&paths, "onequery gateway")
        .expect_err("expected empty auth secret to fail before runtime launch");

    assert_eq!(error.title, "invalid self-host secrets config");
    assert_eq!(
        error.why,
        format!(
            "{} -> auth.secret: must not be empty",
            paths.secrets_path.display()
        )
    );

    fs::remove_dir_all(test_dir)
        .unwrap_or_else(|error| panic!("expected temp self-host directory cleanup: {error}"));
}

#[test]
fn rejects_whitespace_connector_enrollment_token_before_runtime_launch() {
    let (test_dir, paths) = create_test_paths("self-host-whitespace-enrollment-token");

    fs::create_dir_all(&paths.config_dir)
        .unwrap_or_else(|error| panic!("expected config dir creation to succeed: {error}"));
    fs::write(&paths.config_path, valid_self_host_config_toml())
        .unwrap_or_else(|error| panic!("expected config write to succeed: {error}"));
    fs::write(
        &paths.secrets_path,
        format!(
            "[auth]\nsecret = \"better\"\n\n[crypto]\nmaster_encryption_key = \"{TEST_MASTER_ENCRYPTION_KEY}\"\n\n[connectors]\nenrollment_token = \"   \"\n"
        ),
    )
    .unwrap_or_else(|error| panic!("expected secrets write to succeed: {error}"));

    let error = load_self_host_config(&paths, "onequery gateway")
        .expect_err("expected whitespace enrollment token to fail before runtime launch");

    assert_eq!(error.title, "invalid self-host secrets config");
    assert_eq!(
        error.why,
        format!(
            "{} -> connectors.enrollment_token: must not be empty",
            paths.secrets_path.display()
        )
    );

    fs::remove_dir_all(test_dir)
        .unwrap_or_else(|error| panic!("expected temp self-host directory cleanup: {error}"));
}
