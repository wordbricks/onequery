use std::collections::VecDeque;
use std::fs::File;
use std::io::BufRead;
use std::io::BufReader;
use std::path::Path;

use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;

use super::super::GATEWAY_LOG_PREVIEW_LINE_COUNT;

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct LogPreview {
    pub(crate) lines: Vec<String>,
    pub(crate) truncated: bool,
}

pub(crate) fn read_log_preview(path: &Path, command_line: &str) -> Result<LogPreview, CliError> {
    if !path.is_file() {
        return Ok(LogPreview {
            lines: Vec::new(),
            truncated: false,
        });
    }

    let file = File::open(path).map_err(|read_error| {
        CliError::new(
            "failed to read gateway log",
            command_line,
            ErrorStage::LoadConfig,
            format!("{read_error} ({})", path.display()),
            vec![format!("check log file {}", path.display())],
        )
    })?;

    let mut preview_lines = VecDeque::with_capacity(GATEWAY_LOG_PREVIEW_LINE_COUNT);
    let mut total_lines = 0_usize;

    for line in BufReader::new(file).lines() {
        let line = line.map_err(|read_error| {
            CliError::new(
                "failed to read gateway log",
                command_line,
                ErrorStage::LoadConfig,
                format!("{read_error} ({})", path.display()),
                vec![format!("check log file {}", path.display())],
            )
        })?;

        total_lines += 1;
        if preview_lines.len() == GATEWAY_LOG_PREVIEW_LINE_COUNT {
            let _ = preview_lines.pop_front();
        }
        preview_lines.push_back(line);
    }

    Ok(LogPreview {
        truncated: total_lines > GATEWAY_LOG_PREVIEW_LINE_COUNT,
        lines: preview_lines.into_iter().collect(),
    })
}

#[cfg(test)]
mod tests {
    use std::fs;

    use pretty_assertions::assert_eq;
    use tempfile::tempdir;

    use super::GATEWAY_LOG_PREVIEW_LINE_COUNT;
    use super::LogPreview;
    use super::read_log_preview;

    #[test]
    fn read_log_preview_returns_last_preview_window() {
        let temp_dir = tempdir().unwrap_or_else(|error| panic!("expected log temp dir: {error}"));
        let log_path = temp_dir.path().join("server.log");
        let line_count = GATEWAY_LOG_PREVIEW_LINE_COUNT + 2;
        let contents = (0..line_count)
            .map(|index| format!("line {index}\n"))
            .collect::<String>();
        fs::write(&log_path, contents)
            .unwrap_or_else(|error| panic!("expected log fixture write: {error}"));

        let preview = read_log_preview(log_path.as_path(), "onequery gateway logs")
            .unwrap_or_else(|error| panic!("expected log preview read: {error}"));

        assert_eq!(
            preview,
            LogPreview {
                lines: (2..line_count)
                    .map(|index| format!("line {index}"))
                    .collect(),
                truncated: true,
            }
        );
    }
}
