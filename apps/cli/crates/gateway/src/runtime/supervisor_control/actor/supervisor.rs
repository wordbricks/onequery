use crate::supervisor_control_proto::types;

use super::SupervisorControlActor;
use super::watch::SupervisorWatchEvent;

impl SupervisorControlActor {
    #[cfg(test)]
    pub(super) async fn publish_supervisor_transition(
        &self,
        transition: types::SupervisorTransition,
        status: types::SupervisorStatus,
    ) {
        self.replace_status(status).await;
        let _ = self
            .state
            .events
            .send(SupervisorWatchEvent::SupervisorTransition(transition));
    }

    pub(crate) async fn apply_supervisor_transition(
        &self,
        transition: types::SupervisorTransition,
        status: Option<types::SupervisorStatus>,
    ) {
        {
            let mut current = self.state.status.write().await;
            if let Some(mut status) = status {
                let has_runtime_identity = status.runtime.as_option().is_some();
                status.active_session = current.active_session;
                if has_runtime_identity {
                    status.runtime_phase = current.runtime_phase;
                    status.runtime_sequence = current.runtime_sequence;
                }
                *current = status;
            } else {
                current.phase = transition.current_phase;
                current.supervisor_sequence = transition.supervisor_sequence;
                current.updated_at = transition.occurred_at.clone();
                if transition.runtime.as_option().is_some() {
                    current.runtime = transition.runtime.clone();
                }
                current.failure = transition.failure.clone();
            }
        }
        if transition
            .current_phase
            .and_then(|phase| phase.as_known())
            .is_some_and(is_terminal_supervisor_phase)
        {
            self.clear_current_stop().await;
        }
        let _ = self
            .state
            .events
            .send(SupervisorWatchEvent::SupervisorTransition(transition));
    }
}

fn is_terminal_supervisor_phase(phase: types::SupervisorPhase) -> bool {
    matches!(
        phase,
        types::SupervisorPhase::SUPERVISOR_PHASE_EXITED
            | types::SupervisorPhase::SUPERVISOR_PHASE_FAILED
    )
}
