use clap::ValueEnum;
use onequery_cli_core::error::CliError;

use crate::diagnostics::TEXT_REPORT_COMMAND;

#[derive(Debug, Clone, Copy, Eq, PartialEq, ValueEnum)]
#[value(rename_all = "snake_case")]
pub(crate) enum ExplainCode {
    Forbidden,
    InvalidRequest,
    LoginDenied,
    LoginRateLimited,
    LoginSessionExpired,
    NotLoggedIn,
    OrgNotFound,
    TransportError,
    DecodeError,
    QueryExecutionFailed,
    QueryExecutionTimedOut,
    QueryExecutionUnavailable,
    QueryPreparationFailed,
    QueryRejected,
    SourceApiDescribeFailed,
    SourceApiExecutionFailed,
    SourceApiExecutionTimedOut,
    SourceApiForbidden,
    SourceApiPreparationFailed,
    SourceApiExecutionStateInvalid,
    SourceApiSourceUnavailable,
    SourceNotFound,
    SourceNameConflict,
    SourceNotQueryable,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) enum ExplainSupportKind {
    None,
    Retry,
    ReportIfReproducible,
    ReportRecommended,
}

impl ExplainSupportKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Retry => "retry",
            Self::ReportIfReproducible => "report_if_reproducible",
            Self::ReportRecommended => "report_recommended",
        }
    }

    pub(crate) fn report_label(self) -> Option<&'static str> {
        match self {
            Self::ReportIfReproducible => Some("Report if reproducible"),
            Self::ReportRecommended => Some("Report"),
            Self::None | Self::Retry => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) struct Explanation {
    pub(crate) code: ExplainCode,
    pub(crate) title: &'static str,
    pub(crate) stages: &'static [&'static str],
    pub(crate) http_status: Option<u16>,
    pub(crate) retryable: bool,
    pub(crate) support_kind: ExplainSupportKind,
    pub(crate) support_reason: &'static str,
    pub(crate) summary: &'static str,
    pub(crate) try_next: &'static [&'static str],
}

const AUTH_STAGE: &[&str] = &["auth"];
const AUTH_OR_ORG_OR_SOURCE_OR_EXECUTE_STAGES: &[&str] = &[
    "auth",
    "resolve_org",
    "resolve_source",
    "execute_query",
    "source_api_describe",
    "source_api_prepare",
    "source_api_execute",
];
const EXECUTE_QUERY_STAGE: &[&str] = &["execute_query"];
const INVALID_REQUEST_STAGES: &[&str] = &[
    "auth",
    "resolve_org",
    "resolve_source",
    "read_query_input",
    "execute_query",
    "source_api_execute",
];
const RESOLVE_ORG_STAGE: &[&str] = &["resolve_org"];
const RESOLVE_SOURCE_STAGE: &[&str] = &["resolve_source"];
const SOURCE_API_DESCRIBE_STAGE: &[&str] = &["source_api_describe"];
const SOURCE_API_PREPARE_STAGE: &[&str] = &["source_api_prepare"];
const SOURCE_API_EXECUTE_STAGE: &[&str] = &["source_api_execute"];

