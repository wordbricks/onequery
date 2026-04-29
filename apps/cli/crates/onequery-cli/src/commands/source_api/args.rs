use std::io::IsTerminal;
use std::path::Path;

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use tokio::fs;
use tokio::io::AsyncReadExt;

use crate::cli::ApiArgs;
use onequery_cli_core::path_utils::resolve_user_path_for_cli;

use super::CommandContext;

pub(super) fn has_execute_intent_flags(args: &ApiArgs) -> bool {
    args.op.is_some()
        || args.target.is_some()
        || args.method.is_some()
        || !args.headers.is_empty()
        || !args.raw_fields.is_empty()
        || !args.fields.is_empty()
        || args.input.is_some()
        || args.paginate
        || args.slurp
        || args.max_pages.is_some()
        || args.dry_run
}

#[derive(Debug, Default)]
pub(super) struct SourceApiInputReader {
    cached_stdin: Option<Vec<u8>>,
}

impl SourceApiInputReader {
    pub(super) async fn read_bytes(
        &mut self,
        input_path: &str,
        context: &CommandContext,
        title: &'static str,
        try_next: Vec<String>,
    ) -> Result<Vec<u8>, CliError> {
        if input_path == "-" {
            if std::io::stdin().is_terminal() {
                return Err(CliError::new(
                    title,
                    context.command_line.clone(),
                    ErrorStage::ReadQueryInput,
                    "no piped stdin input detected. `-` requires data from a pipe or redirect.",
                    try_next,
                ));
            }

            if let Some(cached_stdin) = &self.cached_stdin {
                return Ok(cached_stdin.clone());
            }

            let mut buffer = Vec::new();
            tokio::io::stdin()
                .read_to_end(&mut buffer)
                .await
                .map_err(|stdin_error| {
                    CliError::new(
                        title,
                        context.command_line.clone(),
                        ErrorStage::ReadQueryInput,
                        stdin_error.to_string(),
                        try_next.clone(),
                    )
                })?;
            self.cached_stdin = Some(buffer.clone());
            return Ok(buffer);
        }

        let resolved_input_path = resolve_user_path_for_cli(
            Path::new(input_path),
            &context.command_line,
            ErrorStage::ReadQueryInput,
            title,
            try_next.clone(),
        )?;

        let metadata = fs::metadata(&resolved_input_path)
            .await
            .map_err(|metadata_error| {
                CliError::new(
                    title,
                    context.command_line.clone(),
                    ErrorStage::ReadQueryInput,
                    format!("{metadata_error} ({})", resolved_input_path.display()),
                    try_next.clone(),
                )
            })?;
        if !metadata.is_file() {
            return Err(CliError::new(
                title,
                context.command_line.clone(),
                ErrorStage::ReadQueryInput,
                format!(
                    "path is not a regular file ({})",
                    resolved_input_path.display()
                ),
                try_next,
            ));
        }

        fs::read(&resolved_input_path).await.map_err(|read_error| {
            CliError::new(
                title,
                context.command_line.clone(),
                ErrorStage::ReadQueryInput,
                format!("{read_error} ({})", resolved_input_path.display()),
                try_next,
            )
        })
    }

    pub(super) async fn read_text(
        &mut self,
        input_path: &str,
        context: &CommandContext,
        title: &'static str,
        try_next: Vec<String>,
    ) -> Result<String, CliError> {
        let bytes = self
            .read_bytes(input_path, context, title, try_next.clone())
            .await?;
        String::from_utf8(bytes).map_err(|utf8_error| {
            CliError::new(
                title,
                context.command_line.clone(),
                ErrorStage::ReadQueryInput,
                utf8_error.to_string(),
                try_next,
            )
        })
    }
}
