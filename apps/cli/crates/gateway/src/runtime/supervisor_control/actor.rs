use std::sync::Arc;
use std::sync::atomic::AtomicU64;
use std::sync::atomic::Ordering;

use tokio::sync::Mutex;
use tokio::sync::Notify;
use tokio::sync::RwLock;
use tokio::sync::broadcast;
use tokio::sync::mpsc;

use crate::supervisor_control_proto::types;

use super::errors::failed_precondition;
use super::errors::missing_required_field;
mod stop;
mod supervisor;
mod transitions;
mod validation;
mod watch;

use stop::SupervisorStopOperation;
pub(crate) use stop::SupervisorStopRequest;
#[cfg(test)]
use stop::stop_response;
use transitions::RuntimeTransitionFields;
use transitions::runtime_transition_from_fields;
use transitions::runtime_transition_from_status_update;
use validation::SupervisorStatusIdentityExt;
use validation::validate_runtime_sequence_not_backward;
use validation::validate_target_field;
use watch::SupervisorWatchEvent;

#[derive(Clone)]
pub(crate) struct SupervisorControlActor {
    state: Arc<SupervisorControlState>,
}

struct SupervisorControlState {
    command_sink: RwLock<Option<RuntimeSessionCommandSink>>,
    current_stop: Mutex<Option<SupervisorStopOperation>>,
    stop_requests_rx: Mutex<mpsc::Receiver<SupervisorStopRequest>>,
    stop_requests_tx: mpsc::Sender<SupervisorStopRequest>,
    status: RwLock<types::SupervisorStatus>,
    events: broadcast::Sender<SupervisorWatchEvent>,
    runtime_ready: Notify,
    session_sequence: AtomicU64,
}

struct RuntimeSessionCommandSink {
    session_id: u64,
    identity: RuntimeSessionIdentity,
    last_heartbeat_sequence: Option<u64>,
    tx: mpsc::Sender<types::OpenRuntimeSessionResponse>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct RuntimeSessionIdentity {
    launch_id: String,
    data_dir: String,
    runtime_pid: u32,
}

struct ControlIdentityFields<'a> {
    launch_id: &'a str,
    data_dir: &'a str,
    runtime_pid: u32,
}

fn validate_control_identity<'a>(
    fields: ControlIdentityFields<'a>,
    status: &types::SupervisorStatus,
) -> Result<(), connectrpc::ConnectError> {
    validate_target_field("launch_id", fields.launch_id, status.launch_id())?;
    validate_target_field("data_dir", fields.data_dir, status.data_dir())?;
    validate_target_field("runtime_pid", fields.runtime_pid, status.runtime_pid())?;

    Ok(())
}

impl SupervisorControlActor {
    pub(crate) fn new(initial_status: types::SupervisorStatus) -> Self {
        let (events, _) = broadcast::channel(128);
        let (stop_requests_tx, stop_requests_rx) = mpsc::channel(16);

        Self {
            state: Arc::new(SupervisorControlState {
                command_sink: RwLock::new(None),
                current_stop: Mutex::new(None),
                stop_requests_rx: Mutex::new(stop_requests_rx),
                stop_requests_tx,
                status: RwLock::new(initial_status),
                events,
                runtime_ready: Notify::new(),
                session_sequence: AtomicU64::new(0),
            }),
        }
    }

    pub(crate) async fn snapshot(&self) -> types::SupervisorStatus {
        self.state.status.read().await.clone()
    }

    pub(super) async fn validate_session_hello(
        &self,
        hello: &types::RuntimeSessionHelloView<'_>,
    ) -> Result<RuntimeSessionIdentity, connectrpc::ConnectError> {
        let status = self.snapshot().await;
        let launch_id = hello
            .launch_id
            .ok_or_else(|| missing_required_field("runtime_session_hello.launch_id"))?;
        let data_dir = hello
            .data_dir
            .ok_or_else(|| missing_required_field("runtime_session_hello.data_dir"))?;
        let runtime_pid = hello
            .runtime_pid
            .ok_or_else(|| missing_required_field("runtime_session_hello.runtime_pid"))?;
        validate_control_identity(
            ControlIdentityFields {
                launch_id,
                data_dir,
                runtime_pid,
            },
            &status,
        )?;

        Ok(RuntimeSessionIdentity {
            launch_id: launch_id.to_owned(),
            data_dir: data_dir.to_owned(),
            runtime_pid,
        })
    }

