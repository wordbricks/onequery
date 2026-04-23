use chrono::DateTime;
use chrono::Utc;
use serde_json::json;

use onequery_cli_core::error::CliError;

use crate::cli::DoctorReportArgs;
use crate::cli::DoctorSubcommand;
use crate::diagnostics::DiagnosticsPaths;
use crate::diagnostics::load_last_error;
use crate::diagnostics::render_report_markdown;
use crate::diagnostics::write_report;
use crate::output::CommandOutput;

pub(crate) fn execute(
    command: &DoctorSubcommand,
    command_line: &str,
) -> Result<CommandOutput, CliError> {
    execute_with_clock(
        command,
        command_line,
        &DiagnosticsPaths::resolve(command_line)?,
        Utc::now(),
    )
}

fn execute_with_clock(
    command: &DoctorSubcommand,
    command_line: &str,
    paths: &DiagnosticsPaths,
    now: DateTime<Utc>,
) -> Result<CommandOutput, CliError> {
    match command {
        DoctorSubcommand::Report(args) => execute_report(args, command_line, paths, now),
    }
}

fn execute_report(
    args: &DoctorReportArgs,
    command_line: &str,
    paths: &DiagnosticsPaths,
    now: DateTime<Utc>,
) -> Result<CommandOutput, CliError> {
    let snapshot = load_last_error(paths, command_line)?;

    if args.stdout {
        let report = render_report_markdown(&snapshot, &paths.last_error_path, command_line)?;
        return Ok(CommandOutput::structured(
            Vec::new(),
            json!({
                "diagnosticsPath": paths.last_error_path.display().to_string(),
            }),
        )
        .with_text_stdout(report));
    }

    let report_path = write_report(paths, command_line, &snapshot, now)?;
    Ok(CommandOutput::structured(
        vec![
            "Created diagnostic report:".to_owned(),
            format!("  {}", report_path.display()),
            String::new(),
            "Review it before sharing.".to_owned(),
        ],
        json!({
            "reportPath": report_path.display().to_string(),
            "diagnosticsPath": paths.last_error_path.display().to_string(),
        }),
    ))
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;
    use chrono::Utc;
    use insta::assert_snapshot;
    use pretty_assertions::assert_eq;
    use tempfile::tempdir;

    use crate::diagnostics::DiagnosticSnapshot;
    use crate::diagnostics::persist_last_error;
    use crate::output::EffectiveOutputMode;
    use crate::output::render_output;

    use super::DiagnosticsPaths;
    use super::DoctorReportArgs;
    use super::DoctorSubcommand;
    use super::execute_with_clock;

    fn sample_command() -> DoctorSubcommand {
        DoctorSubcommand::Report(DoctorReportArgs {
            last: true,
            stdout: false,
            json: false,
        })
    }

    fn sample_error() -> onequery_cli_core::error::CliError {
        onequery_cli_core::error::CliError::new(
            "query failed",
            "onequery query exec --source warehouse --sql \"<excerpt: select 1>\"",
            onequery_cli_core::error::ErrorStage::ExecuteQuery,
            "failed to decode query response",
            vec!["retry onequery query exec --source warehouse".to_owned()],
        )
        .with_command_path(Some("query exec".to_owned()))
        .with_code(Some("decode_error".to_owned()))
        .with_status(Some(502))
        .with_request_id(Some("req_123".to_owned()))
        .with_hint(Some("the API returned an unexpected payload".to_owned()))
    }

    fn seed_snapshot(paths: &DiagnosticsPaths) -> DiagnosticSnapshot {
        let created_at = Utc
            .with_ymd_and_hms(2026, 4, 23, 3, 12, 11)
            .single()
            .expect("expected timestamp");
        let error = sample_error();
        persist_last_error(
            paths,
            "onequery query exec",
            &error,
            Some("query exec"),
            created_at,
        )
        .expect("expected diagnostics persistence");
        DiagnosticSnapshot::from_error(&error, Some("query exec"), created_at)
    }

    #[test]
    fn report_command_creates_report_file_and_text_output_snapshot() {
        let temp_dir = tempdir().expect("failed to create tempdir");
        let paths = DiagnosticsPaths::for_test(temp_dir.path().join("onequery-data"));
        let now = Utc
            .with_ymd_and_hms(2026, 4, 23, 3, 20, 0)
            .single()
            .expect("expected timestamp");
        let snapshot = seed_snapshot(&paths);

        let output = execute_with_clock(
            &sample_command(),
            "onequery doctor report --last",
            &paths,
            now,
        )
        .expect("expected report output");

        let rendered = output.lines.join("\n");
        let report_path = paths
            .reports_dir
            .join("onequery-report-2026-04-23T03-20-00Z-req_123.md");
        assert!(
            report_path.is_file(),
            "expected report file at {}",
            report_path.display()
        );
        assert_eq!(
            std::fs::read_to_string(&report_path)
                .expect("expected saved report")
                .contains("# OneQuery CLI Diagnostic Report"),
            true
        );
        assert_eq!(
            std::fs::read_to_string(&report_path)
                .expect("expected saved report")
                .contains(&snapshot.command_line_sanitized),
            true
        );

        crate::commands::with_command_snapshot_path(|| {
            insta::with_settings!({
                filters => [
                    (temp_dir.path().to_string_lossy().as_ref(), "<tmp>")
                ]
            }, {
                assert_snapshot!(rendered);
            });
        });
    }

    #[test]
    fn report_command_stdout_renders_markdown_snapshot() {
        let temp_dir = tempdir().expect("failed to create tempdir");
        let paths = DiagnosticsPaths::for_test(temp_dir.path().join("onequery-data"));
        let now = Utc
            .with_ymd_and_hms(2026, 4, 23, 3, 20, 0)
            .single()
            .expect("expected timestamp");
        seed_snapshot(&paths);

        let output = execute_with_clock(
            &DoctorSubcommand::Report(DoctorReportArgs {
                last: true,
                stdout: true,
                json: false,
            }),
            "onequery doctor report --last --stdout",
            &paths,
            now,
        )
        .expect("expected report output");

        let rendered = render_output(
            output.with_command("doctor report"),
            EffectiveOutputMode::Text,
        );

        crate::commands::with_command_snapshot_path(|| {
            insta::with_settings!({
                filters => [
                    (temp_dir.path().to_string_lossy().as_ref(), "<tmp>")
                ]
            }, {
                assert_snapshot!(rendered);
            });
        });
    }

    #[test]
    fn report_command_json_output_snapshot() {
        let temp_dir = tempdir().expect("failed to create tempdir");
        let paths = DiagnosticsPaths::for_test(temp_dir.path().join("onequery-data"));
        let now = Utc
            .with_ymd_and_hms(2026, 4, 23, 3, 20, 0)
            .single()
            .expect("expected timestamp");
        seed_snapshot(&paths);

        let output = execute_with_clock(
            &DoctorSubcommand::Report(DoctorReportArgs {
                last: true,
                stdout: false,
                json: true,
            }),
            "onequery doctor report --last --json",
            &paths,
            now,
        )
        .expect("expected report output");

        let rendered = render_output(
            output.with_command("doctor report"),
            EffectiveOutputMode::Json,
        );
        let pretty = serde_json::to_string_pretty(
            &serde_json::from_str::<serde_json::Value>(&rendered).expect("expected JSON output"),
        )
        .expect("expected pretty JSON");

        crate::commands::with_command_snapshot_path(|| {
            insta::with_settings!({
                filters => [
                    (temp_dir.path().to_string_lossy().as_ref(), "<tmp>")
                ]
            }, {
                assert_snapshot!(pretty);
            });
        });
    }
}
