use reqwest::StatusCode;
use reqwest::header::HeaderMap;
use onequery_cli_core::error::ErrorStage;

use crate::output_metadata::SanitizationMetadata;
use crate::output_metadata::UntrustedOutputMetadata;
use crate::transport::generated::Error as GeneratedError;
use crate::transport::generated::types;

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct ApiSuccess<T> {
    pub(crate) payload: T,
    pub(crate) request_id: Option<String>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) enum ApiFailure {
    Problem(ApiProblem),
    Transport(TransportFailure),
    Decode(DecodeFailure),
}

impl ApiFailure {
    pub(crate) fn is_retryable(&self) -> bool {
        match self {
            Self::Problem(problem) => problem.retryable,
            Self::Transport(transport) => transport.retryable,
            Self::Decode(_) => false,
        }
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct ApiProblem {
    pub(crate) status: StatusCode,
    pub(crate) problem_type: Option<String>,
    pub(crate) title: Option<String>,
    pub(crate) detail: Option<String>,
    pub(crate) code: Option<String>,
    pub(crate) retryable: bool,
    pub(crate) stage: ErrorStage,
    pub(crate) hint: Option<String>,
    pub(crate) request_id: Option<String>,
    pub(crate) validation_issues: Vec<ApiValidationIssue>,
    pub(crate) raw_body: String,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct ApiValidationIssue {
    pub(crate) field: String,
    pub(crate) message: String,
    pub(crate) code: String,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) enum TransportFailureKind {
    SendRequest,
    ReadResponseBody,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct TransportFailure {
    pub(crate) kind: TransportFailureKind,
    pub(crate) stage: ErrorStage,
    pub(crate) message: String,
    pub(crate) retryable: bool,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct DecodeFailure {
    pub(crate) stage: ErrorStage,
    pub(crate) message: String,
    pub(crate) request_id: Option<String>,
}

#[derive(Clone, Copy)]
pub(crate) enum ProblemStageFallback {
    Fixed(ErrorStage),
    FromStatus(fn(StatusCode) -> ErrorStage),
}

#[derive(Clone, Copy)]
pub(crate) struct ResponseFailureStages {
    problem_stage: ProblemStageFallback,
    decode_stage: ErrorStage,
}

impl ResponseFailureStages {
    pub(crate) const fn fixed(problem_stage: ErrorStage, decode_stage: ErrorStage) -> Self {
        Self {
            problem_stage: ProblemStageFallback::Fixed(problem_stage),
            decode_stage,
        }
    }

    pub(crate) const fn from_status(
        problem_stage: fn(StatusCode) -> ErrorStage,
        decode_stage: ErrorStage,
    ) -> Self {
        Self {
            problem_stage: ProblemStageFallback::FromStatus(problem_stage),
            decode_stage,
        }
    }

    fn resolve_problem_stage(self, status: StatusCode) -> ErrorStage {
        match self.problem_stage {
            ProblemStageFallback::Fixed(stage) => stage,
            ProblemStageFallback::FromStatus(resolve_stage) => resolve_stage(status),
        }
    }
}

pub(crate) fn conversion_failure(stage: ErrorStage, message: impl Into<String>) -> ApiFailure {
    ApiFailure::Problem(ApiProblem {
        status: StatusCode::UNPROCESSABLE_ENTITY,
        problem_type: None,
        title: Some("Invalid Request".to_owned()),
        detail: Some(message.into()),
        code: Some("invalid_request".to_owned()),
        retryable: false,
        stage,
        hint: None,
        request_id: None,
        validation_issues: Vec::new(),
        raw_body: String::new(),
    })
}

pub(crate) fn decode_failure(
    stage: ErrorStage,
    message: impl Into<String>,
    request_id: Option<String>,
) -> ApiFailure {
    ApiFailure::Decode(DecodeFailure {
        stage,
        message: message.into(),
        request_id,
    })
}

fn transport_failure_from_error(kind: TransportFailureKind, error: reqwest::Error) -> ApiFailure {
    ApiFailure::Transport(TransportFailure {
        kind,
        stage: ErrorStage::Http,
        message: error.to_string(),
        retryable: error.is_connect() || error.is_timeout(),
    })
}

pub(crate) fn try_into_value<T, V>(value: V, stage: ErrorStage) -> Result<T, ApiFailure>
where
    T: TryFrom<V>,
    T::Error: std::fmt::Display,
{
    T::try_from(value).map_err(|error| conversion_failure(stage, error.to_string()))
}

pub(crate) fn try_into_option<T, V>(
    value: Option<V>,
    stage: ErrorStage,
) -> Result<Option<T>, ApiFailure>
where
    T: TryFrom<V>,
    T::Error: std::fmt::Display,
{
    value.map(|value| try_into_value(value, stage)).transpose()
}

pub(crate) async fn failure_from_generated(
    error: GeneratedError<types::CliProblem>,
    stages: ResponseFailureStages,
) -> ApiFailure {
    match error {
        GeneratedError::InvalidRequest(message) | GeneratedError::Custom(message) => {
            conversion_failure(
                stages.resolve_problem_stage(StatusCode::UNPROCESSABLE_ENTITY),
                message,
            )
        }
        GeneratedError::CommunicationError(request_error) => {
            transport_failure_from_error(TransportFailureKind::SendRequest, request_error)
        }
        GeneratedError::InvalidUpgrade(read_error)
        | GeneratedError::ResponseBodyError(read_error) => {
            transport_failure_from_error(TransportFailureKind::ReadResponseBody, read_error)
        }
        GeneratedError::InvalidResponsePayload(_, decode_error) => {
            ApiFailure::Decode(DecodeFailure {
                stage: stages.decode_stage,
                message: decode_error.to_string(),
                request_id: None,
            })
        }
        GeneratedError::ErrorResponse(response) => {
            let status = response.status();
            let request_id = response_request_id(response.headers());
            let problem =
                problem_from_generated_payload(response.into_inner(), status, request_id, None);
            ApiFailure::Problem(problem)
        }
        GeneratedError::UnexpectedResponse(response) => {
            let status = response.status();
            let request_id = response_request_id(response.headers());
            let body_bytes = response.bytes().await.map_err(|read_error| {
                transport_failure_from_error(TransportFailureKind::ReadResponseBody, read_error)
            });

            match body_bytes {
                Ok(_body_bytes) if status.is_success() => ApiFailure::Decode(DecodeFailure {
                    stage: stages.decode_stage,
                    message: format!("unexpected response status {status}"),
                    request_id,
                }),
                Ok(body_bytes) => ApiFailure::Problem(parse_problem_response(
                    status,
                    request_id,
                    &body_bytes,
                    stages.resolve_problem_stage(status),
                )),
                Err(failure) => failure,
            }
        }
    }
}

pub(crate) fn parse_problem_response(
    status: StatusCode,
    header_request_id: Option<String>,
    body_bytes: &[u8],
    fallback_stage: ErrorStage,
) -> ApiProblem {
    let raw_body = String::from_utf8_lossy(body_bytes).into_owned();
    match serde_json::from_slice::<types::CliProblem>(body_bytes) {
        Ok(problem) => {
            problem_from_generated_payload(problem, status, header_request_id, Some(raw_body))
        }
        Err(_) => ApiProblem {
            status,
            problem_type: None,
            title: None,
            detail: None,
            code: None,
            retryable: status_implies_retryable(status),
            stage: fallback_stage,
            hint: None,
            request_id: header_request_id,
            validation_issues: Vec::new(),
            raw_body,
        },
    }
}

pub(crate) fn response_request_id(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-request-id")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

pub(crate) fn untrusted_output_metadata_from_generated<T>(
    untrusted_paths: Vec<T>,
    sanitization: Option<types::CliSanitization>,
) -> UntrustedOutputMetadata
where
    T: Into<String>,
{
    UntrustedOutputMetadata {
        untrusted_paths: untrusted_paths.into_iter().map(Into::into).collect(),
        sanitization: sanitization.map(|sanitization| SanitizationMetadata {
            profile: sanitization.profile.into(),
            sanitized_paths: sanitization
                .sanitized_paths
                .into_iter()
                .map(Into::into)
                .collect(),
            raw_available: sanitization.raw_available,
        }),
    }
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.and_then(|candidate| {
        if candidate.trim().is_empty() {
            return None;
        }

        Some(candidate)
    })
}

fn problem_from_generated_payload(
    problem: types::CliProblem,
    status: StatusCode,
    header_request_id: Option<String>,
    raw_body: Option<String>,
) -> ApiProblem {
    let raw_body = raw_body.unwrap_or_else(|| serde_json::to_string(&problem).unwrap_or_default());
    let request_id = non_empty(Some(String::from(problem.request_id))).or(header_request_id);

    ApiProblem {
        status,
        problem_type: non_empty(Some(problem.type_)),
        title: non_empty(Some(problem.title)),
        detail: non_empty(problem.detail),
        code: Some(problem.code.to_string()),
        retryable: problem.retryable,
        stage: generated_problem_stage_to_error_stage(problem.stage),
        hint: non_empty(problem.hint),
        request_id,
        validation_issues: problem
            .errors
            .into_iter()
            .map(|issue| ApiValidationIssue {
                field: issue.field,
                message: issue.message,
                code: issue.code,
            })
            .collect(),
        raw_body,
    }
}

fn status_implies_retryable(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::BAD_GATEWAY | StatusCode::SERVICE_UNAVAILABLE | StatusCode::GATEWAY_TIMEOUT
    )
}

fn generated_problem_stage_to_error_stage(stage: types::CliProblemStage) -> ErrorStage {
    match stage {
        types::CliProblemStage::Auth => ErrorStage::Auth,
        types::CliProblemStage::ExecuteQuery => ErrorStage::ExecuteQuery,
        types::CliProblemStage::ReadQueryInput => ErrorStage::ReadQueryInput,
        types::CliProblemStage::ResolveOrg => ErrorStage::ResolveOrg,
        types::CliProblemStage::ResolveSource => ErrorStage::ResolveSource,
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use reqwest::StatusCode;
    use serde_json::json;
    use onequery_cli_core::error::ErrorStage;

    use super::ApiFailure;
    use super::ApiProblem;
    use super::ApiValidationIssue;
    use super::TransportFailure;
    use super::TransportFailureKind;
    use super::parse_problem_response;

    #[test]
    fn parse_problem_response_reads_cli_problem_extensions() {
        let problem = parse_problem_response(
            StatusCode::NOT_FOUND,
            None,
            json!({
                "type": "https://onequery.invalid/problems/cli/source-not-found",
                "status": 404,
                "title": "Source Not Found",
                "detail": "no source named \"warehouse\" exists",
                "code": "source_not_found",
                "stage": "resolve_source",
                "hint": "run `oneq source list`",
                "requestId": "req_123",
                "retryable": false
            })
            .to_string()
            .as_bytes(),
            ErrorStage::Http,
        );

        assert_eq!(
            problem,
            ApiProblem {
                status: StatusCode::NOT_FOUND,
                problem_type: Some(
                    "https://onequery.invalid/problems/cli/source-not-found".to_owned()
                ),
                title: Some("Source Not Found".to_owned()),
                detail: Some("no source named \"warehouse\" exists".to_owned()),
                code: Some("source_not_found".to_owned()),
                retryable: false,
                stage: ErrorStage::ResolveSource,
                hint: Some("run `oneq source list`".to_owned()),
                request_id: Some("req_123".to_owned()),
                validation_issues: Vec::new(),
                raw_body: json!({
                    "type": "https://onequery.invalid/problems/cli/source-not-found",
                    "status": 404,
                    "title": "Source Not Found",
                    "detail": "no source named \"warehouse\" exists",
                    "code": "source_not_found",
                    "stage": "resolve_source",
                    "hint": "run `oneq source list`",
                    "requestId": "req_123",
                    "retryable": false
                })
                .to_string(),
            }
        );
    }

    #[test]
    fn parse_problem_response_falls_back_to_header_request_id_for_unstructured_body() {
        let problem = parse_problem_response(
            StatusCode::BAD_GATEWAY,
            Some("req_header".to_owned()),
            b"<html>bad gateway</html>",
            ErrorStage::Http,
        );

        assert_eq!(
            problem,
            ApiProblem {
                status: StatusCode::BAD_GATEWAY,
                problem_type: None,
                title: None,
                detail: None,
                code: None,
                retryable: true,
                stage: ErrorStage::Http,
                hint: None,
                request_id: Some("req_header".to_owned()),
                validation_issues: Vec::new(),
                raw_body: "<html>bad gateway</html>".to_owned(),
            }
        );
    }

    #[test]
    fn parse_problem_response_reads_validation_issues() {
        let problem = parse_problem_response(
            StatusCode::BAD_REQUEST,
            None,
            json!({
                "type": "https://onequery.invalid/problems/cli/invalid-request",
                "status": 400,
                "title": "Invalid Request",
                "detail": "source is required",
                "code": "invalid_request",
                "stage": "resolve_source",
                "hint": "correct the request and retry",
                "requestId": "req_validation",
                "retryable": false,
                "errors": [
                    {
                        "field": "source",
                        "message": "source is required",
                        "code": "too_small"
                    },
                    {
                        "field": "sql",
                        "message": "query must be read-only",
                        "code": "custom"
                    }
                ]
            })
            .to_string()
            .as_bytes(),
            ErrorStage::Http,
        );

        assert_eq!(
            problem.validation_issues,
            vec![
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
            ]
        );
    }

    #[test]
    fn retryable_failures_only_cover_transient_statuses_and_transport_errors() {
        assert_eq!(
            [
                ApiFailure::Problem(ApiProblem {
                    status: StatusCode::SERVICE_UNAVAILABLE,
                    problem_type: None,
                    title: None,
                    detail: None,
                    code: None,
                    retryable: true,
                    stage: ErrorStage::Http,
                    hint: None,
                    request_id: None,
                    validation_issues: Vec::new(),
                    raw_body: String::new(),
                })
                .is_retryable(),
                ApiFailure::Transport(TransportFailure {
                    kind: TransportFailureKind::SendRequest,
                    stage: ErrorStage::Http,
                    message: "timeout".to_owned(),
                    retryable: true,
                })
                .is_retryable(),
                ApiFailure::Transport(TransportFailure {
                    kind: TransportFailureKind::ReadResponseBody,
                    stage: ErrorStage::Http,
                    message: "invalid chunk".to_owned(),
                    retryable: false,
                })
                .is_retryable(),
            ],
            [true, true, false]
        );
    }
}