    pub(super) async fn open_runtime_session_commands(
        &self,
        identity: RuntimeSessionIdentity,
    ) -> Result<(u64, mpsc::Receiver<types::OpenRuntimeSessionResponse>), connectrpc::ConnectError>
    {
        let session_id = self.state.session_sequence.fetch_add(1, Ordering::Relaxed) + 1;
        let (tx, rx) = mpsc::channel(16);
        {
            let mut command_sink = self.state.command_sink.write().await;
            if command_sink.is_some() {
                return Err(failed_precondition("runtime session is already active"));
            }
            *command_sink = Some(RuntimeSessionCommandSink {
                session_id,
                identity,
                last_heartbeat_sequence: None,
                tx,
            });
        }
        let status = {
            let mut status = self.state.status.write().await;
            status.active_session = Some(true);
            status.clone()
        };
        self.publish_snapshot(status);

        Ok((session_id, rx))
    }

    pub(super) async fn close_runtime_session_commands(&self, session_id: u64) {
        let mut sink = self.state.command_sink.write().await;
        if sink
            .as_ref()
            .is_some_and(|active| active.session_id == session_id)
        {
            *sink = None;
            let status = {
                let mut status = self.state.status.write().await;
                status.active_session = Some(false);
                status.clone()
            };
            self.publish_snapshot(status);
        }
    }

    pub(super) async fn apply_runtime_ready(
        &self,
        session_id: u64,
        ready: &types::RuntimeReady,
    ) -> Result<(), connectrpc::ConnectError> {
        let identity = self.validate_session_owner(session_id).await?;
        let runtime_status = ready
            .status
            .as_option()
            .ok_or_else(|| missing_required_field("runtime_ready.status"))?
            .clone();
        let transition = self
            .apply_runtime_status_update(&identity, &runtime_status, "runtime-ready", None)
            .await?;
        self.state.runtime_ready.notify_waiters();
        self.publish_runtime_transition(transition);
        Ok(())
    }

    pub(super) async fn apply_runtime_heartbeat(
        &self,
        session_id: u64,
        heartbeat: &types::RuntimeSessionHeartbeat,
    ) -> Result<(), connectrpc::ConnectError> {
        let heartbeat_sequence = heartbeat.heartbeat_sequence.ok_or_else(|| {
            missing_required_field("runtime_session_heartbeat.heartbeat_sequence")
        })?;
        {
            let mut sink = self.state.command_sink.write().await;
            let Some(active) = sink.as_mut() else {
                return Err(failed_precondition(
                    "runtime session event arrived after session closed",
                ));
            };
            if active.session_id != session_id {
                return Err(failed_precondition(
                    "runtime session event belongs to stale session",
                ));
            }
            if active
                .last_heartbeat_sequence
                .is_some_and(|last| heartbeat_sequence <= last)
            {
                return Err(failed_precondition(
                    "heartbeat.heartbeat_sequence must advance",
                ));
            }
            active.last_heartbeat_sequence = Some(heartbeat_sequence);
        }
        let mut status = self.state.status.write().await;
        status.active_session = Some(true);
        Ok(())
    }

    pub(super) async fn apply_runtime_shutdown_started(
        &self,
        session_id: u64,
        started: &types::RuntimeShutdownStarted,
    ) -> Result<(), connectrpc::ConnectError> {
        self.validate_session_owner(session_id).await?;
        let operation_id = started
            .operation_id
            .as_deref()
            .ok_or_else(|| missing_required_field("runtime_shutdown_started.operation_id"))?;
        let runtime_sequence = started
            .runtime_sequence
            .ok_or_else(|| missing_required_field("runtime_shutdown_started.runtime_sequence"))?;
        let transition = {
            let mut status = self.state.status.write().await;
            validate_runtime_sequence_not_backward(
                status.runtime_sequence,
                runtime_sequence,
                "shutdown_started.runtime_sequence",
            )?;
            let previous_phase = status
                .runtime_phase
                .and_then(|phase| phase.as_known())
                .unwrap_or(types::RuntimePhase::RUNTIME_PHASE_READY);
            status.runtime_phase = Some(types::RuntimePhase::RUNTIME_PHASE_STOPPING.into());
            status.runtime_sequence = started.runtime_sequence;
            status.updated_at = started.started_at.clone();
            status.active_session = Some(true);
            runtime_transition_from_fields(RuntimeTransitionFields {
                transition_id: format!("shutdown-started:{operation_id}"),
                runtime_sequence: started.runtime_sequence,
                previous_phase,
                current_phase: types::RuntimePhase::RUNTIME_PHASE_STOPPING,
                reason: started
                    .reason
                    .clone()
                    .ok_or_else(|| missing_required_field("runtime_shutdown_started.reason"))?,
                occurred_at: started.started_at.clone(),
                failure: None,
                caller_operation_id: Some(operation_id.to_owned()),
            })
        };
        self.publish_runtime_transition(transition);
        Ok(())
    }

