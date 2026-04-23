use serde_json::json;

use crate::cli::ExplainArgs;
use crate::explain::report_command_for_explanation;
use crate::output::CommandOutput;
use onequery_cli_core::error::CliError;

pub(crate) fn execute(args: &ExplainArgs) -> Result<CommandOutput, CliError> {
    let explanation = args.code.explanation();
    let mut data = serde_json::Map::new();
    data.insert("code".to_owned(), json!(explanation.code.slug()));
    data.insert("title".to_owned(), json!(explanation.title));
    if let [stage] = explanation.stages {
        data.insert("stage".to_owned(), json!(stage));
    } else {
        data.insert("stages".to_owned(), json!(explanation.stages));
    }
    data.insert("httpStatus".to_owned(), json!(explanation.http_status));
    data.insert("retryable".to_owned(), json!(explanation.retryable));
    data.insert(
        "support".to_owned(),
        json!({
            "kind": explanation.support_kind.as_str(),
            "reason": explanation.support_reason,
        }),
    );
    data.insert("summary".to_owned(), json!(explanation.summary));
    data.insert("tryNext".to_owned(), json!(explanation.try_next));
    data.insert(
        "reportCommand".to_owned(),
        json!(report_command_for_explanation(explanation)),
    );

    let mut lines = vec![
        format!("Code: {}", explanation.code.slug()),
        format!("Title: {}", explanation.title),
        if let [stage] = explanation.stages {
            format!("Stage: {stage}")
        } else {
            format!("Stages: {}", explanation.stages.join(", "))
        },
        match explanation.http_status {
            Some(status) => format!("HTTP Status: {status}"),
            None => "HTTP Status: n/a (client-side failure)".to_owned(),
        },
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
        serde_json::Value::Object(data),
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

    #[test]
    fn explain_command_renders_variable_stage_server_codes_without_fake_primary_stage() {
        let output = execute(&ExplainArgs {
            code: ExplainCode::InvalidRequest,
        })
        .expect("expected explain output");

        assert_eq!(
            output.into_data(),
            serde_json::json!({
                "code": "invalid_request",
                "title": "Invalid Request",
                "stages": ["auth", "resolve_source", "read_query_input", "execute_query"],
                "httpStatus": 422,
                "retryable": false,
                "support": {
                    "kind": "none",
                    "reason": "user_actionable",
                },
                "summary": "The CLI API rejected the request because one or more input fields were invalid for this command stage.",
                "tryNext": ["correct the request fields and retry"],
                "reportCommand": serde_json::Value::Null,
            })
        );
    }

    #[test]
    fn explain_command_renders_client_side_codes_without_fake_http_status() {
        let output = execute(&ExplainArgs {
            code: ExplainCode::TransportError,
        })
        .expect("expected explain output");

        assert_eq!(
            output.into_data(),
            serde_json::json!({
                "code": "transport_error",
                "title": "Transport Error",
                "stages": ["auth", "resolve_org", "resolve_source", "execute_query"],
                "httpStatus": serde_json::Value::Null,
                "retryable": true,
                "support": {
                    "kind": "retry",
                    "reason": "transient",
                },
                "summary": "The CLI could not reach the API or did not receive a complete response over the network.",
                "tryNext": ["retry the same command after checking network reachability"],
                "reportCommand": serde_json::Value::Null,
            })
        );
    }
}