impl ExplainCode {
    pub(crate) fn from_problem_reason(reason: &str) -> Option<Self> {
        match reason {
            "FORBIDDEN" => Some(Self::Forbidden),
            "AUTH_REQUEST_INVALID"
            | "SOURCE_REQUEST_INVALID"
            | "ORG_REQUEST_INVALID"
            | "READ_QUERY_INPUT_INVALID"
            | "EXECUTE_QUERY_REQUEST_INVALID"
            | "SOURCE_API_REQUEST_INVALID" => Some(Self::InvalidRequest),
            "LOGIN_DENIED" => Some(Self::LoginDenied),
            "LOGIN_RATE_LIMITED" => Some(Self::LoginRateLimited),
            "LOGIN_SESSION_EXPIRED" => Some(Self::LoginSessionExpired),
            "NOT_LOGGED_IN" => Some(Self::NotLoggedIn),
            "ORG_NOT_FOUND" => Some(Self::OrgNotFound),
            "QUERY_EXECUTION_FAILED" => Some(Self::QueryExecutionFailed),
            "QUERY_EXECUTION_TIMED_OUT" => Some(Self::QueryExecutionTimedOut),
            "QUERY_EXECUTION_UNAVAILABLE" => Some(Self::QueryExecutionUnavailable),
            "QUERY_PREPARATION_FAILED" => Some(Self::QueryPreparationFailed),
            "QUERY_REJECTED" => Some(Self::QueryRejected),
            "SOURCE_API_DESCRIBE_FAILED" => Some(Self::SourceApiDescribeFailed),
            "SOURCE_API_EXECUTION_FAILED" => Some(Self::SourceApiExecutionFailed),
            "SOURCE_API_EXECUTION_TIMED_OUT" => Some(Self::SourceApiExecutionTimedOut),
            "SOURCE_API_FORBIDDEN" => Some(Self::SourceApiForbidden),
            "SOURCE_API_PREPARATION_FAILED" => Some(Self::SourceApiPreparationFailed),
            "SOURCE_API_EXECUTION_STATE_INVALID" => Some(Self::SourceApiExecutionStateInvalid),
            "SOURCE_API_SOURCE_UNAVAILABLE" => Some(Self::SourceApiSourceUnavailable),
            "SOURCE_NOT_FOUND" => Some(Self::SourceNotFound),
            "SOURCE_NAME_CONFLICT" => Some(Self::SourceNameConflict),
            "SOURCE_NOT_QUERYABLE" => Some(Self::SourceNotQueryable),
            _ => None,
        }
    }

