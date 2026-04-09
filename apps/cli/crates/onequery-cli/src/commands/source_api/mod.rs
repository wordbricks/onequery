mod args;
mod field_patch;
mod format;
mod intent;
mod plan;
mod render;

use std::time::Duration;

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;

use crate::cli::UseArgs;
use crate::output::CommandOutput;
use crate::presentation::api_failure::ApiErrorPresentation;
use crate::presentation::api_failure::present_api_failure;
use crate::transport::source_api;
use crate::transport::source_api::ExecuteSourceApiRequestPayload;
use crate::transport::source_api::ExecuteSourceApiResponse;

use super::CommandContext;
use super::Runtime;
use super::auth_session::authenticated_api_client_with_timeout;
use super::auth_session::ensure_authenticated;
use super::require_org;
use plan::PlannedCommand;
use plan::SourceApiExecutionOptions;
use render::render_descriptor_output;
use render::render_dry_run_output;
use render::render_execute_output;

pub(super) async fn execute<B, T>(
    args: &UseArgs,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError> {
    let org_slug = require_org(context)?.to_owned();
    ensure_authenticated(context, runtime).await?;

    let request_timeout = Duration::from_secs(runtime.config.data().request_timeout_sec);
    let client = authenticated_api_client_with_timeout(context, runtime, request_timeout)?;

    let descriptor_response =
        source_api::describe_source_api(&client, org_slug.as_str(), args.source.as_str())
            .await
            .map_err(|failure| {
                present_api_failure(
                    failure,
                    ApiErrorPresentation {
                        command: &context.command_line,
                        title: "source API describe failed",
                        transport_why_prefix: "failed to reach source API service",
                        decode_why_prefix: "failed to decode source API descriptor",
                        fallback_try_next: vec![format!("onequery use --source {}", args.source)],
                        unauthorized_try_next: Some(vec!["onequery auth login".to_owned()]),
                    },
                )
            })?;

    let plan = plan::build_plan(args, &descriptor_response.payload, context).await?;
    match plan {
        PlannedCommand::Describe => render_descriptor_output(descriptor_response.payload)
            .map(|output| output.with_request_id(descriptor_response.request_id)),
        PlannedCommand::DryRun { request } => {
            let normalize_response = source_api::normalize_source_api(
                &client,
                org_slug.as_str(),
                args.source.as_str(),
                &request,
            )
            .await
            .map_err(|failure| present_source_api_normalize_failure(failure, args, context))?;

            render_dry_run_output(normalize_response.payload)
                .map(|output| output.with_request_id(normalize_response.request_id))
        }
        PlannedCommand::Execute { plan } => {
            let execute_response = execute_source_api_pages(
                &client,
                org_slug.as_str(),
                args.source.as_str(),
                &plan.request,
                &plan.execution,
                args,
                context,
            )
            .await?;

            render_execute_output(execute_response.pages, plan.render)
                .map(|output| output.with_request_id(execute_response.request_id))
        }
    }
}

struct ExecuteSourceApiPages {
    pages: Vec<ExecuteSourceApiResponse>,
    request_id: Option<String>,
}

async fn execute_source_api_pages(
    client: &crate::transport::client::AuthenticatedApiClient,
    org_slug: &str,
    source_key: &str,
    request: &ExecuteSourceApiRequestPayload,
    execution: &SourceApiExecutionOptions,
    args: &UseArgs,
    context: &CommandContext,
) -> Result<ExecuteSourceApiPages, CliError> {
    let mut next_request = request.clone();
    let max_pages = execution.max_pages.unwrap_or(u32::MAX);

    let first_response =
        source_api::execute_source_api(client, org_slug, source_key, &next_request)
            .await
            .map_err(|failure| present_source_api_execute_failure(failure, args, context))?;
    let mut request_id = first_response.request_id.clone();
    let mut next_page_token = first_response.payload.next_page_token.clone();
    let mut pages = vec![first_response.payload];

    while execution.paginate && (pages.len() as u32) < max_pages {
        let Some(next_page_token_value) = next_page_token else {
            break;
        };

        next_request.page_token = Some(next_page_token_value);

        let response = source_api::execute_source_api(client, org_slug, source_key, &next_request)
            .await
            .map_err(|failure| present_source_api_execute_failure(failure, args, context))?;
        request_id = response.request_id.clone();
        next_page_token = response.payload.next_page_token.clone();
        pages.push(response.payload);
    }

    Ok(ExecuteSourceApiPages { pages, request_id })
}

fn present_source_api_normalize_failure(
    failure: crate::transport::http::ApiFailure,
    args: &UseArgs,
    context: &CommandContext,
) -> CliError {
    present_api_failure(
        failure,
        ApiErrorPresentation {
            command: &context.command_line,
            title: "source API dry run failed",
            transport_why_prefix: "failed to reach source API service",
            decode_why_prefix: "failed to decode source API normalized plan",
            fallback_try_next: vec![
                format!("onequery use --source {}", args.source),
                format!("retry {}", context.command_line),
            ],
            unauthorized_try_next: Some(vec!["onequery auth login".to_owned()]),
        },
    )
}

fn present_source_api_execute_failure(
    failure: crate::transport::http::ApiFailure,
    args: &UseArgs,
    context: &CommandContext,
) -> CliError {
    present_api_failure(
        failure,
        ApiErrorPresentation {
            command: &context.command_line,
            title: "source API execution failed",
            transport_why_prefix: "failed to reach source API service",
            decode_why_prefix: "failed to decode source API response",
            fallback_try_next: vec![
                format!("onequery use --source {}", args.source),
                format!("retry {}", context.command_line),
            ],
            unauthorized_try_next: Some(vec!["onequery auth login".to_owned()]),
        },
    )
}

pub(super) fn source_api_examples(source_key: &str) -> Vec<String> {
    vec![
        format!("onequery use --source {source_key}"),
        format!("onequery use --source {source_key} /path"),
        format!("onequery use --source {source_key} --op <operation> <selector>"),
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