    pub(super) async fn apply_runtime_shutdown_finished(
        &self,
        session_id: u64,
        finished: &types::RuntimeShutdownFinished,
    ) -> Result<(), connectrpc::ConnectError> {
        let identity = self.validate_session_owner(session_id).await?;
        let operation_id = finished
            .operation_id
            .as_deref()
            .ok_or_else(|| missing_required_field("runtime_shutdown_finished.operation_id"))?;
        let runtime_status = finished
            .status
            .as_option()
            .ok_or_else(|| missing_required_field("runtime_shutdown_finished.status"))?
            .clone();
        self.validate_current_stop_operation_id(
            Some(operation_id),
            "shutdown_finished.operation_id",
        )
        .await?;
        let transition = self
            .apply_runtime_status_update(
                &identity,
                &runtime_status,
                "shutdown-finished",
                Some(operation_id.to_owned()),
            )
            .await?;
        self.publish_runtime_transition(transition);
        Ok(())
    }

    pub(super) async fn apply_runtime_shutdown_failed(
        &self,
        session_id: u64,
        failed: &types::RuntimeShutdownFailed,
    ) -> Result<(), connectrpc::ConnectError> {
        let identity = self.validate_session_owner(session_id).await?;
        let operation_id = failed
            .operation_id
            .as_deref()
            .ok_or_else(|| missing_required_field("runtime_shutdown_failed.operation_id"))?;
        let runtime_status = failed
            .status
            .as_option()
            .ok_or_else(|| missing_required_field("runtime_shutdown_failed.status"))?
            .clone();
        self.validate_current_stop_operation_id(Some(operation_id), "shutdown_failed.operation_id")
            .await?;
        let transition = {
            let mut status = self.state.status.write().await;
            let runtime_sequence = runtime_status
                .runtime_sequence
                .ok_or_else(|| missing_required_field("runtime_status.runtime_sequence"))?;
            validate_runtime_sequence_not_backward(
                status.runtime_sequence,
                runtime_sequence,
                "shutdown_failed.status.runtime_sequence",
            )?;
            let previous_phase = status
                .runtime_phase
                .and_then(|phase| phase.as_known())
                .unwrap_or(types::RuntimePhase::RUNTIME_PHASE_STOPPING);
            status.runtime_phase = runtime_status.phase;
            status.runtime_sequence = runtime_status.runtime_sequence;
            status.updated_at = runtime_status.updated_at.clone();
            status.runtime = buffa::MessageField::some(identity.runtime_identity());
            status.active_session = Some(true);
            runtime_transition_from_fields(RuntimeTransitionFields {
                transition_id: format!("shutdown-failed:{operation_id}"),
                runtime_sequence: runtime_status.runtime_sequence,
                previous_phase,
                current_phase: types::RuntimePhase::RUNTIME_PHASE_SHUTDOWN_FAILED,
                reason: failed
                    .failure
                    .as_option()
                    .and_then(|failure| failure.message.clone())
                    .unwrap_or_else(|| "shutdown failed".to_owned()),
                occurred_at: failed.failed_at.clone(),
                failure: failed.failure.as_option().cloned(),
                caller_operation_id: Some(operation_id.to_owned()),
            })
        };
        self.publish_runtime_transition(transition);
        Ok(())
    }

