mod launch;
mod render;
mod runtime;
pub mod self_host;
mod self_host_paths;
mod state;
mod supervisor_control_proto;
mod supervisor_control_protocol;

#[cfg(test)]
mod tests;

use std::ffi::OsString;
use std::net::TcpStream;
use std::net::ToSocketAddrs;
use std::path::PathBuf;
use std::time::Duration;

use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;
use onequery_core::process_context::ProcessContext;
use serde_json::Value;

use render::render_gateway_logs_output;
use render::render_gateway_restart_output;
use render::render_gateway_status_output_with_live_status;
use runtime::read_live_runtime_status;
use runtime::read_log_preview;
use runtime::read_managed_runtime_pid;
use runtime::run_gateway_background;
use runtime::run_gateway_foreground;
use runtime::run_gateway_supervisor;
use runtime::stop_runtime;
use state::GatewayStateAccessMode;
use state::resolve_runtime_state;

const PACKAGED_SERVER_BUNDLE_FILENAME: &str = "onequery-server.mjs";
const PACKAGED_SERVER_JS_RUNTIME_ENV_VAR: &str = "ONEQUERY_SERVER_JS_RUNTIME";
const GATEWAY_LOG_PREVIEW_LINE_COUNT: usize = 20;
const GATEWAY_START_POLL_ATTEMPTS: usize = 100;
const GATEWAY_START_POLL_INTERVAL_MS: u64 = 100;
const GATEWAY_STOP_POLL_ATTEMPTS: usize = 50;
const GATEWAY_STOP_POLL_INTERVAL_MS: u64 = 100;
const RETRY_GATEWAY_STOP_COMMAND: &str = "retry onequery gateway stop";
const CHECK_SERVER_LOG_AND_RETRY_GATEWAY_STOP: &str =
    "check the server log and retry onequery gateway stop";
const REINSTALL_CLI_PACKAGE_COMMAND: &str = "reinstall the CLI package";
const FOREGROUND_GATEWAY_RETRY_COMMAND: &str = "onequery gateway";
const BACKGROUND_GATEWAY_RETRY_COMMAND: &str = "onequery gateway start";
const RESTART_GATEWAY_RETRY_COMMAND: &str = "onequery gateway restart";
pub const DEFAULT_GATEWAY_SUPERVISOR_CRASH_LOOP_MAX_RESTARTS: u32 = 0;
pub const DEFAULT_GATEWAY_SUPERVISOR_CRASH_LOOP_INITIAL_BACKOFF_MS: u64 = 500;
pub const DEFAULT_GATEWAY_SUPERVISOR_CRASH_LOOP_MAX_BACKOFF_MS: u64 = 30_000;

/// Gateway command selected by the CLI front-end.
#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum GatewayCommand {
    /// Run the gateway in the foreground.
    Foreground,
    /// Start the managed gateway in the background.
    Start,
    /// Stop a managed gateway process.
    Stop,
    /// Restart the managed gateway in the background.
    Restart,
    /// Report gateway runtime status.
    Status,
    /// Show gateway log information and a short preview.
    Logs,
}

/// Arguments passed to the hidden gateway supervisor process.
#[derive(Debug, Clone, Eq, PartialEq)]
pub struct GatewaySupervisorArgs {
    /// JavaScript runtime command used to launch the packaged server.
    pub runtime_command: OsString,
    /// Packaged server entrypoint path.
    pub runtime_entry: PathBuf,
    /// Runtime launch config path prepared by `onequery gateway start`.
    pub launch_config: PathBuf,
    /// Maximum supervised runtime restarts after unexpected exits. Zero disables restarts.
    pub crash_loop_max_restarts: u32,
    /// Initial restart backoff in milliseconds for bounded crash-loop policy.
    pub crash_loop_initial_backoff_ms: u64,
    /// Maximum restart backoff in milliseconds for bounded crash-loop policy.
    pub crash_loop_max_backoff_ms: u64,
}

/// Gateway command output before the CLI applies its top-level output envelope.
#[derive(Debug, Clone, Eq, PartialEq)]
pub struct GatewayCommandOutput {
    /// Human-readable output lines.
    pub lines: Vec<String>,
    /// Structured command data.
    pub data: Value,
}

impl GatewayCommandOutput {
    fn structured(lines: Vec<String>, data: Value) -> Self {
        Self { lines, data }
    }

    #[cfg(test)]
    fn into_data(self) -> Value {
        self.data
    }
}

