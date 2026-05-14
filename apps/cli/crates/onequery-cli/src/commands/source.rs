use super::CommandContext;
use super::Runtime;
use super::auth_session::authenticated_api_client;
use super::auth_session::ensure_authenticated_org;
use super::read_controls_from_list_args;
use super::read_controls_from_read_args;
use crate::cli::ListReadArgs;
use crate::cli::ReadArgs;
use crate::cli::SourceSubcommand;
use crate::identifiers::OrgSlug;
use crate::identifiers::SourceKey;
use crate::output::CommandOutput;
use crate::output::TerminalOutput;
use crate::output::append_padded_cell;
use crate::output::pretty_json_lines;
use crate::output::serialize_command_data;
use crate::presentation::api_failure::ApiErrorPresentation;
use crate::presentation::api_failure::present_api_failure_with_context;
use crate::recovery::auth_login_then_retry_try_next;
use crate::recovery::auth_login_try_next;
use crate::recovery::command_then_retry_try_next;
use crate::transport::read_controls::PageInfo;
use crate::transport::source;
use crate::transport::source::SourceListPayload;
use crate::transport::source::SourceSummary;
use crate::transport::source::SourceTestOutcome;
use crate::transport::source::SourceTestPayload;
use crate::transport::source::SourceTestSupportedResult;
use crate::workflows::retry::RetryDirective;
use crate::workflows::retry::classify_retry_directive;
use crate::workflows::runner::DEFAULT_MAX_WORKFLOW_STEPS;
use crate::workflows::runner::Transition;
use crate::workflows::runner::WorkflowLabel;
use crate::workflows::runner::WorkflowRunConfig;
use crate::workflows::runner::run_reducer_workflow;
use onequery_core::error::CliError;

#[derive(Debug)]
enum SourceMode {
    List {
        read: ListReadArgs,
    },
    Show {
        source_key: SourceKey,
        read: ReadArgs,
    },
    Test {
        source_key: SourceKey,
    },
}

#[derive(Debug)]
enum SourceState {
    Idle { mode: SourceMode },
    CheckingAuth { mode: SourceMode },
    LoadingList,
    LoadingShow,
    LoadingTest,
}

#[derive(Debug)]
enum SourceTerminalState {
    Completed { output: TerminalOutput },
    NeedsReauth { error: CliError },
    Failed { error: CliError },
}

#[derive(Debug)]
enum SourceEvent {
    Start,
    Authenticated {
        org: OrgSlug,
    },
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
    SourceTested {
        payload: SourceTestPayload,
        request_id: Option<String>,
    },
    SourceLoadFailed {
        error: CliError,
        outcome: SourceFailureOutcome,
    },
    SourceTestFailed {
        error: CliError,
        outcome: SourceFailureOutcome,
    },
}

