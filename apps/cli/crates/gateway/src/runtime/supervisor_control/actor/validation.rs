use crate::supervisor_control_proto::types;

use super::super::errors::failed_precondition;
pub(super) trait SupervisorStatusIdentityExt {
    fn launch_id(&self) -> Option<&str>;
    fn data_dir(&self) -> Option<&str>;
    fn runtime_pid(&self) -> Option<u32>;
}

impl SupervisorStatusIdentityExt for types::SupervisorStatus {
    fn launch_id(&self) -> Option<&str> {
        self.launch
            .as_option()
            .and_then(|launch| launch.launch_id.as_deref())
    }

    fn data_dir(&self) -> Option<&str> {
        self.launch
            .as_option()
            .and_then(|launch| launch.data_dir.as_deref())
    }

    fn runtime_pid(&self) -> Option<u32> {
        self.launch
            .as_option()
            .and_then(|launch| launch.runtime_pid)
    }
}

pub(super) fn validate_target_field<T>(
    field: &'static str,
    actual: T,
    expected: Option<T>,
) -> Result<(), connectrpc::ConnectError>
where
    T: Copy + Eq,
{
    if Some(actual) == expected {
        return Ok(());
    }

    Err(failed_precondition(format!(
        "supervisor control target field {field} does not match active launch"
    )))
}

// Comment: keep this module limited to stateful supervisor-control validation.
// Required fields, oneof presence, and scalar ranges are specified in the
// runtime protos with buf.validate annotations; re-adding them here creates a
// second source of truth.
pub(super) fn validate_runtime_sequence_not_backward(
    current: Option<u64>,
    next: u64,
    field: &'static str,
) -> Result<(), connectrpc::ConnectError> {
    if current.is_some_and(|current| next < current) {
        return Err(failed_precondition(format!(
            "{field} must not move backward"
        )));
    }

    Ok(())
}
