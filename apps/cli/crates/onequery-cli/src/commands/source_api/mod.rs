mod args;
mod field_patch;
mod format;
mod intent;
mod plan;
mod render;

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;

use crate::cli::ApiArgs;
use crate::output::CommandOutput;
use crate::presentation::api_failure::ApiErrorPresentation;
use crate::presentation::api_failure::present_api_failure_with_context;
use crate::recovery::auth_login_try_next;
use crate::recovery::command_then_retry_try_next;
use crate::transport::source_api;
use crate::transport::source_api::SourceApiDraft;
use crate::transport::source_api::SourceApiHeader;
use crate::transport::source_api::SourceApiPreview;
use crate::transport::source_api::SourceApiResponseBody;
use crate::transport::source_api::SourceApiSource;

use super::CommandContext;
use super::Runtime;
use super::auth_session::authenticated_api_client;
use super::auth_session::ensure_authenticated_org;
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
    let org_slug = ensure_authenticated_org(context, runtime).await?;
    let client = authenticated_api_client(context, runtime)?;

    let descriptor_response =
        source_api::describe_source_api(&client, org_slug.as_str(), args.source.as_str())
            .await
            .map_err(|failure| {
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
    let Some(first_source) = first_page.source.into_option() else {
        return Err(source_api_error(
            context,
            "invalid source API execution response",
            ErrorStage::ExecuteQuery,
            "source API execution response did not include source metadata",
            source_key,
        ));
    };
    let Some(first_operation_name) = first_page.operation else {
        return Err(source_api_error(
            context,
            "invalid source API execution response",
            ErrorStage::ExecuteQuery,
            "source API execution response did not include an operation name",
            source_key,
        ));
    };
    let Some(first_status) = first_page.status else {
        return Err(source_api_error(
            context,
            "invalid source API execution response",
            ErrorStage::ExecuteQuery,
            "source API execution response did not include an HTTP status",
            source_key,
        ));
    };
    let Some(first_content_type) = first_page.content_type else {
        return Err(source_api_error(
            context,
            "invalid source API execution response",
            ErrorStage::ExecuteQuery,
            "source API execution response did not include a content type",
            source_key,
        ));
    };
    let mut pages = vec![SourceApiExecutionPage {
        body: first_page.body,
        content_type: first_content_type,
        continuation_token: first_response.payload.continuation_token,
        headers: first_page.headers,
        operation: first_operation_name,
        selector: first_page.selector,
        source: first_source,
        status: first_status,
    }];

    while execution.paginate && (pages.len() as u32) < max_pages {
        let Some(continuation_token_value) = continuation_token else {
            break;
        };

        let response = source_api::resume_source_api(
            client,
            org_slug,
            source_key,
            continuation_token_value.as_str(),
        )
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
        let Some(source) = page.source.into_option() else {
            return Err(source_api_error(
                context,
                "invalid source API execution response",
                ErrorStage::ExecuteQuery,
                "source API resume response did not include source metadata",
                source_key,
            ));
        };
        let Some(operation_name) = page.operation else {
            return Err(source_api_error(
                context,
                "invalid source API execution response",
                ErrorStage::ExecuteQuery,
                "source API resume response did not include an operation name",
                source_key,
            ));
        };
        let Some(status) = page.status else {
            return Err(source_api_error(
                context,
                "invalid source API execution response",
                ErrorStage::ExecuteQuery,
                "source API resume response did not include an HTTP status",
                source_key,
            ));
        };
        let Some(content_type) = page.content_type else {
            return Err(source_api_error(
                context,
                "invalid source API execution response",
                ErrorStage::ExecuteQuery,
                "source API resume response did not include a content type",
                source_key,
            ));
        };
        pages.push(SourceApiExecutionPage {
            body: page.body,
            content_type,
            continuation_token: response.payload.continuation_token,
            headers: page.headers,
            operation: operation_name,
            selector: page.selector,
            source,
            status,
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
