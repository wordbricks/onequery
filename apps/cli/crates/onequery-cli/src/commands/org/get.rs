use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;

use crate::cli::ReadArgs;
use crate::output::CommandOutput;
use crate::presentation::api_failure::ApiErrorPresentation;
use crate::presentation::api_failure::present_api_failure;
use crate::transport::org;
use crate::transport::org::OrgDetails;
use crate::workflows::runner::DEFAULT_MAX_WORKFLOW_STEPS;
use crate::workflows::runner::Transition;
use crate::workflows::runner::WorkflowLabel;
use crate::workflows::runner::WorkflowRunConfig;
use crate::workflows::runner::run_reducer_workflow;

use super::super::CommandContext;
use super::super::Runtime;
use super::super::auth_session::authenticated_api_client;
use super::super::auth_session::ensure_authenticated;
use super::super::read_controls_from_read_args;
use super::super::require_org;
use super::presentation::render_org_get_output;

#[derive(Debug)]
enum OrgGetState {
    Idle { read: ReadArgs },
    CheckingAuth { read: ReadArgs },
    Loading,
}

#[derive(Debug)]
enum OrgGetTerminalState {
    Completed { output: CommandOutput },
    NeedsReauth { error: CliError },
    Failed { error: CliError },
}

#[derive(Debug)]
enum OrgGetEvent {
    Start,
    Authenticated,
    AuthFailed {
        error: CliError,
    },
    Loaded {
        read: ReadArgs,
        org: OrgDetails,
        request_id: Option<String>,
    },
    LoadFailed {
        error: CliError,
        outcome: OrgGetFailureOutcome,
    },
}