#[derive(Debug)]
enum SourceEffect {
    EnsureAuthenticatedOrg,
    FetchSourceList {
        org: OrgSlug,
        read: ListReadArgs,
    },
    FetchSource {
        org: OrgSlug,
        source_key: SourceKey,
        read: ReadArgs,
    },
    FetchSourceTest {
        org: OrgSlug,
        source_key: SourceKey,
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
    if let SourceSubcommand::Providers = command {
        return super::source_providers::execute(context, runtime).await;
    }

    if let SourceSubcommand::Connect(args) = command {
        return super::source_connect::execute(args, context, runtime).await;
    }

    let mode = match command {
        SourceSubcommand::List { read } => SourceMode::List { read: read.clone() },
        SourceSubcommand::Show { source_key, read } => SourceMode::Show {
            source_key: source_key.clone(),
            read: read.clone(),
        },
        SourceSubcommand::Test { source_key } => SourceMode::Test {
            source_key: source_key.clone(),
        },
        SourceSubcommand::Providers => unreachable!("source providers is delegated"),
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
        SourceTerminalState::Completed { output } => Ok(output.into_inner()),
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
                    SourceEffect::EnsureAuthenticatedOrg,
                ),
                SourceMode::Show { source_key, read } => Transition::continue_with_effect(
                    SourceState::CheckingAuth {
                        mode: SourceMode::Show { source_key, read },
                    },
                    SourceEffect::EnsureAuthenticatedOrg,
                ),
                SourceMode::Test { source_key } => Transition::continue_with_effect(
                    SourceState::CheckingAuth {
                        mode: SourceMode::Test { source_key },
                    },
                    SourceEffect::EnsureAuthenticatedOrg,
                ),
            },
            SourceEvent::Authenticated { .. }
            | SourceEvent::AuthFailed { .. }
            | SourceEvent::SourceListLoaded { .. }
            | SourceEvent::SourceListLoadFailed { .. }
            | SourceEvent::SourceLoaded { .. }
            | SourceEvent::SourceTested { .. }
            | SourceEvent::SourceLoadFailed { .. }
            | SourceEvent::SourceTestFailed { .. } => {
                Transition::done(SourceTerminalState::Failed {
                    error: unexpected_transition_error(context, SourceState::Idle { mode }, event),
                })
            }
        },
        SourceState::CheckingAuth { mode } => match event {
            SourceEvent::Authenticated { org } => match mode {
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
                SourceMode::Test { source_key } => Transition::continue_with_effect(
                    SourceState::LoadingTest,
                    SourceEffect::FetchSourceTest { org, source_key },
                ),
            },
            SourceEvent::AuthFailed { error } => {
                Transition::done(SourceTerminalState::Failed { error })
            }
            SourceEvent::Start
            | SourceEvent::SourceListLoaded { .. }
            | SourceEvent::SourceListLoadFailed { .. }
            | SourceEvent::SourceLoaded { .. }
            | SourceEvent::SourceTested { .. }
            | SourceEvent::SourceLoadFailed { .. }
            | SourceEvent::SourceTestFailed { .. } => {
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
                    output: TerminalOutput::new(output.with_request_id(request_id)),
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
            | SourceEvent::Authenticated { .. }
            | SourceEvent::AuthFailed { .. }
            | SourceEvent::SourceLoaded { .. }
            | SourceEvent::SourceTested { .. }
            | SourceEvent::SourceLoadFailed { .. }
            | SourceEvent::SourceTestFailed { .. } => {
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
                    output: TerminalOutput::new(output.with_request_id(request_id)),
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
            | SourceEvent::Authenticated { .. }
            | SourceEvent::AuthFailed { .. }
            | SourceEvent::SourceListLoaded { .. }
            | SourceEvent::SourceListLoadFailed { .. }
            | SourceEvent::SourceTested { .. }
            | SourceEvent::SourceTestFailed { .. } => {
                Transition::done(SourceTerminalState::Failed {
                    error: unexpected_transition_error(context, SourceState::LoadingShow, event),
                })
            }
        },
        SourceState::LoadingTest => match event {
            SourceEvent::SourceTested {
                payload,
                request_id,
            } => match render_source_test_output(payload) {
                Ok(output) => Transition::done(SourceTerminalState::Completed {
                    output: TerminalOutput::new(output.with_request_id(request_id)),
                }),
                Err(error) => Transition::done(SourceTerminalState::Failed { error }),
            },
            SourceEvent::SourceTestFailed { error, outcome } => match outcome {
                SourceFailureOutcome::NeedsReauth => {
                    Transition::done(SourceTerminalState::NeedsReauth { error })
                }
                SourceFailureOutcome::Failed => {
                    Transition::done(SourceTerminalState::Failed { error })
                }
            },
            SourceEvent::Start
            | SourceEvent::Authenticated { .. }
            | SourceEvent::AuthFailed { .. }
            | SourceEvent::SourceListLoaded { .. }
            | SourceEvent::SourceListLoadFailed { .. }
            | SourceEvent::SourceLoaded { .. }
            | SourceEvent::SourceLoadFailed { .. } => {
                Transition::done(SourceTerminalState::Failed {
                    error: unexpected_transition_error(context, SourceState::LoadingTest, event),
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
        SourceEffect::EnsureAuthenticatedOrg => {
            match ensure_authenticated_org(context, runtime).await {
                Ok(org) => SourceEvent::Authenticated { org },
                Err(error) => SourceEvent::AuthFailed { error },
            }
        }
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
                        error: present_api_failure_with_context(
                            failure,
                            context,
                            ApiErrorPresentation {
                                command: &context.command_line,
                                title: "source list failed",
                                transport_why_prefix: "failed to reach source list endpoint",
                                decode_why_prefix: "failed to decode source list response",
                                fallback_try_next: auth_login_then_retry_try_next(
                                    &context.command_line,
                                ),
                                unauthorized_try_next: Some(auth_login_try_next()),
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
                        error: present_api_failure_with_context(
                            failure,
                            context,
                            ApiErrorPresentation {
                                command: &context.command_line,
                                title: "source show failed",
                                transport_why_prefix: "failed to reach source show endpoint",
                                decode_why_prefix: "failed to decode source show response",
                                fallback_try_next: command_then_retry_try_next(
                                    "onequery source list",
                                    &context.command_line,
                                ),
                                unauthorized_try_next: Some(auth_login_try_next()),
                            },
                        ),
                        outcome,
                    }
                }
            }
        }
        SourceEffect::FetchSourceTest { org, source_key } => {
            let client = match authenticated_api_client(context, runtime) {
                Ok(client) => client,
                Err(error) => {
                    return SourceEvent::SourceTestFailed {
                        error,
                        outcome: SourceFailureOutcome::Failed,
                    };
                }
            };

            match source::test_source(&client, org.as_str(), source_key.as_str()).await {
                Ok(response) => SourceEvent::SourceTested {
                    payload: response.payload,
                    request_id: response.request_id,
                },
                Err(failure) => {
                    let outcome = source_failure_outcome(&failure);

                    SourceEvent::SourceTestFailed {
                        error: present_api_failure_with_context(
                            failure,
                            context,
                            ApiErrorPresentation {
                                command: &context.command_line,
                                title: "source test failed",
                                transport_why_prefix: "failed to reach source test endpoint",
                                decode_why_prefix: "failed to decode source test response",
                                fallback_try_next: command_then_retry_try_next(
                                    "onequery source list",
                                    &context.command_line,
                                ),
                                unauthorized_try_next: Some(auth_login_try_next()),
                            },
                        ),
                        outcome,
                    }
                }
            }
        }
    }
}

fn source_failure_outcome(
    failure: &crate::transport::api_failure::ApiFailure,
) -> SourceFailureOutcome {
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
            Self::LoadingTest => "LoadingTest",
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
            Self::Authenticated { .. } => "Authenticated",
            Self::AuthFailed { .. } => "AuthFailed",
            Self::SourceListLoaded { .. } => "SourceListLoaded",
            Self::SourceListLoadFailed { .. } => "SourceListLoadFailed",
            Self::SourceLoaded { .. } => "SourceLoaded",
            Self::SourceLoadFailed { .. } => "SourceLoadFailed",
            Self::SourceTested { .. } => "SourceTested",
            Self::SourceTestFailed { .. } => "SourceTestFailed",
        }
    }
}

