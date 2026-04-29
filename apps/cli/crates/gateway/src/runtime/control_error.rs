use base64::Engine;
use buffa::Message;
use connectrpc::ConnectError;
use connectrpc::ErrorCode;
use onequery_core::error::CliError;
use onequery_core::error::CliValidationIssue;
use onequery_proto_runtime::google::rpc;

const RUNTIME_CONTROL_ERROR_INFO_DOMAIN: &str = "onequery.runtime.v1";
const ERROR_INFO_DETAIL_TYPE: &str = "google.rpc.ErrorInfo";
const BAD_REQUEST_DETAIL_TYPE: &str = "google.rpc.BadRequest";
const RETRY_INFO_DETAIL_TYPE: &str = "google.rpc.RetryInfo";
const RESOURCE_INFO_DETAIL_TYPE: &str = "google.rpc.ResourceInfo";
const PRECONDITION_FAILURE_DETAIL_TYPE: &str = "google.rpc.PreconditionFailure";
const ERROR_INFO_OPERATION_METADATA: &str = "operation";
const ERROR_INFO_RETRYABLE_METADATA: &str = "retryable";

#[derive(Debug, Clone, Eq, PartialEq)]
struct RuntimeControlConnectProblem {
    reason: String,
    server_message: Option<String>,
    retryable: bool,
    retry_after_ms: Option<u64>,
    operation: Option<String>,
    validation_issues: Vec<CliValidationIssue>,
    preconditions: Vec<RuntimeControlPreconditionViolation>,
    resources: Vec<RuntimeControlResourceInfo>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
struct RuntimeControlPreconditionViolation {
    violation_type: String,
    subject: String,
    description: String,
}

#[derive(Debug, Clone, Eq, PartialEq)]
struct RuntimeControlResourceInfo {
    resource_type: String,
    resource_name: String,
    description: Option<String>,
}

impl RuntimeControlConnectProblem {
    fn summary(&self) -> String {
        let operation = self.operation.as_deref().unwrap_or("request");
        let mut detail = format!(
            "{}{}",
            runtime_control_reason_summary(self.reason.as_str()),
            if operation == "request" {
                String::new()
            } else {
                format!(" for {operation}")
            }
        );

        if let Some(server_message) = self.server_message.as_deref() {
            detail.push_str(": ");
            detail.push_str(server_message);
        }

        if !self.validation_issues.is_empty() {
            detail.push_str("; validation issues: ");
            detail.push_str(
                self.validation_issues
                    .iter()
                    .map(validation_issue_summary)
                    .collect::<Vec<_>>()
                    .join(", ")
                    .as_str(),
            );
        }

        if !self.preconditions.is_empty() {
            detail.push_str("; preconditions: ");
            detail.push_str(
                self.preconditions
                    .iter()
                    .map(precondition_summary)
                    .collect::<Vec<_>>()
                    .join(", ")
                    .as_str(),
            );
        }

        if !self.resources.is_empty() {
            detail.push_str("; resources: ");
            detail.push_str(
                self.resources
                    .iter()
                    .map(resource_summary)
                    .collect::<Vec<_>>()
                    .join(", ")
                    .as_str(),
            );
        }

        if self.retryable {
            detail.push_str("; retryable");
            if let Some(retry_after_ms) = self.retry_after_ms {
                detail.push_str(format!(" after {retry_after_ms}ms").as_str());
            }
        }

        detail
    }
}

pub(crate) fn runtime_control_error_allows_fallback(error: &ConnectError) -> bool {
    if let Some(problem) = runtime_control_problem_from_connect_error(error) {
        return problem.retryable;
    }

    matches!(
        error.code,
        ErrorCode::DeadlineExceeded
            | ErrorCode::Unavailable
            | ErrorCode::Unimplemented
            | ErrorCode::Unknown
    )
}

pub(super) fn runtime_control_connect_error_summary(error: &ConnectError) -> Option<String> {
    runtime_control_problem_from_connect_error(error).map(|problem| problem.summary())
}

pub(super) fn with_runtime_control_connect_error_metadata(
    error: &ConnectError,
    cli_error: CliError,
    fallback_code: Option<String>,
) -> CliError {
    let Some(problem) = runtime_control_problem_from_connect_error(error) else {
        return cli_error.with_code(fallback_code);
    };

    cli_error
        .with_code(Some(problem.reason))
        .with_retryable(problem.retryable)
        .with_retry_after_ms(problem.retry_after_ms)
        .with_validation_issues(problem.validation_issues)
}

fn runtime_control_problem_from_connect_error(
    error: &ConnectError,
) -> Option<RuntimeControlConnectProblem> {
    let error_info = runtime_control_error_info(error)?;
    let server_message = non_empty(error.message.clone());
    let retryable = error_info_retryable(&error_info);
    let operation =
        metadata_value(&error_info, ERROR_INFO_OPERATION_METADATA).map(ToOwned::to_owned);
    let reason = non_empty_string(error_info.reason)?;
    let mut parsed = ParsedRuntimeControlDetails::default();

    for detail in &error.details {
        match detail.type_url.as_str() {
            ERROR_INFO_DETAIL_TYPE => {}
            RETRY_INFO_DETAIL_TYPE => {
                if let Some(retry_info) = decode_connect_detail::<rpc::RetryInfo>(detail)
                    && let Some(retry_after_ms) = retry_info
                        .retry_delay
                        .into_option()
                        .and_then(duration_to_ms)
                {
                    parsed.retry_after_ms = Some(retry_after_ms);
                }
            }
            BAD_REQUEST_DETAIL_TYPE => {
                if let Some(bad_request) = decode_connect_detail::<rpc::BadRequest>(detail) {
                    parsed.validation_issues.extend(
                        bad_request
                            .field_violations
                            .into_iter()
                            .map(validation_issue_from_generated),
                    );
                }
            }
            PRECONDITION_FAILURE_DETAIL_TYPE => {
                if let Some(precondition_failure) =
                    decode_connect_detail::<rpc::PreconditionFailure>(detail)
                {
                    parsed.preconditions.extend(
                        precondition_failure
                            .violations
                            .into_iter()
                            .map(precondition_from_generated),
                    );
                }
            }
            RESOURCE_INFO_DETAIL_TYPE => {
                if let Some(resource_info) = decode_connect_detail::<rpc::ResourceInfo>(detail)
                    && let Some(resource) = resource_from_generated(resource_info)
                {
                    parsed.resources.push(resource);
                }
            }
            _ => {}
        }
    }

    Some(RuntimeControlConnectProblem {
        reason,
        server_message,
        retryable,
        retry_after_ms: parsed.retry_after_ms,
        operation,
        validation_issues: parsed.validation_issues,
        preconditions: parsed.preconditions,
        resources: parsed.resources,
    })
}

fn runtime_control_error_info(error: &ConnectError) -> Option<rpc::ErrorInfo> {
    error.details.iter().find_map(|detail| {
        if detail.type_url.as_str() != ERROR_INFO_DETAIL_TYPE {
            return None;
        }

        let error_info = decode_connect_detail::<rpc::ErrorInfo>(detail)?;
        if error_info.domain == RUNTIME_CONTROL_ERROR_INFO_DOMAIN {
            Some(error_info)
        } else {
            None
        }
    })
}

fn error_info_retryable(error_info: &rpc::ErrorInfo) -> bool {
    matches!(
        metadata_value(error_info, ERROR_INFO_RETRYABLE_METADATA),
        Some("true")
    )
}

fn metadata_value<'a>(error_info: &'a rpc::ErrorInfo, key: &str) -> Option<&'a str> {
    error_info
        .metadata
        .get(key)
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