#[derive(Debug)]
enum OrgGetEffect {
    EnsureAuthenticated,
    FetchOrg { org: String, read: ReadArgs },
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum OrgGetFailureOutcome {
    NeedsReauth,
    Failed,
}

pub(super) async fn run<B, T>(
    read: &ReadArgs,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError> {
    let final_state = run_reducer_workflow(
        OrgGetState::Idle { read: read.clone() },
        OrgGetEvent::Start,
        WorkflowRunConfig {
            context,
            runtime,
            workflow_name: "org_get",
            command_line: &context.command_line,
            verbose: context.verbose,
            max_steps: DEFAULT_MAX_WORKFLOW_STEPS,
        },
        reduce,
        |effect, workflow_context, workflow_runtime| {
            Box::pin(execute_effect(effect, workflow_context, workflow_runtime))
        },
    )
    .await?;

    match final_state {
        OrgGetTerminalState::Completed { output } => Ok(output),
        OrgGetTerminalState::NeedsReauth { error } | OrgGetTerminalState::Failed { error } => {
            Err(error)
        }
    }
}

fn reduce(
    state: OrgGetState,
    event: OrgGetEvent,
    context: &CommandContext,
) -> Transition<OrgGetState, OrgGetTerminalState, OrgGetEffect> {
    match state {
        OrgGetState::Idle { read } => match event {
            OrgGetEvent::Start => Transition::continue_with_effect(
                OrgGetState::CheckingAuth { read },
                OrgGetEffect::EnsureAuthenticated,
            ),
            OrgGetEvent::Authenticated
            | OrgGetEvent::AuthFailed { .. }
            | OrgGetEvent::Loaded { .. }
            | OrgGetEvent::LoadFailed { .. } => Transition::done(OrgGetTerminalState::Failed {
                error: unexpected_transition_error(context, OrgGetState::Idle { read }, event),
            }),
        },
        OrgGetState::CheckingAuth { read } => match event {
            OrgGetEvent::Authenticated => {
                let org = match require_org(context) {
                    Ok(org) => org.to_owned(),
                    Err(error) => return Transition::done(OrgGetTerminalState::Failed { error }),
                };

                Transition::continue_with_effect(
                    OrgGetState::Loading,
                    OrgGetEffect::FetchOrg { org, read },
                )
            }
            OrgGetEvent::AuthFailed { error } => {
                Transition::done(OrgGetTerminalState::Failed { error })
            }
            OrgGetEvent::Start | OrgGetEvent::Loaded { .. } | OrgGetEvent::LoadFailed { .. } => {
                Transition::done(OrgGetTerminalState::Failed {
                    error: unexpected_transition_error(
                        context,
                        OrgGetState::CheckingAuth { read },
                        event,
                    ),
                })
            }
        },
        OrgGetState::Loading => match event {
            OrgGetEvent::Loaded {
                read,
                org,
                request_id,
            } => match render_org_get_output(org, &read) {
                Ok(output) => Transition::done(OrgGetTerminalState::Completed {
                    output: output.with_request_id(request_id),
                }),
                Err(error) => Transition::done(OrgGetTerminalState::Failed { error }),
            },
            OrgGetEvent::LoadFailed { error, outcome } => match outcome {
                OrgGetFailureOutcome::NeedsReauth => {
                    Transition::done(OrgGetTerminalState::NeedsReauth { error })
                }
                OrgGetFailureOutcome::Failed => {
                    Transition::done(OrgGetTerminalState::Failed { error })
                }
            },
            OrgGetEvent::Start | OrgGetEvent::Authenticated | OrgGetEvent::AuthFailed { .. } => {
                Transition::done(OrgGetTerminalState::Failed {
                    error: unexpected_transition_error(context, OrgGetState::Loading, event),
                })
            }
        },
    }
}

fn unexpected_transition_error(
    context: &CommandContext,
    state: OrgGetState,
    event: OrgGetEvent,
) -> CliError {
    CliError::internal(
        context.command_line.clone(),
        format!(
            "unexpected org get workflow transition: state={}, event={}",
            state.workflow_label(),
            event.workflow_label()
        ),
    )
}

async fn execute_effect<B, T>(
    effect: OrgGetEffect,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> OrgGetEvent {
    match effect {
        OrgGetEffect::EnsureAuthenticated => match ensure_authenticated(context, runtime).await {
            Ok(()) => OrgGetEvent::Authenticated,
            Err(error) => OrgGetEvent::AuthFailed { error },
        },
        OrgGetEffect::FetchOrg { org, read } => {
            let client = match authenticated_api_client(context, runtime) {
                Ok(client) => client,
                Err(error) => {
                    return OrgGetEvent::LoadFailed {
                        error,
                        outcome: OrgGetFailureOutcome::Failed,
                    };
                }
            };

            match org::get_org_with_controls(
                &client,
                org.as_str(),
                &read_controls_from_read_args(&read),
            )
            .await
            {
                Ok(response) => OrgGetEvent::Loaded {
                    read,
                    org: response.payload,
                    request_id: response.request_id,
                },
                Err(failure) => {
                    let outcome = if matches!(
                        failure,
                        crate::transport::http::ApiFailure::Problem(ref problem)
                            if problem.stage == ErrorStage::Auth
                    ) {
                        OrgGetFailureOutcome::NeedsReauth
                    } else {
                        OrgGetFailureOutcome::Failed
                    };

                    OrgGetEvent::LoadFailed {
                        error: present_api_failure(
                            failure,
                            ApiErrorPresentation {
                                command: &context.command_line,
                                title: "org get failed",
                                transport_why_prefix: "failed to reach org read endpoint",
                                decode_why_prefix: "failed to decode org read response",
                                fallback_try_next: vec![
                                    "run onequery auth login".to_owned(),
                                    format!("retry {}", context.command_line),
                                ],
                                unauthorized_try_next: Some(vec!["onequery auth login".to_owned()]),
                            },
                        ),
                        outcome,
                    }
                }
            }
        }
    }
}

impl WorkflowLabel for OrgGetState {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Idle { .. } => "Idle",
            Self::CheckingAuth { .. } => "CheckingAuth",
            Self::Loading => "Loading",
        }
    }
}

impl WorkflowLabel for OrgGetTerminalState {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Completed { .. } => "Completed",
            Self::NeedsReauth { .. } => "NeedsReauth",
            Self::Failed { .. } => "Failed",
        }
    }
}

impl WorkflowLabel for OrgGetEvent {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Start => "Start",
            Self::Authenticated => "Authenticated",
            Self::AuthFailed { .. } => "AuthFailed",
            Self::Loaded { .. } => "Loaded",
            Self::LoadFailed { .. } => "LoadFailed",
        }
    }
}

impl WorkflowLabel for OrgGetEffect {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::EnsureAuthenticated => "EnsureAuthenticated",
            Self::FetchOrg { .. } => "FetchOrg",
        }
    }
}
