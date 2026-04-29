use std::io::IsTerminal;
use std::path::Path;

use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;
use tokio::fs;
use tokio::io::AsyncReadExt;
use tokio::time::Duration;

use crate::cli::QueryInputArgs;
use crate::transport::query::QueryRequestPayload;
use crate::workflows::retry::RetryDirective;
use crate::workflows::retry::classify_retry_directive;
use onequery_core::cli_paths::resolve_user_path_for_cli;

use super::CommandContext;
use super::QueryIntent;
use super::QueryValidateFailureOutcome;
use super::query_result_window_from_args;

pub(super) async fn load_query_request_payload(
    args: &QueryInputArgs,
    context: &CommandContext,
    intent: QueryIntent,
) -> Result<QueryRequestPayload, CliError> {
    if args.uses_raw_input() {
        let Some(input_path) = args.input.as_ref() else {
            return Err(CliError::internal(
                context.command_line.clone(),
                "query raw input requested without an input path",
            ));
        };
        let raw = read_query_json_input(input_path, context, intent).await?;
        let payload = serde_json::from_str::<QueryRequestPayload>(&raw).map_err(|parse_error| {
            CliError::new(
                "invalid query request body",
                context.command_line.clone(),
                ErrorStage::ReadQueryInput,
                parse_error.to_string(),
                query_input_examples(intent),
            )
        })?;

        return ensure_query_payload_has_sql(payload, context, intent);
    }

    let sql = load_sql_text(args, context, intent).await?;
    let result_window = query_result_window_from_args(&args.result_window);
    ensure_query_payload_has_sql(
        QueryRequestPayload {
            sql,
            max_rows: result_window.max_rows,
            max_bytes: result_window.max_bytes,
            cell_max_chars: result_window.cell_max_chars,
            timeout_ms: result_window.timeout_ms,
        },
        context,
        intent,
    )
}

fn ensure_query_payload_has_sql(
    payload: QueryRequestPayload,
    context: &CommandContext,
    intent: QueryIntent,
) -> Result<QueryRequestPayload, CliError> {
    if payload.sql.trim().is_empty() {
        return Err(CliError::new(
            "query rejected",
            context.command_line.clone(),
            ErrorStage::ReadQueryInput,
            "SQL input is empty.",
            query_input_examples(intent),
        ));
    }

    Ok(payload)
}

async fn load_sql_text(
    args: &QueryInputArgs,
    context: &CommandContext,
    intent: QueryIntent,
) -> Result<String, CliError> {
    if let Some(sql) = &args.sql {
        return Ok(sql.clone());
    }

    if let Some(path) = &args.file {
        let resolved_path = resolve_user_path_for_cli(
            path.as_path(),
            &context.command_line,
            ErrorStage::ReadQueryInput,
            "failed to read SQL file",
            vec!["confirm the --file path exists".to_owned()],
        )?;

        let metadata = fs::metadata(&resolved_path)
            .await
            .map_err(|metadata_error| {
                CliError::new(
                    "failed to read SQL file",
                    context.command_line.clone(),
                    ErrorStage::ReadQueryInput,
                    format!("{metadata_error} ({})", resolved_path.display()),
                    vec!["confirm the --file path exists".to_owned()],
                )
            })?;
        if !metadata.is_file() {
            return Err(CliError::new(
                "failed to read SQL file",
                context.command_line.clone(),
                ErrorStage::ReadQueryInput,
                format!("path is not a regular file ({})", resolved_path.display()),
                vec!["provide a regular UTF-8 .sql file to --file".to_owned()],
            ));
        }

        return fs::read_to_string(&resolved_path)
            .await
            .map_err(|read_error| {
                CliError::new(
                    "failed to read SQL file",
                    context.command_line.clone(),
                    ErrorStage::ReadQueryInput,
                    format!("{read_error} ({})", resolved_path.display()),
                    vec!["confirm the --file path contains UTF-8 SQL text".to_owned()],
                )
            });
    }

    if args.stdin {
        if std::io::stdin().is_terminal() {
            return Err(CliError::new(
                "stdin is required for --stdin",
                context.command_line.clone(),
                ErrorStage::ReadQueryInput,
                "no piped stdin input detected. --stdin requires data from a pipe or redirect.",
                vec![
                    format!(
                        "cat query.sql | {} --source <source_key> --stdin",
                        intent.command()
                    ),
                    format!(
                        "or use {} --sql/--file instead of --stdin",
                        intent.command()
                    ),
                ],
            ));
        }

        let mut buffer = String::new();
        tokio::io::stdin()
            .read_to_string(&mut buffer)
            .await
            .map_err(|stdin_error| {
                CliError::new(
                    "failed to read SQL from stdin",
                    context.command_line.clone(),
                    ErrorStage::ReadQueryInput,
                    stdin_error.to_string(),
                    vec![format!("pipe SQL input into {} --stdin", intent.command())],
                )
            })?;
        return Ok(buffer);
    }

    // CONTEXT: clap enforces the mutually-exclusive `query_input_source` group at parse time,
    // so reaching this branch would indicate a parser regression rather than invalid user input.
    Err(CliError::internal(
        context.command_line.clone(),
        "query input source group accepted an impossible state",
    ))
}

