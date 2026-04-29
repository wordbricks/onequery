use onequery_core::error::CliError;

use crate::commands::CommandContext;
use crate::output::CommandOutput;
use crate::output::TerminalOutput;
use crate::workflows::runner::Transition;

use super::super::render::render_execute_output;
use super::state::SourceApiEvent;
use super::state::SourceApiExecutionState;
use super::state::SourceApiTerminalState;
use super::state::SourceApiTransition;
use super::state::source_api_event_name;

pub(super) fn complete_execution(
    execution: SourceApiExecutionState,
    context: &CommandContext,
) -> SourceApiTransition {
    let Some(preview) = execution.preview else {
        return Transition::done(failed_state(CliError::internal(
            context.command_line.clone(),
            "source API execution completed without a preview",
        )));
    };

    match render_execute_output(execution.pages, &preview, execution.plan.render) {
        Ok(output) => Transition::done(completed_state(
            output.with_request_id(verbose_request_id(context, execution.latest_request_id)),
        )),
        Err(error) => Transition::done(failed_state(error)),
    }
}

pub(super) fn completed_state(output: CommandOutput) -> SourceApiTerminalState {
    SourceApiTerminalState::Completed {
        output: TerminalOutput::new(output),
    }
}

pub(super) fn failed_state(error: CliError) -> SourceApiTerminalState {
    SourceApiTerminalState::Failed { error }
}

pub(super) fn verbose_request_id(
    context: &CommandContext,
    request_id: Option<String>,
) -> Option<String> {
    context.verbose.then_some(request_id).flatten()
}

pub(super) fn unexpected_transition(
    context: &CommandContext,
    state_name: &str,
    event: &SourceApiEvent,
) -> SourceApiTransition {
    Transition::done(failed_state(CliError::internal(
        context.command_line.clone(),
        format!(
            "unexpected source API workflow transition: state={state_name}, event={}",
            source_api_event_name(event)
        ),
    )))
}
