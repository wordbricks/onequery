use crate::supervisor_control_proto::types;

use super::super::errors::failed_precondition;
use super::super::errors::invalid_argument;

pub(super) trait SupervisorStatusIdentityExt {
    fn launch_id(&self) -> Option<&str>;
    fn data_dir(&self) -> Option<&str>;
    fn runtime_pid(&self) -> Option<u32>;
    fn supervisor_id(&self) -> Option<&str>;
    fn supervisor_pid(&self) -> Option<u32>;
    fn supervisor_generation(&self) -> Option<u64>;
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
            .or_else(|| self.runtime.as_option().and_then(|runtime| runtime.pid))
    }

    fn supervisor_id(&self) -> Option<&str> {
        self.identity
            .as_option()
            .and_then(|identity| identity.supervisor_id.as_deref())
    }

    fn supervisor_pid(&self) -> Option<u32> {
        self.identity
            .as_option()
            .and_then(|identity| identity.pid)
            .or_else(|| {
                self.launch
                    .as_option()
                    .and_then(|launch| launch.supervisor_pid)
            })
    }

    fn supervisor_generation(&self) -> Option<u64> {
        self.identity
            .as_option()
            .and_then(|identity| identity.generation)
            .or_else(|| {
                self.launch
                    .as_option()
                    .and_then(|launch| launch.supervisor_generation)
            })
    }
}

pub(super) fn validate_target_field<T>(
    field: &'static str,
    actual: Option<T>,
    expected: Option<T>,
) -> Result<(), connectrpc::ConnectError>
where
    T: Copy + Eq,
{
    if actual == expected {
        return Ok(());
    }

    Err(failed_precondition(format!(
        "supervisor control target field {field} does not match active launch"
    )))
}

pub(super) fn required_operation_id<'a>(
    operation_id: Option<&'a str>,
    field: &'static str,
) -> Result<&'a str, connectrpc::ConnectError> {
    let Some(operation_id) = operation_id.filter(|operation_id| !operation_id.is_empty()) else {
        return Err(invalid_argument(format!("{field} is required")));
    };
    validate_uuid(operation_id, field)?;

    Ok(operation_id)
}

pub(super) fn validate_uuid(
    value: &str,
    field: &'static str,
) -> Result<(), connectrpc::ConnectError> {
    uuid::Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| invalid_argument(format!("{field} must be a UUID")))
}

pub(super) fn required_u64(
    value: Option<u64>,
    field: &'static str,
) -> Result<u64, connectrpc::ConnectError> {
    value
        .filter(|value| *value >= 1)
        .ok_or_else(|| invalid_argument(format!("{field} is required")))
}

pub(super) fn required_runtime_status_sequence(
    status: &types::RuntimeStatus,
    field: &'static str,
) -> Result<u64, connectrpc::ConnectError> {
    required_u64(status.runtime_sequence, field)
}

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

pub(super) fn validate_required_timestamp<T: Default>(
    timestamp: &buffa::MessageField<T>,
    field: &'static str,
) -> Result<(), connectrpc::ConnectError> {
    if timestamp.as_option().is_some() {
        return Ok(());
    }

    Err(invalid_argument(format!("{field} is required")))
}

pub(super) fn validate_required_phase(
    phase: Option<buffa::EnumValue<types::RuntimePhase>>,
    field: &'static str,
) -> Result<types::RuntimePhase, connectrpc::ConnectError> {
    let Some(phase) = phase.and_then(|phase| phase.as_known()) else {
        return Err(invalid_argument(format!("{field} is required")));
    };
    if phase == types::RuntimePhase::RUNTIME_PHASE_UNSPECIFIED {
        return Err(invalid_argument(format!("{field} must not be unspecified")));
    }

    Ok(phase)
}
