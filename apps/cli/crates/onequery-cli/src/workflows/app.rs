use crate::cli::Command;
use crate::cli::Invocation;
use crate::commands::CommandContext;
use crate::commands::Runtime;
use crate::commands::{self};
use crate::output::CommandOutput;
use crate::output::TerminalOutput;
use crate::workflows::runner::DEFAULT_MAX_WORKFLOW_STEPS;
use crate::workflows::runner::Transition;
use crate::workflows::runner::WorkflowLabel;
use crate::workflows::runner::WorkflowRunConfig;
use crate::workflows::runner::run_reducer_workflow;
use onequery_core::error::CliError;

#[derive(Debug, Clone, Copy)]
enum AppState {
    Idle,
    ResolvingContext,
    Executing,
}

#[derive(Debug)]
enum AppTerminalState {
    Completed { output: TerminalOutput },
    Failed { error: CliError },
}

#[derive(Debug)]
enum AppEvent {
    InvocationReceived {
        invocation: Invocation,
    },
    ContextResolved {
        invocation: Invocation,
        context: CommandContext,
    },
    ContextResolutionFailed {
        error: CliError,
    },
    CommandCompleted {
        output: CommandOutput,
    },
    CommandFailed {
        error: CliError,
    },
}

#[derive(Debug)]
enum AppEffect {
    ResolveContext {
        invocation: Invocation,
    },
    ExecuteCommand {
        command: Command,
        context: CommandContext,
    },
}

#[derive(Debug)]
struct AppWorkflowContext {
    command_line: String,
}

pub(crate) async fn run<B, T>(
    invocation: Invocation,
    runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError>
where
    B: crate::platform::BrowserLauncher,
    T: crate::platform::Terminal,
{
    let context = AppWorkflowContext {
        command_line: invocation.raw_command.clone(),
    };
    let verbose = invocation.global.verbose;

    // CONTEXT: top-level app workflow now shares the same reducer runner as subcommands
    // so terminal invariants and logging behavior stay aligned.
    let final_state = run_reducer_workflow(
        AppState::Idle,
        AppEvent::InvocationReceived { invocation },
        WorkflowRunConfig {
            context: &context,
            runtime,
            workflow_name: "app",
            command_line: &context.command_line,
            verbose,
            max_steps: DEFAULT_MAX_WORKFLOW_STEPS,
        },
        reduce,
        |effect, _, runtime| Box::pin(execute_effect(effect, runtime)),
    )
    .await?;

    match final_state {
        AppTerminalState::Completed { output } => Ok(output.into_inner()),
        AppTerminalState::Failed { error } => Err(error),
    }
}

fn reduce(
    state: AppState,
    event: AppEvent,
    context: &AppWorkflowContext,
) -> Transition<AppState, AppTerminalState, AppEffect> {
    match state {
        AppState::Idle => match event {
            AppEvent::InvocationReceived { invocation } => Transition::continue_with_effect(
                AppState::ResolvingContext,
                AppEffect::ResolveContext { invocation },
            ),
            AppEvent::ContextResolved { .. }
            | AppEvent::ContextResolutionFailed { .. }
            | AppEvent::CommandCompleted { .. }
            | AppEvent::CommandFailed { .. } => Transition::done(AppTerminalState::Failed {
                error: unexpected_transition_error(context, AppState::Idle, event),
            }),
        },
        AppState::ResolvingContext => match event {
            AppEvent::ContextResolved {
                invocation,
                context,
            } => Transition::continue_with_effect(
                AppState::Executing,
                AppEffect::ExecuteCommand {
                    command: invocation.command,
                    context,
                },
            ),
            AppEvent::ContextResolutionFailed { error } => {
                Transition::done(AppTerminalState::Failed { error })
            }
            AppEvent::InvocationReceived { .. }
            | AppEvent::CommandCompleted { .. }
            | AppEvent::CommandFailed { .. } => Transition::done(AppTerminalState::Failed {
                error: unexpected_transition_error(context, AppState::ResolvingContext, event),
            }),
        },
        AppState::Executing => match event {
            AppEvent::CommandCompleted { output } => {
                Transition::done(AppTerminalState::Completed {
                    output: TerminalOutput::new(output),
                })
            }
            AppEvent::CommandFailed { error } => {
                Transition::done(AppTerminalState::Failed { error })
            }
            AppEvent::InvocationReceived { .. }
            | AppEvent::ContextResolved { .. }
            | AppEvent::ContextResolutionFailed { .. } => {
                Transition::done(AppTerminalState::Failed {
                    error: unexpected_transition_error(context, AppState::Executing, event),
                })
            }
        },
    }
}

fn unexpected_transition_error(
    context: &AppWorkflowContext,
    state: AppState,
    event: AppEvent,
) -> CliError {
    CliError::internal(
        context.command_line.clone(),
        format!(
            "unexpected workflow transition: state={}, event={}",
            state.workflow_label(),
            event.workflow_label()
        ),
    )
}

async fn execute_effect<B, T>(effect: AppEffect, runtime: &mut Runtime<B, T>) -> AppEvent
where
    B: crate::platform::BrowserLauncher,
    T: crate::platform::Terminal,
{
    match effect {
        AppEffect::ResolveContext { invocation } => {
            match commands::resolve_context(&invocation, runtime) {
                Ok(context) => AppEvent::ContextResolved {
                    invocation,
                    context,
                },
                Err(error) => AppEvent::ContextResolutionFailed { error },
            }
        }
        AppEffect::ExecuteCommand { command, context } => {
            let command_path = command.command_path().to_owned();
            match commands::execute(command, &context, runtime).await {
                Ok(output) => AppEvent::CommandCompleted {
                    output: output.with_command(command_path),
                },
                Err(error) => AppEvent::CommandFailed {
                    error: error.with_command_path(Some(command_path)),
                },
            }
        }
    }
}

impl WorkflowLabel for AppState {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Idle => "Idle",
            Self::ResolvingContext => "ResolvingContext",
            Self::Executing => "Executing",
        }
    }
}

