use onequery_cli_core::error::CliError;
use onequery_cli_core::error::CliValidationIssue;
use onequery_cli_core::error::ErrorStage;
use reqwest::StatusCode;

use crate::transport::client::ApiClientBuildFailure;
use crate::transport::http::ApiFailure;
use crate::transport::http::connect_title;

pub(crate) struct ApiErrorPresentation<'a> {
    pub(crate) command: &'a str,
    pub(crate) title: &'a str,
    pub(crate) transport_why_prefix: &'a str,
    pub(crate) decode_why_prefix: &'a str,
    pub(crate) fallback_try_next: Vec<String>,
    pub(crate) unauthorized_try_next: Option<Vec<String>>,
}

pub(crate) fn present_api_failure(
    failure: ApiFailure,
    presentation: ApiErrorPresentation<'_>,
) -> CliError {
    let ApiErrorPresentation {
        command,
        title,
        transport_why_prefix,
        decode_why_prefix,
        fallback_try_next,
        unauthorized_try_next,
    } = presentation;

    match failure {
        ApiFailure::Problem(problem) => {
            let title = problem
                .title
                .clone()
                .or_else(|| problem.connect_code.map(connect_title))
                .or_else(|| problem.code.as_deref().map(humanize_error_code))
                .or_else(|| problem.status.map(|status| format!("{title} ({status})")))
                .unwrap_or_else(|| title.to_owned());
            let why = problem
                .detail
                .clone()
                .unwrap_or_else(|| fallback_problem_why(&problem, title.as_str()));
            let hint = problem.hint.clone();
            let try_next = if problem.is_auth_error() {
                unauthorized_try_next.unwrap_or_else(|| {
                    hint.clone()
                        .map_or_else(|| fallback_try_next.clone(), |value| vec![value])
                })
            } else {
                hint.clone()
                    .map_or_else(|| fallback_try_next.clone(), |value| vec![value])
            };

            CliError::new(title, command, problem.stage, why, try_next)
                .with_hint(hint)
                .with_code(problem.code)
                .with_status(problem.status.map(|status| status.as_u16()))
                .with_retryable(problem.retryable)
                .with_retry_after_ms(problem.retry_after_ms)
                .with_validation_issues(
                    problem
                        .validation_issues
                        .iter()
                        .map(|issue| CliValidationIssue {
                            field: issue.field.clone(),
                            message: issue.message.clone(),
                            code: issue.code.clone(),
                        })
                        .collect(),
                )
                .with_request_id(problem.request_id)
        }
        ApiFailure::Transport(transport) => CliError::new(
            title,
            command,
            transport.stage,
            format!("{transport_why_prefix}: {}", transport.message),
            fallback_try_next,
        )
        .with_code(Some("transport_error".to_owned()))
        .with_retryable(transport.retryable),
        ApiFailure::Decode(decode) => CliError::new(
            title,
            command,
            decode.stage,
            format!("{decode_why_prefix}: {}", decode.message),
            fallback_try_next,
        )
        .with_code(Some("decode_error".to_owned()))
        .with_request_id(decode.request_id),
    }
}

pub(crate) fn present_api_client_build_failure(
    failure: ApiClientBuildFailure,
    command: &str,
) -> CliError {
    match failure {
        ApiClientBuildFailure::InvalidBaseUrl { base_url, message } => CliError::new(
            "invalid base URL",
            command.to_owned(),
            ErrorStage::LoadConfig,
            format!("{message}: {base_url}"),
            vec!["rebuild onequery with a valid default base URL".to_owned()],
        ),
        ApiClientBuildFailure::InvalidAuthToken { message } => CliError::new(
            "invalid auth token",
            command.to_owned(),
            ErrorStage::Auth,
            message,
            vec![
                "onequery auth logout".to_owned(),
                "onequery auth login".to_owned(),
            ],
        ),
        ApiClientBuildFailure::InvalidRequestId { message } => CliError::new(
            "invalid request ID",
            command.to_owned(),
            ErrorStage::Http,
            message,
            vec![
                "pass --request-id with visible ASCII characters only".to_owned(),
                "retry command without --request-id".to_owned(),
            ],
        ),
        ApiClientBuildFailure::HttpClient { message } => CliError::new(
            "failed to create HTTP client",
            command.to_owned(),
            ErrorStage::Http,
            message,
            vec!["retry command".to_owned()],
        ),
    }
}