async fn read_query_json_input(
    input_path: &Path,
    context: &CommandContext,
    intent: QueryIntent,
) -> Result<String, CliError> {
    if input_path.as_os_str() == "-" {
        if std::io::stdin().is_terminal() {
            return Err(CliError::new(
                "stdin is required for --input -",
                context.command_line.clone(),
                ErrorStage::ReadQueryInput,
                "no piped stdin input detected. --input - requires one UTF-8 JSON payload from stdin.",
                query_input_examples(intent),
            ));
        }

        let mut buffer = String::new();
        tokio::io::stdin()
            .read_to_string(&mut buffer)
            .await
            .map_err(|stdin_error| {
                CliError::new(
                    "failed to read query input from stdin",
                    context.command_line.clone(),
                    ErrorStage::ReadQueryInput,
                    stdin_error.to_string(),
                    query_input_examples(intent),
                )
            })?;
        return Ok(buffer);
    }

    let resolved_input_path = resolve_user_path_for_cli(
        input_path,
        &context.command_line,
        ErrorStage::ReadQueryInput,
        "failed to read query input file",
        query_input_examples(intent),
    )?;

    let metadata = fs::metadata(&resolved_input_path)
        .await
        .map_err(|metadata_error| {
            CliError::new(
                "failed to read query input file",
                context.command_line.clone(),
                ErrorStage::ReadQueryInput,
                format!("{metadata_error} ({})", resolved_input_path.display()),
                query_input_examples(intent),
            )
        })?;
    if !metadata.is_file() {
        return Err(CliError::new(
            "failed to read query input file",
            context.command_line.clone(),
            ErrorStage::ReadQueryInput,
            format!(
                "path is not a regular file ({})",
                resolved_input_path.display()
            ),
            query_input_examples(intent),
        ));
    }

    fs::read_to_string(&resolved_input_path)
        .await
        .map_err(|read_error| {
            CliError::new(
                "failed to read query input file",
                context.command_line.clone(),
                ErrorStage::ReadQueryInput,
                format!("{read_error} ({})", resolved_input_path.display()),
                query_input_examples(intent),
            )
        })
}

impl QueryIntent {
    fn command(self) -> &'static str {
        match self {
            Self::Execute => "onequery query exec",
            Self::Validate => "onequery query validate",
        }
    }
}

fn query_input_examples(intent: QueryIntent) -> Vec<String> {
    vec![
        format!(
            "{} --source <source_key> --sql \"select 1\"",
            intent.command()
        ),
        format!(
            "cat query.json | {} --source <source_key> --input -",
            intent.command()
        ),
    ]
}

pub(super) fn with_effective_query_timeout(
    payload: &QueryRequestPayload,
    request_timeout_sec: u64,
) -> QueryRequestPayload {
    payload
        .clone()
        .with_default_timeout_ms(Some(default_query_timeout_ms(request_timeout_sec)))
}

pub(super) fn effective_query_http_timeout(
    payload: &QueryRequestPayload,
    request_timeout_sec: u64,
) -> Duration {
    Duration::from_millis(
        payload
            .timeout_ms
            .unwrap_or_else(|| default_query_timeout_ms(request_timeout_sec)),
    )
}

fn default_query_timeout_ms(request_timeout_sec: u64) -> u64 {
    request_timeout_sec.saturating_mul(1000)
}

pub(super) fn query_validate_failure_outcome(
    failure: &crate::transport::api_failure::ApiFailure,
) -> QueryValidateFailureOutcome {
    if classify_retry_directive(failure) == RetryDirective::NeedsReauth {
        QueryValidateFailureOutcome::NeedsReauth
    } else {
        QueryValidateFailureOutcome::Failed
    }
}
