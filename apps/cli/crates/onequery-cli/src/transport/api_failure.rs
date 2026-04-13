use base64::Engine;
use buffa::Enumeration;
use buffa::Message;
use connectrpc::ConnectError;
use connectrpc::ErrorCode;
use http::HeaderMap;
use onequery_cli_core::error::ErrorStage;

use crate::output_metadata::SanitizationMetadata;
use crate::transport::generated;
use crate::transport::generated::types;

const CLI_ERROR_DETAIL_TYPE: &str = "onequery.cli.v1.CliErrorDetail";
const BAD_REQUEST_DETAIL_TYPE: &str = "google.rpc.BadRequest";
const RETRY_INFO_DETAIL_TYPE: &str = "google.rpc.RetryInfo";
const REQUEST_ID_HEADER: &str = "x-request-id";

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
    pub(crate) connect_code: ErrorCode,
    pub(crate) title: Option<String>,
    pub(crate) detail: Option<String>,
    pub(crate) code: Option<String>,
    pub(crate) retryable: bool,
    pub(crate) retry_after_ms: Option<u64>,
    pub(crate) stage: ErrorStage,
    pub(crate) hint: Option<String>,
    pub(crate) request_id: Option<String>,
    pub(crate) validation_issues: Vec<ApiValidationIssue>,
}