#[derive(Default)]
struct ParsedRuntimeControlDetails {
    retry_after_ms: Option<u64>,
    validation_issues: Vec<CliValidationIssue>,
    preconditions: Vec<RuntimeControlPreconditionViolation>,
    resources: Vec<RuntimeControlResourceInfo>,
}

fn validation_issue_from_generated(
    violation: rpc::bad_request::FieldViolation,
) -> CliValidationIssue {
    CliValidationIssue {
        field: violation.field,
        message: violation.description,
        code: reason_to_code(violation.reason.as_str()).unwrap_or_else(|| "invalid".to_owned()),
    }
}

fn precondition_from_generated(
    violation: rpc::precondition_failure::Violation,
) -> RuntimeControlPreconditionViolation {
    RuntimeControlPreconditionViolation {
        violation_type: violation.r#type,
        subject: violation.subject,
        description: violation.description,
    }
}

fn resource_from_generated(resource_info: rpc::ResourceInfo) -> Option<RuntimeControlResourceInfo> {
    Some(RuntimeControlResourceInfo {
        resource_type: non_empty_string(resource_info.resource_type)?,
        resource_name: non_empty_string(resource_info.resource_name)?,
        description: non_empty_string(resource_info.description),
    })
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

fn runtime_control_reason_summary(reason: &str) -> String {
    match reason {
        "RUNTIME_CONTROL_REQUEST_INVALID" => "runtime control request is invalid".to_owned(),
        "RUNTIME_CONTROL_OPERATION_CONFLICT" => {
            "runtime control operation id conflicts with an earlier request".to_owned()
        }
        "RUNTIME_CONTROL_TARGET_PRECONDITION_FAILED" => {
            "runtime control target does not match the running runtime".to_owned()
        }
        "RUNTIME_CONTROL_STARTUP_NOT_READY" => "runtime control is not ready yet".to_owned(),
        "RUNTIME_CONTROL_ACTOR_UNAVAILABLE" => "runtime control actor is unavailable".to_owned(),
        "RUNTIME_CONTROL_INTERNAL" => "runtime control failed internally".to_owned(),
        _ => format!("runtime control returned {}", reason_to_label(reason)),
    }
}

fn validation_issue_summary(issue: &CliValidationIssue) -> String {
    if issue.field.is_empty() {
        return format!("{} ({})", issue.message, issue.code);
    }

    format!("{}: {} ({})", issue.field, issue.message, issue.code)
}

fn precondition_summary(violation: &RuntimeControlPreconditionViolation) -> String {
    let subject = if violation.subject.is_empty() {
        "target"
    } else {
        violation.subject.as_str()
    };
    let violation_type = if violation.violation_type.is_empty() {
        "precondition"
    } else {
        violation.violation_type.as_str()
    };

    if violation.description.is_empty() {
        format!("{violation_type} on {subject}")
    } else {
        format!("{violation_type} on {subject}: {}", violation.description)
    }
}

fn resource_summary(resource: &RuntimeControlResourceInfo) -> String {
    match resource.description.as_deref() {
        Some(description) => format!(
            "{} {} ({description})",
            resource.resource_type, resource.resource_name
        ),
        None => format!("{} {}", resource.resource_type, resource.resource_name),
    }
}

fn reason_to_code(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    Some(trimmed.replace('-', "_").to_ascii_lowercase())
}

fn reason_to_label(value: &str) -> String {
    reason_to_code(value)
        .unwrap_or_else(|| "unknown_error".to_owned())
        .replace('_', " ")
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|candidate| !candidate.trim().is_empty())
}

