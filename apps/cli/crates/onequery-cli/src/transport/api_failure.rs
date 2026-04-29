use base64::Engine;
use buffa::Message;
use connectrpc::ConnectError;
use connectrpc::ErrorCode;
use http::HeaderMap;
use onequery_core::error::ErrorStage;

use crate::output_metadata::SanitizationMetadata;
use crate::transport::generated;
use crate::transport::generated::types;

const CLI_ERROR_INFO_DOMAIN: &str = "onequery.cli.v1";
const ERROR_INFO_DETAIL_TYPE: &str = "google.rpc.ErrorInfo";
const BAD_REQUEST_DETAIL_TYPE: &str = "google.rpc.BadRequest";
const RETRY_INFO_DETAIL_TYPE: &str = "google.rpc.RetryInfo";
const RESOURCE_INFO_DETAIL_TYPE: &str = "google.rpc.ResourceInfo";
const ERROR_INFO_PROBLEM_STAGE_METADATA: &str = "problemStage";
const ERROR_INFO_RETRYABLE_METADATA: &str = "retryable";
const REQUEST_ID_HEADER: &str = "x-request-id";
const NOT_LOGGED_IN_REASON: &str = "NOT_LOGGED_IN";

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
    pub(crate) reason: ApiProblemReason,
    pub(crate) server_message: String,
    pub(crate) retryable: bool,
    pub(crate) retry_after_ms: Option<u64>,
    pub(crate) stage: ErrorStage,
    pub(crate) request_id: Option<String>,
    pub(crate) validation_issues: Vec<ApiValidationIssue>,
    pub(crate) resource: Option<ApiResourceInfo>,
}

impl ApiProblem {
    pub(crate) fn is_auth_error(&self) -> bool {
        self.reason.as_str() == NOT_LOGGED_IN_REASON
    }
}

#[derive(Debug, Clone, Eq, PartialEq, Hash)]
pub(crate) struct ApiProblemReason(String);

impl ApiProblemReason {
    pub(crate) fn new(value: impl Into<String>) -> Option<Self> {
        let value = value.into();
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return None;
        }

