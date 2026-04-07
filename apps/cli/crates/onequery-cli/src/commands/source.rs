use crate::cli::ListReadArgs;
use crate::cli::ReadArgs;
use crate::cli::SourceSubcommand;
use crate::output::CommandOutput;
use crate::output::append_padded_cell;
use crate::output::pretty_json_lines;
use crate::output::serialize_command_data;
use crate::presentation::api_failure::ApiErrorPresentation;
use crate::presentation::api_failure::present_api_failure;
use crate::transport::read_controls::PageInfo;
use crate::transport::source;
use crate::transport::source::SourceListPayload;
use crate::transport::source::SourceSummary;
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
use super::read_controls_from_list_args;
use super::read_controls_from_read_args;
use super::require_org;

#[derive(Debug)]
enum SourceMode {
    List { read: ListReadArgs },
    Show { source_key: String, read: ReadArgs },
}

#[derive(Debug)]
enum SourceState {
    Idle { mode: SourceMode },
    CheckingAuth { mode: SourceMode },
    LoadingList,
    LoadingShow,
}

#[derive(Debug)]
enum SourceTerminalState {
    Completed { output: CommandOutput },
    NeedsReauth { error: CliError },
    Failed { error: CliError },
}

#[derive(Debug)]
enum SourceEvent {
    Start,
    Authenticated,
    AuthFailed {
        error: CliError,
    },
    SourceListLoaded {
        payload: SourceListPayload,
        read: ListReadArgs,
        request_id: Option<String>,
    },
    SourceListLoadFailed {
        error: CliError,
        outcome: SourceFailureOutcome,
    },
    SourceLoaded {
        read: ReadArgs,
        source: SourceSummary,
        request_id: Option<String>,
    },
    SourceLoadFailed {
        error: CliError,
        outcome: SourceFailureOutcome,
    },
}

