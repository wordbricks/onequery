mod args;
mod field_patch;
mod format;
mod intent;
mod plan;
mod render;

use std::time::Duration;

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;

use crate::cli::ApiArgs;
use crate::output::CommandOutput;
use crate::presentation::api_failure::ApiErrorPresentation;
use crate::presentation::api_failure::present_api_failure;
use crate::transport::source_api;
use crate::transport::source_api::SourceApiDraft;
use crate::transport::source_api::SourceApiExecutionPage;
use crate::transport::source_api::SourceApiPreview;

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
    args: &ApiArgs,
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
                        fallback_try_next: vec![format!("onequery api --source {}", args.source)],
                        unauthorized_try_next: Some(vec!["onequery auth login".to_owned()]),
                    },
                )
            })?;

    let plan = plan::build_plan(args, &descriptor_response.payload, context).await?;
    match plan {
        PlannedCommand::Describe => {
            render_descriptor_output(descriptor_response.payload).map(|output| {
                output.with_request_id(if context.verbose {
                    descriptor_response.request_id.clone()
                } else {
                    None
                })
            })
        }
        PlannedCommand::DryRun { draft } => {
            let preview = preview_source_api_execution(
                &client,
                org_slug.as_str(),
                args.source.as_str(),
                &draft,
                args,
                context,
            )
            .await?;

            render_dry_run_output(&preview.preview, context.verbose).map(|output| {
                output.with_request_id(if context.verbose {
                    preview.request_id.clone()
                } else {
                    None
                })
            })
        }
        PlannedCommand::Execute { plan } => {
            let execute_response = execute_source_api_pages(
                &client,
                org_slug.as_str(),
                args.source.as_str(),
                &plan.draft,
                &plan.execution,
                args,
                context,
            )
            .await?;

            render_execute_output(
                execute_response.pages,
                &execute_response.preview,
                plan.render,
            )
            .map(|output| {
                output.with_request_id(if context.verbose {
                    execute_response.request_id.clone()
                } else {
                    None
                })
            })
        }
    }
}

struct PreviewedSourceApiExecution {
    preview: SourceApiPreview,
    request_id: Option<String>,
}

struct ExecutedSourceApiPages {
    pages: Vec<SourceApiExecutionPage>,
    preview: SourceApiPreview,
    request_id: Option<String>,
}

async fn preview_source_api_execution(
    client: &crate::transport::client::AuthenticatedApiClient,
    org_slug: &str,
    source_key: &str,
    draft: &SourceApiDraft,
    args: &ApiArgs,
    context: &CommandContext,
) -> Result<PreviewedSourceApiExecution, CliError> {
    let preview_response =
        source_api::execute_source_api(client, org_slug, source_key, draft, true)
            .await
            .map_err(|failure| present_source_api_preview_failure(failure, args, context))?;
    let Some(preview) = preview_response.payload.preview.into_option() else {
        return Err(source_api_error(
            context,
            "invalid source API preview response",
            ErrorStage::ExecuteQuery,
            "source API preview response did not include a preview",
            source_key,
        ));
    };

    Ok(PreviewedSourceApiExecution {
        preview,
        request_id: preview_response.request_id,
    })
}

async fn execute_source_api_pages(
    client: &crate::transport::client::AuthenticatedApiClient,
    org_slug: &str,
    source_key: &str,
    draft: &SourceApiDraft,
    execution: &SourceApiExecutionOptions,
    args: &ApiArgs,
    context: &CommandContext,
) -> Result<ExecutedSourceApiPages, CliError> {
    let max_pages = execution.max_pages.unwrap_or(u32::MAX);

    let first_response = source_api::execute_source_api(client, org_slug, source_key, draft, false)
        .await
        .map_err(|failure| present_source_api_execute_failure(failure, args, context))?;
    let Some(preview) = first_response.payload.preview.into_option() else {
        return Err(source_api_error(
            context,
            "invalid source API execution response",
            ErrorStage::ExecuteQuery,
            "source API execution response did not include a preview",
            source_key,
        ));
    };
    let Some(first_page) = first_response.payload.result.into_option() else {
        return Err(source_api_error(
            context,
            "invalid source API execution response",
            ErrorStage::ExecuteQuery,
            "source API execution response did not include a result",
            source_key,
        ));
    };
    let mut request_id = first_response.request_id.clone();
    let mut continuation_token = first_response.payload.continuation_token.clone();
    let mut pages = vec![SourceApiExecutionPage {
        body: first_page.body,
        content_type: first_page.content_type,
        continuation_token: first_response.payload.continuation_token,
        headers: first_page.headers,
        operation: first_page.operation,
        selector: first_page.selector,
        source: first_page.source,
        status: first_page.status,
    }];

    while execution.paginate && (pages.len() as u32) < max_pages {
        let Some(continuation_token_value) = continuation_token else {
            break;
        };

        let response = source_api::resume_source_api(client, continuation_token_value.as_str())
            .await
            .map_err(|failure| present_source_api_execute_failure(failure, args, context))?;
        request_id = response.request_id.clone();
        continuation_token = response.payload.continuation_token.clone();
        let Some(page) = response.payload.result.into_option() else {
            return Err(source_api_error(
                context,
                "invalid source API execution response",
                ErrorStage::ExecuteQuery,
                "source API resume response did not include a result",
                source_key,
            ));
        };
        pages.push(SourceApiExecutionPage {
            body: page.body,
            content_type: page.content_type,
            continuation_token: response.payload.continuation_token,
            headers: page.headers,
            operation: page.operation,
            selector: page.selector,
            source: page.source,
            status: page.status,
        });
    }

    Ok(ExecutedSourceApiPages {
        pages,
        preview,
        request_id,
    })
}

fn present_source_api_preview_failure(
    failure: crate::transport::api_failure::ApiFailure,
    args: &ApiArgs,
    context: &CommandContext,
) -> CliError {
    present_api_failure(
        failure,
        ApiErrorPresentation {
            command: &context.command_line,
            title: "source API preview failed",
            transport_why_prefix: "failed to reach source API service",
            decode_why_prefix: "failed to decode source API preview",
            fallback_try_next: vec![
                format!("onequery api --source {}", args.source),
                format!("retry {}", context.command_line),
            ],
            unauthorized_try_next: Some(vec!["onequery auth login".to_owned()]),
        },
    )
}

fn present_source_api_execute_failure(
    failure: crate::transport::api_failure::ApiFailure,
    args: &ApiArgs,
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
                format!("onequery api --source {}", args.source),
                format!("retry {}", context.command_line),
            ],
            unauthorized_try_next: Some(vec!["onequery auth login".to_owned()]),
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