impl WorkflowLabel for AppTerminalState {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Completed { .. } => "Completed",
            Self::Failed { .. } => "Failed",
        }
    }
}

impl WorkflowLabel for AppEvent {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::InvocationReceived { .. } => "InvocationReceived",
            Self::ContextResolved { .. } => "ContextResolved",
            Self::ContextResolutionFailed { .. } => "ContextResolutionFailed",
            Self::CommandCompleted { .. } => "CommandCompleted",
            Self::CommandFailed { .. } => "CommandFailed",
        }
    }
}

impl WorkflowLabel for AppEffect {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::ResolveContext { .. } => "ResolveContext",
            Self::ExecuteCommand { .. } => "ExecuteCommand",
        }
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use crate::cli::Command;
    use crate::cli::GlobalOptions;
    use crate::cli::Invocation;
    use crate::cli::ListReadArgs;
    use crate::cli::SourceSubcommand;
    use crate::workflows::runner::TransitionProgress;
    use onequery_core::error::ErrorStage;

    use super::AppEffect;
    use super::AppEvent;
    use super::AppState;
    use super::AppTerminalState;
    use super::AppWorkflowContext;
    use super::reduce;

    fn sample_invocation() -> Invocation {
        Invocation {
            raw_command: "onequery source list".to_owned(),
            global: GlobalOptions {
                org: None,
                profile: None,
                raw_config_overrides: Vec::new(),
                request_id: None,
                timeout_sec: None,
                requested_output_mode: None,
                output_mode: crate::output::EffectiveOutputMode::Text,
                verbose: false,
            },
            command: Command::Source(SourceSubcommand::List {
                read: ListReadArgs::default(),
            }),
        }
    }

    #[test]
    fn idle_state_receives_invocation_and_emits_context_resolution_effect() {
        let context = AppWorkflowContext {
            command_line: "onequery source list".to_owned(),
        };
        let transition = reduce(
            AppState::Idle,
            AppEvent::InvocationReceived {
                invocation: sample_invocation(),
            },
            &context,
        );

        match transition.into_progress() {
            TransitionProgress::Continue {
                next_state: AppState::ResolvingContext,
                effect: AppEffect::ResolveContext { invocation },
            } => assert_eq!(invocation.raw_command, "onequery source list"),
            other => panic!("expected resolving-context transition, got {other:?}"),
        }
    }

    #[test]
    fn unexpected_transition_fails_with_internal_error() {
        let context = AppWorkflowContext {
            command_line: "onequery source list".to_owned(),
        };
        let transition = reduce(
            AppState::Idle,
            AppEvent::CommandCompleted {
                output: crate::output::CommandOutput::default(),
            },
            &context,
        );

        match transition.into_progress() {
            TransitionProgress::Done {
                terminal_state: AppTerminalState::Failed { error },
            } => assert_eq!(
                (error.stage, error.why.clone()),
                (
                    ErrorStage::Internal,
                    "unexpected workflow transition: state=Idle, event=CommandCompleted".to_owned(),
                )
            ),
            other => panic!("expected failed terminal state, got {other:?}"),
        }
    }
}
