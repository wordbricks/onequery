use serde_json::json;

use crate::GatewayCommandOutput;
use crate::self_host::SelfHostConfig;
use crate::self_host::SelfHostRuntimePaths;

use super::runtime::LogPreview;
use super::runtime::RuntimeControlStatus;
use super::runtime::read_managed_runtime_pid;
use super::state::GatewayRuntimeState;

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum RuntimeStatus<'a> {
    Live(&'a RuntimeControlStatus),
    Running,
    StaleDurableRecords,
    NotRunning,
    NotInitialized,
}

impl RuntimeStatus<'_> {
    const fn is_running(self) -> bool {
        matches!(self, Self::Live(_) | Self::Running)
    }

    fn label(self) -> &'static str {
        match self {
            Self::Live(status) => status.phase.label(),
            Self::Running => "running",
            Self::StaleDurableRecords => "stale_durable_records",
            Self::NotRunning => "not_running",
            Self::NotInitialized => "not_initialized",
        }
    }
}

#[cfg(test)]
pub(super) fn render_gateway_output(state: &GatewayRuntimeState) -> GatewayCommandOutput {
    let listen = server_listen_label(state.config.as_ref());

    GatewayCommandOutput::structured(
        vec![
            "Gateway foundation ready.".to_owned(),
            format!("Config dir: {}", state.paths.config_dir.display()),
            format!("Data dir: {}", state.paths.data_dir.display()),
            format!("Listen: {listen}"),
            format!(
                "Created self-host config.toml: {}",
                yes_no_label(state.config_created)
            ),
            format!(
                "Created secrets.toml: {}",
                yes_no_label(state.secrets_created)
            ),
            "Next steps: onequery gateway (foreground) or onequery gateway start (background)"
                .to_owned(),
        ],
        json!({
            "kind": "gateway",
            "phase": "skeleton",
            "bootstrapped": state.bootstrapped,
            "configCreated": state.config_created,
            "secretsCreated": state.secrets_created,
            "server": state.config.as_ref().map(server_json),
            "runtimeState": runtime_state_json(state),
            "paths": paths_json(&state.paths),
        }),
    )
}

pub(super) fn render_gateway_start_output(
    state: &GatewayRuntimeState,
    started_pid: u32,
) -> GatewayCommandOutput {
    let listen = server_listen_label(state.config.as_ref());

    GatewayCommandOutput::structured(
        vec![
            "Gateway started in background.".to_owned(),
            format!("PID: {started_pid}"),
            format!("Listen: {listen}"),
            format!("Log path: {}", state.paths.server_log_path.display()),
            "Next steps: onequery gateway status | onequery gateway logs | onequery gateway stop"
                .to_owned(),
        ],
        json!({
            "kind": "gateway-start",
            "phase": "managed",
            "bootstrapped": state.bootstrapped,
            "processStarted": true,
            "startedPid": started_pid,
            "server": state.config.as_ref().map(server_json),
            "runtimeState": runtime_state_json(state),
            "paths": paths_json(&state.paths),
        }),
    )
}

#[cfg(test)]
pub(super) fn render_gateway_status_output(state: &GatewayRuntimeState) -> GatewayCommandOutput {
    render_gateway_status_output_with_live_status(state, None)
}

pub(super) fn render_gateway_status_output_with_live_status(
    state: &GatewayRuntimeState,
    live_status: Option<&RuntimeControlStatus>,
) -> GatewayCommandOutput {
    let listen = server_listen_label(state.config.as_ref());
    let runtime_status = resolve_runtime_status(state, live_status);

    GatewayCommandOutput::structured(
        vec![
            "Gateway status".to_owned(),
            format!("Bootstrapped: {}", yes_no_label(state.bootstrapped)),
            format!("Listen: {listen}"),
            format!("Runtime: {}", runtime_status.label()),
        ],
        json!({
            "kind": "gateway-status",
            "phase": "managed",
            "bootstrapped": state.bootstrapped,
            "server": state.config.as_ref().map(server_json),
            "runtimeState": runtime_state_json_with_status(state, runtime_status),
            "paths": paths_json(&state.paths),
        }),
    )
}