    pub(crate) async fn apply_supervisor_terminal_runtime_status(
        &self,
        runtime_status: types::RuntimeStatus,
        transition_id_prefix: &str,
    ) {
        let transition = {
            let mut status = self.state.status.write().await;
            let runtime_identity = status
                .launch
                .as_option()
                .and_then(runtime_identity_from_launch);
            let previous_phase = status
                .runtime_phase
                .and_then(|phase| phase.as_known())
                .unwrap_or(types::RuntimePhase::RUNTIME_PHASE_UNSPECIFIED);
            status.runtime_phase = runtime_status.phase;
            status.runtime_sequence = runtime_status.runtime_sequence;
            status.updated_at = runtime_status.updated_at.clone();
            status.active_session = Some(false);
            if let Some(identity) = runtime_identity {
                status.runtime = buffa::MessageField::some(identity);
            }
            runtime_transition_from_status_update(
                transition_id_prefix,
                previous_phase,
                &runtime_status,
                None,
            )
        };
        self.publish_runtime_transition(transition);
    }

    async fn apply_runtime_status_update(
        &self,
        identity: &RuntimeSessionIdentity,
        runtime_status: &types::RuntimeStatus,
        transition_id_prefix: &str,
        operation_id: Option<String>,
    ) -> Result<types::RuntimeTransition, connectrpc::ConnectError> {
        let mut status = self.state.status.write().await;
        let runtime_sequence = runtime_status
            .runtime_sequence
            .ok_or_else(|| missing_required_field("runtime_status.runtime_sequence"))?;
        validate_runtime_sequence_not_backward(
            status.runtime_sequence,
            runtime_sequence,
            "runtime_status.runtime_sequence",
        )?;
        let previous_phase = status
            .runtime_phase
            .and_then(|phase| phase.as_known())
            .unwrap_or(types::RuntimePhase::RUNTIME_PHASE_STARTING);
        status.active_session = Some(true);
        status.runtime_phase = runtime_status.phase;
        status.runtime_sequence = runtime_status.runtime_sequence;
        status.updated_at = runtime_status.updated_at.clone();
        status.runtime = buffa::MessageField::some(identity.runtime_identity());
        Ok(runtime_transition_from_status_update(
            transition_id_prefix,
            previous_phase,
            runtime_status,
            operation_id,
        ))
    }

    pub(crate) async fn wait_for_runtime_ready(&self) -> u32 {
        loop {
            if let Some(runtime_pid) = ready_runtime_pid(&self.snapshot().await) {
                return runtime_pid;
            }

            self.state.runtime_ready.notified().await;
        }
    }

    #[cfg(test)]
    pub(crate) async fn replace_status(&self, status: types::SupervisorStatus) {
        *self.state.status.write().await = status;
    }

    async fn validate_session_owner(
        &self,
        session_id: u64,
    ) -> Result<RuntimeSessionIdentity, connectrpc::ConnectError> {
        let sink = self.state.command_sink.read().await;
        let Some(sink) = sink.as_ref() else {
            return Err(failed_precondition(
                "runtime session event arrived after session closed",
            ));
        };
        if sink.session_id != session_id {
            return Err(failed_precondition(
                "runtime session event belongs to stale session",
            ));
        }
        Ok(sink.identity.clone())
    }
}

impl RuntimeSessionIdentity {
    fn runtime_identity(&self) -> types::RuntimeIdentity {
        types::RuntimeIdentity {
            launch_id: Some(self.launch_id.clone()),
            data_dir: Some(self.data_dir.clone()),
            pid: Some(self.runtime_pid),
            ..Default::default()
        }
    }
}

fn ready_runtime_pid(status: &types::SupervisorStatus) -> Option<u32> {
    if status.runtime_phase != Some(types::RuntimePhase::RUNTIME_PHASE_READY.into()) {
        return None;
    }

    status
        .runtime
        .as_option()
        .and_then(|runtime| runtime.pid)
        .or_else(|| {
            status
                .launch
                .as_option()
                .and_then(|launch| launch.runtime_pid)
        })
}

fn runtime_identity_from_launch(
    launch: &types::LifecycleLaunchIdentity,
) -> Option<types::RuntimeIdentity> {
    Some(types::RuntimeIdentity {
        launch_id: Some(launch.launch_id.clone()?),
        data_dir: Some(launch.data_dir.clone()?),
        pid: Some(launch.runtime_pid?),
        ..Default::default()
    })
}

#[cfg(test)]
mod tests;
