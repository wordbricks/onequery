use connectrpc::ConnectError;
use connectrpc::ErrorCode;
use onequery_connect_support::error_details;
use onequery_core::error::CliError;
use onequery_core::error::CliValidationIssue;
use onequery_proto_runtime::google::rpc;

const SUPERVISOR_CONTROL_ERROR_INFO_DOMAIN: &str = "onequery.runtime.v1";
const ERROR_INFO_OPERATION_METADATA: &str = "operation";
const ERROR_INFO_RETRYABLE_METADATA: &str = "retryable";

#[derive(Debug, Clone, Eq, PartialEq)]
struct SupervisorControlConnectProblem {
    reason: String,
    server_message: Option<String>,
    retryable: bool,
    retry_after_ms: Option<u64>,
    operation: Option<String>,
    validation_issues: Vec<CliValidationIssue>,
    preconditions: Vec<SupervisorControlPreconditionViolation>,
    resources: Vec<SupervisorControlResourceInfo>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
struct SupervisorControlPreconditionViolation {
    violation_type: String,
    subject: String,
    description: String,
}

#[derive(Debug, Clone, Eq, PartialEq)]
struct SupervisorControlResourceInfo {
    resource_type: String,
    resource_name: String,
    description: Option<String>,
}

impl SupervisorControlConnectProblem {
    fn summary(&self) -> String {
        let operation = self.operation.as_deref().unwrap_or("request");
        let mut detail = format!(
            "{}{}",
            supervisor_control_reason_summary(self.reason.as_str()),
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

pub(crate) fn supervisor_control_error_allows_stop_escalation(error: &ConnectError) -> bool {
    if let Some(problem) = supervisor_control_problem_from_connect_error(error) {
        return problem.retryable
            && problem
                .operation
                .as_deref()
                .is_some_and(|operation| operation.eq_ignore_ascii_case("stop"));
    }

    error.code == ErrorCode::DeadlineExceeded
        || (error.code == ErrorCode::Unavailable
            && error
                .message
                .as_deref()
                .is_some_and(|message| message.contains("stop command stream is not attached")))
}

pub(super) fn supervisor_control_connect_error_summary(error: &ConnectError) -> Option<String> {
    supervisor_control_problem_from_connect_error(error).map(|problem| problem.summary())
}

pub(super) fn with_supervisor_control_connect_error_metadata(
    error: &ConnectError,
    cli_error: CliError,
    default_code: Option<String>,
) -> CliError {
    let Some(problem) = supervisor_control_problem_from_connect_error(error) else {
        return cli_error.with_code(default_code);
    };

    cli_error
        .with_code(Some(problem.reason))
        .with_retryable(problem.retryable)
        .with_retry_after_ms(problem.retry_after_ms)
        .with_validation_issues(problem.validation_issues)
}

fn supervisor_control_problem_from_connect_error(
    error: &ConnectError,
) -> Option<SupervisorControlConnectProblem> {
    let error_info = supervisor_control_error_info(error)?;
    let server_message = error_details::non_empty(error.message.clone());
    let retryable = error_info_retryable(&error_info);
    let operation =
        error_details::metadata_value(&error_info.metadata, ERROR_INFO_OPERATION_METADATA)
            .map(ToOwned::to_owned);
    let reason = error_details::non_empty_string(error_info.reason)?;
    let mut parsed = ParsedSupervisorControlDetails::default();

    for detail in &error.details {
        match detail.type_url.as_str() {
            error_details::ERROR_INFO_DETAIL_TYPE => {}
            error_details::RETRY_INFO_DETAIL_TYPE => {
                if let Ok(retry_info) =
                    error_details::decode_connect_detail::<rpc::RetryInfo>(detail)
                    && let Some(retry_after_ms) = retry_info
                        .retry_delay
                        .into_option()
                        .and_then(error_details::protobuf_duration_to_ms)
                {
                    parsed.retry_after_ms = Some(retry_after_ms);
                }
            }
            error_details::BAD_REQUEST_DETAIL_TYPE => {
                if let Ok(bad_request) =
                    error_details::decode_connect_detail::<rpc::BadRequest>(detail)
                {
                    parsed.validation_issues.extend(
                        bad_request
                            .field_violations
                            .into_iter()
                            .map(validation_issue_from_generated),
                    );
                }
            }
            error_details::PRECONDITION_FAILURE_DETAIL_TYPE => {
                if let Ok(precondition_failure) =
                    error_details::decode_connect_detail::<rpc::PreconditionFailure>(detail)
                {
                    parsed.preconditions.extend(
                        precondition_failure
                            .violations
                            .into_iter()
                            .map(precondition_from_generated),
                    );
                }
            }
            error_details::RESOURCE_INFO_DETAIL_TYPE => {
                if let Ok(resource_info) =
                    error_details::decode_connect_detail::<rpc::ResourceInfo>(detail)
                    && let Some(resource) = resource_from_generated(resource_info)
                {
                    parsed.resources.push(resource);
                }
            }
            _ => {}
        }
    }

    Some(SupervisorControlConnectProblem {
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

fn supervisor_control_error_info(error: &ConnectError) -> Option<rpc::ErrorInfo> {
    error_details::first_decodable_domain_error_info(
        error,
        SUPERVISOR_CONTROL_ERROR_INFO_DOMAIN,
        |error_info: &rpc::ErrorInfo| error_info.domain.as_str(),
    )
}

fn error_info_retryable(error_info: &rpc::ErrorInfo) -> bool {
    matches!(
        error_details::metadata_value(&error_info.metadata, ERROR_INFO_RETRYABLE_METADATA),
        Some("true")
    )
}

#[derive(Default)]
struct ParsedSupervisorControlDetails {
    retry_after_ms: Option<u64>,
    validation_issues: Vec<CliValidationIssue>,
    preconditions: Vec<SupervisorControlPreconditionViolation>,
    resources: Vec<SupervisorControlResourceInfo>,
}

fn validation_issue_from_generated(
    violation: rpc::bad_request::FieldViolation,
) -> CliValidationIssue {
    CliValidationIssue {
        field: violation.field,
        message: violation.description,
        code: error_details::reason_to_code(violation.reason.as_str())
            .unwrap_or_else(|| "invalid".to_owned()),
    }
}

fn precondition_from_generated(
    violation: rpc::precondition_failure::Violation,
) -> SupervisorControlPreconditionViolation {
    SupervisorControlPreconditionViolation {
        violation_type: violation.r#type,
        subject: violation.subject,
        description: violation.description,
    }
}

fn resource_from_generated(
    resource_info: rpc::ResourceInfo,
) -> Option<SupervisorControlResourceInfo> {
    Some(SupervisorControlResourceInfo {
        resource_type: error_details::non_empty_string(resource_info.resource_type)?,
        resource_name: error_details::non_empty_string(resource_info.resource_name)?,
        description: error_details::non_empty_string(resource_info.description),
    })
}

fn supervisor_control_reason_summary(reason: &str) -> String {
    match reason {
        "SUPERVISOR_CONTROL_REQUEST_INVALID" => "supervisor control request is invalid".to_owned(),
        "SUPERVISOR_CONTROL_OPERATION_CONFLICT" => {
            "supervisor control operation id conflicts with an earlier request".to_owned()
        }
        "SUPERVISOR_CONTROL_TARGET_PRECONDITION_FAILED" => {
            "supervisor control target does not match the active launch".to_owned()
        }
        "SUPERVISOR_CONTROL_STARTUP_NOT_READY" => "supervisor control is not ready yet".to_owned(),
        "SUPERVISOR_CONTROL_ACTOR_UNAVAILABLE" => {
            "supervisor control actor is unavailable".to_owned()
        }
        "SUPERVISOR_CONTROL_INTERNAL" => "supervisor control failed internally".to_owned(),
        _ => format!("supervisor control returned {}", reason_to_label(reason)),
    }
}

fn validation_issue_summary(issue: &CliValidationIssue) -> String {
    if issue.field.is_empty() {
        return format!("{} ({})", issue.message, issue.code);
    }

    format!("{}: {} ({})", issue.field, issue.message, issue.code)
}

fn precondition_summary(violation: &SupervisorControlPreconditionViolation) -> String {
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

fn resource_summary(resource: &SupervisorControlResourceInfo) -> String {
    match resource.description.as_deref() {
        Some(description) => format!(
            "{} {} ({description})",
            resource.resource_type, resource.resource_name
        ),
        None => format!("{} {}", resource.resource_type, resource.resource_name),
    }
}

fn reason_to_label(value: &str) -> String {
    error_details::reason_to_code(value)
        .unwrap_or_else(|| "unknown_error".to_owned())
        .replace('_', " ")
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

    use super::supervisor_control_connect_error_summary;
    use super::supervisor_control_error_allows_stop_escalation;
    use super::with_supervisor_control_connect_error_metadata;
    use onequery_proto_runtime::google::rpc as google_rpc;

    #[test]
    fn attaches_problem_metadata_to_cli_errors() {
        let mut error = ConnectError::new(ErrorCode::InvalidArgument, "invalid Stop request");
        error.details.push(error_detail(
            "google.rpc.ErrorInfo",
            &error_info(
                "SUPERVISOR_CONTROL_REQUEST_INVALID",
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

        let cli_error = with_supervisor_control_connect_error_metadata(
            &error,
            CliError::new(
                "failed",
                "onequery gateway stop",
                ErrorStage::Internal,
                "supervisor control failed",
                Vec::new(),
            ),
            Some("default".to_owned()),
        );

        assert_eq!(
            (
                cli_error.code.as_deref(),
                cli_error.retryable,
                cli_error.retry_after_ms,
                cli_error.validation_issues.as_slice(),
            ),
            (
                Some("SUPERVISOR_CONTROL_REQUEST_INVALID"),
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
    fn typed_retryable_stop_errors_allow_escalation() {
        let mut error = ConnectError::new(
            ErrorCode::Unavailable,
            "runtime shutdown controller is not attached",
        );
        error.details.push(error_detail(
            "google.rpc.ErrorInfo",
            &error_info(
                "SUPERVISOR_CONTROL_STARTUP_NOT_READY",
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

        assert_eq!(
            supervisor_control_error_allows_stop_escalation(&error),
            true
        );
        assert_eq!(
            supervisor_control_connect_error_summary(&error),
            Some(
                "supervisor control is not ready yet for stop: runtime shutdown controller is not attached; retryable after 250ms"
                    .to_owned()
            )
        );
    }

    #[test]
    fn typed_non_retryable_unavailable_errors_do_not_allow_escalation() {
        let mut error = ConnectError::new(ErrorCode::Unavailable, "actor stopped");
        error.details.push(error_detail(
            "google.rpc.ErrorInfo",
            &error_info(
                "SUPERVISOR_CONTROL_ACTOR_UNAVAILABLE",
                &[("operation", "watchStatus"), ("retryable", "false")],
            ),
        ));

        assert_eq!(
            supervisor_control_error_allows_stop_escalation(&error),
            false
        );
    }

    #[test]
    fn typed_supervisor_errors_skip_malformed_error_info_before_valid_match() {
        let mut error = ConnectError::new(ErrorCode::Unavailable, "runtime is still starting");
        error.details.push(connectrpc::error::ErrorDetail {
            type_url: "google.rpc.ErrorInfo".to_owned(),
            value: Some("not-base64".to_owned()),
            debug: None,
        });
        error.details.push(error_detail(
            "google.rpc.ErrorInfo",
            &error_info(
                "SUPERVISOR_CONTROL_STARTUP_NOT_READY",
                &[("operation", "stop"), ("retryable", "true")],
            ),
        ));

        assert_eq!(
            supervisor_control_error_allows_stop_escalation(&error),
            true
        );
        assert_eq!(
            supervisor_control_connect_error_summary(&error),
            Some(
                "supervisor control is not ready yet for stop: runtime is still starting; retryable"
                    .to_owned()
            )
        );
    }

    #[test]
    fn typed_retryable_non_stop_errors_do_not_allow_escalation() {
        let mut error = ConnectError::new(ErrorCode::Unavailable, "watch closed");
        error.details.push(error_detail(
            "google.rpc.ErrorInfo",
            &error_info(
                "SUPERVISOR_CONTROL_ACTOR_UNAVAILABLE",
                &[("operation", "watchStatus"), ("retryable", "true")],
            ),
        ));

        assert_eq!(
            supervisor_control_error_allows_stop_escalation(&error),
            false
        );
    }

    #[test]
    fn unstructured_unknown_and_unimplemented_errors_do_not_allow_escalation() {
        for code in [ErrorCode::Unknown, ErrorCode::Unimplemented] {
            let error = ConnectError::new(code, "unstructured control error");

            assert_eq!(
                supervisor_control_error_allows_stop_escalation(&error),
                false
            );
        }
    }

    #[test]
    fn unstructured_unavailable_only_allows_stop_stream_loss_escalation() {
        let broad_unavailable = ConnectError::new(ErrorCode::Unavailable, "socket unavailable");
        let stream_loss = ConnectError::new(
            ErrorCode::Unavailable,
            "supervisor control stop command stream is not attached",
        );

        assert_eq!(
            supervisor_control_error_allows_stop_escalation(&broad_unavailable),
            false
        );
        assert_eq!(
            supervisor_control_error_allows_stop_escalation(&stream_loss),
            true
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