fn non_empty_string(value: String) -> Option<String> {
    non_empty(Some(value))
}

#[cfg(test)]
mod tests {
    use base64::Engine;
    use buffa::Message;
    use connectrpc::ConnectError;
    use connectrpc::ErrorCode;
    use onequery_core::error::CliError;
    use onequery_core::error::ErrorStage;
    use pretty_assertions::assert_eq;

    use super::RuntimeControlPreconditionViolation;
    use super::RuntimeControlResourceInfo;
    use super::runtime_control_connect_error_summary;
    use super::runtime_control_error_allows_fallback;
    use super::runtime_control_problem_from_connect_error;
    use super::with_runtime_control_connect_error_metadata;
    use onequery_proto_runtime::google::rpc as google_rpc;

    #[test]
    fn parses_stale_launch_precondition_details() {
        let mut error = ConnectError::new(
            ErrorCode::FailedPrecondition,
            "launch_id mismatch: expected launch-a, got launch-b",
        );
        error.details.push(error_detail(
            "google.rpc.ErrorInfo",
            &error_info(
                "RUNTIME_CONTROL_TARGET_PRECONDITION_FAILED",
                &[
                    ("operation", "stop"),
                    ("retryable", "false"),
                    ("field", "launch_id"),
                    ("expected", "launch-a"),
                    ("actual", "launch-b"),
                ],
            ),
        ));
        error.details.push(error_detail(
            "google.rpc.PreconditionFailure",
            &google_rpc::PreconditionFailure {
                violations: vec![google_rpc::precondition_failure::Violation {
                    r#type: "RUNTIME_TARGET_MISMATCH".to_owned(),
                    subject: "launch_id".to_owned(),
                    description: "launch_id mismatch: expected launch-a, got launch-b".to_owned(),
                    ..Default::default()
                }],
                ..Default::default()
            },
        ));
        error.details.push(error_detail(
            "google.rpc.ResourceInfo",
            &google_rpc::ResourceInfo {
                resource_type: "onequery.runtime.control.target".to_owned(),
                resource_name: "target.launch_id:launch-a".to_owned(),
                description: "launch_id mismatch: expected launch-a, got launch-b".to_owned(),
                ..Default::default()
            },
        ));

        let problem = runtime_control_problem_from_connect_error(&error)
            .unwrap_or_else(|| panic!("expected runtime-control details"));

        assert_eq!(
            problem.preconditions,
            vec![RuntimeControlPreconditionViolation {
                violation_type: "RUNTIME_TARGET_MISMATCH".to_owned(),
                subject: "launch_id".to_owned(),
                description: "launch_id mismatch: expected launch-a, got launch-b".to_owned(),
            }]
        );
        assert_eq!(
            problem.resources,
            vec![RuntimeControlResourceInfo {
                resource_type: "onequery.runtime.control.target".to_owned(),
                resource_name: "target.launch_id:launch-a".to_owned(),
                description: Some("launch_id mismatch: expected launch-a, got launch-b".to_owned()),
            }]
        );
        assert_eq!(
            runtime_control_connect_error_summary(&error),
            Some(
                "runtime control target does not match the running runtime for stop: launch_id mismatch: expected launch-a, got launch-b; preconditions: RUNTIME_TARGET_MISMATCH on launch_id: launch_id mismatch: expected launch-a, got launch-b; resources: onequery.runtime.control.target target.launch_id:launch-a (launch_id mismatch: expected launch-a, got launch-b)"
                    .to_owned()
            )
        );
    }

