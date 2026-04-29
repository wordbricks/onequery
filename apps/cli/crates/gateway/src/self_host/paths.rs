use std::path::PathBuf;

use onequery_core::app_paths::config_dir;
use onequery_core::app_paths::data_dir;
use onequery_core::error::CliError;

use crate::self_host_paths::launch_config_path_for_launch;
use crate::self_host_paths::runtime_control_socket_path_for_runtime;

use super::config::SELF_HOST_CONFIG_DIR_NAME;

const CONFIG_FILENAME: &str = "config.toml";
const SECRETS_CONFIG_FILENAME: &str = "secrets.toml";
const PGLITE_DIRNAME: &str = "onequery";
const SERVER_LOG_FILENAME: &str = "server.log";
const RUNTIME_LEASE_FILENAME: &str = "runtime.lease.json";
const RUNTIME_STATUS_SNAPSHOT_FILENAME: &str = "runtime.status.json";
const SUPERVISOR_STATUS_SNAPSHOT_FILENAME: &str = "supervisor.status.json";
const LIFECYCLE_EVENT_LOG_FILENAME: &str = "lifecycle.events.pb";
const RELEASES_DIR_NAME: &str = "releases";
const ACTIVE_RELEASE_FILENAME: &str = "active.json";
const RECOVERY_POINTS_DIR_NAME: &str = "recovery-points";
const UPGRADE_TRANSACTION_FILENAME: &str = "upgrade-transaction.json";

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct SelfHostRuntimePaths {
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
    pub config_path: PathBuf,
    pub secrets_path: PathBuf,
    pub pglite_dir: PathBuf,
    pub logs_dir: PathBuf,
    pub server_log_path: PathBuf,
    pub backups_dir: PathBuf,
    pub run_dir: PathBuf,
    pub runtime_control_socket_path: PathBuf,
    pub runtime_lease_path: PathBuf,
    pub runtime_status_snapshot_path: PathBuf,
    pub supervisor_status_snapshot_path: PathBuf,
    pub lifecycle_event_log_path: PathBuf,
    pub releases_dir: PathBuf,
    pub active_release_path: PathBuf,
    pub recovery_points_dir: PathBuf,
    pub upgrade_transaction_path: PathBuf,
}

impl SelfHostRuntimePaths {
    pub fn from_dirs(config_dir: PathBuf, data_dir: PathBuf) -> Self {
        let config_path = config_dir.join(CONFIG_FILENAME);
        let secrets_path = config_dir.join(SECRETS_CONFIG_FILENAME);
        let pglite_dir = data_dir.join("pglite").join(PGLITE_DIRNAME);
        let logs_dir = data_dir.join("logs");
        let server_log_path = logs_dir.join(SERVER_LOG_FILENAME);
        let backups_dir = data_dir.join("backups");
        let run_dir = data_dir.join("run");
        let runtime_control_socket_path =
            runtime_control_socket_path_for_runtime(data_dir.as_path(), run_dir.as_path());
        let runtime_lease_path = run_dir.join(RUNTIME_LEASE_FILENAME);
        let runtime_status_snapshot_path = run_dir.join(RUNTIME_STATUS_SNAPSHOT_FILENAME);
        let supervisor_status_snapshot_path = run_dir.join(SUPERVISOR_STATUS_SNAPSHOT_FILENAME);
        let lifecycle_event_log_path = run_dir.join(LIFECYCLE_EVENT_LOG_FILENAME);
        let releases_dir = data_dir.join(RELEASES_DIR_NAME);
        let active_release_path = releases_dir.join(ACTIVE_RELEASE_FILENAME);
        let recovery_points_dir = data_dir.join(RECOVERY_POINTS_DIR_NAME);
        let upgrade_transaction_path = run_dir.join(UPGRADE_TRANSACTION_FILENAME);

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
            runtime_control_socket_path,
            runtime_lease_path,
            runtime_status_snapshot_path,
            supervisor_status_snapshot_path,
            lifecycle_event_log_path,
            releases_dir,
            active_release_path,
            recovery_points_dir,
            upgrade_transaction_path,
        }
    }
}

pub fn self_host_runtime_paths(command_line: &str) -> Result<SelfHostRuntimePaths, CliError> {
    Ok(SelfHostRuntimePaths::from_dirs(
        config_dir(command_line)?.join(SELF_HOST_CONFIG_DIR_NAME),
        data_dir(command_line)?,
    ))
}

pub(crate) fn self_host_launch_config_path_for_launch(
    paths: &SelfHostRuntimePaths,
    launch_id: &str,
) -> PathBuf {
    launch_config_path_for_launch(paths.run_dir.as_path(), launch_id)
}
