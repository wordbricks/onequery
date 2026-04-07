use serde_json::Map;
use serde_json::Value;

use crate::cli::SourceConnectArgs;
use crate::output::CommandOutput;
use crate::output::serialize_command_data;
use crate::presentation::api_failure::ApiErrorPresentation;
use crate::presentation::api_failure::present_api_failure;
use crate::transport::source_connect;
use crate::transport::source_connect::SourceConnectGuide;
use crate::transport::source_connect::SourceConnectResult;
use crate::workflows::retry::RetryDirective;
use crate::workflows::retry::classify_retry_directive;
use crate::workflows::runner::DEFAULT_MAX_WORKFLOW_STEPS;
use crate::workflows::runner::Transition;
use crate::workflows::runner::WorkflowLabel;
use crate::workflows::runner::WorkflowRunConfig;
use crate::workflows::runner::run_reducer_workflow;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;

use super::CommandContext;
use super::Runtime;
use super::auth_session::authenticated_api_client;
use super::auth_session::ensure_authenticated;
use super::json_input::parse_org_scoped_json_input;
use super::require_org;

#[derive(Debug)]
enum SourceConnectMode {
    Guide {
        source: String,
    },
    Connect {
        source: String,
        input: Map<String, Value>,
    },
}

#[derive(Debug)]
enum SourceConnectState {
    Idle { mode: SourceConnectMode },
    CheckingAuth { mode: SourceConnectMode },
    LoadingGuide,
    Connecting,
}

#[derive(Debug)]
enum SourceConnectTerminalState {
    Completed { output: CommandOutput },
    NeedsReauth { error: CliError },
    Failed { error: CliError },
}

#[derive(Debug)]
enum SourceConnectEvent {
    Start,
    Authenticated,
    AuthFailed {
        error: CliError,
    },
    GuideLoaded {
        guide: Box<SourceConnectGuide>,
        request_id: Option<String>,
    },
    GuideLoadFailed {
        error: CliError,
        outcome: SourceConnectFailureOutcome,
    },
    SourceConnected {
        result: SourceConnectResult,
        request_id: Option<String>,
    },
    SourceConnectFailed {
        error: CliError,
        outcome: SourceConnectFailureOutcome,
    },
}