#[derive(Debug)]
enum SourceEffect {
    EnsureAuthenticated,
    FetchSourceList {
        org: String,
        read: ListReadArgs,
    },
    FetchSource {
        org: String,
        source_key: String,
        read: ReadArgs,
    },
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum SourceFailureOutcome {
    NeedsReauth,
    Failed,
}

pub(super) async fn execute<B, T>(
    command: &SourceSubcommand,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError> {
    if let SourceSubcommand::Connect(args) = command {
        return super::source_connect::execute(args, context, runtime).await;
    }

    let mode = match command {
        SourceSubcommand::List { read } => SourceMode::List { read: read.clone() },
        SourceSubcommand::Show { source_key, read } => SourceMode::Show {
            source_key: source_key.clone(),
            read: read.clone(),
        },
        SourceSubcommand::Connect(_) => unreachable!("source connect is delegated"),
    };

    let final_state = run_reducer_workflow(
        SourceState::Idle { mode },
        SourceEvent::Start,
        WorkflowRunConfig {
            context,
            runtime,
            workflow_name: "source",
            command_line: &context.command_line,
            verbose: context.verbose,
            max_steps: DEFAULT_MAX_WORKFLOW_STEPS,
        },
        reduce,
        |effect, context, runtime| Box::pin(execute_effect(effect, context, runtime)),
    )
    .await?;

    match final_state {
        SourceTerminalState::Completed { output } => Ok(output),
        SourceTerminalState::NeedsReauth { error } | SourceTerminalState::Failed { error } => {
            Err(error)
        }
    }
}

fn reduce(
    state: SourceState,
    event: SourceEvent,
    context: &CommandContext,
) -> Transition<SourceState, SourceTerminalState, SourceEffect> {
    match state {
        SourceState::Idle { mode } => match event {
            SourceEvent::Start => match mode {
                SourceMode::List { read } => Transition::continue_with_effect(
                    SourceState::CheckingAuth {
                        mode: SourceMode::List { read },
                    },
                    SourceEffect::EnsureAuthenticated,
                ),
                SourceMode::Show { source_key, read } => {
                    let Some(source_key) =
                        crate::identifiers::normalize_safe_path_segment(source_key.as_str())
                    else {
                        return Transition::done(SourceTerminalState::Failed {
                            error: CliError::new(
                                "invalid source key",
                                context.command_line.clone(),
                                ErrorStage::ParseCommand,
                                "source key must use only letters, numbers, dots, underscores, or hyphens",
                                vec!["retry onequery source show <source_key>".to_owned()],
                            ),
                        });
                    };

                    Transition::continue_with_effect(
                        SourceState::CheckingAuth {
                            mode: SourceMode::Show {
                                source_key: source_key.to_owned(),
                                read,
                            },
                        },
                        SourceEffect::EnsureAuthenticated,
                    )
                }
            },
            SourceEvent::Authenticated
            | SourceEvent::AuthFailed { .. }
            | SourceEvent::SourceListLoaded { .. }
            | SourceEvent::SourceListLoadFailed { .. }
            | SourceEvent::SourceLoaded { .. }
            | SourceEvent::SourceLoadFailed { .. } => {
                Transition::done(SourceTerminalState::Failed {
                    error: unexpected_transition_error(context, SourceState::Idle { mode }, event),
                })
            }
        },
        SourceState::CheckingAuth { mode } => match event {
            SourceEvent::Authenticated => {
                let org = match require_org(context) {
                    Ok(org) => org.to_owned(),
                    Err(error) => return Transition::done(SourceTerminalState::Failed { error }),
                };

                match mode {
                    SourceMode::List { read } => Transition::continue_with_effect(
                        SourceState::LoadingList,
                        SourceEffect::FetchSourceList { org, read },
                    ),
                    SourceMode::Show { source_key, read } => Transition::continue_with_effect(
                        SourceState::LoadingShow,
                        SourceEffect::FetchSource {
                            org,
                            source_key,
                            read,
                        },
                    ),
                }
            }
            SourceEvent::AuthFailed { error } => {
                Transition::done(SourceTerminalState::Failed { error })
            }
            SourceEvent::Start
            | SourceEvent::SourceListLoaded { .. }
            | SourceEvent::SourceListLoadFailed { .. }
            | SourceEvent::SourceLoaded { .. }
            | SourceEvent::SourceLoadFailed { .. } => {
                Transition::done(SourceTerminalState::Failed {
                    error: unexpected_transition_error(
                        context,
                        SourceState::CheckingAuth { mode },
                        event,
                    ),
                })
            }
        },
        SourceState::LoadingList => match event {
            SourceEvent::SourceListLoaded {
                payload,
                read,
                request_id,
            } => match render_source_list_output(payload, &read) {
                Ok(output) => Transition::done(SourceTerminalState::Completed {
                    output: output.with_request_id(request_id),
                }),
                Err(error) => Transition::done(SourceTerminalState::Failed { error }),
            },
            SourceEvent::SourceListLoadFailed { error, outcome } => match outcome {
                SourceFailureOutcome::NeedsReauth => {
                    Transition::done(SourceTerminalState::NeedsReauth { error })
                }
                SourceFailureOutcome::Failed => {
                    Transition::done(SourceTerminalState::Failed { error })
                }
            },
            SourceEvent::Start
            | SourceEvent::Authenticated
            | SourceEvent::AuthFailed { .. }
            | SourceEvent::SourceLoaded { .. }
            | SourceEvent::SourceLoadFailed { .. } => {
                Transition::done(SourceTerminalState::Failed {
                    error: unexpected_transition_error(context, SourceState::LoadingList, event),
                })
            }
        },
        SourceState::LoadingShow => match event {
            SourceEvent::SourceLoaded {
                read,
                source,
                request_id,
            } => match render_source_show_output(source, &read) {
                Ok(output) => Transition::done(SourceTerminalState::Completed {
                    output: output.with_request_id(request_id),
                }),
                Err(error) => Transition::done(SourceTerminalState::Failed { error }),
            },
            SourceEvent::SourceLoadFailed { error, outcome } => match outcome {
                SourceFailureOutcome::NeedsReauth => {
                    Transition::done(SourceTerminalState::NeedsReauth { error })
                }
                SourceFailureOutcome::Failed => {
                    Transition::done(SourceTerminalState::Failed { error })
                }
            },
            SourceEvent::Start
            | SourceEvent::Authenticated
            | SourceEvent::AuthFailed { .. }
            | SourceEvent::SourceListLoaded { .. }
            | SourceEvent::SourceListLoadFailed { .. } => {
                Transition::done(SourceTerminalState::Failed {
                    error: unexpected_transition_error(context, SourceState::LoadingShow, event),
                })
            }
        },
    }
}

fn unexpected_transition_error(
    context: &CommandContext,
    state: SourceState,
    event: SourceEvent,
) -> CliError {
    CliError::internal(
        context.command_line.clone(),
        format!(
            "unexpected source workflow transition: state={}, event={}",
            state.workflow_label(),
            event.workflow_label()
        ),
    )
}

async fn execute_effect<B, T>(
    effect: SourceEffect,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> SourceEvent {
    match effect {
        SourceEffect::EnsureAuthenticated => match ensure_authenticated(context, runtime).await {
            Ok(()) => SourceEvent::Authenticated,
            Err(error) => SourceEvent::AuthFailed { error },
        },
        SourceEffect::FetchSourceList { org, read } => {
            let client = match authenticated_api_client(context, runtime) {
                Ok(client) => client,
                Err(error) => {
                    return SourceEvent::SourceListLoadFailed {
                        error,
                        outcome: SourceFailureOutcome::Failed,
                    };
                }
            };

            match source::list_sources_with_controls(
                &client,
                org.as_str(),
                &read_controls_from_list_args(&read),
            )
            .await
            {
                Ok(response) => SourceEvent::SourceListLoaded {
                    payload: response.payload,
                    read,
                    request_id: response.request_id,
                },
                Err(failure) => {
                    let outcome = source_failure_outcome(&failure);

                    SourceEvent::SourceListLoadFailed {
                        error: present_api_failure(
                            failure,
                            ApiErrorPresentation {
                                command: &context.command_line,
                                title: "source list failed",
                                transport_why_prefix: "failed to reach source list endpoint",
                                decode_why_prefix: "failed to decode source list response",
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
        SourceEffect::FetchSource {
            org,
            source_key,
            read,
        } => {
            let client = match authenticated_api_client(context, runtime) {
                Ok(client) => client,
                Err(error) => {
                    return SourceEvent::SourceLoadFailed {
                        error,
                        outcome: SourceFailureOutcome::Failed,
                    };
                }
            };

            match source::get_source_by_key_with_controls(
                &client,
                org.as_str(),
                source_key.as_str(),
                &read_controls_from_read_args(&read),
            )
            .await
            {
                Ok(response) => SourceEvent::SourceLoaded {
                    read,
                    source: response.payload,
                    request_id: response.request_id,
                },
                Err(failure) => {
                    let outcome = source_failure_outcome(&failure);

                    SourceEvent::SourceLoadFailed {
                        error: present_api_failure(
                            failure,
                            ApiErrorPresentation {
                                command: &context.command_line,
                                title: "source show failed",
                                transport_why_prefix: "failed to reach source show endpoint",
                                decode_why_prefix: "failed to decode source show response",
                                fallback_try_next: vec![
                                    "onequery source list".to_owned(),
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

fn source_failure_outcome(failure: &crate::transport::http::ApiFailure) -> SourceFailureOutcome {
    if classify_retry_directive(failure) == RetryDirective::NeedsReauth {
        SourceFailureOutcome::NeedsReauth
    } else {
        SourceFailureOutcome::Failed
    }
}

impl WorkflowLabel for SourceState {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Idle { .. } => "Idle",
            Self::CheckingAuth { .. } => "CheckingAuth",
            Self::LoadingList => "LoadingList",
            Self::LoadingShow => "LoadingShow",
        }
    }
}

impl WorkflowLabel for SourceTerminalState {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Completed { .. } => "Completed",
            Self::NeedsReauth { .. } => "NeedsReauth",
            Self::Failed { .. } => "Failed",
        }
    }
}

impl WorkflowLabel for SourceEvent {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Start => "Start",
            Self::Authenticated => "Authenticated",
            Self::AuthFailed { .. } => "AuthFailed",
            Self::SourceListLoaded { .. } => "SourceListLoaded",
            Self::SourceListLoadFailed { .. } => "SourceListLoadFailed",
            Self::SourceLoaded { .. } => "SourceLoaded",
            Self::SourceLoadFailed { .. } => "SourceLoadFailed",
        }
    }
}

impl WorkflowLabel for SourceEffect {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::EnsureAuthenticated => "EnsureAuthenticated",
            Self::FetchSourceList { .. } => "FetchSourceList",
            Self::FetchSource { .. } => "FetchSource",
        }
    }
}

fn render_source_list_output(
    payload: SourceListPayload,
    read: &ListReadArgs,
) -> Result<CommandOutput, CliError> {
    if read.has_field_selection() {
        let data = serialize_command_data(&payload, "onequery source list")?;
        return Ok(CommandOutput::structured(pretty_json_lines(&data), data));
    }

    let sources = payload.sources.as_slice();
    if sources.is_empty() {
        return Ok(CommandOutput::try_deferred(
            vec!["No connected sources found.".to_owned()],
            move || serialize_command_data(&payload, "onequery source list"),
        ));
    }

    let name_width = sources
        .iter()
        .map(|source| source.name.as_deref().unwrap_or("-").len())
        .max()
        .unwrap_or(4)
        .max("NAME".len());
    let provider_width = sources
        .iter()
        .map(|source| source.provider.as_deref().unwrap_or("-").len())
        .max()
        .unwrap_or(8)
        .max("PROVIDER".len());
    let query_width = "QUERY".len();
    let status_width = sources
        .iter()
        .map(|source| source.status.as_deref().unwrap_or("-").len())
        .max()
        .unwrap_or(6)
        .max("STATUS".len());

    let row_capacity = name_width + provider_width + query_width + status_width + 6;
    let mut lines = Vec::with_capacity(sources.len() + 1);
    let mut header = String::with_capacity(row_capacity);
    append_padded_cell(&mut header, "NAME", name_width);
    header.push_str("  ");
    append_padded_cell(&mut header, "PROVIDER", provider_width);
    header.push_str("  ");
    append_padded_cell(&mut header, "QUERY", query_width);
    header.push_str("  ");
    append_padded_cell(&mut header, "STATUS", status_width);
    lines.push(header);

    for source in sources {
        let mut row = String::with_capacity(row_capacity);
        append_padded_cell(&mut row, source.name.as_deref().unwrap_or("-"), name_width);
        row.push_str("  ");
        append_padded_cell(
            &mut row,
            source.provider.as_deref().unwrap_or("-"),
            provider_width,
        );
        row.push_str("  ");
        append_padded_cell(
            &mut row,
            if source.queryable.unwrap_or(false) {
                "yes"
            } else {
                "no"
            },
            query_width,
        );
        row.push_str("  ");
        append_padded_cell(
            &mut row,
            source.status.as_deref().unwrap_or("-"),
            status_width,
        );
        lines.push(row);
    }

    append_page_lines(
        &mut lines,
        &payload.page,
        read.pagination.page_all
            || read.pagination.page_size.is_some()
            || read.pagination.cursor().is_some(),
    );

    Ok(CommandOutput::try_deferred(lines, move || {
        serialize_command_data(&payload, "onequery source list")
    }))
}

fn render_source_show_output(
    source: SourceSummary,
    read: &ReadArgs,
) -> Result<CommandOutput, CliError> {
    if read.has_field_selection() {
        let data = serialize_command_data(&source, "onequery source show")?;
        return Ok(CommandOutput::structured(pretty_json_lines(&data), data));
    }

    let mut lines = vec![
        format!("Source: {}", source.name.as_deref().unwrap_or("-")),
        format!("Provider: {}", source.provider.as_deref().unwrap_or("-")),
        format!("Status: {}", source.status.as_deref().unwrap_or("-")),
        format!(
            "Query (v1): {}",
            if source.queryable.unwrap_or(false) {
                "yes"
            } else {
                "no"
            }
        ),
    ];

    if let Some(display_name) = &source.display_name {
        lines.insert(1, format!("Display Name: {display_name}"));
    }

    if source.queryable.unwrap_or(false) {
        lines.push(format!(
            "Sample query: onequery query execute --source {} --sql \"select 1\"",
            source.name.as_deref().unwrap_or("<source>")
        ));
    }

    Ok(CommandOutput::try_deferred(lines, move || {
        serialize_command_data(&source, "onequery source show")
    }))
}

fn append_page_lines(lines: &mut Vec<String>, page: &PageInfo, force_render: bool) {
    if !force_render && !page.has_more {
        return;
    }

    lines.push(String::new());
    if page.has_more {
        lines.push(format!("Page: {} returned, more available", page.returned));
        if let Some(next_cursor) = &page.next_cursor {
            lines.push(format!("Next cursor: {next_cursor}"));
        }
        return;
    }

    lines.push(format!("Page: {} returned", page.returned));
}

#[cfg(test)]
mod tests {
    use insta::assert_snapshot;
    use onequery_cli_core::error::CliError;
    use onequery_cli_core::error::ErrorStage;
    use pretty_assertions::assert_eq;

    use crate::cli::ListReadArgs;
    use crate::cli::ReadArgs;
    use crate::commands::CommandContext;
    use crate::commands::ResolvedOrgSource;
    use crate::config::default_base_url;
    use crate::transport::read_controls::PageInfo;
    use crate::transport::source::SourceListPayload;
    use crate::workflows::runner::TransitionProgress;

    use super::SourceEvent;
    use super::SourceFailureOutcome;
    use super::SourceMode;
    use super::SourceState;
    use super::SourceTerminalState;
    use crate::transport::source::SourceSummary;

    use super::reduce;
    use super::render_source_list_output;
    use super::render_source_show_output;

    #[test]
    fn render_source_list_output_includes_required_columns() {
        let output = render_source_list_output(
            SourceListPayload {
                sources: vec![
                    SourceSummary {
                        name: Some("warehouse".to_owned()),
                        display_name: None,
                        provider: Some("postgres".to_owned()),
                        queryable: Some(true),
                        status: Some("active".to_owned()),
                    },
                    SourceSummary {
                        name: Some("github_main".to_owned()),
                        display_name: None,
                        provider: Some("github".to_owned()),
                        queryable: Some(false),
                        status: Some("active".to_owned()),
                    },
                ],
                page: PageInfo {
                    next_cursor: None,
                    returned: 2,
                    has_more: false,
                },
            },
            &ListReadArgs::default(),
        )
        .expect("expected source list output");
        assert_snapshot!(output.lines.join("\n"));
    }

    #[test]
    fn render_source_show_output_includes_sample_query_when_queryable() {
        let source = SourceSummary {
            name: Some("warehouse".to_owned()),
            display_name: Some("Warehouse".to_owned()),
            provider: Some("postgres".to_owned()),
            queryable: Some(true),
            status: Some("active".to_owned()),
        };

        let output = render_source_show_output(source, &ReadArgs::default())
            .expect("expected source show output");
        assert_snapshot!(output.lines.join("\n"));
    }

    #[test]
    fn render_source_show_output_omits_sample_query_when_not_queryable() {
        let source = SourceSummary {
            name: Some("github_main".to_owned()),
            display_name: None,
            provider: Some("github".to_owned()),
            queryable: Some(false),
            status: Some("active".to_owned()),
        };

        let output = render_source_show_output(source, &ReadArgs::default())
            .expect("expected source show output without sample query");
        assert_eq!(
            output.lines,
            vec![
                "Source: github_main".to_owned(),
                "Provider: github".to_owned(),
                "Status: active".to_owned(),
                "Query (v1): no".to_owned(),
            ]
        );
    }

    #[test]
    fn unauthorized_source_list_failure_transitions_to_explicit_reauth_terminal_state() {
        let context = CommandContext {
            command_line: "onequery source list".to_owned(),
            base_url: default_base_url(),
            request_id: None,
            resolved_org: Some("acme".to_owned()),
            resolved_org_source: ResolvedOrgSource::Config,
            verbose: false,
        };

        let transition = reduce(
            SourceState::LoadingList,
            SourceEvent::SourceListLoadFailed {
                error: CliError::new(
                    "source list failed",
                    context.command_line.clone(),
                    ErrorStage::Auth,
                    "stored credentials are no longer authorized",
                    vec!["onequery auth login".to_owned()],
                ),
                outcome: SourceFailureOutcome::NeedsReauth,
            },
            &context,
        );

        match transition.into_progress() {
            TransitionProgress::Done {
                terminal_state: SourceTerminalState::NeedsReauth { error },
            } => assert_eq!(error.stage, ErrorStage::Auth),
            other => panic!("expected needs-reauth terminal transition, got {other:?}"),
        }
    }

    #[test]
    fn source_show_rejects_unsafe_source_keys_before_authentication() {
        let context = CommandContext {
            command_line: "onequery source show warehouse/main".to_owned(),
            base_url: default_base_url(),
            request_id: None,
            resolved_org: Some("acme".to_owned()),
            resolved_org_source: ResolvedOrgSource::Config,
            verbose: false,
        };

        let transition = reduce(
            SourceState::Idle {
                mode: SourceMode::Show {
                    source_key: "warehouse/main".to_owned(),
                    read: ReadArgs::default(),
                },
            },
            SourceEvent::Start,
            &context,
        );

        match transition.into_progress() {
            TransitionProgress::Done {
                terminal_state: SourceTerminalState::Failed { error },
            } => assert_eq!(
                (error.title.clone(), error.stage, error.why.clone()),
                (
                    "invalid source key".to_owned(),
                    ErrorStage::ParseCommand,
                    "source key must use only letters, numbers, dots, underscores, or hyphens"
                        .to_owned(),
                )
            ),
            other => panic!("expected invalid source key failure, got {other:?}"),
        }
    }
}
