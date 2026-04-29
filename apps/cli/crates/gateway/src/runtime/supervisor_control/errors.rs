use connectrpc::ConnectError;
use connectrpc::error::ErrorCode;

pub(super) fn failed_precondition(message: impl Into<String>) -> ConnectError {
    ConnectError::new(ErrorCode::FailedPrecondition, message)
}
