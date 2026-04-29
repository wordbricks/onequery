mod args;
mod field_patch;
mod format;
mod intent;
mod plan;
mod render;
mod workflow;

use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;

use crate::cli::ApiArgs;
use crate::output::CommandOutput;
use crate::presentation::api_failure::ApiErrorPresentation;
use crate::presentation::api_failure::present_api_failure_with_context;
use crate::recovery::auth_login_try_next;
use crate::recovery::command_then_retry_try_next;
use crate::transport::source_api::ExecuteSourceApiOutcome;
use crate::transport::source_api::SourceApiExecutionResult;
use crate::transport::source_api::SourceApiHeader;
use crate::transport::source_api::SourceApiPreview;
use crate::transport::source_api::SourceApiResponseBody;
use crate::transport::source_api::SourceApiSource;

use super::CommandContext;
use super::Runtime;

pub(super) async fn execute<B, T>(
    args: &ApiArgs,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError>
where
    B: crate::platform::BrowserLauncher,
    T: crate::platform::Terminal,
{
    workflow::run_source_api_workflow(args.clone(), context, runtime)
        .await?
        .into_result()
}

#[derive(Clone, Debug, Default, PartialEq)]
struct SourceApiExecutionPage {
    source: SourceApiSource,
    operation: String,
    selector: Option<String>,
    status: u32,
    headers: Vec<SourceApiHeader>,
    content_type: String,
    body: Option<SourceApiResponseBody>,
    continuation_token: Option<String>,
}

fn execution_result_from_outcome(
    outcome: ExecuteSourceApiOutcome,
) -> (SourceApiPreview, SourceApiExecutionResult, Option<String>) {
    match outcome {
        ExecuteSourceApiOutcome::Completed { preview, result } => (preview, result, None),
        ExecuteSourceApiOutcome::Continued {
            preview,
            result,
            continuation_token,
        } => (preview, result, Some(continuation_token)),
    }
}

fn source_api_execution_page_from_result(
    result: SourceApiExecutionResult,
    continuation_token: Option<String>,
    context: &CommandContext,
    source_key: &str,
    response_kind: &'static str,
) -> Result<SourceApiExecutionPage, CliError> {
    let Some(source) = result.source.into_option() else {
        return Err(source_api_error(
            context,
            "invalid source API execution response",
            ErrorStage::SourceApiExecute,
            format!("source API {response_kind} response did not include source metadata"),
            source_key,
        ));
    };
    let Some(operation) = result.operation_name else {
        return Err(source_api_error(
            context,
            "invalid source API execution response",
            ErrorStage::SourceApiExecute,
            format!("source API {response_kind} response did not include an operation name"),
            source_key,
        ));
    };
    let Some(status) = result.http_status_code else {
        return Err(source_api_error(
            context,
            "invalid source API execution response",
            ErrorStage::SourceApiExecute,
            format!("source API {response_kind} response did not include an HTTP status"),
            source_key,
        ));
    };
    if !(100..=599).contains(&status) {
        return Err(source_api_error(
            context,
            "invalid source API execution response",
            ErrorStage::SourceApiExecute,
            format!("source API {response_kind} response included invalid HTTP status: {status}"),
            source_key,
        ));
    }
    let Some(content_type) = result.content_type else {
        return Err(source_api_error(
            context,
            "invalid source API execution response",
            ErrorStage::SourceApiExecute,
            format!("source API {response_kind} response did not include a content type"),
            source_key,
        ));
    };

    Ok(SourceApiExecutionPage {
        body: result.body,
        content_type,
        continuation_token,
        headers: result.headers,
        operation,
        selector: result.selector,
        source,
        status,
    })
}

fn present_source_api_describe_failure(
    failure: crate::transport::api_failure::ApiFailure,
    args: &ApiArgs,
    context: &CommandContext,
) -> CliError {
    present_api_failure_with_context(
        failure,
        context,
        ApiErrorPresentation {
            command: &context.command_line,
            title: "source API describe failed",
            transport_why_prefix: "failed to reach source API service",
            decode_why_prefix: "failed to decode source API descriptor",
            fallback_try_next: vec![format!("onequery api --source {}", args.source)],
            unauthorized_try_next: Some(auth_login_try_next()),
        },
    )
}

fn present_source_api_preview_failure(
    failure: crate::transport::api_failure::ApiFailure,
    args: &ApiArgs,
    context: &CommandContext,
) -> CliError {
    present_api_failure_with_context(
        failure,
        context,
        ApiErrorPresentation {
            command: &context.command_line,
            title: "source API preview failed",
            transport_why_prefix: "failed to reach source API service",
            decode_why_prefix: "failed to decode source API preview",
            fallback_try_next: command_then_retry_try_next(
                format!("onequery api --source {}", args.source),
                &context.command_line,
            ),
            unauthorized_try_next: Some(auth_login_try_next()),
        },
    )
}

fn present_source_api_execute_failure(
    failure: crate::transport::api_failure::ApiFailure,
    args: &ApiArgs,
    context: &CommandContext,
) -> CliError {
    present_api_failure_with_context(
        failure,
        context,
        ApiErrorPresentation {
            command: &context.command_line,
            title: "source API execution failed",
            transport_why_prefix: "failed to reach source API service",
            decode_why_prefix: "failed to decode source API response",
            fallback_try_next: command_then_retry_try_next(
                format!("onequery api --source {}", args.source),
                &context.command_line,
            ),
            unauthorized_try_next: Some(auth_login_try_next()),
        },
    )
}

pub(super) fn source_api_examples(source_key: &str) -> Vec<String> {
    vec![
        format!("onequery api --source {source_key}"),
        format!("onequery api --source {source_key} /path"),
        format!("onequery api --source {source_key} --op <operation> <selector>"),
    ]
}

pub(super) fn source_api_parse_error(
    context: &CommandContext,
    title: impl Into<String>,
    why: impl Into<String>,
    source_key: &str,
) -> CliError {
    source_api_error(context, title, ErrorStage::ParseCommand, why, source_key)
}

pub(super) fn source_api_read_input_error(
    context: &CommandContext,
    title: impl Into<String>,
    why: impl Into<String>,
    source_key: &str,
) -> CliError {
    source_api_error(context, title, ErrorStage::ReadQueryInput, why, source_key)
}

fn source_api_error(
    context: &CommandContext,
    title: impl Into<String>,
    stage: ErrorStage,
    why: impl Into<String>,
    source_key: &str,
) -> CliError {
    CliError::new(
        title,
        context.command_line.clone(),
        stage,
        why,
        source_api_examples(source_key),
    )
}
