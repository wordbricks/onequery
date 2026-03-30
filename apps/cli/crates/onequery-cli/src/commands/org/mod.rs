mod get;
mod presentation;
#[cfg(test)]
mod tests;
mod workflow;

use onequery_cli_core::error::CliError;

use crate::cli::OrgSubcommand;
use crate::output::CommandOutput;

use super::CommandContext;
use super::Runtime;

pub(super) async fn execute<B, T>(
    command: &OrgSubcommand,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError>
where
    B: crate::platform::BrowserLauncher,
    T: crate::platform::Terminal,
{
    match command {
        OrgSubcommand::Get { read } => get::run(read, context, runtime).await,
        _ => workflow::run(command, context, runtime).await,
    }
}
