mod launch;
mod render;
mod runtime;
mod state;

#[cfg(test)]
mod tests;

use onequery_cli_core::error::CliError;

use crate::cli::GatewayCommand;
use crate::output::CommandOutput;

use super::CommandContext;
use super::Runtime;
use super::ensure_self_host_runtime_supported;
use render::render_gateway_logs_output;
use render::render_gateway_status_output;
use runtime::read_log_preview;
use runtime::run_gateway_background;
use runtime::run_gateway_foreground;
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

pub(super) async fn execute<B, T>(
    command: GatewayCommand,
    context: &CommandContext,
    _runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError> {
    ensure_self_host_runtime_supported(&context.command_line)?;

    match command {
        GatewayCommand::Foreground => {
            let state = resolve_runtime_state(
                &context.command_line,
                GatewayStateAccessMode::BootstrapIfMissing,
            )?;
            run_gateway_foreground(
                &state,
                &context.command_line,
                FOREGROUND_GATEWAY_RETRY_COMMAND,
            )
        }
        GatewayCommand::Start => {
            let state = resolve_runtime_state(
                &context.command_line,
                GatewayStateAccessMode::BootstrapIfMissing,
            )?;
            run_gateway_background(
                &state,
                &context.command_line,
                BACKGROUND_GATEWAY_RETRY_COMMAND,
            )
        }
        GatewayCommand::Stop => {
            let state =
                resolve_runtime_state(&context.command_line, GatewayStateAccessMode::ReadOnly)?;
            stop_runtime(&state, &context.command_line)
        }
        GatewayCommand::Status => {
            let state =
                resolve_runtime_state(&context.command_line, GatewayStateAccessMode::ReadOnly)?;
            Ok(render_gateway_status_output(&state))
        }
        GatewayCommand::Logs => {
            let state =
                resolve_runtime_state(&context.command_line, GatewayStateAccessMode::ReadOnly)?;
            let preview = read_log_preview(&state.paths.server_log_path, &context.command_line)?;
            Ok(render_gateway_logs_output(&state, &preview))
        }
    }
}
