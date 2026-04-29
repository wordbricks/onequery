use buffa::EnumValue;
use connectrpc::ConnectError;
use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;

pub(crate) use crate::supervisor_control_proto::runtime_phase_label;
use crate::supervisor_control_proto::types;

use super::super::state::GatewayRuntimeState;
use super::control_error::supervisor_control_connect_error_summary;
use super::control_error::with_supervisor_control_connect_error_metadata;
use super::lifecycle::ManagedRuntimeIdentity;
use super::lifecycle::read_supervisor_control_identity_for_recovery;
use super::shutdown::supervisor_stop_target;
use super::supervisor_control::client::get_supervisor_status;

pub(crate) use super::control_error::supervisor_control_error_allows_stop_escalation;

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct LiveSupervisorRuntimeStatus {
    pub(crate) pid: Option<u32>,
    pub(crate) launch_id: Option<String>,
    pub(crate) data_dir: Option<String>,
    pub(crate) phase: types::RuntimePhase,
    pub(crate) runtime_sequence: Option<u64>,
}

pub(crate) async fn read_live_runtime_status(
    state: &GatewayRuntimeState,
    command_line: &str,
) -> Result<Option<LiveSupervisorRuntimeStatus>, CliError> {
    let Some(identity) = read_supervisor_control_identity_for_recovery(&state.paths, command_line)?
    else {
        return Ok(None);
    };
    let target = supervisor_stop_target(&state.paths, &identity.runtime, &identity.supervisor);

    get_supervisor_status(&state.paths, target)
        .await
        .map(|status| Some(status_from_supervisor_status(status, &identity.runtime)))
        .map_err(|error| live_supervisor_status_error(&error, command_line))
}

fn live_supervisor_status_error(error: &ConnectError, command_line: &str) -> CliError {
    let detail = supervisor_control_connect_error_summary(error).unwrap_or_else(|| {
        format!(
            "supervisor control GetStatus returned {}: {error}",
            error.code.as_str()
        )
    });
    let cli_error = CliError::new(
        "failed to read live gateway status",
        command_line,
        ErrorStage::Internal,
        detail,
        vec!["retry onequery gateway status".to_owned()],
    );

    with_supervisor_control_connect_error_metadata(
        error,
        cli_error,
        Some(format!("supervisor_control_{}", error.code.as_str())),
    )
}

fn runtime_phase_from_proto(value: Option<EnumValue<types::RuntimePhase>>) -> types::RuntimePhase {
    value
        .and_then(|value| value.as_known())
        .unwrap_or(types::RuntimePhase::RUNTIME_PHASE_UNSPECIFIED)
}

fn status_from_supervisor_status(
    status: types::SupervisorStatus,
    identity: &ManagedRuntimeIdentity,
) -> LiveSupervisorRuntimeStatus {
    let runtime = status.runtime.into_option();
    let launch = status.launch.into_option();

    LiveSupervisorRuntimeStatus {
        pid: runtime.as_ref().and_then(|runtime| runtime.pid),
        launch_id: runtime
            .as_ref()
            .and_then(|runtime| runtime.launch_id.clone())
            .or_else(|| Some(identity.launch_id.clone())),
        data_dir: runtime
            .as_ref()
            .and_then(|runtime| runtime.data_dir.clone())
            .or_else(|| launch.and_then(|launch| launch.data_dir)),
        phase: runtime_phase_from_proto(status.runtime_phase),
        runtime_sequence: status.runtime_sequence,
    }
}
