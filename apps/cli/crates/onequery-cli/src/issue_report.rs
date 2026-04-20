//! Builds pre-filled GitHub issue URLs that embed the full CLI error trace.
//!
//! Rendered alongside text error output so users can click the link and land on
//! a GitHub "new issue" form with the title and body already populated from the
//! failing command's diagnostic context.

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::CliValidationIssue;

const GITHUB_NEW_ISSUE_URL: &str = "https://github.com/wordbricks/onequery/issues/new";
const ISSUE_LABELS: &str = "bug,cli";
const CLI_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Builds a GitHub "new issue" URL whose title and body are pre-filled from the
/// given CLI error trace.
pub(crate) fn build_issue_url(error: &CliError) -> String {
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("labels", ISSUE_LABELS)
        .append_pair("title", &build_issue_title(error))
        .append_pair("body", &build_issue_body(error))
        .finish();
    format!("{GITHUB_NEW_ISSUE_URL}?{query}")
}

fn build_issue_title(error: &CliError) -> String {
    format!("[cli] {}", error.title)
}

fn build_issue_body(error: &CliError) -> String {
    let mut body = String::new();
    body.push_str(
        "<!-- This issue was pre-filled by `onequery` from the failing command.\n     Please review before submitting and add any additional context below. -->\n\n",
    );

    body.push_str("## Summary\n\n");
    body.push_str(&error.title);
    body.push_str("\n\n");

    body.push_str("## Command\n\n```\n");
    body.push_str(&error.command);
    body.push_str("\n```\n\n");

    body.push_str("## Error trace\n\n");
    append_bullet(&mut body, "Stage", &format!("`{}`", error.stage.as_str()));
    if let Some(code) = &error.code {
        append_bullet(&mut body, "Code", &format!("`{code}`"));
    }
    if let Some(status) = error.status {
        append_bullet(&mut body, "HTTP status", &format!("`{status}`"));
    }
    if let Some(request_id) = &error.request_id {
        append_bullet(&mut body, "Request ID", &format!("`{request_id}`"));
    }
    append_bullet(
        &mut body,
        "Retryable",
        if error.retryable { "yes" } else { "no" },
    );
    append_bullet(&mut body, "Why", &error.why);
    if let Some(hint) = &error.hint {
        append_bullet(&mut body, "Hint", hint);
    }

    if !error.validation_issues.is_empty() {
        body.push_str("\n### Validation\n\n");
        for issue in &error.validation_issues {
            body.push_str(&render_validation_bullet(issue));
            body.push('\n');
        }
    }

    if !error.try_next.is_empty() {
        body.push_str("\n### Suggested next steps\n\n");
        for step in &error.try_next {
            body.push_str(&format!("- {step}\n"));
        }
    }

    body.push_str("\n## Environment\n\n");
    append_bullet(&mut body, "CLI version", &format!("`{CLI_VERSION}`"));
    append_bullet(
        &mut body,
        "OS",
        "<!-- e.g. macOS 14.5, Ubuntu 22.04, Windows 11 -->",
    );

    body.push_str(
        "\n## Additional context\n\n<!-- What were you trying to do when this happened? -->\n",
    );
    body
}

fn append_bullet(body: &mut String, label: &str, value: &str) {
    body.push_str(&format!("- **{label}:** {value}\n"));
}

fn render_validation_bullet(issue: &CliValidationIssue) -> String {
    if issue.field.trim().is_empty() {
        return format!("- {} (`{}`)", issue.message, issue.code);
    }
    format!("- `{}`: {} (`{}`)", issue.field, issue.message, issue.code)
}

#[cfg(test)]
mod tests {
    use onequery_cli_core::error::CliError;
    use onequery_cli_core::error::CliValidationIssue;
    use onequery_cli_core::error::ErrorStage;
    use pretty_assertions::assert_eq;

    use super::build_issue_body;
    use super::build_issue_title;
    use super::build_issue_url;

    #[test]
    fn issue_title_prefixes_cli_tag() {
        let error = CliError::new(
            "query failed",
            "onequery query exec",
            ErrorStage::ExecuteQuery,
            "server rejected write query",
            vec![],
        );

        assert_eq!(build_issue_title(&error), "[cli] query failed");
    }

    #[test]
    fn issue_body_contains_every_populated_error_field() {
        let error = CliError::new(
            "query failed",
            "onequery query exec --source warehouse --sql \"select 1\"",
            ErrorStage::ExecuteQuery,
            "server rejected write query",
            vec!["retry with a read-only SELECT".to_owned()],
        )
        .with_code(Some("query_rejected".to_owned()))
        .with_status(Some(400))
        .with_request_id(Some("req_123".to_owned()))
        .with_hint(Some("queries must be read-only".to_owned()))
        .with_validation_issues(vec![CliValidationIssue {
            field: "sql".to_owned(),
            message: "query must be read-only".to_owned(),
            code: "custom".to_owned(),
        }]);

        let body = build_issue_body(&error);

        for expected in [
            "## Summary\n\nquery failed",
            "onequery query exec --source warehouse --sql \"select 1\"",
            "- **Stage:** `execute_query`",
            "- **Code:** `query_rejected`",
            "- **HTTP status:** `400`",
            "- **Request ID:** `req_123`",
            "- **Why:** server rejected write query",
            "- **Hint:** queries must be read-only",
            "- `sql`: query must be read-only (`custom`)",
            "- retry with a read-only SELECT",
            "## Environment",
            "- **CLI version:** `0.0.0`",
        ] {
            assert!(
                body.contains(expected),
                "expected issue body to contain {expected:?}, got:\n{body}"
            );
        }
    }

    #[test]
    fn issue_url_percent_encodes_title_and_body_into_query_parameters() {
        let error = CliError::new(
            "query failed",
            "onequery query exec",
            ErrorStage::ExecuteQuery,
            "server rejected write query",
            vec![],
        );

        let url = build_issue_url(&error);

        assert!(
            url.starts_with("https://github.com/wordbricks/onequery/issues/new?"),
            "unexpected base URL: {url}"
        );
        assert!(url.contains("labels=bug%2Ccli"), "missing labels: {url}");
        assert!(
            url.contains("title=%5Bcli%5D+query+failed"),
            "missing encoded title: {url}"
        );
        assert!(url.contains("body="), "missing body param: {url}");
    }

    #[test]
    fn issue_body_omits_optional_sections_when_absent() {
        let error = CliError::new(
            "oops",
            "onequery auth whoami",
            ErrorStage::Internal,
            "unexpected",
            vec![],
        );

        let body = build_issue_body(&error);

        assert!(!body.contains("Code:"));
        assert!(!body.contains("HTTP status:"));
        assert!(!body.contains("Request ID:"));
        assert!(!body.contains("Hint:"));
        assert!(!body.contains("### Validation"));
        assert!(!body.contains("### Suggested next steps"));
    }
}