    #[test]
    fn parses_validation_failures() {
        let mut error = ConnectError::new(ErrorCode::InvalidArgument, "invalid Stop request");
        error.details.push(error_detail(
            "google.rpc.ErrorInfo",
            &error_info(
                "RUNTIME_CONTROL_REQUEST_INVALID",
                &[("operation", "Stop"), ("retryable", "false")],
            ),
        ));
        error.details.push(error_detail(
            "google.rpc.BadRequest",
            &google_rpc::BadRequest {
                field_violations: vec![google_rpc::bad_request::FieldViolation {
                    field: "operation_id".to_owned(),
                    description: "must be a valid UUID".to_owned(),
                    reason: "STRING_UUID".to_owned(),
                    ..Default::default()
                }],
                ..Default::default()
            },
        ));

        let problem = runtime_control_problem_from_connect_error(&error)
            .unwrap_or_else(|| panic!("expected runtime-control details"));

        assert_eq!(
            problem.validation_issues,
            vec![onequery_core::error::CliValidationIssue {
                field: "operation_id".to_owned(),
                message: "must be a valid UUID".to_owned(),
                code: "string_uuid".to_owned(),
            }]
        );
        assert_eq!(
            runtime_control_connect_error_summary(&error),
            Some(
                "runtime control request is invalid for Stop: invalid Stop request; validation issues: operation_id: must be a valid UUID (string_uuid)"
                    .to_owned()
            )
        );
    }

