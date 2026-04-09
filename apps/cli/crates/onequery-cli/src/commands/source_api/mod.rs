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

use super::CommandContext;
use super::Runtime;
use super::auth_session::authenticated_api_client_with_timeout;
use super::auth_session::ensure_authenticated;
use super::require_org;
use plan::PlannedCommand;
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
        PlannedCommand::DryRun { plan } => render_dry_run_output(plan)
            .map(|output| output.with_request_id(descriptor_response.request_id)),
        PlannedCommand::Execute { plan } => {
            let response = source_api::execute_source_api(
                &client,
                org_slug.as_str(),
                args.source.as_str(),
                &plan.request,
            )
            .await
            .map_err(|failure| {
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
            })?;

            render_execute_output(response.payload, plan.render)
                .map(|output| output.with_request_id(response.request_id))
        }
    }
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
