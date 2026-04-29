use buffa::EnumValue;

use crate::runtime_control::types;

use super::super::state::GatewayRuntimeState;
use super::lifecycle::ManagedRuntimeIdentity;
use super::lifecycle::read_supervisor_control_identity_for_recovery;
use super::shutdown::supervisor_stop_target;
use super::supervisor_control::client::get_supervisor_status;

pub(crate) use super::control_error::runtime_control_error_allows_fallback;

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct LiveSupervisorRuntimeStatus {
    pub(crate) pid: Option<u32>,
    pub(crate) launch_id: Option<String>,
    pub(crate) data_dir: Option<String>,
    pub(crate) phase: types::RuntimePhase,
    pub(crate) runtime_sequence: Option<u64>,
}

pub(crate) const fn runtime_phase_label(phase: types::RuntimePhase) -> &'static str {
    match phase {
        types::RuntimePhase::RUNTIME_PHASE_UNSPECIFIED => "unspecified",
        types::RuntimePhase::RUNTIME_PHASE_STARTING => "starting",
        types::RuntimePhase::RUNTIME_PHASE_READY => "ready",
        types::RuntimePhase::RUNTIME_PHASE_DRAINING => "draining",
        types::RuntimePhase::RUNTIME_PHASE_CHECKPOINTING => "checkpointing",
        types::RuntimePhase::RUNTIME_PHASE_STOPPING => "stopping",
        types::RuntimePhase::RUNTIME_PHASE_STOPPED => "stopped",
        types::RuntimePhase::RUNTIME_PHASE_SHUTDOWN_FAILED => "shutdown_failed",
        types::RuntimePhase::RUNTIME_PHASE_FAILED => "failed",
    }
}

pub(crate) async fn read_live_runtime_status(
    state: &GatewayRuntimeState,
    command_line: &str,
) -> Option<LiveSupervisorRuntimeStatus> {
    let identity = read_supervisor_control_identity_for_recovery(&state.paths, command_line)
        .ok()
        .flatten()?;
    let target =
        supervisor_stop_target(&state.paths, &identity.runtime, &identity.supervisor);

    get_supervisor_status(&state.paths, target)
        .await
        .ok()
        .map(|status| status_from_supervisor_status(status, &identity.runtime))
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