    pub(crate) fn slug(self) -> &'static str {
        match self {
            Self::Forbidden => "forbidden",
            Self::InvalidRequest => "invalid_request",
            Self::LoginDenied => "login_denied",
            Self::LoginRateLimited => "login_rate_limited",
            Self::LoginSessionExpired => "login_session_expired",
            Self::NotLoggedIn => "not_logged_in",
            Self::OrgNotFound => "org_not_found",
            Self::TransportError => "transport_error",
            Self::DecodeError => "decode_error",
            Self::QueryExecutionFailed => "query_execution_failed",
            Self::QueryExecutionTimedOut => "query_execution_timed_out",
            Self::QueryExecutionUnavailable => "query_execution_unavailable",
            Self::QueryPreparationFailed => "query_preparation_failed",
            Self::QueryRejected => "query_rejected",
            Self::SourceApiDescribeFailed => "source_api_describe_failed",
            Self::SourceApiExecutionFailed => "source_api_execution_failed",
            Self::SourceApiExecutionTimedOut => "source_api_execution_timed_out",
            Self::SourceApiForbidden => "source_api_forbidden",
            Self::SourceApiPreparationFailed => "source_api_preparation_failed",
            Self::SourceApiExecutionStateInvalid => "source_api_execution_state_invalid",
            Self::SourceApiSourceUnavailable => "source_api_source_unavailable",
            Self::SourceNotFound => "source_not_found",
            Self::SourceNameConflict => "source_name_conflict",
            Self::SourceNotQueryable => "source_not_queryable",
        }
    }

    pub(crate) fn command(self) -> String {
        format!("onequery explain {}", self.slug())
    }

    pub(crate) fn explanation(self) -> Explanation {
        // Comment: keep the explain catalog local to the Rust CLI so clap can validate codes
        // offline and `onequery explain` stays usable even when config/runtime loading is broken.
        match self {
            Self::Forbidden => Explanation {
                code: self,
                title: "Forbidden",
                stages: RESOLVE_ORG_STAGE,
                http_status: Some(403),
                retryable: false,
                support_kind: ExplainSupportKind::None,
                support_reason: "user_actionable",
                summary: "The request reached the CLI API, but the current org or account is not allowed to perform this operation.",
                try_next: &["verify org membership and retry"],
            },
            Self::InvalidRequest => Explanation {
                code: self,
                title: "Invalid Request",
                stages: INVALID_REQUEST_STAGES,
                http_status: Some(422),
                retryable: false,
                support_kind: ExplainSupportKind::None,
                support_reason: "user_actionable",
                summary: "The CLI API rejected the request because one or more input fields were invalid for this command stage.",
                try_next: &["correct the request fields and retry"],
            },
            Self::LoginDenied => Explanation {
                code: self,
                title: "Login Denied",
                stages: AUTH_STAGE,
                http_status: Some(403),
                retryable: false,
                support_kind: ExplainSupportKind::None,
                support_reason: "user_actionable",
                summary: "The browser-based login flow completed, but the server refused to create a CLI session.",
                try_next: &["run onequery auth login again"],
            },
            Self::LoginRateLimited => Explanation {
                code: self,
                title: "Login Rate Limited",
                stages: AUTH_STAGE,
                http_status: Some(429),
                retryable: true,
                support_kind: ExplainSupportKind::Retry,
                support_reason: "transient",
                summary: "The login flow is being throttled. Retrying after a short delay is the normal recovery path.",
                try_next: &["wait briefly, then retry onequery auth login"],
            },
            Self::LoginSessionExpired => Explanation {
                code: self,
                title: "Login Session Expired",
                stages: AUTH_STAGE,
                http_status: Some(410),
                retryable: false,
                support_kind: ExplainSupportKind::None,
                support_reason: "user_actionable",
                summary: "The login attempt expired before the CLI could exchange it for a session.",
                try_next: &["run onequery auth login again"],
            },
            Self::NotLoggedIn => Explanation {
                code: self,
                title: "Not Logged In",
                stages: AUTH_STAGE,
                http_status: Some(401),
                retryable: false,
                support_kind: ExplainSupportKind::None,
                support_reason: "user_actionable",
                summary: "The command requires an authenticated CLI session, but no usable session was available.",
                try_next: &["run onequery auth login"],
            },
            Self::OrgNotFound => Explanation {
                code: self,
                title: "Organization Not Found",
                stages: RESOLVE_ORG_STAGE,
                http_status: Some(404),
                retryable: false,
                support_kind: ExplainSupportKind::None,
                support_reason: "user_actionable",
                summary: "The selected org slug does not exist or is not visible to the current session.",
                try_next: &["run onequery org list"],
            },
            Self::TransportError => Explanation {
                code: self,
                title: "Transport Error",
                stages: AUTH_OR_ORG_OR_SOURCE_OR_EXECUTE_STAGES,
                http_status: None,
                retryable: true,
                support_kind: ExplainSupportKind::Retry,
                support_reason: "transient",
                summary: "The CLI could not reach the API or did not receive a complete response over the network.",
                try_next: &["retry the same command after checking network reachability"],
            },
            Self::DecodeError => Explanation {
                code: self,
                title: "Decode Error",
                stages: AUTH_OR_ORG_OR_SOURCE_OR_EXECUTE_STAGES,
                http_status: None,
                retryable: false,
                support_kind: ExplainSupportKind::ReportRecommended,
                support_reason: "unexpected_response_decode_failure",
                summary: "The CLI received a response from the API, but the payload did not match the expected schema.",
                try_next: &[
                    "retry the failing command to confirm the response shape is consistently invalid",
                ],
            },
            Self::QueryExecutionFailed => Explanation {
                code: self,
                title: "Query Execution Failed",
                stages: EXECUTE_QUERY_STAGE,
                http_status: Some(500),
                retryable: false,
                support_kind: ExplainSupportKind::ReportIfReproducible,
                support_reason: "query_execution_failure",
                summary: "The query reached execution, but the backing source or service failed unexpectedly.",
                try_next: &["retry onequery query exec --source <source> --sql \"select ...\""],
            },
            Self::QueryExecutionTimedOut => Explanation {
                code: self,
                title: "Query Execution Timed Out",
                stages: EXECUTE_QUERY_STAGE,
                http_status: Some(504),
                retryable: true,
                support_kind: ExplainSupportKind::Retry,
                support_reason: "transient",
                summary: "The query did not finish before the server-side execution deadline expired.",
                try_next: &["retry onequery query exec --source <source> --sql \"select ...\""],
            },
            Self::QueryExecutionUnavailable => Explanation {
                code: self,
                title: "Query Execution Unavailable",
                stages: EXECUTE_QUERY_STAGE,
                http_status: Some(503),
                retryable: true,
                support_kind: ExplainSupportKind::Retry,
                support_reason: "transient",
                summary: "The query service or a required dependency was temporarily unavailable.",
                try_next: &["retry onequery query exec --source <source> --sql \"select ...\""],
            },
            Self::QueryPreparationFailed => Explanation {
                code: self,
                title: "Query Preparation Failed",
                stages: EXECUTE_QUERY_STAGE,
                http_status: Some(500),
                retryable: false,
                support_kind: ExplainSupportKind::ReportIfReproducible,
                support_reason: "query_preparation_failure",
                summary: "The query could not be prepared for execution because the source or query planner failed unexpectedly.",
                try_next: &["retry onequery query exec --source <source> --sql \"select ...\""],
            },
            Self::QueryRejected => Explanation {
                code: self,
                title: "Query Rejected",
                stages: EXECUTE_QUERY_STAGE,
                http_status: Some(400),
                retryable: false,
                support_kind: ExplainSupportKind::None,
                support_reason: "user_actionable",
                summary: "The query was understood, but policy or capability checks refused to run it.",
                try_next: &["use a single read-only SELECT query"],
            },
            Self::SourceApiDescribeFailed => Explanation {
                code: self,
                title: "Source API Describe Failed",
                stages: SOURCE_API_DESCRIBE_STAGE,
                http_status: Some(500),
                retryable: false,
                support_kind: ExplainSupportKind::ReportIfReproducible,
                support_reason: "source_api_describe_failure",
                summary: "The CLI API could not load the source API description needed to plan the request.",
                try_next: &["retry onequery api --source <source>"],
            },
            Self::SourceApiExecutionFailed => Explanation {
                code: self,
                title: "Source API Execution Failed",
                stages: SOURCE_API_EXECUTE_STAGE,
                http_status: Some(500),
                retryable: false,
                support_kind: ExplainSupportKind::ReportIfReproducible,
                support_reason: "source_api_execution_failure",
                summary: "The source API request reached execution, but the backing source or service failed unexpectedly.",
                try_next: &["retry onequery api --source <source>"],
            },
            Self::SourceApiExecutionTimedOut => Explanation {
                code: self,
                title: "Source API Execution Timed Out",
                stages: SOURCE_API_EXECUTE_STAGE,
                http_status: Some(504),
                retryable: true,
                support_kind: ExplainSupportKind::Retry,
                support_reason: "transient",
                summary: "The source API request did not complete before the execution deadline expired.",
                try_next: &["retry onequery api --source <source>"],
            },
            Self::SourceApiForbidden => Explanation {
                code: self,
                title: "Source API Forbidden",
                stages: SOURCE_API_EXECUTE_STAGE,
                http_status: Some(403),
                retryable: false,
                support_kind: ExplainSupportKind::None,
                support_reason: "user_actionable",
                summary: "The current org or source credentials are not allowed to perform this source API action.",
                try_next: &["verify source API permissions and retry"],
            },
            Self::SourceApiPreparationFailed => Explanation {
                code: self,
                title: "Source API Preparation Failed",
                stages: SOURCE_API_PREPARE_STAGE,
                http_status: Some(500),
                retryable: false,
                support_kind: ExplainSupportKind::ReportIfReproducible,
                support_reason: "source_api_preparation_failure",
                summary: "The source API request could not be prepared before execution because planning failed unexpectedly.",
                try_next: &["retry onequery api --source <source>"],
            },
            Self::SourceApiExecutionStateInvalid => Explanation {
                code: self,
                title: "Source API Execution State Invalid",
                stages: SOURCE_API_EXECUTE_STAGE,
                http_status: Some(410),
                retryable: false,
                support_kind: ExplainSupportKind::None,
                support_reason: "user_actionable",
                summary: "The source API execution state expired or is no longer valid for the requested action.",
                try_next: &["rerun onequery api to refresh source API execution state"],
            },
            Self::SourceApiSourceUnavailable => Explanation {
                code: self,
                title: "Source API Source Unavailable",
                stages: RESOLVE_SOURCE_STAGE,
                http_status: Some(410),
                retryable: false,
                support_kind: ExplainSupportKind::None,
                support_reason: "user_actionable",
                summary: "The source exists, but its credentials or provider state are not currently usable.",
                try_next: &["review source credentials in OneQuery and retry"],
            },
            Self::SourceNotFound => Explanation {
                code: self,
                title: "Source Not Found",
                stages: RESOLVE_SOURCE_STAGE,
                http_status: Some(404),
                retryable: false,
                support_kind: ExplainSupportKind::None,
                support_reason: "user_actionable",
                summary: "The referenced source key does not exist or is not visible in the active org.",
                try_next: &["run onequery source list"],
            },
            Self::SourceNameConflict => Explanation {
                code: self,
                title: "Source Name Conflict",
                stages: RESOLVE_SOURCE_STAGE,
                http_status: Some(409),
                retryable: false,
                support_kind: ExplainSupportKind::None,
                support_reason: "user_actionable",
                summary: "A source with the same name already exists in the active org.",
                try_next: &["choose a different source name and retry"],
            },
            Self::SourceNotQueryable => Explanation {
                code: self,
                title: "Source Not Queryable",
                stages: RESOLVE_SOURCE_STAGE,
                http_status: Some(400),
                retryable: false,
                support_kind: ExplainSupportKind::None,
                support_reason: "user_actionable",
                summary: "The selected source exists, but it does not support query execution.",
                try_next: &["run onequery source list and choose a source where QUERY is yes"],
            },
        }
    }
}

