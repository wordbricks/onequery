use connectrpc::ConnectError;
use connectrpc::ErrorCode;
use http::HeaderMap;
use http::StatusCode;
use onequery_cli_core::error::ErrorStage;

use crate::output_metadata::SanitizationMetadata;
use crate::transport::generated::types;

const REQUEST_ID_HEADER: &str = "x-request-id";
const RETRY_AFTER_MS_HEADER: &str = "retry-after-ms";

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
    pub(crate) connect_code: Option<ErrorCode>,
    pub(crate) status: Option<StatusCode>,
    pub(crate) title: Option<String>,
    pub(crate) detail: Option<String>,
    pub(crate) code: Option<String>,
    pub(crate) retryable: bool,
    pub(crate) retry_after_ms: Option<u64>,
    pub(crate) stage: ErrorStage,
    pub(crate) hint: Option<String>,
    pub(crate) request_id: Option<String>,
    pub(crate) validation_issues: Vec<ApiValidationIssue>,
    pub(crate) raw_body: String,
}

impl ApiProblem {
    pub(crate) fn is_auth_error(&self) -> bool {
        match self.connect_code {
            Some(ErrorCode::Unauthenticated | ErrorCode::PermissionDenied) => true,
            Some(_) => false,
            None => matches!(
                self.status,
                Some(StatusCode::UNAUTHORIZED) | Some(StatusCode::FORBIDDEN)
            ),
        }
    }
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
    FromConnectCode(fn(ErrorCode) -> ErrorStage),
}

#[derive(Clone, Copy)]
pub(crate) struct ResponseFailureStages {
    problem_stage: ProblemStageFallback,
}

impl ResponseFailureStages {
    pub(crate) const fn fixed(problem_stage: ErrorStage) -> Self {
        Self {
            problem_stage: ProblemStageFallback::Fixed(problem_stage),
        }
    }

    pub(crate) const fn from_connect_code(problem_stage: fn(ErrorCode) -> ErrorStage) -> Self {
        Self {
            problem_stage: ProblemStageFallback::FromConnectCode(problem_stage),
        }
    }

    fn resolve_problem_stage(self, code: ErrorCode) -> ErrorStage {
        match self.problem_stage {
            ProblemStageFallback::Fixed(stage) => stage,
            ProblemStageFallback::FromConnectCode(resolve_stage) => resolve_stage(code),
        }
    }
}

pub(crate) fn conversion_failure(stage: ErrorStage, message: impl Into<String>) -> ApiFailure {
    ApiFailure::Problem(ApiProblem {
        connect_code: Some(ErrorCode::InvalidArgument),
        status: None,
        title: None,
        detail: Some(message.into()),
        code: Some("invalid_request".to_owned()),
        retryable: false,
        retry_after_ms: None,
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

pub(crate) fn failure_from_connect(
    error: ConnectError,
    stages: ResponseFailureStages,
) -> ApiFailure {
    let response_headers = &error.response_headers;
    let trailers = &error.trailers;
    let detail = non_empty(error.message);

    ApiFailure::Problem(ApiProblem {
        connect_code: Some(error.code),
        status: None,
        title: None,
        detail,
        code: Some(error.code.as_str().to_owned()),
        retryable: connect_retryable(error.code),
        retry_after_ms: response_retry_after_ms(response_headers)
            .or_else(|| response_retry_after_ms(trailers)),
        stage: stages.resolve_problem_stage(error.code),
        hint: None,
        request_id: response_request_id(response_headers).or_else(|| response_request_id(trailers)),
        validation_issues: Vec::new(),
        raw_body: String::new(),
    })
}

pub(crate) fn response_request_id(headers: &HeaderMap) -> Option<String> {
    header_value(headers, REQUEST_ID_HEADER)
}

pub(crate) fn response_retry_after_ms(headers: &HeaderMap) -> Option<u64> {
    header_value(headers, RETRY_AFTER_MS_HEADER).and_then(|value| value.parse().ok())
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

pub(crate) fn sanitization_metadata_from_generated(
    sanitization: Option<types::CliSanitization>,
) -> Option<SanitizationMetadata> {
    sanitization.map(|sanitization| SanitizationMetadata {
        profile: sanitization.profile,
        sanitized_paths: sanitization.sanitized_paths.into_iter().collect(),
        raw_available: sanitization.raw_available,
    })
}

fn header_value(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|candidate| !candidate.trim().is_empty())
}

fn connect_retryable(code: ErrorCode) -> bool {
    matches!(
        code,
        ErrorCode::Unavailable | ErrorCode::DeadlineExceeded | ErrorCode::ResourceExhausted
    )
}

pub(crate) fn connect_title(code: ErrorCode) -> String {
    match code {
        ErrorCode::InvalidArgument => "Invalid request".to_owned(),
        ErrorCode::Unauthenticated => "Not authenticated".to_owned(),
        ErrorCode::PermissionDenied => "Forbidden".to_owned(),
        ErrorCode::NotFound => "Not found".to_owned(),
        ErrorCode::AlreadyExists => "Already exists".to_owned(),
        ErrorCode::FailedPrecondition => "Failed precondition".to_owned(),
        ErrorCode::ResourceExhausted => "Rate limited".to_owned(),
        ErrorCode::DeadlineExceeded => "Deadline exceeded".to_owned(),
        ErrorCode::Unavailable => "Service unavailable".to_owned(),
        ErrorCode::Internal => "Internal error".to_owned(),
        _ => code.as_str().replace('_', " "),
    }
}

#[cfg(test)]
mod tests {
    use connectrpc::ConnectError;
    use connectrpc::ErrorCode;
    use onequery_cli_core::error::ErrorStage;
    use pretty_assertions::assert_eq;

    use super::ApiFailure;
    use super::ApiProblem;
    use super::ResponseFailureStages;
    use super::failure_from_connect;
    use super::response_request_id;
    use super::response_retry_after_ms;

    #[test]
    fn response_metadata_helpers_read_request_id_and_retry_after() {
        let mut headers = http::HeaderMap::new();
        headers.insert(
            "x-request-id",
            http::HeaderValue::from_static("req_cli_123"),
        );
        headers.insert("retry-after-ms", http::HeaderValue::from_static("1500"));

        assert_eq!(
            response_request_id(&headers),
            Some("req_cli_123".to_owned())
        );
        assert_eq!(response_retry_after_ms(&headers), Some(1500));
    }

    #[test]
    fn failure_from_connect_maps_code_and_metadata() {
        let mut error = ConnectError::new(ErrorCode::ResourceExhausted, "polling is rate limited");
        error.response_headers.insert(
            "x-request-id",
            http::HeaderValue::from_static("req_rate_limited"),
        );
        error
            .response_headers
            .insert("retry-after-ms", http::HeaderValue::from_static("10000"));

        assert_eq!(
            failure_from_connect(error, ResponseFailureStages::fixed(ErrorStage::Auth)),
            ApiFailure::Problem(ApiProblem {
                connect_code: Some(ErrorCode::ResourceExhausted),
                status: None,
                title: None,
                detail: Some("polling is rate limited".to_owned()),
                code: Some("resource_exhausted".to_owned()),
                retryable: true,
                retry_after_ms: Some(10_000),
                stage: ErrorStage::Auth,
                hint: None,
                request_id: Some("req_rate_limited".to_owned()),
                validation_issues: Vec::new(),
                raw_body: String::new(),
            })
        );
    }
}
