use serde_json::json;

use crate::config::self_host::SelfHostConfig;
use crate::config::self_host::SelfHostRuntimePaths;
use crate::output::CommandOutput;

use super::runtime::LogPreview;
use super::runtime::read_managed_runtime_pid;
use super::state::GatewayRuntimeState;

#[cfg(test)]
pub(super) fn render_gateway_output(state: &GatewayRuntimeState) -> CommandOutput {
    let listen = server_listen_label(state.config.as_ref());

    CommandOutput::structured(
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
) -> CommandOutput {
    let listen = server_listen_label(state.config.as_ref());

    CommandOutput::structured(
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

pub(super) fn render_gateway_status_output(state: &GatewayRuntimeState) -> CommandOutput {
    let listen = server_listen_label(state.config.as_ref());
    let runtime_status = runtime_status_label(state);

    CommandOutput::structured(
        vec![
            "Gateway status".to_owned(),
            format!("Bootstrapped: {}", yes_no_label(state.bootstrapped)),
            format!("Listen: {listen}"),
            format!("Runtime: {runtime_status}"),
            format!(
                "PGlite directory present: {}",
                yes_no_label(state.pglite_dir_present)
            ),
            format!("Log file present: {}", yes_no_label(state.log_file_present)),
            format!("PID file present: {}", yes_no_label(state.pid_file_present)),
            format!(
                "Lock file present: {}",
                yes_no_label(state.lock_file_present)
            ),
        ],
        json!({
            "kind": "gateway-status",
            "phase": "managed",
            "bootstrapped": state.bootstrapped,
            "server": state.config.as_ref().map(server_json),
            "runtimeState": runtime_state_json(state),
            "paths": paths_json(&state.paths),
        }),
    )
}

pub(super) fn render_gateway_logs_output(
    state: &GatewayRuntimeState,
    preview: &LogPreview,
) -> CommandOutput {
    let mut lines = vec![
        "Gateway logs".to_owned(),
        format!("Log path: {}", state.paths.server_log_path.display()),
        format!("Log file present: {}", yes_no_label(state.log_file_present)),
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

    CommandOutput::structured(
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
    let running = read_managed_runtime_pid(&state.paths, "onequery gateway status")
        .ok()
        .flatten()
        .is_some();
    json!({
        "running": running,
        "status": if running {
            "running"
        } else if state.pid_file_present || state.lock_file_present {
            "stale_markers"
        } else if state.bootstrapped {
            "not_running"
        } else {
            "not_initialized"
        },
        "pgliteDirPresent": state.pglite_dir_present,
        "logFilePresent": state.log_file_present,
        "pidFilePresent": state.pid_file_present,
        "lockFilePresent": state.lock_file_present,
    })
}

fn runtime_status_label(state: &GatewayRuntimeState) -> &'static str {
    if read_managed_runtime_pid(&state.paths, "onequery gateway status")
        .ok()
        .flatten()
        .is_some()
    {
        return "running";
    }

    if state.pid_file_present || state.lock_file_present {
        return "stale_markers";
    }

    if state.bootstrapped {
        return "not_running";
    }

    "not_initialized"
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
        "pidPath": paths.pid_path.display().to_string(),
        "lockPath": paths.lock_path.display().to_string(),
        "stopRequestPath": paths.stop_request_path.display().to_string(),
        "launchConfigPath": paths.launch_config_path.display().to_string(),
    })
}