impl WorkflowLabel for SourceEffect {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::EnsureAuthenticatedOrg => "EnsureAuthenticatedOrg",
            Self::FetchSourceList { .. } => "FetchSourceList",
            Self::FetchSource { .. } => "FetchSource",
            Self::FetchSourceTest { .. } => "FetchSourceTest",
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
            vec![
                "No connected sources found.".to_owned(),
                "Run `onequery source providers` to view available providers.".to_owned(),
            ],
            move || serialize_command_data(&payload, "onequery source list"),
        ));
    }

    let source_key_width = sources
        .iter()
        .map(|source| source.source_key.len())
        .max()
        .unwrap_or(4)
        .max("SOURCE KEY".len());
    let provider_width = sources
        .iter()
        .map(|source| source.provider.len())
        .max()
        .unwrap_or(8)
        .max("PROVIDER".len());
    let interfaces_width = sources
        .iter()
        .map(|source| format_source_interfaces(&source.interfaces).len())
        .max()
        .unwrap_or(10)
        .max("INTERFACES".len());
    let status_width = sources
        .iter()
        .map(|source| source.status.len())
        .max()
        .unwrap_or(6)
        .max("STATUS".len());

    let row_capacity = source_key_width + provider_width + interfaces_width + status_width + 6;
    let mut lines = Vec::with_capacity(sources.len() + 1);
    let mut header = String::with_capacity(row_capacity);
    append_padded_cell(&mut header, "SOURCE KEY", source_key_width);
    header.push_str("  ");
    append_padded_cell(&mut header, "PROVIDER", provider_width);
    header.push_str("  ");
    append_padded_cell(&mut header, "INTERFACES", interfaces_width);
    header.push_str("  ");
    append_padded_cell(&mut header, "STATUS", status_width);
    lines.push(header);

    for source in sources {
        let mut row = String::with_capacity(row_capacity);
        append_padded_cell(&mut row, &source.source_key, source_key_width);
        row.push_str("  ");
        append_padded_cell(&mut row, &source.provider, provider_width);
        row.push_str("  ");
        append_padded_cell(
            &mut row,
            &format_source_interfaces(&source.interfaces),
            interfaces_width,
        );
        row.push_str("  ");
        append_padded_cell(&mut row, &source.status, status_width);
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
        format!("Source: {}", &source.source_key),
        format!("Provider: {}", &source.provider),
        format!("Status: {}", &source.status),
        format!(
            "Interfaces: {}",
            format_source_interfaces(&source.interfaces)
        ),
    ];

    if let Some(display_name) = &source.display_name {
        lines.insert(1, format!("Display Name: {display_name}"));
    }

    if source
        .interfaces
        .iter()
        .any(|interface| interface == "query")
    {
        lines.push(format!(
            "Query command: onequery query exec --source {} --sql \"select 1\"",
            &source.source_key
        ));
    }

    if source.interfaces.iter().any(|interface| interface == "api") {
        lines.push(format!(
            "API command: onequery api --source {}",
            &source.source_key
        ));
    }

    Ok(CommandOutput::try_deferred(lines, move || {
        serialize_command_data(&source, "onequery source show")
    }))
}

