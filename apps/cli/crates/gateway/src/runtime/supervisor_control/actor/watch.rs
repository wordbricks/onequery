use tokio::sync::broadcast;

use crate::supervisor_control_proto::types;

use super::SupervisorControlActor;

#[derive(Clone, Debug)]
pub(super) enum SupervisorWatchEvent {
    Snapshot(types::SupervisorStatus),
    SupervisorTransition(types::SupervisorTransition),
    RuntimeTransition(types::RuntimeTransition),
}

impl SupervisorControlActor {
    pub(super) fn publish_runtime_transition(&self, transition: types::RuntimeTransition) {
        let _ = self
            .state
            .events
            .send(SupervisorWatchEvent::RuntimeTransition(transition));
    }

    pub(super) fn publish_snapshot(&self, status: types::SupervisorStatus) {
        let _ = self
            .state
            .events
            .send(SupervisorWatchEvent::Snapshot(status));
    }

    pub(crate) async fn watch_status(
        &self,
        after_supervisor_sequence: u64,
        include_snapshot: bool,
    ) -> connectrpc::ServiceStream<types::SupervisorLifecycleServiceWatchStatusResponse> {
        let receiver = self.state.events.subscribe();
        let initial = if include_snapshot {
            Some(watch_snapshot_response(self.snapshot().await))
        } else {
            None
        };

        Box::pin(futures::stream::unfold(
            (initial, after_supervisor_sequence, receiver),
            |(mut initial, after_supervisor_sequence, mut receiver)| async move {
                if let Some(response) = initial.take() {
                    return Some((Ok(response), (initial, after_supervisor_sequence, receiver)));
                }

                loop {
                    match receiver.recv().await {
                        Ok(event)
                            if event.is_after_supervisor_sequence(after_supervisor_sequence) =>
                        {
                            return Some((
                                Ok(event.into_watch_response()),
                                (initial, after_supervisor_sequence, receiver),
                            ));
                        }
                        Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(broadcast::error::RecvError::Closed) => return None,
                    }
                }
            },
        ))
    }
}

impl SupervisorWatchEvent {
    fn is_after_supervisor_sequence(&self, after_supervisor_sequence: u64) -> bool {
        match self {
            Self::Snapshot(_) => true,
            Self::SupervisorTransition(transition) => {
                transition.supervisor_sequence.unwrap_or(0) > after_supervisor_sequence
            }
            Self::RuntimeTransition(_) => true,
        }
    }

    fn into_watch_response(self) -> types::SupervisorLifecycleServiceWatchStatusResponse {
        match self {
            Self::Snapshot(status) => watch_snapshot_response(status),
            Self::SupervisorTransition(transition) => {
                types::SupervisorLifecycleServiceWatchStatusResponse {
                    event: Some(
                        types::supervisor_lifecycle_service_watch_status_response::Event::SupervisorTransition(
                            Box::new(transition),
                        ),
                    ),
                    ..Default::default()
                }
            }
            Self::RuntimeTransition(transition) => {
                types::SupervisorLifecycleServiceWatchStatusResponse {
                    event: Some(
                        types::supervisor_lifecycle_service_watch_status_response::Event::RuntimeTransition(
                            Box::new(transition),
                        ),
                    ),
                    ..Default::default()
                }
            }
        }
    }
}

fn watch_snapshot_response(
    status: types::SupervisorStatus,
) -> types::SupervisorLifecycleServiceWatchStatusResponse {
    types::SupervisorLifecycleServiceWatchStatusResponse {
        event: Some(
            types::supervisor_lifecycle_service_watch_status_response::Event::Snapshot(Box::new(
                status,
            )),
        ),
        ..Default::default()
    }
}
