use std::rc::Rc;

use insta::assert_snapshot;
use onequery_cli_core::error::ErrorStage;
use pretty_assertions::assert_eq;
use tokio::time::Duration;

use crate::cli::ListReadArgs;
use crate::cli::PaginationArgs;
use crate::cli::QueryExecuteArgs;
use crate::cli::QueryInputArgs;
use crate::cli::QueryResultWindowArgs;
use crate::cli::ReadArgs;
use crate::output_metadata::UntrustedOutputMetadata;
use crate::transport::query::QueryCanonicalRequest;
use crate::transport::query::QueryColumn;
use crate::transport::query::QueryRequestPayload;
use crate::transport::query::QueryResult;
use crate::transport::query::QueryResultWindow;
use crate::transport::query::QueryValidationResult;
use crate::transport::read_controls::PageInfo;
use crate::transport::source::SourceSummary;
use crate::workflows::retry::RetryTransition;
use crate::workflows::runner::TransitionProgress;

use super::super::CommandContext;
use super::super::ResolvedOrgSource;
use super::CheckingAuthState;
use super::ExecutingQueryState;
use super::FailedState;
use super::IdleState;
use super::LoadingQueryInputState;
use super::QUERY_MAX_ATTEMPTS;
use super::QUERY_RETRY_DELAY_MS;
use super::QueryEffect;
use super::QueryEvent;
use super::QueryRequest;
use super::QueryState;
use super::QueryTerminalState;
use super::QueryValidateEvent;
use super::QueryValidateFailureOutcome;
use super::QueryValidateTerminalState;
use super::ValidateQueryRequest;
use super::ValidatingQueryState;
use super::WaitingToRetryQueryState;
use super::execute::reduce_executing_query;
use super::execute::reduce_idle;
use super::execute::reduce_loading_query_input;
use super::input::effective_query_http_timeout;
use super::input::with_effective_query_timeout;
use super::presentation::render_query_output;
use super::presentation::render_query_validation_output;
use super::validate::reduce_validating_query;
use super::validate_query_source_key;

fn with_legacy_snapshot_path(test: impl FnOnce()) {
    let mut settings = insta::Settings::clone_current();
    settings.set_snapshot_path("../snapshots");
    settings.bind(test);
}

fn sample_context() -> CommandContext {
    CommandContext {
        command_line: "oneq query execute --source warehouse --sql \"select 1\"".to_owned(),
        base_url: "https://example.com".to_owned(),
        request_id: None,
        resolved_org: Some("acme".to_owned()),
        resolved_org_source: ResolvedOrgSource::Flag,
        verbose: false,
    }
}

fn sample_query_input() -> QueryInputArgs {
    QueryInputArgs {
        input: None,
        sql: Some("select 1".to_owned()),
        file: None,
        stdin: false,
        result_window: QueryResultWindowArgs::default(),
    }
}

fn sample_query_payload() -> QueryRequestPayload {
    QueryRequestPayload {
        sql: "select 1".to_owned(),
        parameters: None,
        max_rows: None,
        max_bytes: None,
        cell_max_chars: None,
        timeout_ms: None,
    }
}

#[test]
fn render_query_output_snapshot() {
    let output = render_query_output(
        QueryResult {
            source: Some(SourceSummary {
                name: Some("warehouse".to_owned()),
                display_name: None,
                provider_kind: Some("postgres".to_owned()),
                queryable: Some(true),
                status: Some("active".to_owned()),
            }),
            row_count: Some(2),
            elapsed_ms: Some(428),
            columns: Some(vec![
                QueryColumn {
                    name: Some("day".to_owned()),
                    logical_type: Some("date".to_owned()),
                },
                QueryColumn {
                    name: Some("signups".to_owned()),
                    logical_type: Some("int".to_owned()),
                },
            ]),
            rows: Some(vec![
                vec!["2026-03-04".to_owned(), "182".to_owned()],
                vec!["2026-03-03".to_owned(), "177".to_owned()],
            ]),
            truncated: Some(false),
            page: PageInfo {
                next_cursor: None,
                returned: 2,
                has_more: false,
            },
            output_metadata: UntrustedOutputMetadata::default(),
        },
        &ListReadArgs::default(),
    )
    .expect("expected query output");

    with_legacy_snapshot_path(|| {
        assert_snapshot!(output.lines.join("\n"));
    });
}

#[test]
fn render_query_validation_output_snapshot() {
    let output = render_query_validation_output(
        QueryValidationResult {
            request: Some(QueryCanonicalRequest {
                sql: Some("SELECT 1".to_owned()),
                parameters: None,
                max_rows: Some(100),
                max_bytes: Some(4096),
                cell_max_chars: Some(256),
                timeout_ms: Some(2500),
            }),
            normalized_sql: Some("SELECT 1".to_owned()),
            declared_result_window: Some(QueryResultWindow {
                max_rows: Some(100),
                max_bytes: Some(4096),
                cell_max_chars: Some(256),
                timeout_ms: Some(2500),
            }),
            source: Some(SourceSummary {
                name: Some("warehouse".to_owned()),
                display_name: Some("Warehouse".to_owned()),
                provider_kind: Some("postgres".to_owned()),
                queryable: Some(true),
                status: Some("active".to_owned()),
            }),
            truncated: Some(false),
        },
        &ReadArgs::default(),
    )
    .expect("expected query validation output");

    with_legacy_snapshot_path(|| {
        assert_snapshot!(output.lines.join("\n"));
    });
}

