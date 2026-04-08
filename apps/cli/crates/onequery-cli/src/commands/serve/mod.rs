mod launch;
mod render;
mod runtime;
mod state;

#[cfg(test)]
mod tests;

use onequery_cli_core::error::CliError;

use crate::cli::ServeCommand;
use crate::output::CommandOutput;

use super::CommandContext;
use super::Runtime;
use super::ensure_self_host_runtime_supported;
use render::render_serve_logs_output;
use render::render_serve_status_output;
use runtime::read_log_preview;
use runtime::run_serve_foreground;
use runtime::stop_runtime;
use state::ServeStateAccessMode;
use state::resolve_runtime_state;

const PACKAGED_SERVER_BUNDLE_FILENAME: &str = "onequery-server.mjs";
const PACKAGED_SERVER_JS_RUNTIME_ENV_VAR: &str = "ONEQUERY_SERVER_JS_RUNTIME";
const SERVE_LOG_PREVIEW_LINE_COUNT: usize = 20;
const SERVE_STOP_POLL_ATTEMPTS: usize = 50;
const SERVE_STOP_POLL_INTERVAL_MS: u64 = 100;
const RETRY_SERVE_COMMAND: &str = "retry onequery serve";
const RETRY_SERVE_STOP_COMMAND: &str = "retry onequery serve stop";
const CHECK_SERVER_LOG_AND_RETRY_SERVE_STOP: &str =
    "check the server log and retry onequery serve stop";
const INSTALL_NODE_AND_RETRY_SERVE_COMMAND: &str =
    "install Node.js 22+ and retry onequery serve";
const REINSTALL_CLI_PACKAGE_COMMAND: &str = "reinstall the CLI package";

pub(super) async fn execute<B, T>(
    command: ServeCommand,
    context: &CommandContext,
    _runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError> {
    ensure_self_host_runtime_supported(&context.command_line)?;

    match command {
        ServeCommand::Root | ServeCommand::Start => {
            let state = resolve_runtime_state(
                &context.command_line,
                ServeStateAccessMode::BootstrapIfMissing,
            )?;
            run_serve_foreground(&state, &context.command_line)
        }
        ServeCommand::Stop => {
            let state =
                resolve_runtime_state(&context.command_line, ServeStateAccessMode::ReadOnly)?;
            stop_runtime(&state, &context.command_line)
        }
        ServeCommand::Status => {
            let state =
                resolve_runtime_state(&context.command_line, ServeStateAccessMode::ReadOnly)?;
            Ok(render_serve_status_output(&state))
        }
        ServeCommand::Logs => {
            let state =
                resolve_runtime_state(&context.command_line, ServeStateAccessMode::ReadOnly)?;
            let preview = read_log_preview(&state.paths.server_log_path, &context.command_line)?;
            Ok(render_serve_logs_output(&state, &preview))
        }
    }
}
