mod launch;
mod render;
mod runtime;
mod runtime_control;
pub mod self_host;
mod self_host_paths;
mod state;

#[cfg(test)]
mod tests;

use std::ffi::OsString;
use std::net::TcpStream;
use std::net::ToSocketAddrs;
use std::path::PathBuf;
use std::time::Duration;

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use onequery_cli_core::process_context::ProcessContext;
use serde_json::Value;

use render::render_gateway_logs_output;
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
const LOCAL_CONNECTION_PROBE_TIMEOUT_MS: u64 = 100;

/// Gateway command selected by the CLI front-end.
#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum GatewayCommand {
    /// Run the gateway in the foreground.
    Foreground,
    /// Start the managed gateway in the background.
    Start,
    /// Stop a managed gateway process.
    Stop,
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
        }
        GatewayCommand::Stop => {
            let state = resolve_runtime_state(command_line, GatewayStateAccessMode::ReadOnly)?;
            stop_runtime(&state, command_line).await
        }
        GatewayCommand::Status => {
            let state = resolve_runtime_state(command_line, GatewayStateAccessMode::ReadOnly)?;
            let live_status = read_live_runtime_status(&state, command_line).await;
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

/// Executes the hidden gateway supervisor command.
pub async fn execute_supervisor(
    args: &GatewaySupervisorArgs,
    command_line: &str,
) -> Result<GatewayCommandOutput, CliError> {
    ensure_self_host_runtime_supported(command_line)?;
    let state = resolve_runtime_state(command_line, GatewayStateAccessMode::BootstrapIfMissing)?;

    run_gateway_supervisor(&state, args, command_line)
}

/// Reads the pid for a running managed gateway process, when present.
pub fn read_running_gateway_pid(command_line: &str) -> Result<Option<u32>, CliError> {
    let state = resolve_runtime_state(command_line, GatewayStateAccessMode::ReadOnly)?;

    read_managed_runtime_pid(&state.paths, command_line)
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

/// Returns whether a local runtime listener accepts TCP connections.
pub fn runtime_accepting_connections(listen_host: &str, listen_port: u16) -> bool {
    let timeout = Duration::from_millis(LOCAL_CONNECTION_PROBE_TIMEOUT_MS);

    (runtime_probe_host(listen_host), listen_port)
        .to_socket_addrs()
        .ok()
        .into_iter()
        .flatten()
        .any(|address| TcpStream::connect_timeout(&address, timeout).is_ok())
}

/// Maps unspecified bind addresses to loopback hosts suitable for local probing.
pub fn runtime_probe_host(listen_host: &str) -> &str {
    match listen_host {
        "0.0.0.0" => "127.0.0.1",
        "::" => "::1",
        _ => listen_host,
    }
}
