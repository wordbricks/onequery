mod completion;
mod effects;
mod reducer;
mod retry_policy;
mod state;

use onequery_cli_core::error::CliError;

use crate::cli::ApiArgs;
use crate::workflows::runner::DEFAULT_MAX_WORKFLOW_STEPS;
use crate::workflows::runner::WorkflowRunConfig;
use crate::workflows::runner::run_reducer_workflow;

use self::state::IdleState;
use self::state::SourceApiEvent;
use self::state::SourceApiState;
use super::super::CommandContext;
use super::super::Runtime;

pub(super) use self::state::SourceApiTerminalState;

pub(super) async fn run_source_api_workflow<B, T>(
    args: ApiArgs,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<SourceApiTerminalState, CliError>
where
    B: crate::platform::BrowserLauncher,
    T: crate::platform::Terminal,
{
    run_reducer_workflow(
        SourceApiState::Idle(IdleState { args }),
        SourceApiEvent::Start,
        WorkflowRunConfig {
            context,
            runtime,
            workflow_name: "source_api",
            command_line: &context.command_line,
            verbose: context.verbose,
            max_steps: DEFAULT_MAX_WORKFLOW_STEPS,
        },
        reducer::reduce,
        |effect, context, runtime| Box::pin(effects::execute_effect(effect, context, runtime)),
    )
    .await
}
