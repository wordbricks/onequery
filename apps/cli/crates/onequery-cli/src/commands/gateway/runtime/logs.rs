use std::fs;
use std::path::Path;

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;

use super::super::GATEWAY_LOG_PREVIEW_LINE_COUNT;

#[derive(Debug, Clone, Eq, PartialEq)]
pub(in crate::commands::gateway) struct LogPreview {
    pub(in crate::commands::gateway) lines: Vec<String>,
    pub(in crate::commands::gateway) truncated: bool,
}

pub(in crate::commands::gateway) fn read_log_preview(
    path: &Path,
    command_line: &str,
) -> Result<LogPreview, CliError> {
    if !path.is_file() {
        return Ok(LogPreview {
            lines: Vec::new(),
            truncated: false,
        });
    }

    let contents = fs::read_to_string(path).map_err(|read_error| {
        CliError::new(
            "failed to read gateway log",
            command_line,
            ErrorStage::LoadConfig,
            format!("{read_error} ({})", path.display()),
            vec![format!("check log file {}", path.display())],
        )
    })?;

    let all_lines = contents.lines().map(ToOwned::to_owned).collect::<Vec<_>>();
    let keep_from = all_lines
        .len()
        .saturating_sub(GATEWAY_LOG_PREVIEW_LINE_COUNT);

    Ok(LogPreview {
        truncated: keep_from > 0,
        lines: all_lines.into_iter().skip(keep_from).collect(),
    })
}
