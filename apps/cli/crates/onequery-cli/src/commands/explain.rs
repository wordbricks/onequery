use serde_json::json;

use crate::cli::ExplainArgs;
use crate::explain::report_command_for_explanation;
use crate::output::CommandOutput;
use onequery_cli_core::error::CliError;

pub(crate) fn execute(args: &ExplainArgs) -> Result<CommandOutput, CliError> {
    let explanation = args.code.explanation();

    let mut lines = vec![
        format!("Code: {}", explanation.code.slug()),
        format!("Title: {}", explanation.title),
        format!("Stage: {}", explanation.stage),
        format!("HTTP Status: {}", explanation.http_status),
        format!(
            "Retryable: {}",
            if explanation.retryable { "yes" } else { "no" }
        ),
        format!("Support kind: {}", explanation.support_kind.as_str()),
        format!("Reason: {}", explanation.support_reason),
        format!("Summary: {}", explanation.summary),
    ];

    if !explanation.try_next.is_empty() {
        lines.push("Try:".to_owned());
        lines.extend(
            explanation
                .try_next
                .iter()
                .map(|step| format!("  - {step}")),
        );
    }

    if let Some(report_label) = explanation.support_kind.report_label() {
        lines.push(format!(
            "{report_label}: {}",
            crate::diagnostics::TEXT_REPORT_COMMAND
        ));
    }

    Ok(CommandOutput::structured(
        lines,
        json!({
            "code": explanation.code.slug(),
            "title": explanation.title,
            "stage": explanation.stage,
            "httpStatus": explanation.http_status,
            "retryable": explanation.retryable,
            "support": {
                "kind": explanation.support_kind.as_str(),
                "reason": explanation.support_reason,
            },
            "summary": explanation.summary,
            "tryNext": explanation.try_next,
            "reportCommand": report_command_for_explanation(explanation),
        }),
    ))
}

#[cfg(test)]
mod tests {
    use insta::assert_snapshot;
    use pretty_assertions::assert_eq;

    use crate::cli::ExplainArgs;
    use crate::explain::ExplainCode;
    use crate::output::EffectiveOutputMode;
    use crate::output::render_output;

    use super::execute;

    #[test]
    fn explain_command_renders_text_snapshot() {
        let output = execute(&ExplainArgs {
            code: ExplainCode::QueryRejected,
        })
        .expect("expected explain output");

        crate::commands::with_command_snapshot_path(|| {
            assert_snapshot!(render_output(
                output.with_command("explain"),
                EffectiveOutputMode::Text,
            ));
        });
    }

    #[test]
    fn explain_command_renders_json_snapshot() {
        let output = execute(&ExplainArgs {
            code: ExplainCode::QueryExecutionFailed,
        })
        .expect("expected explain output");
        let rendered = render_output(output.with_command("explain"), EffectiveOutputMode::Json);
        let pretty = serde_json::to_string_pretty(
            &serde_json::from_str::<serde_json::Value>(&rendered).expect("expected JSON output"),
        )
        .expect("expected pretty JSON");

        crate::commands::with_command_snapshot_path(|| {
            assert_snapshot!(pretty);
        });
    }

    #[test]
    fn explain_command_includes_report_command_only_for_reportable_codes() {
        let reportable = execute(&ExplainArgs {
            code: ExplainCode::QueryExecutionFailed,
        })
        .expect("expected explain output");
        let user_actionable = execute(&ExplainArgs {
            code: ExplainCode::SourceNotFound,
        })
        .expect("expected explain output");

        assert_eq!(
            reportable.into_data(),
            serde_json::json!({
                "code": "query_execution_failed",
                "title": "Query Execution Failed",
                "stage": "execute_query",
                "httpStatus": 500,
                "retryable": false,
                "support": {
                    "kind": "report_if_reproducible",
                    "reason": "query_execution_failure",
                },
                "summary": "The query reached execution, but the backing source or service failed unexpectedly.",
                "tryNext": ["retry onequery query exec --source <source> --sql \"select ...\""],
                "reportCommand": "onequery doctor report --last",
            })
        );
        assert_eq!(
            user_actionable.into_data(),
            serde_json::json!({
                "code": "source_not_found",
                "title": "Source Not Found",
                "stage": "resolve_source",
                "httpStatus": 404,
                "retryable": false,
                "support": {
                    "kind": "none",
                    "reason": "user_actionable",
                },
                "summary": "The referenced source key does not exist or is not visible in the active org.",
                "tryNext": ["run onequery source list"],
                "reportCommand": serde_json::Value::Null,
            })
        );
    }
}
