use std::time::Duration;

use onequery_cli_core::error::CliError;
use serde_json::Map;
use serde_json::Value;

use crate::cli::UseArgs;
use crate::output::CommandOutput;
use crate::output::pretty_json_lines;
use crate::output::serialize_command_data;
use crate::presentation::api_failure::ApiErrorPresentation;
use crate::presentation::api_failure::present_api_failure;
use crate::transport::use_cmd::UseSkill;

use super::CommandContext;
use super::Runtime;
use super::auth_session::authenticated_api_client_with_timeout;
use super::auth_session::build_unauthenticated_api_client;
use super::auth_session::ensure_authenticated;
use super::json_input::parse_org_scoped_json_input;
use super::require_org;

pub(super) async fn execute<B, T>(
    args: &UseArgs,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError> {
    if let Some(raw_input) = args.input.as_deref() {
        return execute_use_input(raw_input, args, context, runtime).await;
    }

    let request_timeout = Duration::from_secs(runtime.config.data().request_timeout_sec);
    let org_slug = context.resolved_org.as_deref();
    let response = if runtime.auth_session.access_token().is_some()
        && ensure_authenticated(context, runtime).await.is_ok()
    {
        let client = authenticated_api_client_with_timeout(context, runtime, request_timeout)?;
        crate::transport::use_cmd::load_use_skill(&client, args.source.as_str(), org_slug).await
    } else {
        let client = build_unauthenticated_api_client(context, request_timeout)?;
        crate::transport::use_cmd::load_use_skill(&client, args.source.as_str(), org_slug).await
    }
    .map_err(|failure| {
        present_api_failure(
            failure,
            ApiErrorPresentation {
                command: &context.command_line,
                title: "use failed",
                transport_why_prefix: "failed to reach use endpoint",
                decode_why_prefix: "failed to decode use response",
                fallback_try_next: vec![format!(
                    "retry oneq use --source {}",
                    args.source.as_str()
                )],
                unauthorized_try_next: None,
            },
        )
    })?;

    Ok(render_use_output(response.payload)?.with_request_id(response.request_id))
}

async fn execute_use_input<B, T>(
    raw_input: &str,
    args: &UseArgs,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError> {
    let input = parse_use_input(raw_input, args, context)?;
    let organization_slug = require_org(context)?.to_owned();
    ensure_authenticated(context, runtime).await?;

    let request_timeout = Duration::from_secs(runtime.config.data().request_timeout_sec);
    let client = authenticated_api_client_with_timeout(context, runtime, request_timeout)?;
    let response = crate::transport::use_cmd::execute_use_input(
        &client,
        args.source.as_str(),
        organization_slug.as_str(),
        input,
    )
    .await
    .map_err(|failure| {
        present_api_failure(
            failure,
            ApiErrorPresentation {
                command: &context.command_line,
                title: "use execution failed",
                transport_why_prefix: "failed to reach provider relay endpoint",
                decode_why_prefix: "failed to decode provider relay response",
                fallback_try_next: vec![
                    format!("oneq use --source {}", args.source.as_str()),
                    format!("retry {}", context.command_line),
                ],
                unauthorized_try_next: Some(vec!["oneq auth login".to_owned()]),
            },
        )
    })?;

    Ok(
        CommandOutput::structured(pretty_json_lines(&response.payload), response.payload)
            .with_request_id(response.request_id),
    )
}

fn parse_use_input(
    raw_input: &str,
    args: &UseArgs,
    context: &CommandContext,
) -> Result<Map<String, Value>, CliError> {
    parse_org_scoped_json_input(raw_input, context, "invalid use input", "use input", || {
        use_input_examples(args.source.as_str())
    })
}

fn use_input_examples(source: &str) -> Vec<String> {
    vec![
        format!("oneq use --source {source}"),
        format!(
            "oneq --org <org_slug> use --source {source} --input '{{\"method\":\"fetch_api\",\"request\":{{\"endpoint\":\"/user\"}}}}'"
        ),
    ]
}

fn render_use_output(skill: UseSkill) -> Result<CommandOutput, CliError> {
    let data = serialize_command_data(&skill, "oneq use")?;
    let lines = skill.content.lines().map(ToOwned::to_owned).collect();
    Ok(CommandOutput::structured(lines, data))
}

#[cfg(test)]
mod tests {
    use insta::assert_snapshot;

    use crate::transport::use_cmd::UseSkill;

    use super::render_use_output;

    #[test]
    fn render_use_output_snapshot() {
        let output = render_use_output(UseSkill {
            source: "sentry".to_owned(),
            title: "OneQuery Sentry Relay Skill".to_owned(),
            description: "Use the Sentry relay route instead of SQL.".to_owned(),
            format: "markdown".to_owned(),
            content: "# OneQuery Sentry Relay Skill\n\nUse `/api/data-sources/sentry/query`.\n"
                .to_owned(),
        })
        .expect("expected use output");

        assert_snapshot!(output.lines.join("\n"));
    }
}
