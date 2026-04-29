use chrono::DateTime;
use chrono::Utc;
use serde_json::json;

use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;

use crate::cli::DoctorReportArgs;
use crate::cli::DoctorSubcommand;
use crate::diagnostics::DiagnosticsPaths;
use crate::diagnostics::load_last_error;
use crate::diagnostics::render_report_markdown;
use crate::diagnostics::write_report;
use crate::issue_report::build_issue_draft;
use crate::output::CommandOutput;
use crate::output::EffectiveOutputMode;
use crate::platform::BrowserLauncher;
use crate::platform::SystemBrowserLauncher;

pub(crate) fn execute(
    command: &DoctorSubcommand,
    command_line: &str,
    requested_output_mode: Option<EffectiveOutputMode>,
) -> Result<CommandOutput, CliError> {
    execute_with_clock_and_browser(
        command,
        command_line,
        requested_output_mode,
        &DiagnosticsPaths::resolve(command_line)?,
        Utc::now(),
        &SystemBrowserLauncher,
    )
}

fn execute_with_clock_and_browser<B>(
    command: &DoctorSubcommand,
    command_line: &str,
    requested_output_mode: Option<EffectiveOutputMode>,
    paths: &DiagnosticsPaths,
    now: DateTime<Utc>,
    browser: &B,
) -> Result<CommandOutput, CliError>
where
    B: BrowserLauncher,
{
    match command {
        DoctorSubcommand::Report(args) => execute_report(
            args,
            command_line,
            requested_output_mode,
            paths,
            now,
            browser,
        ),
    }
}