fn format_source_interfaces(interfaces: &[String]) -> String {
    if interfaces.is_empty() {
        return "-".to_owned();
    }

    interfaces.join(",")
}

fn render_source_test_output(payload: SourceTestPayload) -> Result<CommandOutput, CliError> {
    let mut lines = vec![
        format!("Source: {}", &payload.source.source_key),
        format!("Provider: {}", &payload.source.provider),
        format!("Status: {}", &payload.source.status),
    ];

    if let Some(display_name) = &payload.source.display_name {
        lines.insert(1, format!("Display Name: {display_name}"));
    }

    match &payload.outcome {
        SourceTestOutcome::Supported { result, latency_ms } => {
            let passed = matches!(result, SourceTestSupportedResult::Passed { .. });
            lines.push(format!(
                "Test: {}",
                if passed { "passed" } else { "failed" }
            ));
            match result {
                SourceTestSupportedResult::Passed { message } => {
                    lines.push(format!("Message: {message}"));
                }
                SourceTestSupportedResult::Failed { message, error } => {
                    lines.push(format!("Message: {message}"));
                    lines.push(format!("Error: {error}"));
                }
            }
            if let Some(latency_ms) = latency_ms {
                lines.push(format!("Latency: {latency_ms} ms"));
            }
        }
        SourceTestOutcome::Unsupported { message, reason } => {
            lines.push("Test: unsupported".to_owned());
            lines.push(format!("Message: {message}"));
            lines.push(format!("Reason: {reason}"));
        }
    }

    Ok(CommandOutput::try_deferred(lines, move || {
        serialize_command_data(&payload, "onequery source test")
    }))
}

fn append_page_lines(lines: &mut Vec<String>, page: &PageInfo, force_render: bool) {
    if !force_render && !page.has_next_page() {
        return;
    }

    lines.push(String::new());
    if page.has_next_page() {
        lines.push(format!(
            "Page: {} returned, more available",
            page.returned_count
        ));
        if let Some(next_cursor) = &page.next_cursor {
            lines.push(format!("Next cursor: {next_cursor}"));
        }
        return;
    }

    lines.push(format!("Page: {} returned", page.returned_count));
}

#[cfg(test)]
mod tests {
    use insta::assert_snapshot;
    use onequery_core::error::CliError;
    use onequery_core::error::ErrorStage;
    use pretty_assertions::assert_eq;

    use crate::cli::ListReadArgs;
    use crate::cli::ReadArgs;
    use crate::commands::CommandContext;
    use crate::commands::ResolvedOrgSource;
    use crate::config::default_base_url;
    use crate::transport::read_controls::PageInfo;
    use crate::transport::source::SourceListPayload;
    use crate::transport::source::SourceTestOutcome;
    use crate::transport::source::SourceTestPayload;
    use crate::transport::source::SourceTestSupportedResult;
    use crate::workflows::runner::TransitionProgress;

    use super::SourceEvent;
    use super::SourceFailureOutcome;
    use super::SourceState;
    use super::SourceTerminalState;
    use crate::transport::source::SourceSummary;