    #[test]
    fn attaches_problem_metadata_to_cli_errors() {
        let mut error = ConnectError::new(ErrorCode::InvalidArgument, "invalid Stop request");
        error.details.push(error_detail(
            "google.rpc.ErrorInfo",
            &error_info(
                "RUNTIME_CONTROL_REQUEST_INVALID",
                &[("operation", "Stop"), ("retryable", "false")],
            ),
        ));
        error.details.push(error_detail(
            "google.rpc.BadRequest",
            &google_rpc::BadRequest {
                field_violations: vec![google_rpc::bad_request::FieldViolation {
                    field: "operation_id".to_owned(),
                    description: "must be a valid UUID".to_owned(),
                    reason: "STRING_UUID".to_owned(),
                    ..Default::default()
                }],
                ..Default::default()
            },
        ));

        let cli_error = with_runtime_control_connect_error_metadata(
            &error,
            CliError::new(
                "failed",
                "onequery gateway stop",
                ErrorStage::Internal,
                "runtime control failed",
                Vec::new(),
            ),
            Some("fallback".to_owned()),
        );

        assert_eq!(
            (
                cli_error.code.as_deref(),
                cli_error.retryable,
                cli_error.retry_after_ms,
                cli_error.validation_issues.as_slice(),
            ),
            (
                Some("RUNTIME_CONTROL_REQUEST_INVALID"),
                false,
                None,
                [onequery_core::error::CliValidationIssue {
                    field: "operation_id".to_owned(),
                    message: "must be a valid UUID".to_owned(),
                    code: "string_uuid".to_owned(),
                }]
                .as_slice(),
            )
        );
    }

    #[test]
    fn typed_retryable_startup_errors_allow_fallback() {
        let mut error = ConnectError::new(
            ErrorCode::Unavailable,
            "runtime shutdown controller is not attached",
        );
        error.details.push(error_detail(
            "google.rpc.ErrorInfo",
            &error_info(
                "RUNTIME_CONTROL_STARTUP_NOT_READY",
                &[("operation", "stop"), ("retryable", "true")],
            ),
        ));
        error.details.push(error_detail(
            "google.rpc.RetryInfo",
            &google_rpc::RetryInfo {
                retry_delay: buffa::MessageField::some(buffa_types::google::protobuf::Duration {
                    nanos: 250_000_000,
                    ..Default::default()
                }),
                ..Default::default()
            },
        ));

        assert_eq!(runtime_control_error_allows_fallback(&error), true);
        assert_eq!(
            runtime_control_connect_error_summary(&error),
            Some(
                "runtime control is not ready yet for stop: runtime shutdown controller is not attached; retryable after 250ms"
                    .to_owned()
            )
        );
    }

    #[test]
    fn typed_non_retryable_unavailable_errors_do_not_allow_fallback() {
        let mut error = ConnectError::new(ErrorCode::Unavailable, "actor stopped");
        error.details.push(error_detail(
            "google.rpc.ErrorInfo",
            &error_info(
                "RUNTIME_CONTROL_ACTOR_UNAVAILABLE",
                &[("operation", "watchStatus"), ("retryable", "false")],
            ),
        ));

        assert_eq!(runtime_control_error_allows_fallback(&error), false);
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

    fn error_info(reason: &str, metadata: &[(&str, &str)]) -> google_rpc::ErrorInfo {
        google_rpc::ErrorInfo {
            reason: reason.to_owned(),
            domain: "onequery.runtime.v1".to_owned(),
            metadata: metadata
                .iter()
                .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
                .collect(),
            ..Default::default()
        }
    }
}