pub(super) fn render_gateway_logs_output(
    state: &GatewayRuntimeState,
    preview: &LogPreview,
) -> GatewayCommandOutput {
    let mut lines = vec![
        "Gateway logs".to_owned(),
        format!("Log path: {}", state.paths.server_log_path.display()),
    ];

    if preview.lines.is_empty() {
        lines.push("Preview: <no log lines available>".to_owned());
    } else {
        if preview.truncated {
            lines.push("Preview: last 20 lines".to_owned());
        } else {
            lines.push("Preview:".to_owned());
        }
        lines.extend(preview.lines.iter().cloned());
    }

    GatewayCommandOutput::structured(
        lines,
        json!({
            "kind": "gateway-logs",
            "phase": "managed",
            "bootstrapped": state.bootstrapped,
            "logFilePresent": state.log_file_present,
            "logPath": state.paths.server_log_path.display().to_string(),
            "previewLines": preview.lines,
            "previewTruncated": preview.truncated,
            "runtimeState": runtime_state_json(state),
            "paths": paths_json(&state.paths),
        }),
    )
}

fn server_listen_label(config: Option<&SelfHostConfig>) -> String {
    config
        .map(|config| format!("{}:{}", config.server.listen_host, config.server.port))
        .unwrap_or_else(|| "<uninitialized>".to_owned())
}

fn yes_no_label(value: bool) -> &'static str {
    if value { "yes" } else { "no" }
}

fn server_json(config: &SelfHostConfig) -> serde_json::Value {
    json!({
        "listenHost": config.server.listen_host,
        "port": config.server.port,
        "publicOrigin": config.server.public_origin,
    })
}

pub(super) fn runtime_state_json(state: &GatewayRuntimeState) -> serde_json::Value {
    runtime_state_json_with_status(state, resolve_runtime_status(state, None))
}

fn runtime_state_json_with_status(
    state: &GatewayRuntimeState,
    status: RuntimeStatus<'_>,
) -> serde_json::Value {
    let mut value = json!({
        "running": status.is_running(),
        "status": status.label(),
        "pgliteDirPresent": state.pglite_dir_present,
        "logFilePresent": state.log_file_present,
        "runtimeLeasePresent": state.runtime_lease_present,
        "runtimeStatusSnapshotPresent": state.runtime_status_snapshot_present,
    });

    if let RuntimeStatus::Live(live_status) = status
        && let Some(object) = value.as_object_mut()
    {
        object.insert("runtimeControlReachable".to_owned(), json!(true));
        if let Some(pid) = live_status.pid {
            object.insert("runtimePid".to_owned(), json!(pid));
        }
        if let Some(launch_id) = &live_status.launch_id {
            object.insert("runtimeLaunchId".to_owned(), json!(launch_id));
        }
        if let Some(data_dir) = &live_status.data_dir {
            object.insert("runtimeDataDir".to_owned(), json!(data_dir));
        }
        if let Some(runtime_sequence) = live_status.runtime_sequence {
            object.insert("runtimeSequence".to_owned(), json!(runtime_sequence));
        }
    }

    value
}

fn resolve_runtime_status<'a>(
    state: &GatewayRuntimeState,
    live_status: Option<&'a RuntimeControlStatus>,
) -> RuntimeStatus<'a> {
    if let Some(live_status) = live_status {
        return RuntimeStatus::Live(live_status);
    }

    if read_managed_runtime_pid(&state.paths, "onequery gateway status")
        .ok()
        .flatten()
        .is_some()
    {
        return RuntimeStatus::Running;
    }

    if state.runtime_lease_present || state.runtime_status_snapshot_present {
        return RuntimeStatus::StaleDurableRecords;
    }

    if state.bootstrapped {
        return RuntimeStatus::NotRunning;
    }

    RuntimeStatus::NotInitialized
}

pub(super) fn paths_json(paths: &SelfHostRuntimePaths) -> serde_json::Value {
    json!({
        "configDir": paths.config_dir.display().to_string(),
        "dataDir": paths.data_dir.display().to_string(),
        "configPath": paths.config_path.display().to_string(),
        "secretsPath": paths.secrets_path.display().to_string(),
        "pgliteDir": paths.pglite_dir.display().to_string(),
        "logsDir": paths.logs_dir.display().to_string(),
        "serverLogPath": paths.server_log_path.display().to_string(),
        "backupsDir": paths.backups_dir.display().to_string(),
        "runDir": paths.run_dir.display().to_string(),
        "runtimeLeasePath": paths.runtime_lease_path.display().to_string(),
        "runtimeStatusSnapshotPath": paths.runtime_status_snapshot_path.display().to_string(),
        "supervisorStatusSnapshotPath": paths.supervisor_status_snapshot_path.display().to_string(),
        "releasesDir": paths.releases_dir.display().to_string(),
        "activeReleasePath": paths.active_release_path.display().to_string(),
        "recoveryPointsDir": paths.recovery_points_dir.display().to_string(),
        "upgradeTransactionPath": paths.upgrade_transaction_path.display().to_string(),
    })
}