    use super::reduce;
    use super::render_source_list_output;
    use super::render_source_show_output;
    use super::render_source_test_output;

    #[test]
    fn render_source_list_output_includes_required_columns() {
        let output = render_source_list_output(
            SourceListPayload {
                sources: vec![
                    SourceSummary {
                        source_key: "warehouse".to_owned(),
                        display_name: None,
                        provider: "postgres".to_owned(),
                        status: "active".to_owned(),
                        interfaces: vec!["query".to_owned()],
                    },
                    SourceSummary {
                        source_key: "github_main".to_owned(),
                        display_name: None,
                        provider: "github".to_owned(),
                        status: "active".to_owned(),
                        interfaces: vec!["api".to_owned()],
                    },
                ],
                page: PageInfo {
                    next_cursor: None,
                    returned_count: 2,
                },
            },
            &ListReadArgs::default(),
        )
        .expect("expected source list output");
        assert_snapshot!(output.lines.join("\n"));
    }

    #[test]
    fn render_source_list_output_recommends_provider_discovery_when_empty() {
        let output = render_source_list_output(
            SourceListPayload {
                sources: Vec::new(),
                page: PageInfo {
                    next_cursor: None,
                    returned_count: 0,
                },
            },
            &ListReadArgs::default(),
        )
        .expect("expected source list output");

        assert_eq!(
            output.lines,
            vec![
                "No connected sources found.".to_owned(),
                "Run `onequery source providers` to view available providers.".to_owned(),
            ]
        );
    }

    #[test]
    fn render_source_show_output_includes_query_command_with_query_interface() {
        let source = SourceSummary {
            source_key: "warehouse".to_owned(),
            display_name: Some("Warehouse".to_owned()),
            provider: "postgres".to_owned(),
            status: "active".to_owned(),
            interfaces: vec!["query".to_owned()],
        };

        let output = render_source_show_output(source, &ReadArgs::default())
            .expect("expected source show output");
        assert_snapshot!(output.lines.join("\n"));
    }

    #[test]
    fn render_source_show_output_omits_sample_query_without_query_interface() {
        let source = SourceSummary {
            source_key: "github_main".to_owned(),
            display_name: None,
            provider: "github".to_owned(),
            status: "active".to_owned(),
            interfaces: vec!["api".to_owned()],
        };

        let output = render_source_show_output(source, &ReadArgs::default())
            .expect("expected source show output without sample query");
        assert_eq!(
            output.lines,
            vec![
                "Source: github_main".to_owned(),
                "Provider: github".to_owned(),
                "Status: active".to_owned(),
                "Interfaces: api".to_owned(),
                "API command: onequery api --source github_main".to_owned(),
            ]
        );
    }

    #[test]
    fn render_source_test_output_includes_supported_failure_details() {
        let output = render_source_test_output(SourceTestPayload {
            source: SourceSummary {
                source_key: "warehouse".to_owned(),
                display_name: Some("Warehouse".to_owned()),
                provider: "postgres".to_owned(),
                status: "error".to_owned(),
                interfaces: Vec::new(),
            },
            outcome: SourceTestOutcome::Supported {
                result: SourceTestSupportedResult::Failed {
                    message: "Connection test failed.".to_owned(),
                    error: "password authentication failed".to_owned(),
                },
                latency_ms: Some(123),
            },
        })
        .expect("expected source test output");

        assert_snapshot!(output.lines.join("\n"));
    }

    #[test]
    fn render_source_test_output_includes_unsupported_reason() {
        let output = render_source_test_output(SourceTestPayload {
            source: SourceSummary {
                source_key: "github_prod".to_owned(),
                display_name: None,
                provider: "github".to_owned(),
                status: "active".to_owned(),
                interfaces: vec!["api".to_owned()],
            },
            outcome: SourceTestOutcome::Unsupported {
                message:
                    "Testing is not supported for OAuth-based providers. They are tested during the authorization flow."
                        .to_owned(),
                reason: "oauth".to_owned(),
            },
        })
        .expect("expected unsupported source test output");

        assert_eq!(
            output.lines,
            vec![
                "Source: github_prod".to_owned(),
                "Provider: github".to_owned(),
                "Status: active".to_owned(),
                "Test: unsupported".to_owned(),
                "Message: Testing is not supported for OAuth-based providers. They are tested during the authorization flow.".to_owned(),
                "Reason: oauth".to_owned(),
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
}