pub(crate) fn explain_reference_for_error(error: &CliError) -> Option<(String, String)> {
    let code = error
        .code
        .as_deref()
        .and_then(explain_code_for_error_code)?;
    let slug = code.slug().to_owned();
    Some((slug, code.command()))
}

pub(crate) fn explanation_for_error_code(code: &str) -> Option<Explanation> {
    explain_code_for_error_code(code).map(ExplainCode::explanation)
}

fn explain_code_for_error_code(code: &str) -> Option<ExplainCode> {
    local_explain_code(code).or_else(|| ExplainCode::from_problem_reason(code))
}

fn local_explain_code(code: &str) -> Option<ExplainCode> {
    match code {
        "transport_error" => Some(ExplainCode::TransportError),
        "decode_error" => Some(ExplainCode::DecodeError),
        _ => None,
    }
}

pub(crate) fn report_command_for_explanation(explanation: Explanation) -> Option<&'static str> {
    explanation
        .support_kind
        .report_label()
        .map(|_| TEXT_REPORT_COMMAND)
}

#[cfg(test)]
mod tests {
    use onequery_cli_core::error::CliError;
    use onequery_cli_core::error::ErrorStage;
    use pretty_assertions::assert_eq;

    use super::ExplainCode;
    use super::explain_reference_for_error;