fn execute_report<B>(
    args: &DoctorReportArgs,
    command_line: &str,
    requested_output_mode: Option<EffectiveOutputMode>,
    paths: &DiagnosticsPaths,
    now: DateTime<Utc>,
    browser: &B,
) -> Result<CommandOutput, CliError>
where
    B: BrowserLauncher,
{
    let snapshot = load_selected_snapshot(args, paths, command_line)?;

    if requested_output_mode == Some(EffectiveOutputMode::Text) {
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
    let issue_draft = build_issue_draft(&snapshot, &report_path);

    if args.open {
        browser
            .open_url(issue_draft.issue_url.as_str())
            .map_err(|open_error| {
                CliError::new(
                    "failed to open GitHub issue draft",
                    command_line,
                    ErrorStage::Internal,
                    format!("could not open browser automatically ({open_error})"),
                    vec![
                        issue_draft.github_command.clone(),
                        format!(
                            "review {} and paste it into a new GitHub issue",
                            report_path.display()
                        ),
                    ],
                )
            })?;
    }

    let mut lines = vec![
        "Created diagnostic report:".to_owned(),
        format!("  {}", report_path.display()),
        String::new(),
        "Create a GitHub issue with:".to_owned(),
        format!("  {}", issue_draft.github_command),
    ];
    if args.open {
        lines.push(String::new());
        lines.push("Opened a GitHub issue draft in your browser.".to_owned());
        lines.push("Paste the report contents before submitting.".to_owned());
    }
    lines.push(String::new());
    lines.push("Review it before sharing.".to_owned());

    Ok(CommandOutput::structured(
        lines,
        json!({
            "reportPath": report_path.display().to_string(),
            "diagnosticsPath": paths.last_error_path.display().to_string(),
            "githubCommand": issue_draft.github_command,
            "openedBrowser": args.open,
        }),
    ))
}

fn load_selected_snapshot(
    args: &DoctorReportArgs,
    paths: &DiagnosticsPaths,
    command_line: &str,
) -> Result<crate::diagnostics::DiagnosticSnapshot, CliError> {
    let snapshot = load_last_error(paths, command_line)?;
    if args.selector.last {
        return Ok(snapshot);
    }

    let Some(request_id) = args.selector.request_id.as_ref() else {
        return Err(CliError::internal(
            command_line,
            "doctor report selector group accepted an impossible state",
        ));
    };

    // Comment: diagnostics currently persist one redacted snapshot, so request-id selection
    // validates the saved snapshot instead of searching a historical store.
    if snapshot.request_id.as_deref() == Some(request_id.as_str()) {
        return Ok(snapshot);
    }

    let why = match snapshot.request_id.as_deref() {
        Some(saved_request_id) => format!(
            "saved diagnostics request ID `{saved_request_id}` does not match `{request_id}`"
        ),
        None => "the saved diagnostics snapshot does not include a request ID".to_owned(),
    };

    Err(CliError::new(
        "diagnostic report unavailable",
        command_line,
        ErrorStage::LoadConfig,
        why,
        vec![
            "run the failing command again to capture a fresh snapshot".to_owned(),
            format!("retry {}", crate::diagnostics::TEXT_REPORT_COMMAND),
        ],
    ))
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use chrono::TimeZone;
    use chrono::Utc;
    use insta::assert_snapshot;
    use pretty_assertions::assert_eq;
    use tempfile::tempdir;

    use crate::diagnostics::DiagnosticEnvironment;
    use crate::diagnostics::DiagnosticErrorSnapshot;
    use crate::diagnostics::DiagnosticReportability;
    use crate::diagnostics::DiagnosticSnapshot;
    use crate::identifiers::test_request_id;
    use crate::output::EffectiveOutputMode;
    use crate::output::render_error;
    use crate::output::render_output;
    use crate::platform::BrowserLaunchError;
    use crate::platform::BrowserLauncher;
    use onequery_core::error::ErrorStage;

    use super::DiagnosticsPaths;
    use super::DoctorReportArgs;
    use super::DoctorSubcommand;
    use super::execute_with_clock_and_browser;
    use crate::cli::DoctorReportSelectorArgs;

    #[derive(Debug)]
    struct RecordingBrowser {
        urls: RefCell<Vec<String>>,
        failure: Option<String>,
    }

    impl RecordingBrowser {
        fn succeed() -> Self {
            Self {
                urls: RefCell::new(Vec::new()),
                failure: None,
            }
        }

        fn fail(message: &str) -> Self {
            Self {
                urls: RefCell::new(Vec::new()),
                failure: Some(message.to_owned()),
            }
        }

        fn urls(&self) -> Vec<String> {
            self.urls.borrow().clone()
        }
    }

    impl BrowserLauncher for RecordingBrowser {
        fn open_url(&self, url: &str) -> Result<(), BrowserLaunchError> {
            self.urls.borrow_mut().push(url.to_owned());
            match &self.failure {
                Some(message) => Err(BrowserLaunchError::Open {
                    message: message.clone(),
                }),
                None => Ok(()),
            }
        }
    }

    fn sample_command() -> DoctorSubcommand {
        DoctorSubcommand::Report(DoctorReportArgs {
            selector: DoctorReportSelectorArgs {
                last: true,
                request_id: None,
            },
            open: false,
        })
    }

    fn report_snapshot_filters(temp_dir_path: &str) -> Vec<(&str, &str)> {
        vec![
            (temp_dir_path, "<tmp>"),
            (r"CLI version: `[^`]+`", "CLI version: `<cli-version>`"),
            (
                r#""cliVersion": "[^"]+""#,
                r#""cliVersion": "<cli-version>""#,
            ),
        ]
    }

    fn seed_snapshot(paths: &DiagnosticsPaths) -> DiagnosticSnapshot {
        let snapshot = DiagnosticSnapshot {
            schema_version: 1,
            created_at: Utc
                .with_ymd_and_hms(2026, 4, 23, 3, 12, 11)
                .single()
                .expect("expected timestamp"),
            cli_version: env!("CARGO_PKG_VERSION").to_owned(),
            command_path: Some("query exec".to_owned()),
            command_line_sanitized:
                "onequery query exec --source warehouse --sql \"<excerpt: select 1>\"".to_owned(),
            exit_code: 6,
            request_id: Some("req_123".to_owned()),
            error: DiagnosticErrorSnapshot {
                code: Some("decode_error".to_owned()),
                stage: "execute_query".to_owned(),
                title: "query failed".to_owned(),
                detail: "failed to decode query response".to_owned(),
                status: Some(502),
                retryable: false,
                retry_after_ms: None,
                hint: Some("the API returned an unexpected payload".to_owned()),
                try_next: vec!["retry onequery query exec --source warehouse".to_owned()],
                validation_issues: Vec::new(),
            },
            reportability: DiagnosticReportability {
                recommended: true,
                reason: Some("unexpected_response_decode_failure".to_owned()),
            },
            // Comment: report snapshots pin a synthetic environment so CI runners and
            // developer machines do not rewrite them based on host OS or architecture.
            environment: DiagnosticEnvironment {
                os: "macos".to_owned(),
                arch: "aarch64".to_owned(),
            },
        };
        let diagnostics_dir = paths
            .last_error_path
            .parent()
            .expect("expected diagnostics directory");
        let serialized =
            serde_json::to_string_pretty(&snapshot).expect("expected diagnostics serialization");

        std::fs::create_dir_all(diagnostics_dir).expect("expected diagnostics directory");
        std::fs::write(&paths.last_error_path, serialized).expect("expected diagnostics write");

        snapshot
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
        let browser = RecordingBrowser::succeed();

        let output = execute_with_clock_and_browser(
            &sample_command(),
            "onequery doctor report --last",
            None,
            &paths,
            now,
            &browser,
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

        let temp_dir_path = temp_dir.path().to_string_lossy();
        crate::commands::with_command_snapshot_path(|| {
            insta::with_settings!({
                filters => report_snapshot_filters(&temp_dir_path)
            }, {
                assert_snapshot!(rendered);
            });
        });
        assert_eq!(browser.urls(), Vec::<String>::new());
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
        let browser = RecordingBrowser::succeed();

        let output = execute_with_clock_and_browser(
            &DoctorSubcommand::Report(DoctorReportArgs {
                selector: DoctorReportSelectorArgs {
                    last: true,
                    request_id: None,
                },
                open: false,
            }),
            "onequery doctor report --last --text",
            Some(EffectiveOutputMode::Text),
            &paths,
            now,
            &browser,
        )
        .expect("expected report output");

        let rendered = render_output(
            output.with_command("doctor report"),
            EffectiveOutputMode::Text,
        );

        let temp_dir_path = temp_dir.path().to_string_lossy();
        crate::commands::with_command_snapshot_path(|| {
            insta::with_settings!({
                filters => report_snapshot_filters(&temp_dir_path)
            }, {
                assert_snapshot!(rendered);
            });
        });
        assert_eq!(browser.urls(), Vec::<String>::new());
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
        let browser = RecordingBrowser::succeed();

        let output = execute_with_clock_and_browser(
            &DoctorSubcommand::Report(DoctorReportArgs {
                selector: DoctorReportSelectorArgs {
                    last: true,
                    request_id: None,
                },
                open: false,
            }),
            "onequery doctor report --last --json",
            Some(EffectiveOutputMode::Json),
            &paths,
            now,
            &browser,
        )
        .expect("expected report output");

        let rendered = render_output(
            output.with_command("doctor report"),
            EffectiveOutputMode::Json,
        );
        let parsed =
            serde_json::from_str::<serde_json::Value>(&rendered).expect("expected JSON output");
        let pretty = serde_json::to_string_pretty(&parsed).expect("expected pretty JSON");
        assert_eq!(
            parsed
                .get("data")
                .and_then(serde_json::Value::as_object)
                .and_then(|data| data.get("issueUrl")),
            None,
            "doctor report JSON should keep browser draft URLs out of structured output"
        );

        let temp_dir_path = temp_dir.path().to_string_lossy();
        crate::commands::with_command_snapshot_path(|| {
            insta::with_settings!({
                filters => report_snapshot_filters(&temp_dir_path)
            }, {
                assert_snapshot!(pretty);
            });
        });
        assert_eq!(browser.urls(), Vec::<String>::new());
    }

    #[test]
    fn report_command_open_opens_browser_and_text_output_snapshot() {
        let temp_dir = tempdir().expect("failed to create tempdir");
        let paths = DiagnosticsPaths::for_test(temp_dir.path().join("onequery-data"));
        let now = Utc
            .with_ymd_and_hms(2026, 4, 23, 3, 20, 0)
            .single()
            .expect("expected timestamp");
        seed_snapshot(&paths);
        let browser = RecordingBrowser::succeed();

        let output = execute_with_clock_and_browser(
            &DoctorSubcommand::Report(DoctorReportArgs {
                selector: DoctorReportSelectorArgs {
                    last: true,
                    request_id: None,
                },
                open: true,
            }),
            "onequery doctor report --last --open",
            None,
            &paths,
            now,
            &browser,
        )
        .expect("expected report output");

        let rendered = output.lines.join("\n");
        let opened_urls = browser.urls();

        let temp_dir_path = temp_dir.path().to_string_lossy();
        crate::commands::with_command_snapshot_path(|| {
            insta::with_settings!({
                filters => {
                    let mut filters = report_snapshot_filters(&temp_dir_path);
                    filters.push((
                        r"https://github\\.com/wordbricks/onequery/issues/new\\?\\S+",
                        "<ISSUE_URL>",
                    ));
                    filters
                }
            }, {
                assert_snapshot!(rendered);
            });
        });

        assert_eq!(opened_urls.len(), 1);
        assert!(
            opened_urls[0].starts_with("https://github.com/wordbricks/onequery/issues/new?"),
            "expected GitHub new issue URL, got {}",
            opened_urls[0]
        );
        assert!(opened_urls[0].contains("title=%5Bcli%5D+decode_error"));
        assert!(opened_urls[0].contains("labels=bug%2Ccli"));
    }

    #[test]
    fn report_command_open_failure_returns_github_cli_fallback() {
        let temp_dir = tempdir().expect("failed to create tempdir");
        let paths = DiagnosticsPaths::for_test(temp_dir.path().join("onequery-data"));
        let now = Utc
            .with_ymd_and_hms(2026, 4, 23, 3, 20, 0)
            .single()
            .expect("expected timestamp");
        seed_snapshot(&paths);
        let browser = RecordingBrowser::fail("launch denied");

        let error = execute_with_clock_and_browser(
            &DoctorSubcommand::Report(DoctorReportArgs {
                selector: DoctorReportSelectorArgs {
                    last: true,
                    request_id: None,
                },
                open: true,
            }),
            "onequery doctor report --last --open",
            None,
            &paths,
            now,
            &browser,
        )
        .expect_err("expected browser launch error");

        assert_eq!(error.title, "failed to open GitHub issue draft");
        assert_eq!(error.stage, ErrorStage::Internal);
        assert_eq!(
            error.try_next[1],
            format!(
                "review {} and paste it into a new GitHub issue",
                temp_dir
                    .path()
                    .join("onequery-data/reports/onequery-report-2026-04-23T03-20-00Z-req_123.md")
                    .display()
            )
        );
        assert!(
            error.try_next[0].starts_with("gh issue create -R wordbricks/onequery"),
            "expected gh issue fallback command, got {}",
            error.try_next[0]
        );
    }

    #[test]
    fn report_command_open_failure_renders_report_path_in_error_output_snapshot() {
        let temp_dir = tempdir().expect("failed to create tempdir");
        let paths = DiagnosticsPaths::for_test(temp_dir.path().join("onequery-data"));
        let now = Utc
            .with_ymd_and_hms(2026, 4, 23, 3, 20, 0)
            .single()
            .expect("expected timestamp");
        seed_snapshot(&paths);
        let browser = RecordingBrowser::fail("launch denied");

        let error = execute_with_clock_and_browser(
            &DoctorSubcommand::Report(DoctorReportArgs {
                selector: DoctorReportSelectorArgs {
                    last: true,
                    request_id: None,
                },
                open: true,
            }),
            "onequery doctor report --last --open",
            None,
            &paths,
            now,
            &browser,
        )
        .expect_err("expected browser launch error");

        let rendered = render_error(
            &error.with_command_path(Some("doctor report".to_owned())),
            EffectiveOutputMode::Text,
        );

        let temp_dir_path = temp_dir.path().to_string_lossy();
        crate::commands::with_command_snapshot_path(|| {
            insta::with_settings!({
                filters => report_snapshot_filters(&temp_dir_path)
            }, {
                assert_snapshot!(rendered);
            });
        });
    }

    #[test]
    fn report_command_accepts_matching_request_id_selector() {
        let temp_dir = tempdir().expect("failed to create tempdir");
        let paths = DiagnosticsPaths::for_test(temp_dir.path().join("onequery-data"));
        let now = Utc
            .with_ymd_and_hms(2026, 4, 23, 3, 20, 0)
            .single()
            .expect("expected timestamp");
        let browser = RecordingBrowser::succeed();

        seed_snapshot(&paths);

        let output = execute_with_clock_and_browser(
            &DoctorSubcommand::Report(DoctorReportArgs {
                selector: DoctorReportSelectorArgs {
                    last: false,
                    request_id: Some(test_request_id("req_123")),
                },
                open: false,
            }),
            "onequery doctor report --request-id req_123",
            None,
            &paths,
            now,
            &browser,
        )
        .expect("expected matching request ID to select the saved snapshot");

        assert_eq!(
            output
                .into_data()
                .get("reportPath")
                .and_then(serde_json::Value::as_str),
            Some(
                temp_dir
                    .path()
                    .join("onequery-data/reports/onequery-report-2026-04-23T03-20-00Z-req_123.md")
                    .to_string_lossy()
                    .as_ref()
            )
        );
    }

    #[test]
    fn report_command_rejects_mismatched_request_id_selector() {
        let temp_dir = tempdir().expect("failed to create tempdir");
        let paths = DiagnosticsPaths::for_test(temp_dir.path().join("onequery-data"));
        let now = Utc
            .with_ymd_and_hms(2026, 4, 23, 3, 20, 0)
            .single()
            .expect("expected timestamp");
        let browser = RecordingBrowser::succeed();

        seed_snapshot(&paths);

        let error = execute_with_clock_and_browser(
            &DoctorSubcommand::Report(DoctorReportArgs {
                selector: DoctorReportSelectorArgs {
                    last: false,
                    request_id: Some(test_request_id("req_missing")),
                },
                open: false,
            }),
            "onequery doctor report --request-id req_missing",
            None,
            &paths,
            now,
            &browser,
        )
        .expect_err("expected request ID mismatch to reject the saved snapshot");

        assert_eq!(error.title, "diagnostic report unavailable");
        assert_eq!(error.stage, ErrorStage::LoadConfig);
        assert_eq!(
            error.why,
            "saved diagnostics request ID `req_123` does not match `req_missing`"
        );
        assert_eq!(
            error.try_next,
            vec![
                "run the failing command again to capture a fresh snapshot".to_owned(),
                "retry onequery doctor report --last".to_owned(),
            ]
        );
    }
}