#[test]
fn with_effective_query_timeout_defaults_missing_timeout_to_config_timeout() {
    let payload = with_effective_query_timeout(&sample_query_payload(), 5);

    assert_eq!(payload.timeout_ms, Some(5_000));
}

#[test]
fn effective_query_http_timeout_uses_the_defaulted_payload_timeout() {
    let payload = with_effective_query_timeout(&sample_query_payload(), 5);

    assert_eq!(
        effective_query_http_timeout(&payload, 5),
        Duration::from_millis(5_000)
    );
}

#[test]
fn effective_query_http_timeout_respects_explicit_payload_timeout() {
    let payload = QueryRequestPayload {
        timeout_ms: Some(7_500),
        ..sample_query_payload()
    };

    assert_eq!(
        effective_query_http_timeout(&payload, 5),
        Duration::from_millis(7_500)
    );
}

#[test]
fn render_query_output_renders_no_columns() {
    let output = render_query_output(
        QueryResult {
            source: Some(SourceSummary {
                name: Some("warehouse".to_owned()),
                display_name: None,
                provider_kind: Some("postgres".to_owned()),
                queryable: Some(true),
                status: Some("active".to_owned()),
            }),
            row_count: Some(0),
            elapsed_ms: Some(0),
            columns: Some(vec![]),
            rows: Some(vec![]),
            truncated: Some(false),
            page: PageInfo {
                next_cursor: None,
                returned: 0,
                has_more: false,
            },
            output_metadata: UntrustedOutputMetadata::default(),
        },
        &ListReadArgs::default(),
    )
    .expect("expected no-column query output");

    assert_eq!(
        output.lines,
        vec![
            "Source: warehouse (postgres)".to_owned(),
            "Rows: 0".to_owned(),
            "Time: 0 ms".to_owned(),
            String::new(),
            "<no columns>".to_owned(),
        ]
    );
}

#[test]
fn start_loads_local_sql_input_before_authentication() {
    let context = sample_context();

    let transition = reduce_idle(
        IdleState {
            args: QueryExecuteArgs {
                source: "warehouse".to_owned(),
                read: ListReadArgs {
                    read: ReadArgs::default(),
                    pagination: PaginationArgs::default(),
                },
                input: sample_query_input(),
            },
        },
        QueryEvent::Start,
        &context,
    );

    assert_eq!(
        match transition.into_progress() {
            TransitionProgress::Continue {
                next_state: QueryState::LoadingQueryInput(LoadingQueryInputState { source_key, .. }),
                effect: QueryEffect::LoadQueryRequest { input },
            } => (source_key, input),
            other => panic!("expected SQL input loading transition, got {other:?}"),
        },
        ("warehouse".to_owned(), sample_query_input(),)
    );
}

#[test]
fn validate_query_source_key_rejects_unsafe_path_segments() {
    let context = sample_context();

    let Err(error) = validate_query_source_key("warehouse/main", &context) else {
        panic!("expected invalid source key");
    };

    assert_eq!(
        (error.title.clone(), error.stage, error.why.clone()),
        (
            "invalid source key".to_owned(),
            ErrorStage::ParseCommand,
            "source key must use only letters, numbers, dots, underscores, or hyphens".to_owned(),
        )
    );
}

#[test]
fn loading_sql_input_resolves_org_before_authentication() {
    let context = sample_context();

    let transition = reduce_loading_query_input(
        LoadingQueryInputState {
            source_key: "warehouse".to_owned(),
            read: ListReadArgs::default(),
        },
        QueryEvent::RequestLoaded {
            payload: sample_query_payload(),
        },
        &context,
    );

    assert_eq!(
        match transition.into_progress() {
            TransitionProgress::Continue {
                next_state: QueryState::CheckingAuth(CheckingAuthState { request }),
                effect: QueryEffect::EnsureAuthenticated,
            } => (
                request.org.clone(),
                request.source_key.clone(),
                request.read.clone(),
                request.payload.clone(),
            ),
            other => panic!("expected auth-check transition, got {other:?}"),
        },
        (
            "acme".to_owned(),
            "warehouse".to_owned(),
            ListReadArgs::default(),
            sample_query_payload(),
        )
    );
}