    #[test]
    fn invalid_request_explanation_tracks_all_server_problem_stages() {
        let explanation = ExplainCode::InvalidRequest.explanation();

        assert_eq!(
            explanation.stages,
            &[
                "auth",
                "resolve_org",
                "resolve_source",
                "read_query_input",
                "execute_query",
                "source_api_execute"
            ]
        );
        assert_eq!(explanation.http_status, Some(422));
    }

    #[test]
    fn local_transport_and_decode_explanations_do_not_claim_fixed_http_statuses() {
        let transport = ExplainCode::TransportError.explanation();
        let decode = ExplainCode::DecodeError.explanation();

        assert_eq!(
            transport.stages,
            &[
                "auth",
                "resolve_org",
                "resolve_source",
                "execute_query",
                "source_api_describe",
                "source_api_prepare",
                "source_api_execute"
            ]
        );
        assert_eq!(transport.http_status, None);
        assert_eq!(decode.stages, transport.stages);
        assert_eq!(decode.http_status, None);
    }

    #[test]
    fn explain_reference_for_error_uses_catalog_for_known_reason() {
        let error = CliError::new(
            "source failed",
            "onequery source show warehouse",
            ErrorStage::ResolveSource,
            "no source named warehouse exists",
            vec!["run onequery source list".to_owned()],
        )
        .with_code(Some("SOURCE_NOT_FOUND".to_owned()));

        assert_eq!(
            explain_reference_for_error(&error),
            Some((
                "source_not_found".to_owned(),
                "onequery explain source_not_found".to_owned()
            ))
        );
    }

    #[test]
    fn explain_reference_for_error_keeps_local_decode_error_fallback() {
        let error = CliError::new(
            "query failed",
            "onequery query exec",
            ErrorStage::ExecuteQuery,
            "failed to decode query response",
            vec!["retry onequery query exec".to_owned()],
        )
        .with_code(Some("decode_error".to_owned()));

        assert_eq!(
            explain_reference_for_error(&error),
            Some((
                "decode_error".to_owned(),
                "onequery explain decode_error".to_owned()
            ))
        );
    }

    #[test]
    fn explain_reference_for_error_does_not_infer_unknown_problem_reasons() {
        let error = CliError::new(
            "source failed",
            "onequery source show warehouse",
            ErrorStage::ResolveSource,
            "no source named warehouse exists",
            vec!["run onequery source list".to_owned()],
        )
        .with_code(Some("SOURCE_MOVED_ELSEWHERE".to_owned()));

        assert_eq!(explain_reference_for_error(&error), None);
    }
}