fn fallback_http_why(status: StatusCode, body: &str) -> String {
    if body.trim().is_empty() {
        format!("server returned {status}")
    } else {
        format!("server returned {status}: {}", body.trim())
    }
}

fn fallback_problem_why(
    problem: &crate::transport::http::ApiProblem,
    default_title: &str,
) -> String {
    if let Some(status) = problem.status {
        return fallback_http_why(status, problem.raw_body.as_str());
    }

    if let Some(code) = problem.code.as_deref() {
        return format!("server returned {}", humanize_error_code(code));
    }

    default_title.to_owned()
}

fn humanize_error_code(raw: &str) -> String {
    if raw.contains(' ') {
        return raw.to_owned();
    }

    raw.split(['_', '-'])
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use connectrpc::ErrorCode;
    use insta::assert_snapshot;
    use onequery_cli_core::error::CliError;
    use onequery_cli_core::error::ErrorStage;
    use pretty_assertions::assert_eq;
    use reqwest::StatusCode;
    use serde_json::Value;
    use serde_json::json;

    use crate::output::EffectiveOutputMode;
    use crate::output::render_error;
    use crate::transport::client::ApiClientBuildFailure;
    use crate::transport::http::ApiFailure;
    use crate::transport::http::ApiProblem;
    use crate::transport::http::ApiValidationIssue;
    use crate::transport::http::DecodeFailure;
    use crate::transport::http::TransportFailure;
    use crate::transport::http::TransportFailureKind;

    use super::ApiErrorPresentation;
    use super::humanize_error_code;
    use super::present_api_client_build_failure;
    use super::present_api_failure;

    fn error_summary(error: &CliError) -> Value {
        json!({
            "title": error.title,
            "command": error.command,
            "stage": error.stage.as_str(),
            "why": error.why,
            "tryNext": error.try_next,
            "requestId": error.request_id,
            "hint": error.hint,
            "code": error.code,
            "status": error.status,
            "retryable": error.retryable,
            "retryAfterMs": error.retry_after_ms,
            "validationIssues": error.validation_issues.iter().map(|issue| {
                json!({
                    "field": issue.field,
                    "message": issue.message,
                    "code": issue.code,
                })
            }).collect::<Vec<_>>(),
        })
    }

    #[test]
    fn humanize_error_code_replaces_separators() {
        assert_eq!(
            [
                humanize_error_code("source_not_found"),
                humanize_error_code("query-failed"),
                humanize_error_code("forbidden"),
            ],
            ["source not found", "query failed", "forbidden"]
        );
    }

    #[test]
    fn present_api_client_build_failure_reports_invalid_base_url() {
        let error = present_api_client_build_failure(
            ApiClientBuildFailure::InvalidBaseUrl {
                base_url: "invalid-url".to_owned(),
                message: "relative URL without a base".to_owned(),
            },
            "onequery org list",
        );

        assert_eq!(
            error_summary(&error),
            json!({
                "title": "invalid base URL",
                "command": "onequery org list",
                "stage": "load_config",
                "why": "relative URL without a base: invalid-url",
                "tryNext": ["rebuild onequery with a valid default base URL"],
                "requestId": null,
                "hint": null,
                "code": null,
                "status": null,
                "retryable": false,
                "retryAfterMs": null,
                "validationIssues": [],
            })
        );
    }

    #[test]
    fn present_api_client_build_failure_reports_invalid_auth_token() {
        let error = present_api_client_build_failure(
            ApiClientBuildFailure::InvalidAuthToken {
                message: "invalid bearer token".to_owned(),
            },
            "onequery auth whoami",
        );

        assert_eq!(
            error_summary(&error),
            json!({
                "title": "invalid auth token",
                "command": "onequery auth whoami",
                "stage": "auth",
                "why": "invalid bearer token",
                "tryNext": ["onequery auth logout", "onequery auth login"],
                "requestId": null,
                "hint": null,
                "code": null,
                "status": null,
                "retryable": false,
                "retryAfterMs": null,
                "validationIssues": [],
            })
        );
    }

    #[test]
    fn present_api_client_build_failure_reports_invalid_request_id() {
        let error = present_api_client_build_failure(
            ApiClientBuildFailure::InvalidRequestId {
                message: "failed to parse header value".to_owned(),
            },
            "onequery org list",
        );

        assert_eq!(
            error_summary(&error),
            json!({
                "title": "invalid request ID",
                "command": "onequery org list",
                "stage": "http",
                "why": "failed to parse header value",
                "tryNext": [
                    "pass --request-id with visible ASCII characters only",
                    "retry command without --request-id"
                ],
                "requestId": null,
                "hint": null,
                "code": null,
                "status": null,
                "retryable": false,
                "retryAfterMs": null,
                "validationIssues": [],
            })
        );
    }

    #[test]
    fn present_api_client_build_failure_reports_http_client_creation_failures() {
        let error = present_api_client_build_failure(
            ApiClientBuildFailure::HttpClient {
                message: "tls backend initialization failed".to_owned(),
            },
            "onequery query exec --source warehouse --sql \"select 1\"",
        );

        assert_eq!(
            error_summary(&error),
            json!({
                "title": "failed to create HTTP client",
                "command": "onequery query exec --source warehouse --sql \"select 1\"",
                "stage": "http",
                "why": "tls backend initialization failed",
                "tryNext": ["retry command"],
                "requestId": null,
                "hint": null,
                "code": null,
                "status": null,
                "retryable": false,
                "retryAfterMs": null,
                "validationIssues": [],
            })
        );
    }

    #[test]
    fn present_api_failure_prefers_api_problem_fields() {
        let error = present_api_failure(
            ApiFailure::Problem(ApiProblem {
                connect_code: None,
                status: Some(StatusCode::NOT_FOUND),
                title: Some("Source Not Found".to_owned()),
                detail: Some("no source named \"warehouse\" exists".to_owned()),
                code: Some("source_not_found".to_owned()),
                retryable: false,
                retry_after_ms: None,
                stage: ErrorStage::ResolveSource,
                hint: Some("run `onequery source list`".to_owned()),
                request_id: Some("req_123".to_owned()),
                validation_issues: Vec::new(),
                raw_body: String::new(),
            }),
            ApiErrorPresentation {
                command: "onequery source show warehouse",
                title: "source show failed",
                transport_why_prefix: "failed to reach source show endpoint",
                decode_why_prefix: "failed to decode source show response",
                fallback_try_next: vec!["retry onequery source show warehouse".to_owned()],
                unauthorized_try_next: None,
            },
        );

        assert_eq!(
            error_summary(&error),
            json!({
                "title": "Source Not Found",
                "command": "onequery source show warehouse",
                "stage": "resolve_source",
                "why": "no source named \"warehouse\" exists",
                "tryNext": ["run `onequery source list`"],
                "requestId": "req_123",
                "hint": "run `onequery source list`",
                "code": "source_not_found",
                "status": 404,
                "retryable": false,
                "retryAfterMs": null,
                "validationIssues": [],
            })
        );
    }

    #[test]
    fn present_api_failure_uses_connect_code_when_status_is_absent() {
        let error = present_api_failure(
            ApiFailure::Problem(ApiProblem {
                connect_code: Some(ErrorCode::Unauthenticated),
                status: None,
                title: None,
                detail: Some("stored credentials are no longer authorized".to_owned()),
                code: Some("unauthenticated".to_owned()),
                retryable: false,
                retry_after_ms: None,
                stage: ErrorStage::Auth,
                hint: Some("login via the OneQuery web app and retry".to_owned()),
                request_id: Some("req_connect_auth".to_owned()),
                validation_issues: Vec::new(),
                raw_body: String::new(),
            }),
            ApiErrorPresentation {
                command: "onequery query exec --source warehouse --sql \"select 1\"",
                title: "query failed",
                transport_why_prefix: "failed to reach query endpoint",
                decode_why_prefix: "failed to decode query response",
                fallback_try_next: vec!["retry onequery query exec".to_owned()],
                unauthorized_try_next: Some(vec!["onequery auth login".to_owned()]),
            },
        );

        assert_eq!(
            error_summary(&error),
            json!({
                "title": "Not authenticated",
                "command": "onequery query exec --source warehouse --sql \"select 1\"",
                "stage": "auth",
                "why": "stored credentials are no longer authorized",
                "tryNext": ["onequery auth login"],
                "requestId": "req_connect_auth",
                "hint": "login via the OneQuery web app and retry",
                "code": "unauthenticated",
                "status": null,
                "retryable": false,
                "retryAfterMs": null,
                "validationIssues": [],
            })
        );
    }

    #[test]
    fn present_api_failure_uses_connect_codes_for_reauth_guidance_without_status() {
        let error = present_api_failure(
            ApiFailure::Problem(ApiProblem {
                connect_code: Some(connectrpc::ErrorCode::Unauthenticated),
                status: None,
                title: None,
                detail: Some("stored credentials are no longer authorized".to_owned()),
                code: Some("unauthenticated".to_owned()),
                retryable: false,
                retry_after_ms: None,
                stage: ErrorStage::Auth,
                hint: Some("login via the OneQuery web app and retry".to_owned()),
                request_id: Some("req_connect_reauth".to_owned()),
                validation_issues: Vec::new(),
                raw_body: String::new(),
            }),
            ApiErrorPresentation {
                command: "onequery query exec --source warehouse --sql \"select 1\"",
                title: "query failed",
                transport_why_prefix: "failed to reach query endpoint",
                decode_why_prefix: "failed to decode query response",
                fallback_try_next: vec![
                    "retry onequery query exec --source warehouse --sql \"select 1\"".to_owned(),
                ],
                unauthorized_try_next: Some(vec!["onequery auth login".to_owned()]),
            },
        );

        assert_eq!(
            error_summary(&error),
            json!({
                "title": "Not authenticated",
                "command": "onequery query exec --source warehouse --sql \"select 1\"",
                "stage": "auth",
                "why": "stored credentials are no longer authorized",
                "tryNext": ["onequery auth login"],
                "requestId": "req_connect_reauth",
                "hint": "login via the OneQuery web app and retry",
                "code": "unauthenticated",
                "status": null,
                "retryable": false,
                "retryAfterMs": null,
                "validationIssues": [],
            })
        );
    }

    #[test]
    fn present_api_failure_falls_back_for_decode_failures() {
        let error = present_api_failure(
            ApiFailure::Decode(DecodeFailure {
                stage: ErrorStage::ExecuteQuery,
                message: "expected value at line 1 column 1".to_owned(),
                request_id: Some("req_fallback".to_owned()),
            }),
            ApiErrorPresentation {
                command: "onequery query exec --source warehouse --sql \"select 1\"",
                title: "query failed",
                transport_why_prefix: "failed to reach query endpoint",
                decode_why_prefix: "failed to decode query response",
                fallback_try_next: vec![
                    "retry onequery query exec --source warehouse --sql \"select 1\"".to_owned(),
                ],
                unauthorized_try_next: None,
            },
        );

        assert_eq!(
            error_summary(&error),
            json!({
                "title": "query failed",
                "command": "onequery query exec --source warehouse --sql \"select 1\"",
                "stage": "execute_query",
                "why": "failed to decode query response: expected value at line 1 column 1",
                "tryNext": ["retry onequery query exec --source warehouse --sql \"select 1\""],
                "requestId": "req_fallback",
                "hint": null,
                "code": "decode_error",
                "status": null,
                "retryable": false,
                "retryAfterMs": null,
                "validationIssues": [],
            })
        );
    }

    #[test]
    fn rendered_problem_error_snapshot() {
        let error = present_api_failure(
            ApiFailure::Problem(ApiProblem {
                connect_code: None,
                status: Some(StatusCode::NOT_FOUND),
                title: Some("Source Not Found".to_owned()),
                detail: Some("no source named \"warehouse\" exists".to_owned()),
                code: Some("source_not_found".to_owned()),
                retryable: false,
                retry_after_ms: None,
                stage: ErrorStage::ResolveSource,
                hint: Some("run `onequery source list`".to_owned()),
                request_id: Some("req_problem".to_owned()),
                validation_issues: Vec::new(),
                raw_body: String::new(),
            }),
            ApiErrorPresentation {
                command: "onequery source show warehouse",
                title: "source show failed",
                transport_why_prefix: "failed to reach source show endpoint",
                decode_why_prefix: "failed to decode source show response",
                fallback_try_next: vec!["retry onequery source show warehouse".to_owned()],
                unauthorized_try_next: None,
            },
        );

        assert_snapshot!(render_error(&error, EffectiveOutputMode::Text));
    }

    #[test]
    fn rendered_transport_error_snapshot() {
        let error = present_api_failure(
            ApiFailure::Transport(TransportFailure {
                kind: TransportFailureKind::SendRequest,
                stage: ErrorStage::Http,
                message: "operation timed out".to_owned(),
                retryable: true,
            }),
            ApiErrorPresentation {
                command: "onequery org list",
                title: "org list failed",
                transport_why_prefix: "failed to reach org list endpoint",
                decode_why_prefix: "failed to decode org list response",
                fallback_try_next: vec!["retry onequery org list".to_owned()],
                unauthorized_try_next: None,
            },
        );

        assert_snapshot!(render_error(&error, EffectiveOutputMode::Text));
    }

    #[test]
    fn rendered_decode_error_snapshot() {
        let error = present_api_failure(
            ApiFailure::Decode(DecodeFailure {
                stage: ErrorStage::ExecuteQuery,
                message: "expected value at line 1 column 1".to_owned(),
                request_id: Some("req_decode".to_owned()),
            }),
            ApiErrorPresentation {
                command: "onequery query exec --source warehouse --sql \"select 1\"",
                title: "query failed",
                transport_why_prefix: "failed to reach query endpoint",
                decode_why_prefix: "failed to decode query response",
                fallback_try_next: vec![
                    "retry onequery query exec --source warehouse --sql \"select 1\"".to_owned(),
                ],
                unauthorized_try_next: None,
            },
        );

        assert_snapshot!(render_error(&error, EffectiveOutputMode::Text));
    }

    #[test]
    fn present_api_failure_overrides_unauthorized_try_next_for_reauth_guidance() {
        let error = present_api_failure(
            ApiFailure::Problem(ApiProblem {
                connect_code: None,
                status: Some(StatusCode::UNAUTHORIZED),
                title: Some("Not Logged In".to_owned()),
                detail: Some("stored credentials are no longer authorized".to_owned()),
                code: Some("not_logged_in".to_owned()),
                retryable: false,
                retry_after_ms: None,
                stage: ErrorStage::Auth,
                hint: Some("login via the OneQuery web app and retry".to_owned()),
                request_id: Some("req_reauth".to_owned()),
                validation_issues: Vec::new(),
                raw_body: String::new(),
            }),
            ApiErrorPresentation {
                command: "onequery query exec --source warehouse --sql \"select 1\"",
                title: "query failed",
                transport_why_prefix: "failed to reach query endpoint",
                decode_why_prefix: "failed to decode query response",
                fallback_try_next: vec![
                    "retry onequery query exec --source warehouse --sql \"select 1\"".to_owned(),
                ],
                unauthorized_try_next: Some(vec!["onequery auth login".to_owned()]),
            },
        );

        assert_eq!(
            error_summary(&error),
            json!({
                "title": "Not Logged In",
                "command": "onequery query exec --source warehouse --sql \"select 1\"",
                "stage": "auth",
                "why": "stored credentials are no longer authorized",
                "tryNext": ["onequery auth login"],
                "requestId": "req_reauth",
                "hint": "login via the OneQuery web app and retry",
                "code": "not_logged_in",
                "status": 401,
                "retryable": false,
                "retryAfterMs": null,
                "validationIssues": [],
            })
        );
    }

    #[test]
    fn rendered_unauthorized_problem_guides_query_reauth_snapshot() {
        let error = present_api_failure(
            ApiFailure::Problem(ApiProblem {
                connect_code: None,
                status: Some(StatusCode::UNAUTHORIZED),
                title: Some("Not Logged In".to_owned()),
                detail: Some("stored credentials are no longer authorized".to_owned()),
                code: Some("not_logged_in".to_owned()),
                retryable: false,
                retry_after_ms: None,
                stage: ErrorStage::Auth,
                hint: Some("login via the OneQuery web app and retry".to_owned()),
                request_id: Some("req_query_auth".to_owned()),
                validation_issues: Vec::new(),
                raw_body: String::new(),
            }),
            ApiErrorPresentation {
                command: "onequery query exec --source warehouse --sql \"select 1\"",
                title: "query failed",
                transport_why_prefix: "failed to reach query endpoint",
                decode_why_prefix: "failed to decode query response",
                fallback_try_next: vec![
                    "retry onequery query exec --source warehouse --sql \"select 1\"".to_owned(),
                ],
                unauthorized_try_next: Some(vec!["onequery auth login".to_owned()]),
            },
        );

        assert_snapshot!(render_error(&error, EffectiveOutputMode::Text));
    }

    #[test]
    fn rendered_unauthorized_problem_guides_org_reauth_snapshot() {
        let error = present_api_failure(
            ApiFailure::Problem(ApiProblem {
                connect_code: None,
                status: Some(StatusCode::FORBIDDEN),
                title: Some("Forbidden".to_owned()),
                detail: Some("this account can no longer access the org list".to_owned()),
                code: Some("forbidden".to_owned()),
                retryable: false,
                retry_after_ms: None,
                stage: ErrorStage::Auth,
                hint: Some("refresh your session and retry".to_owned()),
                request_id: Some("req_org_auth".to_owned()),
                validation_issues: Vec::new(),
                raw_body: String::new(),
            }),
            ApiErrorPresentation {
                command: "onequery org list",
                title: "org list failed",
                transport_why_prefix: "failed to reach org list endpoint",
                decode_why_prefix: "failed to decode org list response",
                fallback_try_next: vec![
                    "run onequery auth login".to_owned(),
                    "retry onequery org list".to_owned(),
                ],
                unauthorized_try_next: Some(vec!["onequery auth login".to_owned()]),
            },
        );

        assert_snapshot!(render_error(&error, EffectiveOutputMode::Text));
    }

    #[test]
    fn rendered_unauthorized_problem_guides_source_reauth_snapshot() {
        let error = present_api_failure(
            ApiFailure::Problem(ApiProblem {
                connect_code: None,
                status: Some(StatusCode::UNAUTHORIZED),
                title: Some("Not Logged In".to_owned()),
                detail: Some("stored credentials are no longer authorized".to_owned()),
                code: Some("not_logged_in".to_owned()),
                retryable: false,
                retry_after_ms: None,
                stage: ErrorStage::Auth,
                hint: Some("login via the OneQuery web app and retry".to_owned()),
                request_id: Some("req_source_auth".to_owned()),
                validation_issues: Vec::new(),
                raw_body: String::new(),
            }),
            ApiErrorPresentation {
                command: "onequery source show warehouse",
                title: "source show failed",
                transport_why_prefix: "failed to reach source show endpoint",
                decode_why_prefix: "failed to decode source show response",
                fallback_try_next: vec![
                    "onequery source list".to_owned(),
                    "retry onequery source show warehouse".to_owned(),
                ],
                unauthorized_try_next: Some(vec!["onequery auth login".to_owned()]),
            },
        );

        assert_snapshot!(render_error(&error, EffectiveOutputMode::Text));
    }

    #[test]
    fn rendered_validation_problem_includes_structured_issues_snapshot() {
        let error = present_api_failure(
            ApiFailure::Problem(ApiProblem {
                connect_code: None,
                status: Some(StatusCode::BAD_REQUEST),
                title: Some("Invalid Request".to_owned()),
                detail: Some("request body contains invalid fields".to_owned()),
                code: Some("invalid_request".to_owned()),
                retryable: false,
                retry_after_ms: None,
                stage: ErrorStage::ExecuteQuery,
                hint: Some("correct the request and retry".to_owned()),
                request_id: Some("req_validation".to_owned()),
                validation_issues: vec![
                    ApiValidationIssue {
                        field: "source".to_owned(),
                        message: "source is required".to_owned(),
                        code: "too_small".to_owned(),
                    },
                    ApiValidationIssue {
                        field: "sql".to_owned(),
                        message: "query must be read-only".to_owned(),
                        code: "custom".to_owned(),
                    },
                ],
                raw_body: String::new(),
            }),
            ApiErrorPresentation {
                command: "onequery query exec --source '' --sql \"delete from events\"",
                title: "query failed",
                transport_why_prefix: "failed to reach query endpoint",
                decode_why_prefix: "failed to decode query response",
                fallback_try_next: vec!["retry onequery query".to_owned()],
                unauthorized_try_next: None,
            },
        );

        assert_snapshot!(render_error(&error, EffectiveOutputMode::Text));
    }
}