#[test]
fn retryable_query_failure_transitions_to_explicit_retry_state() {
    let context = sample_context();
    let retryable_error = onequery_cli_core::error::CliError::new(
        "query failed",
        context.command_line.clone(),
        ErrorStage::Http,
        "temporary network timeout",
        vec!["retry oneq query execute --source warehouse --sql \"select 1\"".to_owned()],
    );

    let transition = reduce_executing_query(
        ExecutingQueryState {
            request: Rc::new(QueryRequest {
                org: "acme".to_owned(),
                source_key: "warehouse".to_owned(),
                read: ListReadArgs::default(),
                payload: sample_query_payload(),
            }),
        },
        QueryEvent::QueryExecuteFailed {
            error: retryable_error,
            retry: RetryTransition::RetryScheduled {
                next_attempt: 2,
                max_attempts: QUERY_MAX_ATTEMPTS,
                delay_ms: QUERY_RETRY_DELAY_MS,
            },
        },
        &context,
    );

    assert_eq!(
        match transition.into_progress() {
            TransitionProgress::Continue {
                next_state:
                    QueryState::WaitingToRetryQuery(WaitingToRetryQueryState {
                        request,
                        next_attempt,
                    }),
                effect:
                    QueryEffect::WaitBeforeRetryQuery {
                        next_attempt: effect_attempt,
                        delay_ms,
                    },
            } => (
                request.org.clone(),
                request.source_key.clone(),
                request.read.clone(),
                request.payload.clone(),
                next_attempt,
                effect_attempt,
                delay_ms,
            ),
            other => panic!("expected waiting-to-retry continue transition, got {other:?}"),
        },
        (
            "acme".to_owned(),
            "warehouse".to_owned(),
            ListReadArgs::default(),
            sample_query_payload(),
            2,
            2,
            QUERY_RETRY_DELAY_MS,
        )
    );
}

#[test]
fn retryable_query_failure_exhausts_after_max_attempts() {
    let context = sample_context();
    let terminal_error = onequery_cli_core::error::CliError::new(
        "query failed",
        context.command_line.clone(),
        ErrorStage::Http,
        "temporary network timeout",
        vec!["retry oneq query execute --source warehouse --sql \"select 1\"".to_owned()],
    );

    let transition = reduce_executing_query(
        ExecutingQueryState {
            request: Rc::new(QueryRequest {
                org: "acme".to_owned(),
                source_key: "warehouse".to_owned(),
                read: ListReadArgs::default(),
                payload: sample_query_payload(),
            }),
        },
        QueryEvent::QueryExecuteFailed {
            error: terminal_error,
            retry: RetryTransition::RetryExhausted {
                attempts: QUERY_MAX_ATTEMPTS,
                max_attempts: QUERY_MAX_ATTEMPTS,
            },
        },
        &context,
    );

    match transition.into_progress() {
        TransitionProgress::Done {
            terminal_state: QueryTerminalState::Failed(FailedState { error }),
        } => assert_eq!(error.stage, ErrorStage::Http),
        other => panic!("expected failed terminal transition, got {other:?}"),
    }
}

#[test]
fn unauthorized_query_failure_transitions_to_explicit_reauth_terminal_state() {
    let context = sample_context();
    let reauth_error = onequery_cli_core::error::CliError::new(
        "query failed",
        context.command_line.clone(),
        ErrorStage::Auth,
        "stored credentials are no longer authorized",
        vec!["oneq auth login".to_owned()],
    );

    let transition = reduce_executing_query(
        ExecutingQueryState {
            request: Rc::new(QueryRequest {
                org: "acme".to_owned(),
                source_key: "warehouse".to_owned(),
                read: ListReadArgs::default(),
                payload: sample_query_payload(),
            }),
        },
        QueryEvent::QueryExecuteFailed {
            error: reauth_error,
            retry: RetryTransition::NeedsReauth,
        },
        &context,
    );

    match transition.into_progress() {
        TransitionProgress::Done {
            terminal_state: QueryTerminalState::NeedsReauth(FailedState { error }),
        } => assert_eq!(error.stage, ErrorStage::Auth),
        other => panic!("expected needs-reauth terminal transition, got {other:?}"),
    }
}

#[test]
fn validate_unauthorized_failure_transitions_to_explicit_reauth_terminal_state() {
    let context = sample_context();
    let reauth_error = onequery_cli_core::error::CliError::new(
        "query validation failed",
        context.command_line.clone(),
        ErrorStage::ReadQueryInput,
        "stored credentials are no longer authorized",
        vec!["oneq auth login".to_owned()],
    );

    let transition = reduce_validating_query(
        ValidatingQueryState {
            request: Rc::new(ValidateQueryRequest {
                org: "acme".to_owned(),
                source_key: "warehouse".to_owned(),
                read: ReadArgs::default(),
                payload: sample_query_payload(),
            }),
        },
        QueryValidateEvent::QueryValidateFailed {
            error: reauth_error,
            outcome: QueryValidateFailureOutcome::NeedsReauth,
        },
        &context,
    );

    match transition.into_progress() {
        TransitionProgress::Done {
            terminal_state: QueryValidateTerminalState::NeedsReauth(FailedState { error }),
        } => assert_eq!(error.stage, ErrorStage::ReadQueryInput),
        other => panic!("expected needs-reauth terminal transition, got {other:?}"),
    }
}
