use connectrpc::ConnectError;
use connectrpc::error::ErrorCode;

pub(super) fn failed_precondition(message: impl Into<String>) -> ConnectError {
    ConnectError::new(ErrorCode::FailedPrecondition, message)
}

pub(super) fn invalid_argument(message: impl Into<String>) -> ConnectError {
    ConnectError::new(ErrorCode::InvalidArgument, message)
}

pub(super) fn missing_required_field(field: &str) -> ConnectError {
    invalid_argument(format!("{field} is required"))
}