impl ApiProblem {
    pub(crate) fn is_auth_error(&self) -> bool {
        matches!(
            self.connect_code,
            ErrorCode::Unauthenticated | ErrorCode::PermissionDenied
        )
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
pub(crate) struct ProblemStageFallback {
    default_stage: ErrorStage,
    auth_stage: Option<ErrorStage>,
    not_found_stage: Option<ErrorStage>,
}

impl ProblemStageFallback {
    pub(crate) const fn fixed(default_stage: ErrorStage) -> Self {
        Self {
            default_stage,
            auth_stage: None,
            not_found_stage: None,
        }
    }

    pub(crate) const fn auth_or(default_stage: ErrorStage) -> Self {
        Self {
            default_stage,
            auth_stage: Some(ErrorStage::Auth),
            not_found_stage: None,
        }
    }

    pub(crate) const fn auth_or_not_found(
        default_stage: ErrorStage,
        not_found_stage: ErrorStage,
    ) -> Self {
        Self {
            default_stage,
            auth_stage: Some(ErrorStage::Auth),
            not_found_stage: Some(not_found_stage),
        }
    }

    fn resolve(self, code: ErrorCode) -> ErrorStage {
        if let Some(auth_stage) = self.auth_stage
            && matches!(
                code,
                ErrorCode::Unauthenticated | ErrorCode::PermissionDenied
            )
        {
            return auth_stage;
        }

        if let Some(not_found_stage) = self.not_found_stage
            && matches!(code, ErrorCode::NotFound)
        {
            return not_found_stage;
        }

        self.default_stage
    }
}

#[derive(Debug, Default)]
struct ParsedCliProblemDetails {
    title: Option<String>,
    code: Option<String>,
    stage: Option<ErrorStage>,
    hint: Option<String>,
    retryable: Option<bool>,
    retry_after_ms: Option<u64>,
    request_id: Option<String>,
    validation_issues: Vec<ApiValidationIssue>,
}

pub(crate) fn conversion_failure(stage: ErrorStage, message: impl Into<String>) -> ApiFailure {
    ApiFailure::Problem(ApiProblem {
        connect_code: ErrorCode::InvalidArgument,
        title: None,
        detail: Some(message.into()),
        code: Some("invalid_request".to_owned()),
        retryable: false,
        retry_after_ms: None,
        stage,
        hint: None,
        request_id: None,
        validation_issues: Vec::new(),
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
    fallback_stage: ProblemStageFallback,
) -> ApiFailure {
    let resolved_stage = fallback_stage.resolve(error.code);
    let parsed_details = parse_connect_problem_details(&error, resolved_stage);

    ApiFailure::Problem(ApiProblem {
        connect_code: error.code,
        title: parsed_details.title,
        detail: non_empty(error.message),
        code: parsed_details
            .code
            .or_else(|| Some(error.code.as_str().to_owned())),
        retryable: parsed_details
            .retryable
            .unwrap_or_else(|| connect_retryable(error.code)),
        retry_after_ms: parsed_details.retry_after_ms,
        stage: parsed_details.stage.unwrap_or(resolved_stage),
        hint: parsed_details.hint,
        request_id: parsed_details.request_id.or_else(|| {
            response_request_id(&error.response_headers)
                .or_else(|| response_request_id(&error.trailers))
        }),
        validation_issues: parsed_details.validation_issues,
    })
}

pub(crate) fn response_request_id(headers: &HeaderMap) -> Option<String> {
    header_value(headers, REQUEST_ID_HEADER)
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

fn parse_connect_problem_details(
    error: &ConnectError,
    fallback_stage: ErrorStage,
) -> ParsedCliProblemDetails {
    let mut parsed = ParsedCliProblemDetails::default();

    for detail in &error.details {
        match detail.type_url.as_str() {
            CLI_ERROR_DETAIL_TYPE => {
                let Some(cli_error) = decode_connect_detail::<types::CliErrorDetail>(detail) else {
                    continue;
                };

                if parsed.code.is_none() {
                    parsed.code = cli_problem_code_to_string(cli_error.code);
                }
                if parsed.title.is_none() {
                    parsed.title = non_empty(Some(cli_error.title));
                }
                if parsed.stage.is_none() {
                    parsed.stage = Some(cli_problem_stage_to_error_stage(
                        cli_error.stage,
                        fallback_stage,
                    ));
                }
                if parsed.hint.is_none() {
                    parsed.hint = non_empty(cli_error.hint);
                }
                if parsed.retryable.is_none() {
                    parsed.retryable = Some(cli_error.retryable);
                }
                if parsed.request_id.is_none() {
                    parsed.request_id = non_empty(cli_error.request_id);
                }
            }
            RETRY_INFO_DETAIL_TYPE => {
                let Some(retry_info) =
                    decode_connect_detail::<generated::google::rpc::RetryInfo>(detail)
                else {
                    continue;
                };

                if parsed.retry_after_ms.is_none() {
                    parsed.retry_after_ms = retry_info
                        .retry_delay
                        .into_option()
                        .and_then(duration_to_ms);
                }
            }
            BAD_REQUEST_DETAIL_TYPE => {
                let Some(bad_request) =
                    decode_connect_detail::<generated::google::rpc::BadRequest>(detail)
                else {
                    continue;
                };

                parsed.validation_issues.extend(
                    bad_request
                        .field_violations
                        .into_iter()
                        .map(validation_issue_from_generated)
                        .collect::<Vec<_>>(),
                );
            }
            _ => {}
        }
    }

    parsed
}

fn validation_issue_from_generated(
    violation: generated::google::rpc::bad_request::FieldViolation,
) -> ApiValidationIssue {
    ApiValidationIssue {
        field: violation.field,
        message: violation.description,
        code: reason_to_code(violation.reason.as_str()).unwrap_or_else(|| "invalid".to_owned()),
    }
}

fn duration_to_ms(duration: buffa_types::google::protobuf::Duration) -> Option<u64> {
    if duration.seconds < 0 || duration.nanos < 0 {
        return None;
    }

    let seconds = u64::try_from(duration.seconds).ok()?;
    let nanos = u64::try_from(duration.nanos).ok()?;
    let millis_from_seconds = seconds.checked_mul(1000)?;
    let millis_from_nanos = nanos / 1_000_000;
    millis_from_seconds.checked_add(millis_from_nanos)
}

fn cli_problem_code_to_string(code: buffa::EnumValue<types::CliProblemCode>) -> Option<String> {
    code.as_known()?
        .proto_name()
        .strip_prefix("CLI_PROBLEM_CODE_")
        .map(str::to_ascii_lowercase)
}

fn cli_problem_stage_to_error_stage(
    stage: buffa::EnumValue<types::CliProblemStage>,
    fallback_stage: ErrorStage,
) -> ErrorStage {
    match stage.as_known() {
        Some(types::CliProblemStage::CLI_PROBLEM_STAGE_AUTH) => ErrorStage::Auth,
        Some(types::CliProblemStage::CLI_PROBLEM_STAGE_EXECUTE_QUERY) => ErrorStage::ExecuteQuery,
        Some(types::CliProblemStage::CLI_PROBLEM_STAGE_READ_QUERY_INPUT) => {
            ErrorStage::ReadQueryInput
        }
        Some(types::CliProblemStage::CLI_PROBLEM_STAGE_RESOLVE_ORG) => ErrorStage::ResolveOrg,
        Some(types::CliProblemStage::CLI_PROBLEM_STAGE_RESOLVE_SOURCE) => ErrorStage::ResolveSource,
        Some(types::CliProblemStage::CLI_PROBLEM_STAGE_UNSPECIFIED) | None => fallback_stage,
    }
}

fn reason_to_code(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    Some(trimmed.replace('-', "_").to_ascii_lowercase())
}

fn decode_connect_detail<MessageType>(
    detail: &connectrpc::error::ErrorDetail,
) -> Option<MessageType>
where
    MessageType: Message,
{
    let value = detail.value.as_deref()?;
    let bytes = base64::engine::general_purpose::STANDARD_NO_PAD
        .decode(value)
        .or_else(|_| base64::engine::general_purpose::STANDARD.decode(value))
        .ok()?;
    MessageType::decode_from_slice(bytes.as_slice()).ok()
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
    use base64::Engine;
    use buffa::Message;
    use connectrpc::ConnectError;
    use connectrpc::ErrorCode;
    use onequery_cli_core::error::ErrorStage;
    use pretty_assertions::assert_eq;

    use crate::transport::generated;

    use super::ApiFailure;
    use super::ApiProblem;
    use super::ProblemStageFallback;
    use super::failure_from_connect;
    use super::response_request_id;

    #[test]
    fn response_metadata_helpers_read_request_id() {
        let mut headers = http::HeaderMap::new();
        headers.insert(
            "x-request-id",
            http::HeaderValue::from_static("req_cli_123"),
        );

        assert_eq!(
            response_request_id(&headers),
            Some("req_cli_123".to_owned())
        );
    }

    #[test]
    fn problem_stage_fallback_auth_or_routes_auth_failures() {
        let fallback = ProblemStageFallback::auth_or(ErrorStage::ExecuteQuery);

        assert_eq!(
            [
                fallback.resolve(ErrorCode::Unauthenticated),
                fallback.resolve(ErrorCode::PermissionDenied),
                fallback.resolve(ErrorCode::InvalidArgument),
            ],
            [ErrorStage::Auth, ErrorStage::Auth, ErrorStage::ExecuteQuery,]
        );
    }

    #[test]
    fn problem_stage_fallback_auth_or_not_found_routes_not_found() {
        let fallback = ProblemStageFallback::auth_or_not_found(
            ErrorStage::ResolveSource,
            ErrorStage::ResolveOrg,
        );

        assert_eq!(
            [
                fallback.resolve(ErrorCode::Unauthenticated),
                fallback.resolve(ErrorCode::NotFound),
                fallback.resolve(ErrorCode::InvalidArgument),
            ],
            [
                ErrorStage::Auth,
                ErrorStage::ResolveOrg,
                ErrorStage::ResolveSource,
            ]
        );
    }

    #[test]
    fn failure_from_connect_prefers_cli_error_details() {
        let mut error = ConnectError::new(ErrorCode::ResourceExhausted, "polling is rate limited");
        error.response_headers.insert(
            "x-request-id",
            http::HeaderValue::from_static("req_header_fallback"),
        );
        error.details.push(error_detail(
            "onequery.cli.v1.CliErrorDetail",
            &generated::types::CliErrorDetail {
                code: generated::types::CliProblemCode::CLI_PROBLEM_CODE_LOGIN_RATE_LIMITED.into(),
                stage: generated::types::CliProblemStage::CLI_PROBLEM_STAGE_AUTH.into(),
                title: "Login Rate Limited".to_owned(),
                hint: Some("wait briefly, then retry `onequery auth login`".to_owned()),
                retryable: true,
                request_id: Some("req_problem".to_owned()),
                ..Default::default()
            },
        ));
        error.details.push(error_detail(
            "google.rpc.RetryInfo",
            &generated::google::rpc::RetryInfo {
                retry_delay: buffa::MessageField::some(buffa_types::google::protobuf::Duration {
                    seconds: 10,
                    ..Default::default()
                }),
                ..Default::default()
            },
        ));
        error.details.push(error_detail(
            "google.rpc.BadRequest",
            &generated::google::rpc::BadRequest {
                field_violations: vec![generated::google::rpc::bad_request::FieldViolation {
                    field: "credentials.host".to_owned(),
                    description: "must be a hostname".to_owned(),
                    reason: "INVALID_STRING".to_owned(),
                    ..Default::default()
                }],
                ..Default::default()
            },
        ));

        assert_eq!(
            failure_from_connect(error, ProblemStageFallback::fixed(ErrorStage::Internal)),
            ApiFailure::Problem(ApiProblem {
                connect_code: ErrorCode::ResourceExhausted,
                title: Some("Login Rate Limited".to_owned()),
                detail: Some("polling is rate limited".to_owned()),
                code: Some("login_rate_limited".to_owned()),
                retryable: true,
                retry_after_ms: Some(10_000),
                stage: ErrorStage::Auth,
                hint: Some("wait briefly, then retry `onequery auth login`".to_owned()),
                request_id: Some("req_problem".to_owned()),
                validation_issues: vec![super::ApiValidationIssue {
                    field: "credentials.host".to_owned(),
                    message: "must be a hostname".to_owned(),
                    code: "invalid_string".to_owned(),
                }],
            })
        );
    }

    #[test]
    fn failure_from_connect_falls_back_to_connect_metadata_without_typed_details() {
        let mut error = ConnectError::new(ErrorCode::Unavailable, "server temporarily unavailable");
        error.response_headers.insert(
            "x-request-id",
            http::HeaderValue::from_static("req_unavailable"),
        );

        assert_eq!(
            failure_from_connect(error, ProblemStageFallback::fixed(ErrorStage::Http)),
            ApiFailure::Problem(ApiProblem {
                connect_code: ErrorCode::Unavailable,
                title: None,
                detail: Some("server temporarily unavailable".to_owned()),
                code: Some("unavailable".to_owned()),
                retryable: true,
                retry_after_ms: None,
                stage: ErrorStage::Http,
                hint: None,
                request_id: Some("req_unavailable".to_owned()),
                validation_issues: Vec::new(),
            })
        );
    }

    fn error_detail<MessageType>(
        type_url: &str,
        message: &MessageType,
    ) -> connectrpc::error::ErrorDetail
    where
        MessageType: Message,
    {
        connectrpc::error::ErrorDetail {
            type_url: type_url.to_owned(),
            value: Some(
                base64::engine::general_purpose::STANDARD_NO_PAD.encode(message.encode_to_bytes()),
            ),
            debug: None,
        }
    }
}