#[derive(Debug)]
enum SourceConnectEffect {
    EnsureAuthenticated,
    FetchGuide {
        org: String,
        source: String,
    },
    ConnectSource {
        org: String,
        source: String,
        input: Map<String, Value>,
    },
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum SourceConnectFailureOutcome {
    NeedsReauth,
    Failed,
}

pub(super) async fn execute<B, T>(
    args: &SourceConnectArgs,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError> {
    let source = args.source.trim();
    if source.is_empty() {
        return Err(CliError::new(
            "invalid source connect source",
            context.command_line.clone(),
            ErrorStage::ResolveSource,
            "--source must not be empty",
            vec!["retry with --source <provider>".to_owned()],
        ));
    }

    let mode = match args.input.as_deref() {
        Some(raw_input) => SourceConnectMode::Connect {
            source: source.to_owned(),
            input: parse_source_connect_input(raw_input, context)?,
        },
        None => SourceConnectMode::Guide {
            source: source.to_owned(),
        },
    };

    let final_state = run_reducer_workflow(
        SourceConnectState::Idle { mode },
        SourceConnectEvent::Start,
        WorkflowRunConfig {
            context,
            runtime,
            workflow_name: "source_connect",
            command_line: &context.command_line,
            verbose: context.verbose,
            max_steps: DEFAULT_MAX_WORKFLOW_STEPS,
        },
        reduce,
        |effect, context, runtime| Box::pin(execute_effect(effect, context, runtime)),
    )
    .await?;

    match final_state {
        SourceConnectTerminalState::Completed { output } => Ok(output),
        SourceConnectTerminalState::NeedsReauth { error }
        | SourceConnectTerminalState::Failed { error } => Err(error),
    }
}

fn reduce(
    state: SourceConnectState,
    event: SourceConnectEvent,
    context: &CommandContext,
) -> Transition<SourceConnectState, SourceConnectTerminalState, SourceConnectEffect> {
    match state {
        SourceConnectState::Idle { mode } => match event {
            SourceConnectEvent::Start => Transition::continue_with_effect(
                SourceConnectState::CheckingAuth { mode },
                SourceConnectEffect::EnsureAuthenticated,
            ),
            SourceConnectEvent::Authenticated
            | SourceConnectEvent::AuthFailed { .. }
            | SourceConnectEvent::GuideLoaded { .. }
            | SourceConnectEvent::GuideLoadFailed { .. }
            | SourceConnectEvent::SourceConnected { .. }
            | SourceConnectEvent::SourceConnectFailed { .. } => {
                Transition::done(SourceConnectTerminalState::Failed {
                    error: unexpected_transition_error(
                        context,
                        SourceConnectState::Idle { mode },
                        event,
                    ),
                })
            }
        },
        SourceConnectState::CheckingAuth { mode } => match event {
            SourceConnectEvent::Authenticated => {
                let org = match require_org(context) {
                    Ok(org) => org.to_owned(),
                    Err(error) => {
                        return Transition::done(SourceConnectTerminalState::Failed { error });
                    }
                };

                match mode {
                    SourceConnectMode::Guide { source } => Transition::continue_with_effect(
                        SourceConnectState::LoadingGuide,
                        SourceConnectEffect::FetchGuide { org, source },
                    ),
                    SourceConnectMode::Connect { source, input } => {
                        Transition::continue_with_effect(
                            SourceConnectState::Connecting,
                            SourceConnectEffect::ConnectSource { org, source, input },
                        )
                    }
                }
            }
            SourceConnectEvent::AuthFailed { error } => {
                Transition::done(SourceConnectTerminalState::Failed { error })
            }
            SourceConnectEvent::Start
            | SourceConnectEvent::GuideLoaded { .. }
            | SourceConnectEvent::GuideLoadFailed { .. }
            | SourceConnectEvent::SourceConnected { .. }
            | SourceConnectEvent::SourceConnectFailed { .. } => {
                Transition::done(SourceConnectTerminalState::Failed {
                    error: unexpected_transition_error(
                        context,
                        SourceConnectState::CheckingAuth { mode },
                        event,
                    ),
                })
            }
        },
        SourceConnectState::LoadingGuide => match event {
            SourceConnectEvent::GuideLoaded { guide, request_id } => {
                match render_source_connect_guide_output(*guide) {
                    Ok(output) => Transition::done(SourceConnectTerminalState::Completed {
                        output: output.with_request_id(request_id),
                    }),
                    Err(error) => Transition::done(SourceConnectTerminalState::Failed { error }),
                }
            }
            SourceConnectEvent::GuideLoadFailed { error, outcome } => match outcome {
                SourceConnectFailureOutcome::NeedsReauth => {
                    Transition::done(SourceConnectTerminalState::NeedsReauth { error })
                }
                SourceConnectFailureOutcome::Failed => {
                    Transition::done(SourceConnectTerminalState::Failed { error })
                }
            },
            SourceConnectEvent::Start
            | SourceConnectEvent::Authenticated
            | SourceConnectEvent::AuthFailed { .. }
            | SourceConnectEvent::SourceConnected { .. }
            | SourceConnectEvent::SourceConnectFailed { .. } => {
                Transition::done(SourceConnectTerminalState::Failed {
                    error: unexpected_transition_error(
                        context,
                        SourceConnectState::LoadingGuide,
                        event,
                    ),
                })
            }
        },
        SourceConnectState::Connecting => match event {
            SourceConnectEvent::SourceConnected { result, request_id } => {
                match render_source_connect_result_output(result) {
                    Ok(output) => Transition::done(SourceConnectTerminalState::Completed {
                        output: output.with_request_id(request_id),
                    }),
                    Err(error) => Transition::done(SourceConnectTerminalState::Failed { error }),
                }
            }
            SourceConnectEvent::SourceConnectFailed { error, outcome } => match outcome {
                SourceConnectFailureOutcome::NeedsReauth => {
                    Transition::done(SourceConnectTerminalState::NeedsReauth { error })
                }
                SourceConnectFailureOutcome::Failed => {
                    Transition::done(SourceConnectTerminalState::Failed { error })
                }
            },
            SourceConnectEvent::Start
            | SourceConnectEvent::Authenticated
            | SourceConnectEvent::AuthFailed { .. }
            | SourceConnectEvent::GuideLoaded { .. }
            | SourceConnectEvent::GuideLoadFailed { .. } => {
                Transition::done(SourceConnectTerminalState::Failed {
                    error: unexpected_transition_error(
                        context,
                        SourceConnectState::Connecting,
                        event,
                    ),
                })
            }
        },
    }
}

fn unexpected_transition_error(
    context: &CommandContext,
    state: SourceConnectState,
    event: SourceConnectEvent,
) -> CliError {
    CliError::internal(
        context.command_line.clone(),
        format!(
            "unexpected source connect workflow transition: state={}, event={}",
            state.workflow_label(),
            event.workflow_label()
        ),
    )
}

async fn execute_effect<B, T>(
    effect: SourceConnectEffect,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> SourceConnectEvent {
    match effect {
        SourceConnectEffect::EnsureAuthenticated => {
            match ensure_authenticated(context, runtime).await {
                Ok(()) => SourceConnectEvent::Authenticated,
                Err(error) => SourceConnectEvent::AuthFailed { error },
            }
        }
        SourceConnectEffect::FetchGuide { org, source } => {
            let client = match authenticated_api_client(context, runtime) {
                Ok(client) => client,
                Err(error) => {
                    return SourceConnectEvent::GuideLoadFailed {
                        error,
                        outcome: SourceConnectFailureOutcome::Failed,
                    };
                }
            };

            match source_connect::load_source_connect_guide(&client, org.as_str(), source.as_str())
                .await
            {
                Ok(response) => SourceConnectEvent::GuideLoaded {
                    guide: Box::new(response.payload),
                    request_id: response.request_id,
                },
                Err(failure) => {
                    let outcome = source_connect_failure_outcome(&failure);
                    SourceConnectEvent::GuideLoadFailed {
                        error: present_api_failure(
                            failure,
                            ApiErrorPresentation {
                                command: &context.command_line,
                                title: "source connect failed",
                                transport_why_prefix: "failed to reach source connect guide endpoint",
                                decode_why_prefix: "failed to decode source connect guide response",
                                fallback_try_next: vec![format!("retry {}", context.command_line)],
                                unauthorized_try_next: Some(vec!["onequery auth login".to_owned()]),
                            },
                        ),
                        outcome,
                    }
                }
            }
        }
        SourceConnectEffect::ConnectSource { org, source, input } => {
            let client = match authenticated_api_client(context, runtime) {
                Ok(client) => client,
                Err(error) => {
                    return SourceConnectEvent::SourceConnectFailed {
                        error,
                        outcome: SourceConnectFailureOutcome::Failed,
                    };
                }
            };

            match source_connect::connect_source(&client, org.as_str(), source.as_str(), input)
                .await
            {
                Ok(response) => SourceConnectEvent::SourceConnected {
                    result: response.payload,
                    request_id: response.request_id,
                },
                Err(failure) => {
                    let outcome = source_connect_failure_outcome(&failure);
                    SourceConnectEvent::SourceConnectFailed {
                        error: present_api_failure(
                            failure,
                            ApiErrorPresentation {
                                command: &context.command_line,
                                title: "source connect failed",
                                transport_why_prefix: "failed to reach source connect endpoint",
                                decode_why_prefix: "failed to decode source connect response",
                                fallback_try_next: vec![
                                    format!("onequery source connect --source {}", source),
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

fn source_connect_failure_outcome(
    failure: &crate::transport::http::ApiFailure,
) -> SourceConnectFailureOutcome {
    if classify_retry_directive(failure) == RetryDirective::NeedsReauth {
        SourceConnectFailureOutcome::NeedsReauth
    } else {
        SourceConnectFailureOutcome::Failed
    }
}

fn parse_source_connect_input(
    raw_input: &str,
    context: &CommandContext,
) -> Result<Map<String, Value>, CliError> {
    parse_org_scoped_json_input(
        raw_input,
        context,
        "invalid source connect input",
        "source connect input",
        source_connect_input_examples,
    )
}

fn source_connect_input_examples() -> Vec<String> {
    vec![
        "onequery source connect --source <provider>".to_owned(),
        "onequery --org <org_slug> source connect --source postgres --input '{\"name\":\"warehouse\",\"credentials\":{\"host\":\"db.example.com\",\"database\":\"app\",\"username\":\"onequery\",\"password\":\"secret\"}}'".to_owned(),
    ]
}

fn render_source_connect_guide_output(
    guide: SourceConnectGuide,
) -> Result<CommandOutput, CliError> {
    let data = serialize_command_data(&guide, "onequery source connect")?;
    let lines = guide.content.lines().map(ToOwned::to_owned).collect();
    Ok(CommandOutput::structured(lines, data))
}

fn render_source_connect_result_output(
    result: SourceConnectResult,
) -> Result<CommandOutput, CliError> {
    let lines = vec![
        format!(
            "Source connected: {}",
            result.source.name.as_deref().unwrap_or("-")
        ),
        format!(
            "Provider: {}",
            result.source.provider.as_deref().unwrap_or("-")
        ),
        format!("Status: {}", result.source.status.as_deref().unwrap_or("-")),
        format!(
            "Query (v1): {}",
            if result.source.queryable.unwrap_or(false) {
                "yes"
            } else {
                "no"
            }
        ),
        format!("Next: {}", result.next_command),
    ];
    Ok(CommandOutput::try_deferred(lines, move || {
        serialize_command_data(&result, "onequery source connect")
    }))
}

impl WorkflowLabel for SourceConnectState {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Idle { .. } => "Idle",
            Self::CheckingAuth { .. } => "CheckingAuth",
            Self::LoadingGuide => "LoadingGuide",
            Self::Connecting => "Connecting",
        }
    }
}

impl WorkflowLabel for SourceConnectTerminalState {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Completed { .. } => "Completed",
            Self::NeedsReauth { .. } => "NeedsReauth",
            Self::Failed { .. } => "Failed",
        }
    }
}

impl WorkflowLabel for SourceConnectEvent {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Start => "Start",
            Self::Authenticated => "Authenticated",
            Self::AuthFailed { .. } => "AuthFailed",
            Self::GuideLoaded { .. } => "GuideLoaded",
            Self::GuideLoadFailed { .. } => "GuideLoadFailed",
            Self::SourceConnected { .. } => "SourceConnected",
            Self::SourceConnectFailed { .. } => "SourceConnectFailed",
        }
    }
}

impl WorkflowLabel for SourceConnectEffect {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::EnsureAuthenticated => "EnsureAuthenticated",
            Self::FetchGuide { .. } => "FetchGuide",
            Self::ConnectSource { .. } => "ConnectSource",
        }
    }
}

#[cfg(test)]
mod tests {
    use insta::assert_snapshot;
    use onequery_cli_core::error::ErrorStage;
    use pretty_assertions::assert_eq;

    use crate::commands::CommandContext;
    use crate::commands::ResolvedOrgSource;
    use crate::config::default_base_url;
    use crate::transport::source::SourceSummary;
    use crate::transport::source_connect::SourceConnectGuide;
    use crate::transport::source_connect::SourceConnectResult;
    use crate::workflows::runner::TransitionProgress;
    use onequery_cli_core::error::CliError;

    use super::SourceConnectEffect;
    use super::SourceConnectEvent;
    use super::SourceConnectFailureOutcome;
    use super::SourceConnectMode;
    use super::SourceConnectState;
    use super::SourceConnectTerminalState;
    use super::parse_source_connect_input;
    use super::reduce;
    use super::render_source_connect_guide_output;
    use super::render_source_connect_result_output;

    #[test]
    fn render_source_connect_guide_output_snapshot() {
        let guide = SourceConnectGuide {
            title: "OneQuery Source Connect Guide".to_owned(),
            description: "Create one source connection.".to_owned(),
            format: "markdown".to_owned(),
            content:
                "# OneQuery Source Connect Guide\n\n1. Gather credentials.\n2. Run the command.\n"
                    .to_owned(),
            command: "onequery source connect --source postgres --input '<json>'".to_owned(),
        };

        let output = render_source_connect_guide_output(guide)
            .expect("expected source connect guide output");
        assert_snapshot!(output.lines.join("\n"));
    }

    #[test]
    fn render_source_connect_result_output_snapshot() {
        let output = render_source_connect_result_output(SourceConnectResult {
            source: SourceSummary {
                name: Some("warehouse".to_owned()),
                display_name: None,
                provider: Some("postgres".to_owned()),
                queryable: Some(true),
                status: Some("active".to_owned()),
            },
            next_command: "onequery source show warehouse".to_owned(),
        })
        .expect("expected source connect result output");

        assert_snapshot!(output.lines.join("\n"));
    }

    #[test]
    fn source_connect_input_rejects_org_fields() {
        let error = parse_source_connect_input(
            r#"{"name":"warehouse","organizationSlug":"acme","credentials":{"host":"db.example.com"}}"#,
            &CommandContext {
                command_line: "onequery source connect --source postgres --input <excerpt>"
                    .to_owned(),
                base_url: default_base_url(),
                request_id: None,
                resolved_org: Some("acme".to_owned()),
                resolved_org_source: ResolvedOrgSource::Config,
                verbose: false,
            },
        )
        .expect_err("expected org context fields to be rejected");

        assert_eq!(error.title, "invalid source connect input".to_owned());
        assert!(error.why.contains("organizationId"));
    }

    #[test]
    fn unauthorized_source_connect_failure_transitions_to_explicit_reauth_terminal_state() {
        let context = CommandContext {
            command_line: "onequery source connect --source postgres".to_owned(),
            base_url: default_base_url(),
            request_id: None,
            resolved_org: Some("acme".to_owned()),
            resolved_org_source: ResolvedOrgSource::Config,
            verbose: false,
        };

        let transition = reduce(
            SourceConnectState::LoadingGuide,
            SourceConnectEvent::GuideLoadFailed {
                error: CliError::new(
                    "source connect failed",
                    context.command_line.clone(),
                    ErrorStage::Auth,
                    "stored credentials are no longer authorized",
                    vec!["onequery auth login".to_owned()],
                ),
                outcome: SourceConnectFailureOutcome::NeedsReauth,
            },
            &context,
        );

        match transition.into_progress() {
            TransitionProgress::Done {
                terminal_state: SourceConnectTerminalState::NeedsReauth { error },
            } => assert_eq!(error.stage, ErrorStage::Auth),
            other => panic!("expected needs-reauth terminal transition, got {other:?}"),
        }
    }

    #[test]
    fn source_connect_starts_in_guide_mode_without_input() {
        let context = CommandContext {
            command_line: "onequery source connect --source postgres".to_owned(),
            base_url: default_base_url(),
            request_id: None,
            resolved_org: Some("acme".to_owned()),
            resolved_org_source: ResolvedOrgSource::Config,
            verbose: false,
        };

        let transition = reduce(
            SourceConnectState::Idle {
                mode: SourceConnectMode::Guide {
                    source: "postgres".to_owned(),
                },
            },
            SourceConnectEvent::Start,
            &context,
        );

        match transition.into_progress() {
            TransitionProgress::Continue {
                next_state: SourceConnectState::CheckingAuth { mode },
                effect: SourceConnectEffect::EnsureAuthenticated,
            } => {
                assert!(matches!(mode, SourceConnectMode::Guide { source } if source == "postgres"))
            }
            other => panic!("expected guide-mode transition, got {other:?}"),
        }
    }
}
