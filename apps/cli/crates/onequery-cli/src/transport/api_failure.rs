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
    pub(crate) title: String,
    pub(crate) detail: String,
    pub(crate) code: types::ProblemCode,
    pub(crate) retryable: bool,
    pub(crate) retry_after_ms: Option<u64>,
    pub(crate) stage: ErrorStage,
    pub(crate) hint: Option<String>,
    pub(crate) request_id: Option<String>,
    pub(crate) validation_issues: Vec<ApiValidationIssue>,
}

impl ApiProblem {
    pub(crate) fn is_auth_error(&self) -> bool {
        self.code == types::ProblemCode::PROBLEM_CODE_NOT_LOGGED_IN
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

#[derive(Debug, Default)]
struct ParsedCliProblemDetails {
    cli_error: Option<types::CliErrorDetail>,
    retry_after_ms: Option<u64>,
    validation_issues: Vec<ApiValidationIssue>,
    saw_cli_detail_extension: bool,
}

pub(crate) fn conversion_failure(stage: ErrorStage, message: impl Into<String>) -> ApiFailure {
    ApiFailure::Problem(ApiProblem {
        title: "Invalid Request".to_owned(),
        detail: message.into(),
        code: types::ProblemCode::PROBLEM_CODE_INVALID_REQUEST,
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

pub(crate) fn failure_from_connect(error: ConnectError, stage: ErrorStage) -> ApiFailure {
    let request_id = connect_request_id(&error);

    match parse_connect_problem_details(&error, request_id.clone()) {
        Ok(Some(problem)) => ApiFailure::Problem(problem),
        Ok(None) if connect_transport_retryable(error.code) => {
            ApiFailure::Transport(TransportFailure {
                kind: TransportFailureKind::SendRequest,
                stage,
                message: connect_error_message(&error),
                retryable: true,
            })
        }
        Ok(None) => decode_failure(stage, untyped_connect_error_message(&error), request_id),
        Err(message) => decode_failure(stage, message, request_id),
    }
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
        profile: sanitization.profile.unwrap_or_default(),
        sanitized_paths: sanitization.sanitized_paths.into_iter().collect(),
        raw_available: sanitization.raw_available.unwrap_or_default(),
    })
}

fn parse_connect_problem_details(
    error: &ConnectError,
    request_id: Option<String>,
) -> Result<Option<ApiProblem>, String> {
    let mut parsed = ParsedCliProblemDetails::default();

    for detail in &error.details {
        match connect_detail_type_name(detail.type_url.as_str()) {
            CLI_ERROR_DETAIL_TYPE => {
                parsed.saw_cli_detail_extension = true;
                let cli_error = decode_connect_detail::<types::CliErrorDetail>(detail)
                    .ok_or_else(|| "failed to decode CliErrorDetail".to_owned())?;
                if parsed.cli_error.replace(cli_error).is_some() {
                    return Err("server returned duplicate CliErrorDetail entries".to_owned());
                }
            }
            RETRY_INFO_DETAIL_TYPE => {
                parsed.saw_cli_detail_extension = true;
                let retry_info = decode_connect_detail::<generated::google::rpc::RetryInfo>(detail)
                    .ok_or_else(|| "failed to decode RetryInfo".to_owned())?;
                let retry_after_ms = retry_info
                    .retry_delay
                    .into_option()
                    .and_then(duration_to_ms)
                    .ok_or_else(|| "server returned invalid RetryInfo.retry_delay".to_owned())?;
                if parsed.retry_after_ms.replace(retry_after_ms).is_some() {
                    return Err("server returned duplicate RetryInfo entries".to_owned());
                }
            }
            BAD_REQUEST_DETAIL_TYPE => {
                parsed.saw_cli_detail_extension = true;
                let bad_request =
                    decode_connect_detail::<generated::google::rpc::BadRequest>(detail)
                        .ok_or_else(|| "failed to decode BadRequest".to_owned())?;

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

    let Some(cli_error) = parsed.cli_error else {
        if parsed.saw_cli_detail_extension {
            return Err(
                "server returned CLI Connect error details without CliErrorDetail".to_owned(),
            );
        }

        return Ok(None);
    };

    let title = non_empty(cli_error.title)
        .ok_or_else(|| "server returned CliErrorDetail without title".to_owned())?;
    let detail = non_empty(error.message.clone())
        .ok_or_else(|| "server returned CliErrorDetail without an error message".to_owned())?;
    let code = cli_error
        .code
        .and_then(known_cli_problem_code)
        .ok_or_else(|| "server returned invalid ProblemCode".to_owned())?;
    let stage = cli_error
        .stage
        .and_then(cli_problem_stage_to_error_stage)
        .ok_or_else(|| "server returned invalid ProblemStage".to_owned())?;

    Ok(Some(ApiProblem {
        title,
        detail,
        code,
        retryable: cli_error.retryable.unwrap_or_default(),
        retry_after_ms: parsed.retry_after_ms,
        stage,
        hint: non_empty(cli_error.hint),
        request_id: non_empty(cli_error.request_id).or(request_id),
        validation_issues: parsed.validation_issues,
    }))
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

pub(crate) fn cli_problem_code_string(code: types::ProblemCode) -> String {
    code.proto_name()
        .strip_prefix("PROBLEM_CODE_")
        .map(str::to_ascii_lowercase)
        .unwrap_or_else(|| panic!("expected known CLI problem code: {code:?}"))
}

fn known_cli_problem_code(
    code: buffa::EnumValue<types::ProblemCode>,
) -> Option<types::ProblemCode> {
    match code.as_known() {
        Some(types::ProblemCode::PROBLEM_CODE_UNSPECIFIED) | None => None,
        Some(code) => Some(code),
    }
}

fn cli_problem_stage_to_error_stage(
    stage: buffa::EnumValue<types::ProblemStage>,
) -> Option<ErrorStage> {
    match stage.as_known() {
        Some(types::ProblemStage::PROBLEM_STAGE_AUTH) => Some(ErrorStage::Auth),
        Some(types::ProblemStage::PROBLEM_STAGE_EXECUTE_QUERY) => Some(ErrorStage::ExecuteQuery),
        Some(types::ProblemStage::PROBLEM_STAGE_READ_QUERY_INPUT) => {
            Some(ErrorStage::ReadQueryInput)
        }
        Some(types::ProblemStage::PROBLEM_STAGE_RESOLVE_ORG) => Some(ErrorStage::ResolveOrg),
        Some(types::ProblemStage::PROBLEM_STAGE_RESOLVE_SOURCE) => Some(ErrorStage::ResolveSource),
        Some(types::ProblemStage::PROBLEM_STAGE_UNSPECIFIED) | None => None,
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

fn connect_detail_type_name(type_url: &str) -> &str {
    type_url
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or(type_url)
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

fn connect_transport_retryable(code: ErrorCode) -> bool {
    matches!(
        code,
        ErrorCode::Unavailable | ErrorCode::DeadlineExceeded | ErrorCode::ResourceExhausted
    )
}

fn connect_request_id(error: &ConnectError) -> Option<String> {
    response_request_id(&error.response_headers).or_else(|| response_request_id(&error.trailers))
}

fn connect_error_message(error: &ConnectError) -> String {
    non_empty(error.message.clone()).unwrap_or_else(|| error.code.as_str().replace('_', " "))
}

fn untyped_connect_error_message(error: &ConnectError) -> String {
    format!(
        "server returned untyped Connect error {}: {}",
        error.code.as_str(),
        connect_error_message(error)
    )
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
    use super::TransportFailure;
    use super::TransportFailureKind;
    use super::cli_problem_code_string;
    use super::connect_detail_type_name;
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
    fn failure_from_connect_parses_typed_cli_problem_details() {
        let mut error = ConnectError::new(ErrorCode::ResourceExhausted, "polling is rate limited");
        error.response_headers.insert(
            "x-request-id",
            http::HeaderValue::from_static("req_header_fallback"),
        );
        error.details.push(error_detail(
            "type.googleapis.com/onequery.cli.v1.CliErrorDetail",
            &generated::types::CliErrorDetail {
                code: Some(generated::types::ProblemCode::PROBLEM_CODE_LOGIN_RATE_LIMITED.into()),
                stage: Some(generated::types::ProblemStage::PROBLEM_STAGE_AUTH.into()),
                title: Some("Login Rate Limited".to_owned()),
                hint: Some("wait briefly, then retry `onequery auth login`".to_owned()),
                retryable: Some(true),
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
            failure_from_connect(error, ErrorStage::Internal),
            ApiFailure::Problem(ApiProblem {
                title: "Login Rate Limited".to_owned(),
                detail: "polling is rate limited".to_owned(),
                code: generated::types::ProblemCode::PROBLEM_CODE_LOGIN_RATE_LIMITED,
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
    fn failure_from_connect_treats_untyped_transient_errors_as_transport_failures() {
        let mut error = ConnectError::new(ErrorCode::Unavailable, "server temporarily unavailable");
        error.response_headers.insert(
            "x-request-id",
            http::HeaderValue::from_static("req_unavailable"),
        );

        assert_eq!(
            failure_from_connect(error, ErrorStage::Http),
            ApiFailure::Transport(TransportFailure {
                kind: TransportFailureKind::SendRequest,
                stage: ErrorStage::Http,
                message: "server temporarily unavailable".to_owned(),
                retryable: true,
            })
        );
    }

    #[test]
    fn failure_from_connect_rejects_untyped_non_transient_errors() {
        let mut error = ConnectError::new(ErrorCode::PermissionDenied, "forbidden");
        error.response_headers.insert(
            "x-request-id",
            http::HeaderValue::from_static("req_forbidden"),
        );

        assert_eq!(
            failure_from_connect(error, ErrorStage::ResolveOrg),
            ApiFailure::Decode(super::DecodeFailure {
                stage: ErrorStage::ResolveOrg,
                message: "server returned untyped Connect error permission_denied: forbidden"
                    .to_owned(),
                request_id: Some("req_forbidden".to_owned()),
            })
        );
    }

    #[test]
    fn failure_from_connect_rejects_partial_cli_detail_sets() {
        let mut error = ConnectError::new(ErrorCode::InvalidArgument, "request invalid");
        error.details.push(error_detail(
            "google.rpc.BadRequest",
            &generated::google::rpc::BadRequest {
                field_violations: vec![generated::google::rpc::bad_request::FieldViolation {
                    field: "sql".to_owned(),
                    description: "query must be read-only".to_owned(),
                    reason: "CUSTOM".to_owned(),
                    ..Default::default()
                }],
                ..Default::default()
            },
        ));

        assert_eq!(
            failure_from_connect(error, ErrorStage::ReadQueryInput),
            ApiFailure::Decode(super::DecodeFailure {
                stage: ErrorStage::ReadQueryInput,
                message: "server returned CLI Connect error details without CliErrorDetail"
                    .to_owned(),
                request_id: None,
            })
        );
    }

    #[test]
    fn connect_detail_type_name_accepts_any_type_urls() {
        assert_eq!(
            [
                connect_detail_type_name("onequery.cli.v1.CliErrorDetail"),
                connect_detail_type_name("type.googleapis.com/onequery.cli.v1.CliErrorDetail"),
            ],
            [
                "onequery.cli.v1.CliErrorDetail",
                "onequery.cli.v1.CliErrorDetail"
            ]
        );
    }

    #[test]
    fn cli_problem_code_string_projects_known_codes() {
        assert_eq!(
            cli_problem_code_string(
                generated::types::ProblemCode::PROBLEM_CODE_QUERY_EXECUTION_UNAVAILABLE
            ),
            "query_execution_unavailable"
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