/// Executes a gateway command.
pub async fn execute(
    command: GatewayCommand,
    command_line: &str,
    process: &ProcessContext,
) -> Result<GatewayCommandOutput, CliError> {
    ensure_self_host_runtime_supported(command_line)?;

    match command {
        GatewayCommand::Foreground => {
            let state =
                resolve_runtime_state(command_line, GatewayStateAccessMode::BootstrapIfMissing)?;
            run_gateway_foreground(
                &state,
                process,
                command_line,
                FOREGROUND_GATEWAY_RETRY_COMMAND,
            )
            .await
        }
        GatewayCommand::Start => {
            let state =
                resolve_runtime_state(command_line, GatewayStateAccessMode::BootstrapIfMissing)?;
            run_gateway_background(
                &state,
                process,
                command_line,
                BACKGROUND_GATEWAY_RETRY_COMMAND,
            )
            .await
        }
        GatewayCommand::Stop => {
            let state = resolve_runtime_state(command_line, GatewayStateAccessMode::ReadOnly)?;
            stop_runtime(&state, command_line).await
        }
        GatewayCommand::Restart => {
            let state =
                resolve_runtime_state(command_line, GatewayStateAccessMode::BootstrapIfMissing)?;
            restart_runtime(&state, process, command_line).await
        }
        GatewayCommand::Status => {
            let state = resolve_runtime_state(command_line, GatewayStateAccessMode::ReadOnly)?;
            let live_status = read_live_runtime_status(&state, command_line).await?;
            Ok(render_gateway_status_output_with_live_status(
                &state,
                live_status.as_ref(),
            ))
        }
        GatewayCommand::Logs => {
            let state = resolve_runtime_state(command_line, GatewayStateAccessMode::ReadOnly)?;
            let preview = read_log_preview(&state.paths.server_log_path, command_line)?;
            Ok(render_gateway_logs_output(&state, &preview))
        }
    }
}

async fn restart_runtime(
    state: &state::GatewayRuntimeState,
    process: &ProcessContext,
    command_line: &str,
) -> Result<GatewayCommandOutput, CliError> {
    let stop_output = stop_runtime(state, command_line).await?;
    let stopped_pid = stop_output
        .data
        .get("stoppedPid")
        .and_then(serde_json::Value::as_u64)
        .and_then(|pid| u32::try_from(pid).ok());
    let start_output =
        run_gateway_background(state, process, command_line, RESTART_GATEWAY_RETRY_COMMAND).await?;
    let started_pid = start_output
        .data
        .get("startedPid")
        .and_then(serde_json::Value::as_u64)
        .and_then(|pid| u32::try_from(pid).ok())
        .ok_or_else(|| {
            CliError::internal(
                command_line.to_owned(),
                "gateway start output omitted startedPid during restart",
            )
        })?;
    let refreshed_state = resolve_runtime_state(command_line, GatewayStateAccessMode::ReadOnly)?;

    Ok(render_gateway_restart_output(
        &refreshed_state,
        stopped_pid,
        started_pid,
    ))
}

/// Executes the hidden gateway supervisor command.
pub async fn execute_supervisor(
    args: &GatewaySupervisorArgs,
    command_line: &str,
) -> Result<GatewayCommandOutput, CliError> {
    ensure_self_host_runtime_supported(command_line)?;
    let state = resolve_runtime_state(command_line, GatewayStateAccessMode::BootstrapIfMissing)?;

    run_gateway_supervisor(&state, args, command_line).await
}

/// Reads the pid for a running managed gateway process, when present.
pub fn read_running_gateway_pid(command_line: &str) -> Result<Option<u32>, CliError> {
    let state = resolve_runtime_state(command_line, GatewayStateAccessMode::ReadOnly)?;

    read_managed_runtime_pid(&state.paths, command_line)
}

/// Reads the pid for a running managed gateway process using resolved paths.
pub fn read_running_gateway_pid_from_paths(
    paths: &self_host::SelfHostRuntimePaths,
    command_line: &str,
) -> Result<Option<u32>, CliError> {
    read_managed_runtime_pid(paths, command_line)
}

/// Ensures the self-host runtime is supported on this platform.
pub fn ensure_self_host_runtime_supported(command_line: &str) -> Result<(), CliError> {
    if cfg!(unix) || cfg!(windows) {
        return Ok(());
    }

    Err(CliError::new(
        "self-host runtime is not supported on this platform",
        command_line,
        ErrorStage::Internal,
        "the published self-host runtime currently supports macOS, Linux, and Windows".to_owned(),
        vec![
            "run onequery gateway, backup, and restore on macOS, Linux, or Windows".to_owned(),
            "use a supported host and point remote clients at that server".to_owned(),
        ],
    ))
}

/// Maps unspecified bind addresses to loopback hosts suitable for local probing.
pub fn runtime_probe_host(listen_host: &str) -> &str {
    match listen_host {
        "0.0.0.0" => "127.0.0.1",
        "::" => "::1",
        _ => listen_host,
    }
}

/// Best-effort local TCP probe for recovery guidance and diagnostics.
///
/// Startup readiness is owned by the supervisor-control session handshake;
/// this helper only answers whether something is currently accepting TCP
/// connections on the configured local runtime endpoint.
pub fn runtime_accepting_connections(listen_host: &str, port: u16) -> bool {
    let probe_host = runtime_probe_host(listen_host);
    let Ok(addresses) = (probe_host, port).to_socket_addrs() else {
        return false;
    };

    addresses
        .into_iter()
        .any(|address| TcpStream::connect_timeout(&address, Duration::from_millis(100)).is_ok())
}
