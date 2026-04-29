use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::AtomicU64;
use std::sync::atomic::Ordering;

use futures::Stream;
use tokio::sync::Mutex;
use tokio::sync::Notify;
use tokio::sync::RwLock;
use tokio::sync::broadcast;
use tokio::sync::mpsc;
use tokio::sync::oneshot;

use crate::runtime_control::types;

use super::errors::failed_precondition;

#[derive(Clone)]
pub(crate) struct SupervisorControlActor {
    state: Arc<SupervisorControlState>,
}

struct SupervisorControlState {
    command_sequence: AtomicU64,
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
    tx: mpsc::Sender<types::OpenRuntimeSessionResponse>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct RuntimeSessionIdentity {
    launch_id: String,
    data_dir: String,
    runtime_pid: u32,
    runtime_sequence_at_hello: u64,
    supervisor_id: String,
    supervisor_pid: u32,
    supervisor_generation: u64,
}

pub(crate) struct SupervisorStopRequest {
    pub(super) command: types::SupervisorStopCommand,
    response_tx: oneshot::Sender<
        Result<types::SupervisorLifecycleServiceStopResponse, connectrpc::ConnectError>,
    >,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct SupervisorStopOperation {
    operation_id: String,
    fingerprint: SupervisorStopCommandFingerprint,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct SupervisorStopCommandFingerprint {
    reason: Option<String>,
    completion: Option<types::RuntimeStopCompletion>,
    grace_seconds: Option<i64>,
    grace_nanos: Option<i32>,
    launch_id: Option<String>,
    data_dir: Option<String>,
    runtime_pid: Option<u32>,
    supervisor_id: Option<String>,
    supervisor_pid: Option<u32>,
    supervisor_generation: Option<u64>,
}

#[derive(Clone, Debug)]
pub(super) enum SupervisorWatchEvent {
    Snapshot(types::SupervisorStatus),
    SupervisorTransition(types::SupervisorTransition),
    RuntimeTransition(types::RuntimeTransition),
}

impl SupervisorControlActor {
    pub(crate) fn new(initial_status: types::SupervisorStatus) -> Self {
        let (events, _) = broadcast::channel(128);
        let (stop_requests_tx, stop_requests_rx) = mpsc::channel(16);

        Self {
            state: Arc::new(SupervisorControlState {
                command_sequence: AtomicU64::new(0),
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

    pub(super) async fn validate_target(
        &self,
        target: Option<&types::SupervisorStopTargetView<'_>>,
    ) -> Result<(), connectrpc::ConnectError> {
        let Some(target) = target else {
            return Err(failed_precondition("supervisor control target is required"));
        };
        let status = self.snapshot().await;

        validate_target_field("launch_id", target.launch_id, status.launch_id())?;
        validate_target_field("data_dir", target.data_dir, status.data_dir())?;
        validate_target_field("runtime_pid", target.runtime_pid, status.runtime_pid())?;

        let Some(supervisor) = target.supervisor.as_option() else {
            return Err(failed_precondition(
                "supervisor control target supervisor is required",
            ));
        };

        validate_target_field(
            "supervisor.supervisor_id",
            supervisor.supervisor_id,
            status.supervisor_id(),
        )?;
        validate_target_field("supervisor.pid", supervisor.pid, status.supervisor_pid())?;
        validate_target_field(
            "supervisor.generation",
            supervisor.generation,
            status.supervisor_generation(),
        )?;

        Ok(())
    }

    pub(super) async fn validate_session_hello(
        &self,
        hello: Option<&types::RuntimeSessionHelloView<'_>>,
    ) -> Result<RuntimeSessionIdentity, connectrpc::ConnectError> {
        let Some(hello) = hello else {
            return Err(failed_precondition(
                "runtime session hello is required before lifecycle events",
            ));
        };
        let status = self.snapshot().await;

        validate_target_field("launch_id", hello.launch_id, status.launch_id())?;
        validate_target_field("data_dir", hello.data_dir, status.data_dir())?;
        validate_target_field("runtime_pid", hello.runtime_pid, status.runtime_pid())?;

        let Some(supervisor) = hello.supervisor.as_option() else {
            return Err(failed_precondition(
                "runtime session hello supervisor is required",
            ));
        };

        validate_target_field(
            "supervisor.supervisor_id",
            supervisor.supervisor_id,
            status.supervisor_id(),
        )?;
        validate_target_field("supervisor.pid", supervisor.pid, status.supervisor_pid())?;
        validate_target_field(
            "supervisor.generation",
            supervisor.generation,
            status.supervisor_generation(),
        )?;

        Ok(RuntimeSessionIdentity {
            launch_id: hello.launch_id.unwrap_or_default().to_owned(),
            data_dir: hello.data_dir.unwrap_or_default().to_owned(),
            runtime_pid: hello.runtime_pid.unwrap_or_default(),
            runtime_sequence_at_hello: hello.runtime_sequence.unwrap_or(0),
            supervisor_id: supervisor.supervisor_id.unwrap_or_default().to_owned(),
            supervisor_pid: supervisor.pid.unwrap_or_default(),
            supervisor_generation: supervisor.generation.unwrap_or_default(),
        })
    }

    pub(super) async fn open_runtime_session_commands(
        &self,
        identity: RuntimeSessionIdentity,
    ) -> (u64, mpsc::Receiver<types::OpenRuntimeSessionResponse>) {
        let session_id = self.state.session_sequence.fetch_add(1, Ordering::Relaxed) + 1;
        let (tx, rx) = mpsc::channel(16);
        *self.state.command_sink.write().await = Some(RuntimeSessionCommandSink {
            session_id,
            identity,
            tx,
        });
        let status = {
            let mut status = self.state.status.write().await;
            status.active_session = Some(true);
            status.clone()
        };
        self.publish_snapshot(status);

        (session_id, rx)
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
        let Some(runtime_status) = ready.status.as_option() else {
            return Err(failed_precondition("runtime_ready status is required"));
        };
        identity.validate_runtime_status(runtime_status, "runtime_ready.status")?;
        let transition = self
            .apply_runtime_status_update(runtime_status, "runtime-ready", None)
            .await;
        {
            let mut status = self.state.status.write().await;
            status.phase = Some(types::SupervisorPhase::SUPERVISOR_PHASE_READY.into());
            status.supervisor_sequence = Some(status.supervisor_sequence.unwrap_or(0) + 1);
        }
        self.state.runtime_ready.notify_waiters();
        self.publish_runtime_transition(transition);
        Ok(())
    }

    pub(super) async fn apply_runtime_transition(
        &self,
        session_id: u64,
        transition: types::RuntimeTransition,
    ) -> Result<(), connectrpc::ConnectError> {
        self.validate_session_owner(session_id).await?;
        {
            let mut status = self.state.status.write().await;
            status.runtime_phase = transition.current_phase;
            status.runtime_sequence = transition.runtime_sequence;
            status.updated_at = transition.occurred_at.clone();
            status.active_session = Some(true);
        }
        self.publish_runtime_transition(transition);
        Ok(())
    }

    pub(super) async fn apply_runtime_heartbeat(
        &self,
        session_id: u64,
        heartbeat: &types::RuntimeSessionHeartbeat,
    ) -> Result<(), connectrpc::ConnectError> {
        self.validate_session_owner(session_id).await?;
        let mut status = self.state.status.write().await;
        status.runtime_phase = heartbeat.runtime_phase;
        status.runtime_sequence = heartbeat.runtime_sequence;
        status.updated_at = heartbeat.sent_at.clone();
        status.active_session = Some(true);
        Ok(())
    }

    pub(super) async fn apply_runtime_shutdown_started(
        &self,
        session_id: u64,
        started: &types::RuntimeShutdownStarted,
    ) -> Result<(), connectrpc::ConnectError> {
        self.validate_session_owner(session_id).await?;
        let transition = {
            let mut status = self.state.status.write().await;
            let previous_phase = status
                .runtime_phase
                .and_then(|phase| phase.as_known())
                .unwrap_or(types::RuntimePhase::RUNTIME_PHASE_READY);
            status.runtime_phase = Some(types::RuntimePhase::RUNTIME_PHASE_STOPPING.into());
            status.runtime_sequence = started.runtime_sequence;
            status.updated_at = started.started_at.clone();
            status.active_session = Some(true);
            runtime_transition_from_fields(
                format!(
                    "shutdown-started:{}",
                    started.operation_id.as_deref().unwrap_or("unknown")
                ),
                started.runtime_sequence,
                previous_phase,
                types::RuntimePhase::RUNTIME_PHASE_STOPPING,
                started
                    .reason
                    .clone()
                    .unwrap_or_else(|| "shutdown started".to_owned()),
                started.started_at.clone(),
                None,
                started.operation_id.clone(),
            )
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
        let Some(runtime_status) = finished.status.as_option() else {
            return Err(failed_precondition("shutdown_finished status is required"));
        };
        identity.validate_runtime_status(runtime_status, "shutdown_finished.status")?;
        let transition = self
            .apply_runtime_status_update(
                runtime_status,
                "shutdown-finished",
                finished.operation_id.clone(),
            )
            .await;
        self.publish_runtime_transition(transition);
        Ok(())
    }

    pub(super) async fn apply_runtime_shutdown_failed(
        &self,
        session_id: u64,
        failed: &types::RuntimeShutdownFailed,
    ) -> Result<(), connectrpc::ConnectError> {
        let identity = self.validate_session_owner(session_id).await?;
        let runtime_status = failed.status.as_option();
        if let Some(runtime_status) = runtime_status {
            identity.validate_runtime_status(runtime_status, "shutdown_failed.status")?;
        }
        let transition = {
            let mut status = self.state.status.write().await;
            let previous_phase = status
                .runtime_phase
                .and_then(|phase| phase.as_known())
                .unwrap_or(types::RuntimePhase::RUNTIME_PHASE_STOPPING);
            if let Some(runtime_status) = runtime_status {
                status.runtime_phase = runtime_status.phase;
                status.runtime_sequence = runtime_status.runtime_sequence;
                status.updated_at = runtime_status.updated_at.clone();
                if let Some(runtime_identity) = runtime_status.identity.as_option() {
                    status.runtime = buffa::MessageField::some(runtime_identity.clone());
                }
            } else {
                status.runtime_phase =
                    Some(types::RuntimePhase::RUNTIME_PHASE_SHUTDOWN_FAILED.into());
                status.updated_at = failed.failed_at.clone();
            }
            status.active_session = Some(true);
            runtime_transition_from_fields(
                format!(
                    "shutdown-failed:{}",
                    failed.operation_id.as_deref().unwrap_or("unknown")
                ),
                status.runtime_sequence,
                previous_phase,
                types::RuntimePhase::RUNTIME_PHASE_SHUTDOWN_FAILED,
                failed
                    .failure
                    .as_option()
                    .and_then(|failure| failure.message.clone())
                    .unwrap_or_else(|| "shutdown failed".to_owned()),
                failed.failed_at.clone(),
                failed.failure.as_option().cloned(),
                failed.operation_id.clone(),
            )
        };
        self.publish_runtime_transition(transition);
        Ok(())
    }

    pub(super) async fn apply_runtime_exiting(
        &self,
        session_id: u64,
        exiting: &types::RuntimeExiting,
    ) -> Result<(), connectrpc::ConnectError> {
        self.validate_session_owner(session_id).await?;
        let status = {
            let mut status = self.state.status.write().await;
            status.updated_at = exiting.exiting_at.clone();
            status.active_session = Some(true);
            status.clone()
        };
        self.publish_snapshot(status);
        Ok(())
    }

    async fn apply_runtime_status_update(
        &self,
        runtime_status: &types::RuntimeStatus,
        transition_id_prefix: &str,
        operation_id: Option<String>,
    ) -> types::RuntimeTransition {
        let mut status = self.state.status.write().await;
        let previous_phase = status
            .runtime_phase
            .and_then(|phase| phase.as_known())
            .unwrap_or(types::RuntimePhase::RUNTIME_PHASE_STARTING);
        status.active_session = Some(true);
        status.runtime_phase = runtime_status.phase;
        status.runtime_sequence = runtime_status.runtime_sequence;
        status.updated_at = runtime_status.updated_at.clone();
        if let Some(identity) = runtime_status.identity.as_option() {
            status.runtime = buffa::MessageField::some(identity.clone());
        }
        runtime_transition_from_status_update(
            transition_id_prefix,
            previous_phase,
            runtime_status,
            operation_id,
        )
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

    pub(crate) async fn send_stop_command(
        &self,
        command: types::SupervisorStopCommand,
    ) -> Result<types::SupervisorStatus, connectrpc::ConnectError> {
        let tx = self
            .state
            .command_sink
            .read()
            .await
            .as_ref()
            .map(|sink| sink.tx.clone())
            .ok_or_else(|| {
                failed_precondition("supervisor control stop command stream is not attached")
            })?;
        let operation_id = command.operation_id.clone().unwrap_or_else(|| {
            let sequence = self.state.command_sequence.fetch_add(1, Ordering::Relaxed) + 1;
            format!("generated-stop-{sequence}")
        });

        tx.send(types::OpenRuntimeSessionResponse {
            command_id: Some(format!("stop:{operation_id}")),
            command: Some(types::open_runtime_session_response::Command::Stop(
                Box::new(command),
            )),
            ..Default::default()
        })
        .await
        .map_err(|_| {
            failed_precondition("supervisor control stop command stream is not attached")
        })?;

        Ok(self.snapshot().await)
    }

    pub(super) async fn request_stop(
        &self,
        command: types::SupervisorStopCommand,
    ) -> Result<types::SupervisorLifecycleServiceStopResponse, connectrpc::ConnectError> {
        let operation_id = command.operation_id.clone().ok_or_else(|| {
            failed_precondition("supervisor control stop command operation_id is required")
        })?;
        let fingerprint = SupervisorStopCommandFingerprint::from_command(&command);
        {
            let mut current_stop = self.state.current_stop.lock().await;
            if let Some(current_stop) = current_stop.as_ref() {
                if current_stop.operation_id == operation_id {
                    if current_stop.fingerprint == fingerprint {
                        return Ok(stop_response(
                            types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ALREADY_STOPPING,
                            self.snapshot().await,
                        ));
                    }

                    return Err(failed_precondition(format!(
                        "supervisor control stop command operation_id {operation_id} was already used with different parameters"
                    )));
                }

                return Ok(stop_response(
                    types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ALREADY_STOPPING,
                    self.snapshot().await,
                ));
            }

            *current_stop = Some(SupervisorStopOperation {
                operation_id: operation_id.clone(),
                fingerprint,
            });
        }

        let (response_tx, response_rx) = oneshot::channel();
        self.state
            .stop_requests_tx
            .send(SupervisorStopRequest {
                command,
                response_tx,
            })
            .await
            .map_err(|_| failed_precondition("supervisor control stop monitor is not attached"))?;

        response_rx
            .await
            .map_err(|_| failed_precondition("supervisor control stop monitor closed"))?
    }

    pub(crate) async fn recv_stop_request(&self) -> Option<SupervisorStopRequest> {
        self.state.stop_requests_rx.lock().await.recv().await
    }

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
    ) {
        {
            let mut status = self.state.status.write().await;
            status.phase = transition.current_phase;
            status.supervisor_sequence = transition.supervisor_sequence;
            status.updated_at = transition.occurred_at.clone();
            if transition.runtime.as_option().is_some() {
                status.runtime = transition.runtime.clone();
            }
            status.failure = transition.failure.clone();
        }
        let _ = self
            .state
            .events
            .send(SupervisorWatchEvent::SupervisorTransition(transition));
    }

    pub(super) fn publish_runtime_transition(&self, transition: types::RuntimeTransition) {
        let _ = self
            .state
            .events
            .send(SupervisorWatchEvent::RuntimeTransition(transition));
    }

    fn publish_snapshot(&self, status: types::SupervisorStatus) {
        let _ = self
            .state
            .events
            .send(SupervisorWatchEvent::Snapshot(status));
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

    pub(crate) async fn watch_status(
        &self,
        after_supervisor_sequence: u64,
        include_snapshot: bool,
    ) -> Pin<
        Box<
            dyn Stream<
                    Item = Result<
                        types::SupervisorLifecycleServiceWatchStatusResponse,
                        connectrpc::ConnectError,
                    >,
                > + Send,
        >,
    > {
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

impl SupervisorStopRequest {
    pub(crate) fn operation_id(&self) -> String {
        self.command.operation_id.clone().unwrap_or_default()
    }

    pub(crate) fn complete(
        self,
        result: Result<types::SupervisorLifecycleServiceStopResponse, connectrpc::ConnectError>,
    ) {
        let _ = self.response_tx.send(result);
    }
}

impl SupervisorStopCommandFingerprint {
    fn from_command(command: &types::SupervisorStopCommand) -> Self {
        let target = command.target.as_option();
        let supervisor = target.and_then(|target| target.supervisor.as_option());
        let grace_timeout = command.grace_timeout.as_option();

        Self {
            reason: command.reason.clone(),
            completion: command
                .completion
                .and_then(|completion| completion.as_known()),
            grace_seconds: grace_timeout.map(|duration| duration.seconds),
            grace_nanos: grace_timeout.map(|duration| duration.nanos),
            launch_id: target.and_then(|target| target.launch_id.clone()),
            data_dir: target.and_then(|target| target.data_dir.clone()),
            runtime_pid: target.and_then(|target| target.runtime_pid),
            supervisor_id: supervisor.and_then(|supervisor| supervisor.supervisor_id.clone()),
            supervisor_pid: supervisor.and_then(|supervisor| supervisor.pid),
            supervisor_generation: supervisor.and_then(|supervisor| supervisor.generation),
        }
    }
}

impl RuntimeSessionIdentity {
    fn validate_runtime_status(
        &self,
        status: &types::RuntimeStatus,
        field: &'static str,
    ) -> Result<(), connectrpc::ConnectError> {
        let Some(identity) = status.identity.as_option() else {
            return Err(failed_precondition(format!("{field} identity is required")));
        };

        validate_target_field(
            "launch_id",
            identity.launch_id.as_deref(),
            Some(self.launch_id.as_str()),
        )?;
        validate_target_field(
            "data_dir",
            identity.data_dir.as_deref(),
            Some(self.data_dir.as_str()),
        )?;
        validate_target_field("runtime_pid", identity.pid, Some(self.runtime_pid))?;
        Ok(())
    }
}

fn stop_response(
    disposition: types::RuntimeStopDisposition,
    status: types::SupervisorStatus,
) -> types::SupervisorLifecycleServiceStopResponse {
    types::SupervisorLifecycleServiceStopResponse {
        disposition: Some(disposition.into()),
        status: buffa::MessageField::some(status),
        ..Default::default()
    }
}

fn ready_runtime_pid(status: &types::SupervisorStatus) -> Option<u32> {
    if status.phase != Some(types::SupervisorPhase::SUPERVISOR_PHASE_READY.into())
        || status.runtime_phase != Some(types::RuntimePhase::RUNTIME_PHASE_READY.into())
    {
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

trait SupervisorStatusIdentityExt {
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

fn validate_target_field<T>(
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

fn runtime_transition_from_status_update(
    transition_id_prefix: &str,
    previous_phase: types::RuntimePhase,
    runtime_status: &types::RuntimeStatus,
    operation_id: Option<String>,
) -> types::RuntimeTransition {
    let current_phase = runtime_status
        .phase
        .and_then(|phase| phase.as_known())
        .unwrap_or(types::RuntimePhase::RUNTIME_PHASE_UNSPECIFIED);
    runtime_transition_from_fields(
        format!(
            "{transition_id_prefix}:{}",
            runtime_status.runtime_sequence.unwrap_or(0)
        ),
        runtime_status.runtime_sequence,
        previous_phase,
        current_phase,
        transition_id_prefix.replace('-', " "),
        runtime_status.updated_at.clone(),
        runtime_status.failure.as_option().cloned(),
        operation_id,
    )
}

fn runtime_transition_from_fields(
    transition_id: String,
    runtime_sequence: Option<u64>,
    previous_phase: types::RuntimePhase,
    current_phase: types::RuntimePhase,
    reason: String,
    occurred_at: buffa::MessageField<buffa_types::google::protobuf::Timestamp>,
    failure: Option<types::RuntimeFailure>,
    operation_id: Option<String>,
) -> types::RuntimeTransition {
    types::RuntimeTransition {
        transition_id: Some(transition_id),
        runtime_sequence,
        previous_phase: Some(previous_phase.into()),
        current_phase: Some(current_phase.into()),
        reason: Some(reason),
        occurred_at,
        failure: failure.map(buffa::MessageField::some).unwrap_or_default(),
        caller_operation_id: operation_id,
        ..Default::default()
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

#[cfg(test)]
mod tests {
    use buffa::MessageField;
    use futures::StreamExt;
    use pretty_assertions::assert_eq;
    use tokio::time::Duration;
    use tokio::time::timeout;

    use super::*;

    #[tokio::test]
    async fn watch_status_emits_initial_snapshot_when_requested() {
        let actor = SupervisorControlActor::new(supervisor_status(7));

        let mut stream = actor.watch_status(0, true).await;
        let response = stream
            .next()
            .await
            .expect("expected snapshot response")
            .expect("expected successful snapshot response");

        let Some(types::supervisor_lifecycle_service_watch_status_response::Event::Snapshot(
            snapshot,
        )) = response.event
        else {
            panic!("expected snapshot event");
        };
        assert_eq!(snapshot.supervisor_sequence, Some(7));
    }

    #[tokio::test]
    async fn watch_status_filters_supervisor_transitions_by_sequence() {
        let actor = SupervisorControlActor::new(supervisor_status(1));

        let mut stream = actor.watch_status(2, false).await;
        actor
            .publish_supervisor_transition(supervisor_transition(2), supervisor_status(2))
            .await;
        actor
            .publish_supervisor_transition(supervisor_transition(3), supervisor_status(3))
            .await;

        let response = stream
            .next()
            .await
            .expect("expected transition response")
            .expect("expected successful transition response");

        let Some(
            types::supervisor_lifecycle_service_watch_status_response::Event::SupervisorTransition(
                transition,
            ),
        ) = response.event
        else {
            panic!("expected supervisor transition event");
        };
        assert_eq!(transition.supervisor_sequence, Some(3));
    }

    #[tokio::test]
    async fn runtime_ready_event_marks_active_session_and_wakes_waiters() {
        let actor = SupervisorControlActor::new(supervisor_status(1));
        let waiter = {
            let actor = actor.clone();
            tokio::spawn(async move { actor.wait_for_runtime_ready().await })
        };

        let (session_id, _commands) = actor
            .open_runtime_session_commands(session_identity())
            .await;
        actor
            .apply_runtime_ready(session_id, &runtime_ready())
            .await
            .expect("runtime_ready should be accepted");

        let runtime_pid = timeout(Duration::from_secs(1), waiter)
            .await
            .expect("runtime ready waiter should wake")
            .expect("runtime ready waiter task should complete");
        let status = actor.snapshot().await;

        assert_eq!(runtime_pid, 4242);
        assert_eq!(status.active_session, Some(true));
        assert_eq!(
            status.phase,
            Some(types::SupervisorPhase::SUPERVISOR_PHASE_READY.into())
        );
        assert_eq!(
            status.runtime_phase,
            Some(types::RuntimePhase::RUNTIME_PHASE_READY.into())
        );
        assert_eq!(status.runtime_sequence, Some(2));
        assert_eq!(status.supervisor_sequence, Some(2));
    }

    #[tokio::test]
    async fn stop_command_is_delivered_to_active_session() {
        let actor = SupervisorControlActor::new(supervisor_status(1));
        let (_session_id, mut commands) = actor
            .open_runtime_session_commands(session_identity())
            .await;

        actor
            .send_stop_command(supervisor_stop_command())
            .await
            .expect("stop command should send to active session");

        let command = commands
            .recv()
            .await
            .expect("active session should receive stop command");
        assert_eq!(command.command_id.as_deref(), Some("stop:stop-operation"));
        let Some(types::open_runtime_session_response::Command::Stop(command)) = command.command
        else {
            panic!("expected stop command");
        };
        assert_eq!(command.operation_id.as_deref(), Some("stop-operation"));
    }

    #[tokio::test]
    async fn duplicate_stop_operation_id_returns_already_stopping() {
        let actor = SupervisorControlActor::new(supervisor_status(1));
        let first_stop = {
            let actor = actor.clone();
            tokio::spawn(async move { actor.request_stop(supervisor_stop_command()).await })
        };
        let first_request = timeout(Duration::from_secs(1), actor.recv_stop_request())
            .await
            .expect("first stop request should be received")
            .expect("first stop request should be present");

        let response = actor
            .request_stop(supervisor_stop_command())
            .await
            .expect("duplicate stop request should be idempotent");

        assert_eq!(
            response.disposition.and_then(|value| value.as_known()),
            Some(types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ALREADY_STOPPING)
        );

        first_request.complete(Ok(stop_response(
            types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ACCEPTED,
            actor.snapshot().await,
        )));
        first_stop
            .await
            .expect("first stop task should complete")
            .expect("first stop response should be successful");
    }

    #[tokio::test]
    async fn duplicate_stop_operation_id_with_different_command_rejects_conflict() {
        let actor = SupervisorControlActor::new(supervisor_status(1));
        let first_stop = {
            let actor = actor.clone();
            tokio::spawn(async move { actor.request_stop(supervisor_stop_command()).await })
        };
        let first_request = timeout(Duration::from_secs(1), actor.recv_stop_request())
            .await
            .expect("first stop request should be received")
            .expect("first stop request should be present");
        let mut conflicting_command = supervisor_stop_command();
        conflicting_command.reason = Some("different stop".to_owned());

        let error = actor
            .request_stop(conflicting_command)
            .await
            .expect_err("conflicting duplicate operation should reject");

        assert_eq!(error.code, connectrpc::error::ErrorCode::FailedPrecondition);

        first_request.complete(Ok(stop_response(
            types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ACCEPTED,
            actor.snapshot().await,
        )));
        first_stop
            .await
            .expect("first stop task should complete")
            .expect("first stop response should be successful");
    }

    #[tokio::test]
    async fn mismatched_runtime_ready_does_not_mutate_status() {
        let actor = SupervisorControlActor::new(supervisor_status(1));
        let (session_id, _commands) = actor
            .open_runtime_session_commands(session_identity())
            .await;
        let ready = runtime_ready_with_launch_id("stale-launch");

        let error = actor
            .apply_runtime_ready(session_id, &ready)
            .await
            .expect_err("mismatched runtime status should be rejected");
        let status = actor.snapshot().await;

        assert_eq!(error.code, connectrpc::error::ErrorCode::FailedPrecondition);
        assert_eq!(status.runtime_sequence, None);
        assert_eq!(
            status.runtime_phase,
            Some(types::RuntimePhase::RUNTIME_PHASE_STARTING.into())
        );
    }

    #[tokio::test]
    async fn shutdown_finished_updates_status_and_watchers() {
        let actor = SupervisorControlActor::new(supervisor_status(1));
        let (session_id, _commands) = actor
            .open_runtime_session_commands(session_identity())
            .await;
        let mut stream = actor.watch_status(0, false).await;

        actor
            .apply_runtime_shutdown_finished(session_id, &runtime_shutdown_finished())
            .await
            .expect("shutdown_finished should be accepted");

        let status = actor.snapshot().await;
        assert_eq!(
            status.runtime_phase,
            Some(types::RuntimePhase::RUNTIME_PHASE_STOPPED.into())
        );
        assert_eq!(status.runtime_sequence, Some(4));

        let response = stream
            .next()
            .await
            .expect("expected runtime transition response")
            .expect("expected successful transition response");
        let Some(
            types::supervisor_lifecycle_service_watch_status_response::Event::RuntimeTransition(
                transition,
            ),
        ) = response.event
        else {
            panic!("expected runtime transition event");
        };
        assert_eq!(
            transition.current_phase,
            Some(types::RuntimePhase::RUNTIME_PHASE_STOPPED.into())
        );
    }

    fn supervisor_status(sequence: u64) -> types::SupervisorStatus {
        types::SupervisorStatus {
            identity: MessageField::some(types::SupervisorIdentity {
                supervisor_id: Some("gateway-supervisor:test".to_owned()),
                pid: Some(1),
                generation: Some(1),
                ..Default::default()
            }),
            launch: MessageField::some(types::LifecycleLaunchIdentity {
                launch_id: Some("launch-a".to_owned()),
                data_dir: Some("/tmp/onequery-data".to_owned()),
                runtime_pid: Some(4242),
                supervisor_pid: Some(1),
                supervisor_generation: Some(1),
                ..Default::default()
            }),
            phase: Some(types::SupervisorPhase::SUPERVISOR_PHASE_READY.into()),
            supervisor_sequence: Some(sequence),
            runtime: MessageField::some(types::RuntimeIdentity {
                data_dir: Some("/tmp/onequery-data".to_owned()),
                launch_id: Some("launch-a".to_owned()),
                pid: Some(4242),
                ..Default::default()
            }),
            runtime_phase: Some(types::RuntimePhase::RUNTIME_PHASE_STARTING.into()),
            active_session: Some(false),
            ..Default::default()
        }
    }

    fn session_identity() -> RuntimeSessionIdentity {
        RuntimeSessionIdentity {
            launch_id: "launch-a".to_owned(),
            data_dir: "/tmp/onequery-data".to_owned(),
            runtime_pid: 4242,
            runtime_sequence_at_hello: 1,
            supervisor_id: "gateway-supervisor:test".to_owned(),
            supervisor_pid: 1,
            supervisor_generation: 1,
        }
    }

    fn runtime_ready() -> types::RuntimeReady {
        runtime_ready_with_launch_id("launch-a")
    }

    fn runtime_ready_with_launch_id(launch_id: &str) -> types::RuntimeReady {
        types::RuntimeReady {
            status: MessageField::some(types::RuntimeStatus {
                identity: MessageField::some(types::RuntimeIdentity {
                    data_dir: Some("/tmp/onequery-data".to_owned()),
                    launch_id: Some(launch_id.to_owned()),
                    pid: Some(4242),
                    ..Default::default()
                }),
                phase: Some(types::RuntimePhase::RUNTIME_PHASE_READY.into()),
                runtime_sequence: Some(2),
                updated_at: MessageField::some(timestamp(2)),
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    fn runtime_shutdown_finished() -> types::RuntimeShutdownFinished {
        types::RuntimeShutdownFinished {
            operation_id: Some("stop-operation".to_owned()),
            status: MessageField::some(types::RuntimeStatus {
                identity: MessageField::some(types::RuntimeIdentity {
                    data_dir: Some("/tmp/onequery-data".to_owned()),
                    launch_id: Some("launch-a".to_owned()),
                    pid: Some(4242),
                    ..Default::default()
                }),
                phase: Some(types::RuntimePhase::RUNTIME_PHASE_STOPPED.into()),
                runtime_sequence: Some(4),
                updated_at: MessageField::some(timestamp(4)),
                ..Default::default()
            }),
            finished_at: MessageField::some(timestamp(4)),
            ..Default::default()
        }
    }

    fn timestamp(seconds: i64) -> buffa_types::google::protobuf::Timestamp {
        buffa_types::google::protobuf::Timestamp {
            seconds,
            ..Default::default()
        }
    }

    fn supervisor_stop_command() -> types::SupervisorStopCommand {
        types::SupervisorStopCommand {
            operation_id: Some("stop-operation".to_owned()),
            reason: Some("test stop".to_owned()),
            completion: Some(
                types::RuntimeStopCompletion::RUNTIME_STOP_COMPLETION_CLEANUP_AND_EXIT.into(),
            ),
            target: buffa::MessageField::some(types::SupervisorStopTarget {
                launch_id: Some("launch-a".to_owned()),
                data_dir: Some("/tmp/onequery-data".to_owned()),
                runtime_pid: Some(4242),
                supervisor: buffa::MessageField::some(types::SupervisorIdentity {
                    supervisor_id: Some("gateway-supervisor:test".to_owned()),
                    pid: Some(1),
                    generation: Some(1),
                    ..Default::default()
                }),
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    fn supervisor_transition(sequence: u64) -> types::SupervisorTransition {
        types::SupervisorTransition {
            supervisor: MessageField::some(types::SupervisorIdentity {
                supervisor_id: Some("gateway-supervisor:test".to_owned()),
                pid: Some(1),
                generation: Some(1),
                ..Default::default()
            }),
            supervisor_sequence: Some(sequence),
            previous_phase: Some(types::SupervisorPhase::SUPERVISOR_PHASE_HANDSHAKING.into()),
            current_phase: Some(types::SupervisorPhase::SUPERVISOR_PHASE_READY.into()),
            reason: Some("test".to_owned()),
            ..Default::default()
        }
    }
}
