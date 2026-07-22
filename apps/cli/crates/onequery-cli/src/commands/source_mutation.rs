use std::io::IsTerminal;
use std::path::Path;

use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;
use tokio::fs;
use tokio::io::AsyncReadExt;

use crate::cli::SourceDeleteArgs;
use crate::cli::SourceUpdateArgs;
use crate::output::CommandOutput;
use crate::output::serialize_command_data;
use crate::presentation::api_failure::ApiErrorPresentation;
use crate::presentation::api_failure::present_api_failure_with_context;
use crate::recovery::auth_login_then_retry_try_next;
use crate::recovery::auth_login_try_next;
use crate::transport::source::SourceTestOutcome;
use crate::transport::source::SourceTestSupportedResult;
use crate::transport::source_mutation;
use crate::transport::source_mutation::SourceDeletePayload;
use crate::transport::source_mutation::SourceUpdatePayload;
use crate::transport::source_mutation::SourceUpdateRequestPayload;

use super::CommandContext;
use super::Runtime;
use super::auth_session::authenticated_api_client;
use super::auth_session::ensure_authenticated_org;

pub(super) async fn execute_update<B, T>(
    args: &SourceUpdateArgs,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError> {
    let request = read_update_request(args.input.as_path(), context).await?;
    let org = ensure_authenticated_org(context, runtime).await?;
    let client = authenticated_api_client(context, runtime)?;
    let response =
        source_mutation::update_source(&client, org.as_str(), args.source.as_str(), &request)
            .await
            .map_err(|failure| {
                present_source_mutation_failure(failure, context, "source update failed")
            })?;

    render_update_output(response.payload).map(|output| {
        output
            .with_command("source update")
            .with_request_id(response.request_id)
    })
}

pub(super) async fn execute_delete<B, T>(
    args: &SourceDeleteArgs,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError> {
    if !args.yes {
        return Err(CliError::new(
            "source deletion requires confirmation",
            context.command_line.clone(),
            ErrorStage::ParseCommand,
            format!(
                "{} will be permanently deleted; pass --yes to confirm",
                args.source
            ),
            vec![format!("onequery source delete {} --yes", args.source)],
        ));
    }

    let org = ensure_authenticated_org(context, runtime).await?;
    let client = authenticated_api_client(context, runtime)?;
    let response = source_mutation::delete_source(&client, org.as_str(), args.source.as_str())
        .await
        .map_err(|failure| {
            present_source_mutation_failure(failure, context, "source delete failed")
        })?;

    render_delete_output(response.payload).map(|output| {
        output
            .with_command("source delete")
            .with_request_id(response.request_id)
    })
}

async fn read_update_request(
    input_path: &Path,
    context: &CommandContext,
) -> Result<SourceUpdateRequestPayload, CliError> {
    let raw = if input_path.as_os_str() == "-" {
        if std::io::stdin().is_terminal() {
            return Err(update_input_error(
                context,
                "no piped stdin input detected. --input - requires one UTF-8 JSON payload from stdin",
            ));
        }

        let mut buffer = String::new();
        tokio::io::stdin()
            .read_to_string(&mut buffer)
            .await
            .map_err(|error| update_input_error(context, error.to_string()))?;
        buffer
    } else {
        let metadata = fs::metadata(input_path).await.map_err(|error| {
            update_input_error(context, format!("{error} ({})", input_path.display()))
        })?;
        if !metadata.is_file() {
            return Err(update_input_error(
                context,
                format!("path is not a regular file ({})", input_path.display()),
            ));
        }
        fs::read_to_string(input_path).await.map_err(|error| {
            update_input_error(context, format!("{error} ({})", input_path.display()))
        })?
    };

    let request = serde_json::from_str::<SourceUpdateRequestPayload>(&raw)
        .map_err(|error| update_input_error(context, format!("invalid JSON payload: {error}")))?;
    if request.credentials.is_empty() {
        return Err(update_input_error(
            context,
            "credentials must contain at least one field",
        ));
    }
    Ok(request)
}

fn update_input_error(context: &CommandContext, why: impl Into<String>) -> CliError {
    CliError::new(
        "invalid source update input",
        context.command_line.clone(),
        ErrorStage::ReadQueryInput,
        why,
        vec![
            "create a JSON file such as {\"credentials\":{\"organizationSlug\":\"wordbricks\"}}"
                .to_owned(),
            "onequery source update sentry://source-key --input patch.json".to_owned(),
            "printf '%s' '<json>' | onequery source update sentry://source-key --input -"
                .to_owned(),
        ],
    )
}

fn render_update_output(payload: SourceUpdatePayload) -> Result<CommandOutput, CliError> {
    let (message, latency) = match &payload.outcome {
        SourceTestOutcome::Supported { result, latency_ms } => {
            let message = match result {
                SourceTestSupportedResult::Passed { message }
                | SourceTestSupportedResult::Failed { message, .. } => message.clone(),
            };
            let latency = latency_ms.map_or_else(|| "-".to_owned(), |value| format!("{value} ms"));
            (message, latency)
        }
        SourceTestOutcome::Unsupported { message, .. } => (message.clone(), "-".to_owned()),
    };
    let lines = vec![
        format!("Updated source: {}", payload.source.reference()),
        format!("Status: {}", payload.source.status),
        format!("Connection test: {message}"),
        format!("Test latency: {latency}"),
    ];

    Ok(CommandOutput::try_deferred(lines, move || {
        serialize_command_data(&payload, "onequery source update")
    }))
}

fn render_delete_output(payload: SourceDeletePayload) -> Result<CommandOutput, CliError> {
    let lines = vec![
        format!("Deleted source: {}", payload.source.reference()),
        format!("Provider: {}", payload.source.provider),
    ];
    Ok(CommandOutput::try_deferred(lines, move || {
        serialize_command_data(&payload, "onequery source delete")
    }))
}

fn present_source_mutation_failure(
    failure: crate::transport::api_failure::ApiFailure,
    context: &CommandContext,
    title: &'static str,
) -> CliError {
    present_api_failure_with_context(
        failure,
        context,
        ApiErrorPresentation {
            command: &context.command_line,
            title,
            transport_why_prefix: "failed to reach source mutation endpoint",
            decode_why_prefix: "failed to decode source mutation response",
            fallback_try_next: auth_login_then_retry_try_next(&context.command_line),
            unauthorized_try_next: Some(auth_login_try_next()),
        },
    )
}

#[cfg(test)]
mod tests {
    use insta::assert_snapshot;

    use crate::transport::source::SourceSummary;
    use crate::transport::source::SourceTestOutcome;
    use crate::transport::source::SourceTestSupportedResult;
    use crate::transport::source_mutation::SourceDeletePayload;
    use crate::transport::source_mutation::SourceUpdatePayload;

    use super::render_delete_output;
    use super::render_update_output;

    fn source() -> SourceSummary {
        SourceSummary {
            source_key: "getgpt-sentry".to_owned(),
            display_name: None,
            provider: "sentry".to_owned(),
            status: "active".to_owned(),
            interfaces: vec!["api".to_owned()],
        }
    }

    #[test]
    fn render_update_output_reports_connection_test() {
        let output = render_update_output(SourceUpdatePayload {
            source: source(),
            outcome: SourceTestOutcome::Supported {
                result: SourceTestSupportedResult::Passed {
                    message: "Connected to Sentry".to_owned(),
                },
                latency_ms: Some(42),
            },
        })
        .expect("update output should render");

        assert_snapshot!(output.lines.join("\n"), @r###"
        Updated source: sentry://getgpt-sentry
        Status: active
        Connection test: Connected to Sentry
        Test latency: 42 ms
        "###);
    }

    #[test]
    fn render_delete_output_identifies_deleted_source() {
        let output = render_delete_output(SourceDeletePayload {
            source: source(),
            deleted: true,
        })
        .expect("delete output should render");

        assert_snapshot!(output.lines.join("\n"), @r###"
        Deleted source: sentry://getgpt-sentry
        Provider: sentry
        "###);
    }
}
