use std::fs;
use std::path::Path;
use std::path::PathBuf;

use chrono::DateTime;
use chrono::Utc;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::CliSupportActionKind;
use onequery_cli_core::error::CliValidationIssue;
use onequery_cli_core::error::ErrorStage;
use serde::Deserialize;
use serde::Serialize;

use crate::config::data_dir;
use crate::path_utils;

pub(crate) const TEXT_REPORT_COMMAND: &str = "onequery doctor report --last";
pub(crate) const JSON_REPORT_COMMAND: &str = "onequery doctor report --last --stdout";

const LAST_ERROR_FILENAME: &str = "last-error.json";
const REPORTS_DIR_NAME: &str = "reports";
const DIAGNOSTIC_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct ReportSuggestion {
    pub(crate) recommended: bool,
    pub(crate) reason: String,
}

pub(crate) fn report_suggestion(error: &CliError) -> Option<ReportSuggestion> {
    // Comment: `doctor report` is already the explicit reporting surface, so
    // adding another report hint there is recursive noise rather than guidance.
    if error.command_path.as_deref() == Some("doctor report") {
        return None;
    }

    if let Some(support_action) = &error.support_action {
        match support_action.kind {
            CliSupportActionKind::ReportIfReproducible => {
                return Some(ReportSuggestion {
                    recommended: false,
                    reason: support_action.reason.clone(),
                });
            }
            CliSupportActionKind::ReportRecommended => {
                return Some(ReportSuggestion {
                    recommended: true,
                    reason: support_action.reason.clone(),
                });
            }
            CliSupportActionKind::None
            | CliSupportActionKind::Retry
            | CliSupportActionKind::Explain => return None,
        }
    }

    if matches!(error.stage, ErrorStage::Internal) {
        return Some(ReportSuggestion {
            recommended: true,
            reason: "internal_cli_error".to_owned(),
        });
    }

    if matches!(error.stage, ErrorStage::Render) {
        return Some(ReportSuggestion {
            recommended: true,
            reason: "render_failure".to_owned(),
        });
    }

    match error.code.as_deref() {
        Some("decode_error") => {
            return Some(ReportSuggestion {
                recommended: true,
                reason: "unexpected_response_decode_failure".to_owned(),
            });
        }
        Some("query_execution_failed") => {
            return Some(ReportSuggestion {
                recommended: true,
                reason: "query_execution_failure".to_owned(),
            });
        }
        Some("query_preparation_failed") => {
            return Some(ReportSuggestion {
                recommended: true,
                reason: "query_preparation_failure".to_owned(),
            });
        }
        Some("source_api_describe_failed") => {
            return Some(ReportSuggestion {
                recommended: true,
                reason: "source_api_describe_failure".to_owned(),
            });
        }
        Some("source_api_execution_failed") => {
            return Some(ReportSuggestion {
                recommended: true,
                reason: "source_api_execution_failure".to_owned(),
            });
        }
        Some("source_api_preparation_failed") => {
            return Some(ReportSuggestion {
                recommended: true,
                reason: "source_api_preparation_failure".to_owned(),
            });
        }
        _ => {}
    }

    if error.status.is_some_and(|status| status >= 500) && !error.retryable {
        return Some(ReportSuggestion {
            recommended: true,
            reason: "unexpected_server_failure".to_owned(),
        });
    }

    None
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct DiagnosticsPaths {
    pub(crate) last_error_path: PathBuf,
    pub(crate) reports_dir: PathBuf,
}

impl DiagnosticsPaths {
    pub(crate) fn resolve(command_line: &str) -> Result<Self, CliError> {
        let data_dir = data_dir(command_line)?;
        Ok(Self {
            last_error_path: data_dir.join(LAST_ERROR_FILENAME),
            reports_dir: data_dir.join(REPORTS_DIR_NAME),
        })
    }

    #[cfg(test)]
    pub(crate) fn for_test(data_dir: PathBuf) -> Self {
        Self {
            last_error_path: data_dir.join(LAST_ERROR_FILENAME),
            reports_dir: data_dir.join(REPORTS_DIR_NAME),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticSnapshot {
    pub(crate) schema_version: u32,
    pub(crate) created_at: DateTime<Utc>,
    pub(crate) cli_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) command_path: Option<String>,
    pub(crate) command_line_sanitized: String,
    pub(crate) exit_code: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) request_id: Option<String>,
    pub(crate) error: DiagnosticErrorSnapshot,
    pub(crate) reportability: DiagnosticReportability,
    pub(crate) environment: DiagnosticEnvironment,
}

impl DiagnosticSnapshot {
    pub(crate) fn from_error(
        error: &CliError,
        command_path: Option<&str>,
        created_at: DateTime<Utc>,
    ) -> Self {
        let reportability = match report_suggestion(error) {
            Some(suggestion) => DiagnosticReportability {
                recommended: suggestion.recommended,
                reason: Some(suggestion.reason),
            },
            None => DiagnosticReportability {
                recommended: false,
                reason: None,
            },
        };

        Self {
            schema_version: DIAGNOSTIC_SCHEMA_VERSION,
            created_at,
            cli_version: env!("CARGO_PKG_VERSION").to_owned(),
            command_path: command_path
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .or_else(|| error.command_path.clone()),
            command_line_sanitized: error.command.clone(),
            exit_code: error.exit_code(),
            request_id: error.request_id.clone(),
            error: DiagnosticErrorSnapshot::from_cli_error(error),
            reportability,
            environment: DiagnosticEnvironment {
                os: std::env::consts::OS.to_owned(),
                arch: std::env::consts::ARCH.to_owned(),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticErrorSnapshot {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) code: Option<String>,
    pub(crate) stage: String,
    pub(crate) title: String,
    pub(crate) detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) status: Option<u16>,
    pub(crate) retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) retry_after_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) hint: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub(crate) try_next: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub(crate) validation_issues: Vec<DiagnosticValidationIssue>,
}

impl DiagnosticErrorSnapshot {
    fn from_cli_error(error: &CliError) -> Self {
        Self {
            code: error.code.clone(),
            stage: error.stage.as_str().to_owned(),
            title: error.title.clone(),
            detail: error.why.clone(),
            status: error.status,
            retryable: error.retryable,
            retry_after_ms: error.retry_after_ms,
            hint: error.hint.clone(),
            try_next: error.try_next.clone(),
            validation_issues: error
                .validation_issues
                .iter()
                .cloned()
                .map(DiagnosticValidationIssue::from_cli_issue)
                .collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticValidationIssue {
    pub(crate) field: String,
    pub(crate) message: String,
    pub(crate) code: String,
}

impl DiagnosticValidationIssue {
    fn from_cli_issue(issue: CliValidationIssue) -> Self {
        Self {
            field: issue.field,
            message: issue.message,
            code: issue.code,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticReportability {
    pub(crate) recommended: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticEnvironment {
    pub(crate) os: String,
    pub(crate) arch: String,
}

pub(crate) fn persist_last_error(
    paths: &DiagnosticsPaths,
    command_line: &str,
    error: &CliError,
    command_path: Option<&str>,
    created_at: DateTime<Utc>,
) -> Result<(), CliError> {
    let parent_dir = paths.last_error_path.parent().ok_or_else(|| {
        CliError::new(
            "failed to compute diagnostics directory",
            command_line,
            ErrorStage::LoadConfig,
            format!(
                "invalid diagnostics path: {}",
                paths.last_error_path.display()
            ),
            vec!["check diagnostics directory permissions".to_owned()],
        )
    })?;

    path_utils::create_private_dir(
        parent_dir,
        command_line,
        ErrorStage::LoadConfig,
        "diagnostics",
    )?;

    let serialized = serde_json::to_string_pretty(&DiagnosticSnapshot::from_error(
        error,
        command_path,
        created_at,
    ))
    .map_err(|serialize_error| {
        CliError::new(
            "failed to serialize diagnostics",
            command_line,
            ErrorStage::Render,
            serialize_error.to_string(),
            vec!["retry the failed command".to_owned()],
        )
    })?;

    path_utils::atomic_write_private_file(
        &paths.last_error_path,
        &serialized,
        command_line,
        ErrorStage::LoadConfig,
        "diagnostics",
    )
}

pub(crate) fn load_last_error(
    paths: &DiagnosticsPaths,
    command_line: &str,
) -> Result<DiagnosticSnapshot, CliError> {
    let raw = fs::read_to_string(&paths.last_error_path).map_err(|read_error| {
        let (title, why, try_next) = if read_error.kind() == std::io::ErrorKind::NotFound {
            (
                "diagnostic report unavailable",
                format!(
                    "no saved diagnostics were found at {}",
                    paths.last_error_path.display()
                ),
                vec![
                    "run the failing command again to capture a fresh snapshot".to_owned(),
                    format!("retry {TEXT_REPORT_COMMAND}"),
                ],
            )
        } else {
            (
                "failed to read saved diagnostics",
                format!("{read_error} ({})", paths.last_error_path.display()),
                vec!["check diagnostics directory read permissions".to_owned()],
            )
        };

        CliError::new(title, command_line, ErrorStage::LoadConfig, why, try_next)
    })?;

    serde_json::from_str(&raw).map_err(|parse_error| {
        CliError::new(
            "failed to parse saved diagnostics",
            command_line,
            ErrorStage::LoadConfig,
            format!("{parse_error} ({})", paths.last_error_path.display()),
            vec![
                format!(
                    "remove {} and reproduce the failure",
                    paths.last_error_path.display()
                ),
                format!("retry {TEXT_REPORT_COMMAND}"),
            ],
        )
    })
}

pub(crate) fn render_report_markdown(
    snapshot: &DiagnosticSnapshot,
    diagnostics_path: &Path,
    command_line: &str,
) -> Result<String, CliError> {
    let serialized_snapshot =
        serde_json::to_string_pretty(snapshot).map_err(|serialize_error| {
            CliError::new(
                "failed to render diagnostic report",
                command_line,
                ErrorStage::Render,
                serialize_error.to_string(),
                vec![format!("retry {TEXT_REPORT_COMMAND}")],
            )
        })?;

    let mut report = String::new();
    report.push_str("<!-- Redacted OneQuery CLI diagnostic report. Review before sharing. -->\n\n");
    report.push_str("# OneQuery CLI Diagnostic Report\n\n");
    report.push_str("## Summary\n\n");
    report.push_str(&format!(
        "- Generated at: `{}`\n",
        snapshot.created_at.to_rfc3339()
    ));
    report.push_str(&format!("- CLI version: `{}`\n", snapshot.cli_version));
    if let Some(command_path) = &snapshot.command_path {
        report.push_str(&format!("- Command path: `{command_path}`\n"));
    }
    if let Some(request_id) = &snapshot.request_id {
        report.push_str(&format!("- Request ID: `{request_id}`\n"));
    }
    if let Some(code) = &snapshot.error.code {
        report.push_str(&format!("- Error code: `{code}`\n"));
    }
    report.push_str(&format!("- Error stage: `{}`\n", snapshot.error.stage));
    report.push_str(&format!("- Exit code: `{}`\n", snapshot.exit_code));
    if snapshot.reportability.recommended {
        report.push_str("- Reporting: recommended");
        if let Some(reason) = &snapshot.reportability.reason {
            report.push_str(&format!(" (`{reason}`)"));
        }
        report.push('\n');
    } else if let Some(reason) = &snapshot.reportability.reason {
        report.push_str(&format!("- Reporting: if reproducible (`{reason}`)\n"));
    } else {
        report.push_str("- Reporting: not currently recommended\n");
    }

    report.push_str("\n## Command\n\n```text\n");
    report.push_str(&snapshot.command_line_sanitized);
    report.push_str("\n```\n");

    report.push_str("\n## Error\n\n");
    report.push_str(&format!("- Title: {}\n", snapshot.error.title));
    report.push_str(&format!("- Detail: {}\n", snapshot.error.detail));
    if let Some(status) = snapshot.error.status {
        report.push_str(&format!("- HTTP status: `{status}`\n"));
    }
    report.push_str(&format!(
        "- Retryable: {}\n",
        if snapshot.error.retryable {
            "yes"
        } else {
            "no"
        }
    ));
    if let Some(retry_after_ms) = snapshot.error.retry_after_ms {
        report.push_str(&format!("- Retry after: `{retry_after_ms}` ms\n"));
    }
    if let Some(hint) = &snapshot.error.hint {
        report.push_str(&format!("- Hint: {hint}\n"));
    }

    if !snapshot.error.validation_issues.is_empty() {
        report.push_str("\n### Validation Issues\n\n");
        for issue in &snapshot.error.validation_issues {
            if issue.field.trim().is_empty() {
                report.push_str(&format!("- {} (`{}`)\n", issue.message, issue.code));
                continue;
            }

            report.push_str(&format!(
                "- `{}`: {} (`{}`)\n",
                issue.field, issue.message, issue.code
            ));
        }
    }

    if !snapshot.error.try_next.is_empty() {
        report.push_str("\n### Try Next\n\n");
        for step in &snapshot.error.try_next {
            report.push_str(&format!("- {step}\n"));
        }
    }

    report.push_str("\n## Environment\n\n");
    report.push_str(&format!("- OS: `{}`\n", snapshot.environment.os));
    report.push_str(&format!("- Arch: `{}`\n", snapshot.environment.arch));
    report.push_str(&format!(
        "- Diagnostics snapshot: `{}`\n",
        diagnostics_path.display()
    ));

    report.push_str("\n## Redacted Diagnostics JSON\n\n```json\n");
    report.push_str(&serialized_snapshot);
    report.push_str("\n```\n");

    Ok(report)
}

pub(crate) fn write_report(
    paths: &DiagnosticsPaths,
    command_line: &str,
    snapshot: &DiagnosticSnapshot,
    created_at: DateTime<Utc>,
) -> Result<PathBuf, CliError> {
    path_utils::create_private_dir(
        &paths.reports_dir,
        command_line,
        ErrorStage::LoadConfig,
        "reports",
    )?;

    let timestamp = created_at.format("%Y-%m-%dT%H-%M-%SZ");
    let mut report_filename = format!("onequery-report-{timestamp}");
    if let Some(request_id) = snapshot.request_id.as_deref() {
        let request_id: String = request_id
            .chars()
            .map(|character| {
                if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                    character
                } else {
                    '_'
                }
            })
            .collect();
        if !request_id.is_empty() {
            report_filename.push('-');
            report_filename.push_str(&request_id);
        }
    }
    report_filename.push_str(".md");

    let report_path = paths.reports_dir.join(report_filename);
    let report = render_report_markdown(snapshot, &paths.last_error_path, command_line)?;

    path_utils::atomic_write_private_file(
        &report_path,
        &report,
        command_line,
        ErrorStage::LoadConfig,
        "reports",
    )?;

    Ok(report_path)
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;
    use chrono::Utc;
    use onequery_cli_core::error::CliSupportAction;
    use onequery_cli_core::error::CliSupportActionKind;
    use pretty_assertions::assert_eq;
    use std::path::Path;
    use tempfile::tempdir;

    use super::DiagnosticErrorSnapshot;
    use super::DiagnosticReportability;
    use super::DiagnosticSnapshot;
    use super::DiagnosticsPaths;
    use super::load_last_error;
    use super::persist_last_error;
    use super::render_report_markdown;
    use onequery_cli_core::error::CliError;
    use onequery_cli_core::error::CliValidationIssue;
    use onequery_cli_core::error::ErrorStage;

    fn sample_error() -> CliError {
        CliError::new(
            "query failed",
            "onequery query exec --source warehouse --sql \"<excerpt: select 1>\"",
            ErrorStage::ExecuteQuery,
            "failed to decode query response",
            vec!["retry onequery query exec --source warehouse".to_owned()],
        )
        .with_command_path(Some("query exec".to_owned()))
        .with_code(Some("decode_error".to_owned()))
        .with_status(Some(502))
        .with_request_id(Some("req_123".to_owned()))
        .with_hint(Some("the API returned an unexpected payload".to_owned()))
        .with_retryable(false)
        .with_retry_after_ms(Some(250))
        .with_validation_issues(vec![CliValidationIssue {
            field: "sql".to_owned(),
            message: "expected a read-only query".to_owned(),
            code: "custom".to_owned(),
        }])
    }

    #[test]
    fn persist_and_load_last_error_round_trips_redacted_snapshot() {
        let temp_dir = tempdir().expect("failed to create tempdir");
        let paths = DiagnosticsPaths::for_test(temp_dir.path().join("onequery-data"));
        let created_at = Utc
            .with_ymd_and_hms(2026, 4, 23, 3, 12, 11)
            .single()
            .expect("expected timestamp");

        persist_last_error(
            &paths,
            "onequery query exec",
            &sample_error(),
            Some("query exec"),
            created_at,
        )
        .expect("expected diagnostics persistence");

        let snapshot = load_last_error(&paths, "onequery doctor report --last")
            .expect("expected diagnostics snapshot");

        assert_eq!(
            snapshot,
            DiagnosticSnapshot {
                schema_version: 1,
                created_at,
                cli_version: env!("CARGO_PKG_VERSION").to_owned(),
                command_path: Some("query exec".to_owned()),
                command_line_sanitized:
                    "onequery query exec --source warehouse --sql \"<excerpt: select 1>\""
                        .to_owned(),
                exit_code: 6,
                request_id: Some("req_123".to_owned()),
                error: DiagnosticErrorSnapshot {
                    code: Some("decode_error".to_owned()),
                    stage: "execute_query".to_owned(),
                    title: "query failed".to_owned(),
                    detail: "failed to decode query response".to_owned(),
                    status: Some(502),
                    retryable: false,
                    retry_after_ms: Some(250),
                    hint: Some("the API returned an unexpected payload".to_owned()),
                    try_next: vec!["retry onequery query exec --source warehouse".to_owned()],
                    validation_issues: vec![super::DiagnosticValidationIssue {
                        field: "sql".to_owned(),
                        message: "expected a read-only query".to_owned(),
                        code: "custom".to_owned(),
                    }],
                },
                reportability: DiagnosticReportability {
                    recommended: true,
                    reason: Some("unexpected_response_decode_failure".to_owned()),
                },
                environment: super::DiagnosticEnvironment {
                    os: std::env::consts::OS.to_owned(),
                    arch: std::env::consts::ARCH.to_owned(),
                },
            }
        );
    }

    #[test]
    fn render_report_markdown_includes_summary_and_redacted_json() {
        let snapshot = DiagnosticSnapshot::from_error(
            &sample_error(),
            Some("query exec"),
            Utc.with_ymd_and_hms(2026, 4, 23, 3, 12, 11)
                .single()
                .expect("expected timestamp"),
        );
        let rendered = render_report_markdown(
            &snapshot,
            Path::new("/tmp/onequery-data/last-error.json"),
            "onequery doctor report --last",
        )
        .expect("expected rendered markdown");

        for expected in [
            "# OneQuery CLI Diagnostic Report",
            "- Command path: `query exec`",
            "- Error code: `decode_error`",
            "```text\nonequery query exec --source warehouse --sql \"<excerpt: select 1>\"\n```",
            "### Validation Issues",
            "### Try Next",
            "- Diagnostics snapshot: `/tmp/onequery-data/last-error.json`",
            "## Redacted Diagnostics JSON",
            "\"commandLineSanitized\": \"onequery query exec --source warehouse --sql \\\"<excerpt: select 1>\\\"\"",
        ] {
            assert!(
                rendered.contains(expected),
                "expected markdown to contain {expected:?}, got:\n{rendered}"
            );
        }
    }

    #[test]
    fn diagnostic_snapshot_marks_report_if_reproducible_as_not_recommended() {
        let snapshot = DiagnosticSnapshot::from_error(
            &sample_error().with_support_action(Some(CliSupportAction {
                kind: CliSupportActionKind::ReportIfReproducible,
                reason: "query_execution_failure".to_owned(),
                explain_slug: "query_execution_failed".to_owned(),
            })),
            Some("query exec"),
            Utc.with_ymd_and_hms(2026, 4, 23, 3, 12, 11)
                .single()
                .expect("expected timestamp"),
        );

        assert_eq!(
            snapshot.reportability,
            DiagnosticReportability {
                recommended: false,
                reason: Some("query_execution_failure".to_owned()),
            }
        );
    }
}