        Some(Self(trimmed.to_owned()))
    }

    pub(crate) fn from_static(value: &'static str) -> Self {
        Self(value.to_owned())
    }

    pub(crate) fn as_str(&self) -> &str {
        self.0.as_str()
    }

    pub(crate) fn structured_code(&self) -> String {
        self.0.clone()
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct ApiValidationIssue {
    pub(crate) field: String,
    pub(crate) message: String,
    pub(crate) code: String,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct ApiResourceInfo {
    pub(crate) resource_type: String,
    pub(crate) resource_name: String,
    pub(crate) owner: Option<String>,
    pub(crate) description: Option<String>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct TransportFailure {
    pub(crate) stage: ErrorStage,
    pub(crate) message: String,
    pub(crate) retryable: bool,
    pub(crate) request_id: Option<String>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct DecodeFailure {
    pub(crate) stage: ErrorStage,
    pub(crate) message: String,
    pub(crate) request_id: Option<String>,
}

#[derive(Debug, Default)]
struct ParsedCliProblemDetails {
    retry_after_ms: Option<u64>,
    validation_issues: Vec<ApiValidationIssue>,
    resource: Option<ApiResourceInfo>,
}

pub(crate) fn conversion_failure(stage: ErrorStage, message: impl Into<String>) -> ApiFailure {
    ApiFailure::Problem(ApiProblem {
        reason: ApiProblemReason::from_static(invalid_request_reason_for_stage(stage)),
        server_message: message.into(),
        retryable: false,
        retry_after_ms: None,
        stage,
        request_id: None,
        validation_issues: Vec::new(),
        resource: None,
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
                stage,
                message: connect_error_message(&error),
                retryable: true,
                request_id,
            })
        }
        Ok(None) => decode_failure(stage, untyped_connect_error_message(&error), request_id),
        Err(message) => decode_failure(stage, message, request_id),
    }
}

pub(crate) fn response_request_id(headers: &HeaderMap) -> Option<String> {
    header_value(headers, REQUEST_ID_HEADER)
}

pub(crate) fn success_response_request_id<T>(
    response: &connectrpc::client::UnaryResponse<T>,
) -> Option<String> {
    response_request_id(response.headers()).or_else(|| response_request_id(response.trailers()))
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
    let Some(error_info) = onequery_error_info(error)? else {
        return Ok(None);
    };

    let mut parsed = ParsedCliProblemDetails::default();

    for detail in &error.details {
        match detail.type_url.as_str() {
            ERROR_INFO_DETAIL_TYPE => {}
            RETRY_INFO_DETAIL_TYPE => {
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
            RESOURCE_INFO_DETAIL_TYPE => {
                let resource_info =
                    decode_connect_detail::<generated::google::rpc::ResourceInfo>(detail)
                        .ok_or_else(|| "failed to decode ResourceInfo".to_owned())?;
                let resource = resource_info_from_generated(resource_info)?;
                if parsed.resource.replace(resource).is_some() {
                    return Err("server returned duplicate ResourceInfo entries".to_owned());
                }
            }
            _ => {}
        }
    }

    let stage = error_info_problem_stage(&error_info)?;
    let retryable = error_info_retryable(&error_info)?;
    let reason = ApiProblemReason::new(error_info.reason)
        .ok_or_else(|| "server returned ErrorInfo without reason".to_owned())?;
    let server_message =
        non_empty(error.message.clone()).unwrap_or_else(|| reason.as_str().to_owned());

    Ok(Some(ApiProblem {
        reason,
        server_message,
        retryable,
        retry_after_ms: parsed.retry_after_ms,
        stage,
        request_id,
        validation_issues: parsed.validation_issues,
        resource: parsed.resource,
    }))
}

fn onequery_error_info(
    error: &ConnectError,
) -> Result<Option<generated::google::rpc::ErrorInfo>, String> {
    let mut onequery_error_info = None;

    for detail in &error.details {
        if detail.type_url.as_str() != ERROR_INFO_DETAIL_TYPE {
            continue;
        }

        let error_info = decode_connect_detail::<generated::google::rpc::ErrorInfo>(detail)
            .ok_or_else(|| "failed to decode ErrorInfo".to_owned())?;
        if error_info.domain != CLI_ERROR_INFO_DOMAIN {
            continue;
        }

        if onequery_error_info.replace(error_info).is_some() {
            return Err("server returned duplicate OneQuery ErrorInfo entries".to_owned());
        }
    }

    Ok(onequery_error_info)
}

fn error_info_problem_stage(
    error_info: &generated::google::rpc::ErrorInfo,
) -> Result<ErrorStage, String> {
    let stage = required_error_info_metadata(error_info, ERROR_INFO_PROBLEM_STAGE_METADATA)
        .ok_or_else(|| "server returned ErrorInfo without problemStage metadata".to_owned())?;

    ErrorStage::try_from_api_stage(stage)
        .ok_or_else(|| "server returned invalid ErrorInfo.problemStage metadata".to_owned())
}

fn error_info_retryable(error_info: &generated::google::rpc::ErrorInfo) -> Result<bool, String> {
    let retryable = required_error_info_metadata(error_info, ERROR_INFO_RETRYABLE_METADATA)
        .ok_or_else(|| "server returned ErrorInfo without retryable metadata".to_owned())?;

    match retryable {
        "true" => Ok(true),
        "false" => Ok(false),
        _ => Err("server returned invalid ErrorInfo.retryable metadata".to_owned()),
    }
}

fn required_error_info_metadata<'a>(
    error_info: &'a generated::google::rpc::ErrorInfo,
    key: &str,
) -> Option<&'a str> {
    error_info
        .metadata
        .get(key)
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
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

fn resource_info_from_generated(
    resource_info: generated::google::rpc::ResourceInfo,
) -> Result<ApiResourceInfo, String> {
    let resource_type = non_empty_string(resource_info.resource_type)
        .ok_or_else(|| "server returned ResourceInfo without resource_type".to_owned())?;
    let resource_name = non_empty_string(resource_info.resource_name)
        .ok_or_else(|| "server returned ResourceInfo without resource_name".to_owned())?;

    Ok(ApiResourceInfo {
        resource_type,
        resource_name,
        owner: non_empty_string(resource_info.owner),
        description: non_empty_string(resource_info.description),
    })
}

fn invalid_request_reason_for_stage(stage: ErrorStage) -> &'static str {
    match stage {
        ErrorStage::Auth => "AUTH_REQUEST_INVALID",
        ErrorStage::ResolveOrg => "ORG_REQUEST_INVALID",
        ErrorStage::ResolveSource => "SOURCE_REQUEST_INVALID",
        ErrorStage::ReadQueryInput => "READ_QUERY_INPUT_INVALID",
        ErrorStage::ExecuteQuery => "EXECUTE_QUERY_REQUEST_INVALID",
        ErrorStage::SourceApiDescribe
        | ErrorStage::SourceApiPrepare
        | ErrorStage::SourceApiExecute => "SOURCE_API_REQUEST_INVALID",
        ErrorStage::ParseCommand
        | ErrorStage::LoadConfig
        | ErrorStage::LoadCredentials
        | ErrorStage::Http
        | ErrorStage::Render
        | ErrorStage::Internal => "EXECUTE_QUERY_REQUEST_INVALID",
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

fn non_empty_string(value: String) -> Option<String> {
    non_empty(Some(value))
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
    use onequery_core::error::ErrorStage;
    use pretty_assertions::assert_eq;

    use crate::transport::generated;

    use super::ApiFailure;
    use super::ApiProblem;
    use super::ApiProblemReason;
    use super::ApiResourceInfo;
    use super::ApiValidationIssue;
    use super::TransportFailure;
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
            "google.rpc.ErrorInfo",
            &error_info(
                "LOGIN_RATE_LIMITED",
                "onequery.cli.v1",
                &[("problemStage", "auth"), ("retryable", "true")],
            ),
        ));
        error.details.push(error_detail(
            "google.rpc.ResourceInfo",
            &generated::google::rpc::ResourceInfo {
                resource_type: "auth_session".to_owned(),
                resource_name: "login".to_owned(),
                description: "OAuth device flow".to_owned(),
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
                reason: ApiProblemReason::from_static("LOGIN_RATE_LIMITED"),
                server_message: "polling is rate limited".to_owned(),
                retryable: true,
                retry_after_ms: Some(10_000),
                stage: ErrorStage::Auth,
                request_id: Some("req_header_fallback".to_owned()),
                validation_issues: vec![ApiValidationIssue {
                    field: "credentials.host".to_owned(),
                    message: "must be a hostname".to_owned(),
                    code: "invalid_string".to_owned(),
                }],
                resource: Some(ApiResourceInfo {
                    resource_type: "auth_session".to_owned(),
                    resource_name: "login".to_owned(),
                    owner: None,
                    description: Some("OAuth device flow".to_owned()),
                }),
            })
        );
    }

    #[test]
    fn failure_from_connect_maps_source_api_problem_stages() {
        let mut error = ConnectError::new(ErrorCode::DeadlineExceeded, "upstream timed out");
        error.details.push(error_detail(
            "google.rpc.ErrorInfo",
            &error_info(
                "SOURCE_API_EXECUTION_TIMED_OUT",
                "onequery.cli.v1",
                &[
                    ("problemStage", "source_api_execute"),
                    ("retryable", "true"),
                ],
            ),
        ));

        assert_eq!(
            failure_from_connect(error, ErrorStage::Internal),
            ApiFailure::Problem(ApiProblem {
                reason: ApiProblemReason::from_static("SOURCE_API_EXECUTION_TIMED_OUT"),
                server_message: "upstream timed out".to_owned(),
                retryable: true,
                retry_after_ms: None,
                stage: ErrorStage::SourceApiExecute,
                request_id: None,
                validation_issues: Vec::new(),
                resource: None,
            })
        );
    }

    #[test]
    fn failure_from_connect_rejects_duplicate_onequery_error_info_details() {
        let mut error = ConnectError::new(
            ErrorCode::PermissionDenied,
            "stored credentials are invalid",
        );
        error.response_headers.insert(
            "x-request-id",
            http::HeaderValue::from_static("req_header_fallback"),
        );
        error.details.push(error_detail(
            "google.rpc.ErrorInfo",
            &error_info(
                "NOT_LOGGED_IN",
                "onequery.cli.v1",
                &[("problemStage", "auth"), ("retryable", "false")],
            ),
        ));
        error.details.push(error_detail(
            "google.rpc.ErrorInfo",
            &error_info(
                "NOT_LOGGED_IN",
                "onequery.cli.v1",
                &[("problemStage", "auth"), ("retryable", "false")],
            ),
        ));

        assert_eq!(
            failure_from_connect(error, ErrorStage::Internal),
            ApiFailure::Decode(super::DecodeFailure {
                stage: ErrorStage::Internal,
                message: "server returned duplicate OneQuery ErrorInfo entries".to_owned(),
                request_id: Some("req_header_fallback".to_owned()),
            })
        );
    }

    #[test]
    fn failure_from_connect_treats_wrong_error_info_domain_as_untyped() {
        let mut error = ConnectError::new(ErrorCode::PermissionDenied, "forbidden");
        error.response_headers.insert(
            "x-request-id",
            http::HeaderValue::from_static("req_header_fallback"),
        );
        error.details.push(error_detail(
            "google.rpc.ErrorInfo",
            &error_info(
                "PERMISSION_DENIED",
                "googleapis.com",
                &[("problemStage", "auth"), ("retryable", "false")],
            ),
        ));

        assert_eq!(
            failure_from_connect(error, ErrorStage::ResolveOrg),
            ApiFailure::Decode(super::DecodeFailure {
                stage: ErrorStage::ResolveOrg,
                message: "server returned untyped Connect error permission_denied: forbidden"
                    .to_owned(),
                request_id: Some("req_header_fallback".to_owned()),
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
                stage: ErrorStage::Http,
                message: "server temporarily unavailable".to_owned(),
                retryable: true,
                request_id: Some("req_unavailable".to_owned()),
            })
        );
    }

    #[test]
    fn failure_from_connect_preserves_trailer_request_id_on_untyped_transient_errors() {
        let mut error = ConnectError::new(ErrorCode::Unavailable, "server temporarily unavailable");
        error.trailers.insert(
            "x-request-id",
            http::HeaderValue::from_static("req_trailer"),
        );

        assert_eq!(
            failure_from_connect(error, ErrorStage::Http),
            ApiFailure::Transport(TransportFailure {
                stage: ErrorStage::Http,
                message: "server temporarily unavailable".to_owned(),
                retryable: true,
                request_id: Some("req_trailer".to_owned()),
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
    fn failure_from_connect_treats_standard_details_without_onequery_error_info_as_untyped() {
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
                message: "server returned untyped Connect error invalid_argument: request invalid"
                    .to_owned(),
                request_id: None,
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

    fn error_info(
        reason: &str,
        domain: &str,
        metadata: &[(&str, &str)],
    ) -> generated::google::rpc::ErrorInfo {
        generated::google::rpc::ErrorInfo {
            reason: reason.to_owned(),
            domain: domain.to_owned(),
            metadata: metadata
                .iter()
                .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
                .collect(),
            ..Default::default()
        }
    }
}
