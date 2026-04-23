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
    MalformedJson,
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
    pub(crate) stage: &'static str,
    pub(crate) http_status: u16,
    pub(crate) retryable: bool,
    pub(crate) support_kind: ExplainSupportKind,
    pub(crate) support_reason: &'static str,
    pub(crate) summary: &'static str,
    pub(crate) try_next: &'static [&'static str],
}

impl ExplainCode {
    pub(crate) fn slug(self) -> &'static str {
        match self {
            Self::Forbidden => "forbidden",
            Self::InvalidRequest => "invalid_request",
            Self::LoginDenied => "login_denied",
            Self::LoginRateLimited => "login_rate_limited",
            Self::LoginSessionExpired => "login_session_expired",
            Self::MalformedJson => "malformed_json",
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
                stage: "resolve_org",
                http_status: 403,
                retryable: false,
                support_kind: ExplainSupportKind::None,
                support_reason: "user_actionable",
                summary: "The request reached the CLI API, but the current org or account is not allowed to perform this operation.",
                try_next: &["verify org membership and retry"],
            },
            Self::InvalidRequest => Explanation {
                code: self,
                title: "Invalid Request",
                stage: "execute_query",
                http_status: 422,
                retryable: false,
                support_kind: ExplainSupportKind::None,
                support_reason: "user_actionable",
                summary: "The CLI API rejected the request because one or more input fields were invalid for this command stage.",
                try_next: &["correct the request fields and retry"],
            },
            Self::LoginDenied => Explanation {
                code: self,
                title: "Login Denied",
                stage: "auth",
                http_status: 403,
                retryable: false,
                support_kind: ExplainSupportKind::None,
                support_reason: "user_actionable",
                summary: "The browser-based login flow completed, but the server refused to create a CLI session.",
                try_next: &["run onequery auth login again"],
            },
            Self::LoginRateLimited => Explanation {
                code: self,
                title: "Login Rate Limited",
                stage: "auth",
                http_status: 429,
                retryable: true,
                support_kind: ExplainSupportKind::Retry,
                support_reason: "transient",
                summary: "The login flow is being throttled. Retrying after a short delay is the normal recovery path.",
                try_next: &["wait briefly, then retry onequery auth login"],
            },
            Self::LoginSessionExpired => Explanation {
                code: self,
                title: "Login Session Expired",
                stage: "auth",
                http_status: 410,
                retryable: false,
                support_kind: ExplainSupportKind::None,
                support_reason: "user_actionable",
                summary: "The login attempt expired before the CLI could exchange it for a session.",
                try_next: &["run onequery auth login again"],
            },
            Self::MalformedJson => Explanation {
                code: self,
                title: "Malformed JSON",
                stage: "read_query_input",
                http_status: 400,
                retryable: false,
                support_kind: ExplainSupportKind::None,
                support_reason: "user_actionable",
                summary: "The CLI API could not parse the JSON request body for the current command.",
                try_next: &["correct the request body and retry"],
            },
            Self::NotLoggedIn => Explanation {
                code: self,
                title: "Not Logged In",
                stage: "auth",
                http_status: 401,
                retryable: false,
                support_kind: ExplainSupportKind::None,
                support_reason: "user_actionable",
                summary: "The command requires an authenticated CLI session, but no usable session was available.",
                try_next: &["run onequery auth login"],
            },
            Self::OrgNotFound => Explanation {
                code: self,
                title: "Organization Not Found",
                stage: "resolve_org",
                http_status: 404,
                retryable: false,
                support_kind: ExplainSupportKind::None,
                support_reason: "user_actionable",
                summary: "The selected org slug does not exist or is not visible to the current session.",
                try_next: &["run onequery org list"],
            },
            Self::TransportError => Explanation {
                code: self,
                title: "Transport Error",
                stage: "http",
                http_status: 503,
                retryable: true,
                support_kind: ExplainSupportKind::Retry,
                support_reason: "transient",
                summary: "The CLI could not reach the API or did not receive a complete response over the network.",
                try_next: &["retry the same command after checking network reachability"],
            },
            Self::DecodeError => Explanation {
                code: self,
                title: "Decode Error",
                stage: "execute_query",
                http_status: 502,
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
                stage: "execute_query",
                http_status: 500,
                retryable: false,
                support_kind: ExplainSupportKind::ReportIfReproducible,
                support_reason: "query_execution_failure",
                summary: "The query reached execution, but the backing source or service failed unexpectedly.",
                try_next: &["retry onequery query exec --source <source> --sql \"select ...\""],
            },
            Self::QueryExecutionTimedOut => Explanation {
                code: self,
                title: "Query Execution Timed Out",
                stage: "execute_query",
                http_status: 504,
                retryable: true,
                support_kind: ExplainSupportKind::Retry,
                support_reason: "transient",
                summary: "The query did not finish before the server-side execution deadline expired.",
                try_next: &["retry onequery query exec --source <source> --sql \"select ...\""],
            },
            Self::QueryExecutionUnavailable => Explanation {
                code: self,
                title: "Query Execution Unavailable",
                stage: "execute_query",
                http_status: 503,
                retryable: true,
                support_kind: ExplainSupportKind::Retry,
                support_reason: "transient",
                summary: "The query service or a required dependency was temporarily unavailable.",
                try_next: &["retry onequery query exec --source <source> --sql \"select ...\""],
            },
            Self::QueryPreparationFailed => Explanation {
                code: self,
                title: "Query Preparation Failed",
                stage: "execute_query",
                http_status: 500,
                retryable: false,
                support_kind: ExplainSupportKind::ReportIfReproducible,
                support_reason: "query_preparation_failure",
                summary: "The query could not be prepared for execution because the source or query planner failed unexpectedly.",
                try_next: &["retry onequery query exec --source <source> --sql \"select ...\""],
            },
            Self::QueryRejected => Explanation {
                code: self,
                title: "Query Rejected",
                stage: "execute_query",
                http_status: 400,
                retryable: false,
                support_kind: ExplainSupportKind::None,
                support_reason: "user_actionable",
                summary: "The query was understood, but policy or capability checks refused to run it.",
                try_next: &["use a single read-only SELECT query"],
            },
            Self::SourceApiDescribeFailed => Explanation {
                code: self,
                title: "Source API Describe Failed",
                stage: "resolve_source",
                http_status: 500,
                retryable: false,
                support_kind: ExplainSupportKind::ReportIfReproducible,
                support_reason: "source_api_describe_failure",
                summary: "The CLI API could not load the source API description needed to plan the request.",
                try_next: &["retry onequery api --source <source>"],
            },
            Self::SourceApiExecutionFailed => Explanation {
                code: self,
                title: "Source API Execution Failed",
                stage: "execute_query",
                http_status: 500,
                retryable: false,
                support_kind: ExplainSupportKind::ReportIfReproducible,
                support_reason: "source_api_execution_failure",
                summary: "The source API request reached execution, but the backing source or service failed unexpectedly.",
                try_next: &["retry onequery api --source <source>"],
            },
            Self::SourceApiForbidden => Explanation {
                code: self,
                title: "Source API Forbidden",
                stage: "execute_query",
                http_status: 403,
                retryable: false,
                support_kind: ExplainSupportKind::None,
                support_reason: "user_actionable",
                summary: "The current org or source credentials are not allowed to perform this source API action.",
                try_next: &["verify source API permissions and retry"],
            },
            Self::SourceApiPreparationFailed => Explanation {
                code: self,
                title: "Source API Preparation Failed",
                stage: "execute_query",
                http_status: 500,
                retryable: false,
                support_kind: ExplainSupportKind::ReportIfReproducible,
                support_reason: "source_api_preparation_failure",
                summary: "The source API request could not be prepared before execution because planning failed unexpectedly.",
                try_next: &["retry onequery api --source <source>"],
            },
            Self::SourceApiExecutionStateInvalid => Explanation {
                code: self,
                title: "Source API Execution State Invalid",
                stage: "execute_query",
                http_status: 410,
                retryable: false,
                support_kind: ExplainSupportKind::None,
                support_reason: "user_actionable",
                summary: "The source API execution state expired or is no longer valid for the requested action.",
                try_next: &["rerun onequery api to refresh source API execution state"],
            },
            Self::SourceApiSourceUnavailable => Explanation {
                code: self,
                title: "Source API Source Unavailable",
                stage: "resolve_source",
                http_status: 410,
                retryable: false,
                support_kind: ExplainSupportKind::None,
                support_reason: "user_actionable",
                summary: "The source exists, but its credentials or provider state are not currently usable.",
                try_next: &["review source credentials in OneQuery and retry"],
            },
            Self::SourceNotFound => Explanation {
                code: self,
                title: "Source Not Found",
                stage: "resolve_source",
                http_status: 404,
                retryable: false,
                support_kind: ExplainSupportKind::None,
                support_reason: "user_actionable",
                summary: "The referenced source key does not exist or is not visible in the active org.",
                try_next: &["run onequery source list"],
            },
            Self::SourceNameConflict => Explanation {
                code: self,
                title: "Source Name Conflict",
                stage: "resolve_source",
                http_status: 409,
                retryable: false,
                support_kind: ExplainSupportKind::None,
                support_reason: "user_actionable",
                summary: "A source with the same name already exists in the active org.",
                try_next: &["choose a different source name and retry"],
            },
            Self::SourceNotQueryable => Explanation {
                code: self,
                title: "Source Not Queryable",
                stage: "resolve_source",
                http_status: 400,
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
        .support_action
        .as_ref()
        .and_then(|support_action| ExplainCode::from_str(&support_action.explain_slug, false).ok())
        .or_else(|| {
            error
                .code
                .as_deref()
                .and_then(|code| ExplainCode::from_str(code, false).ok())
        })?;
    let slug = code.slug().to_owned();
    Some((slug, code.command()))
}

pub(crate) fn report_command_for_explanation(explanation: Explanation) -> Option<&'static str> {
    explanation
        .support_kind
        .report_label()
        .map(|_| TEXT_REPORT_COMMAND)
}
