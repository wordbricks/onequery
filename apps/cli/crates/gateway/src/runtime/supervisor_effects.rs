use std::fs::OpenOptions;
use std::io::Write;
use std::time::Duration;

use buffa::MessageField;
use chrono::Utc;
use connectrpc::ConnectError;
use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;
use tokio::time::Instant;

use crate::runtime_control::types;
use crate::self_host::SelfHostRuntimePaths;
use onequery_core::private_files;
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use super::super::BACKGROUND_GATEWAY_RETRY_COMMAND;
use super::super::state::GatewayRuntimeState;
use super::control::request_runtime_control_stop;
use super::lifecycle::ManagedRuntimeIdentity;
use super::lifecycle::read_runtime_status_snapshot_for_recovery;
use super::lifecycle_records;
use super::shutdown::hard_kill_process;
use super::shutdown::terminate_process;
use super::supervisor_machine::SupervisorEffect;
use super::supervisor_machine::SupervisorEvent;
use super::supervisor_machine::SupervisorFailureInfo;
use super::supervisor_machine::SupervisorMachine;
use super::supervisor_machine::SupervisorRuntimeFailureInfo;
use super::supervisor_machine::SupervisorTransitionEffect;
use super::supervisor_machine::reduce_supervisor_machine;
use super::transport::retry_command_hint;

const SUPERVISOR_POLL_INTERVAL: Duration = Duration::from_millis(100);
const LIFECYCLE_SCHEMA_VERSION: u32 = 1;
const SUPERVISOR_RUNTIME_STOP_REASON: &str = "onequery gateway stop";
#[cfg(not(test))]
fn supervisor_runtime_stop_grace_timeout() -> Duration {
    Duration::from_secs(30)
}

#[cfg(test)]
fn supervisor_runtime_stop_grace_timeout() -> Duration {
    Duration::from_millis(150)
}

#[cfg(not(test))]
fn supervisor_runtime_terminate_timeout() -> Duration {
    Duration::from_secs(5)
}

#[cfg(test)]
fn supervisor_runtime_terminate_timeout() -> Duration {
    Duration::from_millis(150)
}

#[cfg(not(test))]
fn supervisor_runtime_kill_timeout() -> Duration {
    Duration::from_secs(5)
}

#[cfg(test)]
fn supervisor_runtime_kill_timeout() -> Duration {
    Duration::from_millis(150)
}

#[derive(Debug, Default)]
pub(super) struct SupervisorTimers {
    stop_deadline: Option<Instant>,
    terminate_deadline: Option<Instant>,
    kill_deadline: Option<Instant>,
}

impl SupervisorTimers {
    pub(super) fn no_active_deadlines(&self) -> bool {
        self.stop_deadline.is_none()
            && self.terminate_deadline.is_none()
            && self.kill_deadline.is_none()
    }

    pub(super) fn stop_deadline_elapsed(&self) -> bool {
        self.stop_deadline
            .is_some_and(|deadline| Instant::now() >= deadline)
    }

    pub(super) fn terminate_deadline_elapsed(&self) -> bool {
        self.terminate_deadline
            .is_some_and(|deadline| Instant::now() >= deadline)
    }

    pub(super) fn kill_deadline_elapsed(&self) -> bool {
        self.kill_deadline
            .is_some_and(|deadline| Instant::now() >= deadline)
    }

    fn schedule_grace_deadline(&mut self, now: Instant) {
        self.stop_deadline = Some(now + supervisor_runtime_stop_grace_timeout());
    }

    fn schedule_terminate_deadline(&mut self, now: Instant) {
        self.stop_deadline = None;
        self.terminate_deadline = Some(now + supervisor_runtime_terminate_timeout());
    }

    fn schedule_escalation_deadline(&mut self, now: Instant) {
        self.terminate_deadline = None;
        self.kill_deadline = Some(now + supervisor_runtime_kill_timeout());
    }

    pub(super) fn next_poll_interval(&self) -> Duration {
        let mut interval = SUPERVISOR_POLL_INTERVAL;
        let now = Instant::now();

        for deadline in [
            self.stop_deadline,
            self.terminate_deadline,
            self.kill_deadline,
        ]
        .into_iter()
        .flatten()
        {
            interval = interval.min(deadline.saturating_duration_since(now));
        }

        interval
    }
}

#[derive(Clone, Copy)]
pub(super) struct SupervisorEffectContext<'a> {
    paths: &'a SelfHostRuntimePaths,
    supervisor: &'a types::SupervisorIdentity,
    launch_id: &'a str,
    runtime_pid: Option<u32>,
    command_line: &'a str,
}

#[derive(Default)]
pub(super) struct SupervisorEffectReport {
    runtime_stop_result: Option<Result<(), ConnectError>>,
    restart_backoff: Option<Duration>,
}

impl SupervisorEffectReport {
    pub(super) fn runtime_stop_result(
        self,
        command_line: &str,
    ) -> Result<Result<(), ConnectError>, CliError> {
        self.runtime_stop_result.ok_or_else(|| {
            supervisor_effect_context_error(
                command_line,
                "runtime stop effect completed without a stop RPC result",
            )
        })
    }

    pub(super) fn restart_backoff(self, command_line: &str) -> Result<Duration, CliError> {
        self.restart_backoff.ok_or_else(|| {
            supervisor_effect_context_error(
                command_line,
                "restart scheduling effect completed without a backoff duration",
            )
        })
    }
}

pub(super) fn supervisor_effect_context<'a>(
    state: &'a GatewayRuntimeState,
    supervisor: &'a types::SupervisorIdentity,
    launch_id: &'a str,
    runtime_pid: Option<u32>,
    command_line: &'a str,
) -> SupervisorEffectContext<'a> {
    SupervisorEffectContext {
        paths: &state.paths,
        supervisor,
        launch_id,
        runtime_pid,
        command_line,
    }
}

pub(super) async fn dispatch_supervisor_event(
    machine: &mut SupervisorMachine,
    event: SupervisorEvent,
    context: SupervisorEffectContext<'_>,
    timers: Option<&mut SupervisorTimers>,
) -> Result<SupervisorEffectReport, CliError> {
    let reduction = reduce_supervisor_machine(machine, event).map_err(|rejection| {
        CliError::new(
            "gateway supervisor rejected lifecycle transition",
            context.command_line,
            ErrorStage::Internal,
            format!(
                "event {} is invalid while supervisor is {}: {}",
                rejection.event.label(),
                rejection.state.label(),
                rejection.reason
            ),
            vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
        )
    })?;
    let transition = reduction.transition;
    let effects = reduction.effects;

    append_supervisor_transition_event_log_entry(&transition, context)?;

    *machine = reduction.machine;

    execute_supervisor_effects(&effects, context, timers).await
}

async fn execute_supervisor_effects(
    effects: &[SupervisorEffect],
    context: SupervisorEffectContext<'_>,
    mut timers: Option<&mut SupervisorTimers>,
) -> Result<SupervisorEffectReport, CliError> {
    let mut report = SupervisorEffectReport::default();
    let now = Instant::now();

    for effect in effects {
        match effect {
            SupervisorEffect::WriteStatusSnapshot {
                phase,
                supervisor_sequence,
                runtime_pid,
                failure,
            } => {
                write_supervisor_status_snapshot(
                    context.paths,
                    SupervisorStatusSnapshotWrite {
                        supervisor: context.supervisor,
                        launch_id: context.launch_id,
                        phase: *phase,
                        supervisor_sequence: *supervisor_sequence,
                        runtime_pid: *runtime_pid,
                        failure: failure.as_ref(),
                    },
                    context.command_line,
                )?;
            }
            SupervisorEffect::WriteTerminalRuntimeStatusSnapshot {
                phase,
                runtime_pid,
                failure,
                exit_code,
                signal,
            } => {
                write_terminal_runtime_status_snapshot(
                    context.paths,
                    TerminalRuntimeStatusSnapshotWrite {
                        supervisor: context.supervisor,
                        launch_id: context.launch_id,
                        phase: *phase,
                        runtime_pid: *runtime_pid,
                        failure,
                        exit_code: *exit_code,
                        signal: signal.as_deref(),
                    },
                    context.command_line,
                )?;
            }
            SupervisorEffect::RequestRuntimeStop { operation_id } => {
                let runtime_pid = context.runtime_pid.ok_or_else(|| {
                    supervisor_effect_context_error(
                        context.command_line,
                        "runtime stop effect requires a runtime pid",
                    )
                })?;
                let stop_result = request_supervised_runtime_stop(
                    context.paths,
                    context.supervisor,
                    context.launch_id,
                    runtime_pid,
                    operation_id,
                )
                .await;

                if report.runtime_stop_result.replace(stop_result).is_some() {
                    return Err(supervisor_effect_context_error(
                        context.command_line,
                        "runtime stop effect ran more than once for one transition",
                    ));
                }
            }
            SupervisorEffect::SignalRuntimeTerminate => {
                let runtime_pid = context.runtime_pid.ok_or_else(|| {
                    supervisor_effect_context_error(
                        context.command_line,
                        "terminate effect requires a runtime pid",
                    )
                })?;
                terminate_process(runtime_pid, context.command_line)?;
            }
            SupervisorEffect::SignalRuntimeKill => {
                let runtime_pid = context.runtime_pid.ok_or_else(|| {
                    supervisor_effect_context_error(
                        context.command_line,
                        "hard-kill effect requires a runtime pid",
                    )
                })?;
                hard_kill_process(runtime_pid, context.command_line)?;
            }
            SupervisorEffect::ScheduleGraceDeadline => {
                supervisor_timers_mut(&mut timers, context.command_line)?
                    .schedule_grace_deadline(now);
            }
            SupervisorEffect::ScheduleTerminateDeadline => {
                supervisor_timers_mut(&mut timers, context.command_line)?
                    .schedule_terminate_deadline(now);
            }
            SupervisorEffect::ScheduleEscalationDeadline => {
                supervisor_timers_mut(&mut timers, context.command_line)?
                    .schedule_escalation_deadline(now);
            }
            SupervisorEffect::ScheduleRestart { backoff } => {
                if report.restart_backoff.replace(*backoff).is_some() {
                    return Err(supervisor_effect_context_error(
                        context.command_line,
                        "restart scheduling effect ran more than once for one transition",
                    ));
                }
            }
        }
    }

    Ok(report)
}

async fn request_supervised_runtime_stop(
    paths: &SelfHostRuntimePaths,
    supervisor: &types::SupervisorIdentity,
    launch_id: &str,
    runtime_pid: u32,
    operation_id: &str,
) -> Result<(), ConnectError> {
    let identity = ManagedRuntimeIdentity {
        launch_id: launch_id.to_owned(),
        pid: runtime_pid,
        supervisor_pid: supervisor.pid,
        supervisor_generation: supervisor.generation,
    };

    let supervisor_id = supervisor.supervisor_id.as_deref().ok_or_else(|| {
        ConnectError::internal("supervisor identity omitted supervisor id for runtime stop")
    })?;

    request_runtime_control_stop(
        paths,
        &identity,
        supervisor_id,
        operation_id,
        SUPERVISOR_RUNTIME_STOP_REASON,
        supervisor_runtime_stop_grace_timeout(),
    )
    .await
    .map(|_| ())
}

fn supervisor_timers_mut<'a>(
    timers: &'a mut Option<&mut SupervisorTimers>,
    command_line: &str,
) -> Result<&'a mut SupervisorTimers, CliError> {
    timers.as_deref_mut().ok_or_else(|| {
        supervisor_effect_context_error(
            command_line,
            "timer effect emitted without a supervisor timer context",
        )
    })
}

fn supervisor_effect_context_error(command_line: &str, detail: &'static str) -> CliError {
    CliError::new(
        "gateway supervisor could not execute lifecycle effect",
        command_line,
        ErrorStage::Internal,
        detail,
        vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
    )
}

fn append_supervisor_transition_event_log_entry(
    transition: &SupervisorTransitionEffect,
    context: SupervisorEffectContext<'_>,
) -> Result<(), CliError> {
    let now = Utc::now();
    let lifecycle_sequence = next_lifecycle_event_sequence(context.paths, context.command_line)?;
    let monotonic_timestamp_nanos = lifecycle_records::next_monotonic_timestamp_nanos();
    let data_dir = context.paths.data_dir.display().to_string();
    let runtime = transition
        .runtime_pid
        .map(|pid| runtime_identity(pid, context.launch_id, &data_dir));
    let supervisor_transition = types::SupervisorTransition {
        supervisor: MessageField::some(context.supervisor.clone()),
        supervisor_sequence: Some(transition.supervisor_sequence),
        previous_phase: Some(transition.previous_phase.into()),
        current_phase: Some(transition.current_phase.into()),
        reason: Some(transition.reason.clone()),
        occurred_at: MessageField::some(protobuf_timestamp(now)),
        runtime: runtime.map(MessageField::some).unwrap_or_default(),
        failure: transition
            .failure
            .as_ref()
            .map(supervisor_failure_to_proto)
            .map(MessageField::some)
            .unwrap_or_default(),
        exit_code: transition.exit_code,
        signal: transition.signal.clone(),
        ..Default::default()
    };
    let entry = types::LifecycleEventLogEntry {
        header: MessageField::some(lifecycle_record_header(
            context.supervisor,
            context.launch_id,
            &data_dir,
            transition.runtime_pid,
            now,
        )),
        lifecycle_sequence: Some(lifecycle_sequence),
        kind: Some(
            types::LifecycleEventKind::LIFECYCLE_EVENT_KIND_SUPERVISOR_TRANSITION_RECORDED.into(),
        ),
        occurred_at: MessageField::some(protobuf_timestamp(now)),
        runtime_sequence: None,
        supervisor_sequence: Some(transition.supervisor_sequence),
        caller_operation_id: transition.caller_operation_id.clone(),
        transition_id: Some(supervisor_transition_id(transition)),
        correlation_id: Some(context.launch_id.to_owned()),
        monotonic_timestamp_nanos: Some(monotonic_timestamp_nanos),
        payload: supervisor_transition.into(),
        ..Default::default()
    };
    let encoded = lifecycle_records::encode_lifecycle_event_log_entry(&entry);

    append_private_lifecycle_event_log_frame(
        context.paths.lifecycle_event_log_path.as_path(),
        &encoded,
        context.command_line,
    )
}

fn next_lifecycle_event_sequence(
    paths: &SelfHostRuntimePaths,
    command_line: &str,
) -> Result<u64, CliError> {
    let path = paths.lifecycle_event_log_path.as_path();
    let contents = match std::fs::read(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(1),
        Err(error) => {
            return Err(CliError::new(
                "failed to read lifecycle event log",
                command_line,
                ErrorStage::Internal,
                format!("{error} ({})", path.display()),
                vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
            ));
        }
    };

    if contents.is_empty() {
        return Ok(1);
    }

    let entries =
        lifecycle_records::decode_lifecycle_event_log_entries(&contents).map_err(|error| {
            CliError::new(
                "failed to parse lifecycle event log",
                command_line,
                ErrorStage::Internal,
                format!(
                    "{error} ({}, encoding={})",
                    path.display(),
                    lifecycle_records::DURABLE_EVENT_LOG_ENCODING
                ),
                vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
            )
        })?;

    Ok(entries
        .into_iter()
        .filter_map(|entry| entry.lifecycle_sequence)
        .max()
        .unwrap_or(0)
        .saturating_add(1))
}

fn append_private_lifecycle_event_log_frame(
    path: &std::path::Path,
    frame: &[u8],
    command_line: &str,
) -> Result<(), CliError> {
    let parent = path.parent().ok_or_else(|| {
        CliError::new(
            "failed to compute lifecycle event log directory",
            command_line,
            ErrorStage::Internal,
            format!("invalid path: {}", path.display()),
            vec!["check filesystem permissions".to_owned()],
        )
    })?;
    std::fs::create_dir_all(parent).map_err(|error| {
        CliError::new(
            "failed to create lifecycle event log directory",
            command_line,
            ErrorStage::Internal,
            format!("{error} ({})", parent.display()),
            vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
        )
    })?;

    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    options.mode(0o600);

    let mut file = options.open(path).map_err(|error| {
        CliError::new(
            "failed to open lifecycle event log",
            command_line,
            ErrorStage::Internal,
            format!("{error} ({})", path.display()),
            vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
        )
    })?;

    #[cfg(unix)]
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).map_err(|error| {
        CliError::new(
            "failed to secure lifecycle event log",
            command_line,
            ErrorStage::Internal,
            format!("{error} ({})", path.display()),
            vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
        )
    })?;

    file.write_all(frame).map_err(|error| {
        CliError::new(
            "failed to append lifecycle event log",
            command_line,
            ErrorStage::Internal,
            format!("{error} ({})", path.display()),
            vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
        )
    })?;
    file.sync_all().map_err(|error| {
        CliError::new(
            "failed to sync lifecycle event log",
            command_line,
            ErrorStage::Internal,
            format!("{error} ({})", path.display()),
            vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
        )
    })
}

fn supervisor_transition_id(transition: &SupervisorTransitionEffect) -> String {
    format!(
        "supervisor:{}:{}",
        transition.supervisor_sequence,
        transition.event.label()
    )
}

fn lifecycle_record_header(
    supervisor: &types::SupervisorIdentity,
    launch_id: &str,
    data_dir: &str,
    runtime_pid: Option<u32>,
    written_at: chrono::DateTime<Utc>,
) -> types::LifecycleRecordHeader {
    types::LifecycleRecordHeader {
        schema_version: Some(LIFECYCLE_SCHEMA_VERSION),
        writer: MessageField::some(types::LifecycleRecordWriterIdentity {
            writer: Some(types::LifecycleRecordWriter::LIFECYCLE_RECORD_WRITER_SUPERVISOR.into()),
            writer_id: supervisor.supervisor_id.clone(),
            ..Default::default()
        }),
        launch: MessageField::some(lifecycle_launch_identity(
            supervisor,
            launch_id,
            data_dir,
            runtime_pid,
        )),
        written_at: MessageField::some(protobuf_timestamp(written_at)),
        ..Default::default()
    }
}

fn lifecycle_launch_identity(
    supervisor: &types::SupervisorIdentity,
    launch_id: &str,
    data_dir: &str,
    runtime_pid: Option<u32>,
) -> types::LifecycleLaunchIdentity {
    types::LifecycleLaunchIdentity {
        launch_id: Some(launch_id.to_owned()),
        data_dir: Some(data_dir.to_owned()),
        runtime_pid,
        supervisor_pid: supervisor.pid,
        supervisor_generation: supervisor.generation,
        ..Default::default()
    }
}

fn runtime_identity(pid: u32, launch_id: &str, data_dir: &str) -> types::RuntimeIdentity {
    types::RuntimeIdentity {
        pid: Some(pid),
        launch_id: Some(launch_id.to_owned()),
        data_dir: Some(data_dir.to_owned()),
        ..Default::default()
    }
}

struct SupervisorStatusSnapshotWrite<'a> {
    supervisor: &'a types::SupervisorIdentity,
    launch_id: &'a str,
    phase: types::SupervisorPhase,
    supervisor_sequence: u64,
    runtime_pid: Option<u32>,
    failure: Option<&'a SupervisorFailureInfo>,
}

fn write_supervisor_status_snapshot(
    paths: &SelfHostRuntimePaths,
    record: SupervisorStatusSnapshotWrite<'_>,
    command_line: &str,
) -> Result<(), CliError> {
    let now = Utc::now();
    let data_dir = paths.data_dir.display().to_string();
    let runtime = record
        .runtime_pid
        .map(|pid| runtime_identity(pid, record.launch_id, &data_dir));
    let snapshot = types::SupervisorStatusSnapshot {
        header: MessageField::some(lifecycle_record_header(
            record.supervisor,
            record.launch_id,
            &data_dir,
            record.runtime_pid,
            now,
        )),
        status: MessageField::some(types::SupervisorStatus {
            identity: MessageField::some(record.supervisor.clone()),
            launch: MessageField::some(lifecycle_launch_identity(
                record.supervisor,
                record.launch_id,
                &data_dir,
                record.runtime_pid,
            )),
            phase: Some(record.phase.into()),
            supervisor_sequence: Some(record.supervisor_sequence),
            updated_at: MessageField::some(protobuf_timestamp(now)),
            runtime: runtime.map(MessageField::some).unwrap_or_default(),
            failure: record
                .failure
                .map(supervisor_failure_to_proto)
                .map(MessageField::some)
                .unwrap_or_default(),
            ..Default::default()
        }),
        snapshot_at: MessageField::some(protobuf_timestamp(now)),
        ..Default::default()
    };
    let serialized =
        lifecycle_records::encode_supervisor_status_snapshot(&snapshot).map_err(|error| {
            CliError::new(
                "failed to serialize gateway supervisor status snapshot",
                command_line,
                ErrorStage::Internal,
                format!(
                    "{error} (encoding={})",
                    lifecycle_records::DURABLE_STATE_FILE_ENCODING
                ),
                vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
            )
        })?;

    private_files::atomic_write_private_file(
        paths.supervisor_status_snapshot_path.as_path(),
        &serialized,
        command_line,
        ErrorStage::Internal,
        "gateway supervisor status snapshot",
    )
}

struct TerminalRuntimeStatusSnapshotWrite<'a> {
    supervisor: &'a types::SupervisorIdentity,
    launch_id: &'a str,
    phase: types::RuntimePhase,
    runtime_pid: u32,
    failure: &'a SupervisorRuntimeFailureInfo,
    exit_code: Option<i32>,
    signal: Option<&'a str>,
}

fn write_terminal_runtime_status_snapshot(
    paths: &SelfHostRuntimePaths,
    record: TerminalRuntimeStatusSnapshotWrite<'_>,
    command_line: &str,
) -> Result<(), CliError> {
    let now = Utc::now();
    let data_dir = paths.data_dir.display().to_string();
    let runtime_sequence =
        next_terminal_runtime_sequence(paths, record.launch_id, record.runtime_pid, command_line)?;
    let failure_message = format!(
        "{}; exit_code={}; signal={}",
        record.failure.message,
        record
            .exit_code
            .map_or_else(|| "none".to_owned(), |code| code.to_string()),
        record.signal.unwrap_or("none"),
    );

    // Comment: this supervisor-authored runtime snapshot is terminal recovery
    // evidence for OS child exit; live in-process lifecycle transitions still
    // come from the runtime-control actor.
    let snapshot = types::RuntimeStatusSnapshot {
        header: MessageField::some(lifecycle_record_header(
            record.supervisor,
            record.launch_id,
            &data_dir,
            Some(record.runtime_pid),
            now,
        )),
        status: MessageField::some(types::RuntimeStatus {
            identity: MessageField::some(runtime_identity(
                record.runtime_pid,
                record.launch_id,
                &data_dir,
            )),
            phase: Some(record.phase.into()),
            runtime_sequence: Some(runtime_sequence),
            updated_at: MessageField::some(protobuf_timestamp(now)),
            failure: MessageField::some(types::RuntimeFailure {
                code: Some(record.failure.code.into()),
                message: Some(failure_message),
                retryable: Some(record.failure.retryability.as_bool()),
                ..Default::default()
            }),
            ..Default::default()
        }),
        snapshot_at: MessageField::some(protobuf_timestamp(now)),
        ..Default::default()
    };
    let serialized =
        lifecycle_records::encode_runtime_status_snapshot(&snapshot).map_err(|error| {
            CliError::new(
                "failed to serialize terminal runtime status snapshot",
                command_line,
                ErrorStage::Internal,
                format!(
                    "{error} (encoding={})",
                    lifecycle_records::DURABLE_STATE_FILE_ENCODING
                ),
                vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
            )
        })?;

    private_files::atomic_write_private_file(
        paths.runtime_status_snapshot_path.as_path(),
        &serialized,
        command_line,
        ErrorStage::Internal,
        "terminal runtime status snapshot",
    )?;

    append_process_exit_event_log_entry(
        paths,
        ProcessExitEventLogWrite {
            supervisor: record.supervisor,
            launch_id: record.launch_id,
            phase: record.phase,
            runtime_pid: record.runtime_pid,
            runtime_sequence,
            retryable: record.failure.retryability.as_bool(),
            exit_code: record.exit_code,
            signal: record.signal,
        },
        command_line,
    )
}

struct ProcessExitEventLogWrite<'a> {
    supervisor: &'a types::SupervisorIdentity,
    launch_id: &'a str,
    phase: types::RuntimePhase,
    runtime_pid: u32,
    runtime_sequence: u64,
    retryable: bool,
    exit_code: Option<i32>,
    signal: Option<&'a str>,
}

fn append_process_exit_event_log_entry(
    paths: &SelfHostRuntimePaths,
    record: ProcessExitEventLogWrite<'_>,
    command_line: &str,
) -> Result<(), CliError> {
    let now = Utc::now();
    let lifecycle_sequence = next_lifecycle_event_sequence(paths, command_line)?;
    let data_dir = paths.data_dir.display().to_string();
    let process_exit = types::LifecycleProcessExit {
        runtime: MessageField::some(runtime_identity(
            record.runtime_pid,
            record.launch_id,
            &data_dir,
        )),
        runtime_phase: Some(record.phase.into()),
        exit_code: record.exit_code,
        signal: record.signal.map(str::to_owned),
        retryable: Some(record.retryable),
        ..Default::default()
    };
    let entry = types::LifecycleEventLogEntry {
        header: MessageField::some(lifecycle_record_header(
            record.supervisor,
            record.launch_id,
            &data_dir,
            Some(record.runtime_pid),
            now,
        )),
        lifecycle_sequence: Some(lifecycle_sequence),
        kind: Some(types::LifecycleEventKind::LIFECYCLE_EVENT_KIND_PROCESS_EXIT_RECORDED.into()),
        occurred_at: MessageField::some(protobuf_timestamp(now)),
        runtime_sequence: Some(record.runtime_sequence),
        correlation_id: Some(record.launch_id.to_owned()),
        monotonic_timestamp_nanos: Some(lifecycle_records::next_monotonic_timestamp_nanos()),
        payload: process_exit.into(),
        ..Default::default()
    };
    let encoded = lifecycle_records::encode_lifecycle_event_log_entry(&entry);

    append_private_lifecycle_event_log_frame(
        paths.lifecycle_event_log_path.as_path(),
        &encoded,
        command_line,
    )
}

fn next_terminal_runtime_sequence(
    paths: &SelfHostRuntimePaths,
    launch_id: &str,
    runtime_pid: u32,
    command_line: &str,
) -> Result<u64, CliError> {
    let Some(snapshot) = read_runtime_status_snapshot_for_recovery(paths, command_line)? else {
        return Ok(1);
    };
    let Some(status) = snapshot.status.as_option() else {
        return Ok(1);
    };
    let Some(identity) = status.identity.as_option() else {
        return Ok(1);
    };

    if identity.pid != Some(runtime_pid)
        || identity.launch_id.as_deref() != Some(launch_id)
        || identity
            .data_dir
            .as_deref()
            .is_none_or(|data_dir| std::path::Path::new(data_dir) != paths.data_dir.as_path())
    {
        return Ok(1);
    }

    Ok(status.runtime_sequence.unwrap_or(0).saturating_add(1))
}

fn supervisor_failure_to_proto(failure: &SupervisorFailureInfo) -> types::SupervisorFailure {
    types::SupervisorFailure {
        code: Some(failure.code.into()),
        message: Some(failure.message.clone()),
        retryable: Some(failure.retryability.as_bool()),
        ..Default::default()
    }
}

fn protobuf_timestamp(value: chrono::DateTime<Utc>) -> buffa_types::google::protobuf::Timestamp {
    buffa_types::google::protobuf::Timestamp {
        seconds: value.timestamp(),
        nanos: value.timestamp_subsec_nanos() as i32,
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use pretty_assertions::assert_eq;
    use tempfile::tempdir;

    use super::SupervisorRuntimeFailureInfo;
    use super::TerminalRuntimeStatusSnapshotWrite;
    use super::append_supervisor_transition_event_log_entry;
    use super::dispatch_supervisor_event;
    use super::lifecycle_records;
    use super::types;
    use super::write_terminal_runtime_status_snapshot;
    use crate::runtime::supervisor_effects::SupervisorEffectContext;
    use crate::runtime::supervisor_machine::SupervisorChildExitKind;
    use crate::runtime::supervisor_machine::SupervisorEvent;
    use crate::runtime::supervisor_machine::SupervisorEventKind;
    use crate::runtime::supervisor_machine::SupervisorFailureInfo;
    use crate::runtime::supervisor_machine::SupervisorFailureRetryability;
    use crate::runtime::supervisor_machine::SupervisorMachine;
    use crate::runtime::supervisor_machine::SupervisorMachineState;
    use crate::runtime::supervisor_machine::SupervisorTransitionEffect;
    use crate::self_host::SelfHostRuntimePaths;

    #[tokio::test]
    async fn unexpected_child_exit_before_control_socket_writes_crash_recovery_records() {
        let (_temp_dir, paths) = test_paths();
        let supervisor = test_supervisor_identity(123);
        let mut machine = SupervisorMachine::new();

        dispatch_test_supervisor_event(
            &mut machine,
            SupervisorEvent::LaunchRequested,
            &paths,
            &supervisor,
            None,
        )
        .await;
        dispatch_test_supervisor_event(
            &mut machine,
            SupervisorEvent::ChildSpawned { runtime_pid: 4242 },
            &paths,
            &supervisor,
            Some(4242),
        )
        .await;
        dispatch_test_supervisor_event(
            &mut machine,
            unexpected_child_exit_event(),
            &paths,
            &supervisor,
            Some(4242),
        )
        .await;

        assert_eq!(machine.state(), SupervisorMachineState::Failed);
        assert_unexpected_child_exit_recovery_records(
            &paths,
            ChildExitRecoveryExpectation {
                event_count: 4,
                previous_supervisor_phase: types::SupervisorPhase::SUPERVISOR_PHASE_HANDSHAKING,
                supervisor_sequence: 3,
            },
        );
    }

    #[tokio::test]
    async fn unexpected_child_exit_after_ready_writes_crash_recovery_records() {
        let (_temp_dir, paths) = test_paths();
        let supervisor = test_supervisor_identity(123);
        let mut machine = SupervisorMachine::new();

        dispatch_test_supervisor_event(
            &mut machine,
            SupervisorEvent::LaunchRequested,
            &paths,
            &supervisor,
            None,
        )
        .await;
        dispatch_test_supervisor_event(
            &mut machine,
            SupervisorEvent::ChildSpawned { runtime_pid: 4242 },
            &paths,
            &supervisor,
            Some(4242),
        )
        .await;
        dispatch_test_supervisor_event(
            &mut machine,
            SupervisorEvent::ControlSocketObserved,
            &paths,
            &supervisor,
            Some(4242),
        )
        .await;
        dispatch_test_supervisor_event(
            &mut machine,
            SupervisorEvent::WatchReady,
            &paths,
            &supervisor,
            Some(4242),
        )
        .await;
        dispatch_test_supervisor_event(
            &mut machine,
            unexpected_child_exit_event(),
            &paths,
            &supervisor,
            Some(4242),
        )
        .await;

        assert_eq!(machine.state(), SupervisorMachineState::Failed);
        assert_unexpected_child_exit_recovery_records(
            &paths,
            ChildExitRecoveryExpectation {
                event_count: 6,
                previous_supervisor_phase: types::SupervisorPhase::SUPERVISOR_PHASE_READY,
                supervisor_sequence: 5,
            },
        );
    }

    #[test]
    fn terminal_runtime_status_snapshot_records_unexpected_child_exit_identity_and_failure() {
        let temp_dir = tempdir().unwrap_or_else(|error| panic!("expected temp dir: {error}"));
        let paths = SelfHostRuntimePaths::from_dirs(
            temp_dir.path().join("config").join("self-host"),
            temp_dir.path().join("data"),
        );
        fs::create_dir_all(&paths.run_dir)
            .unwrap_or_else(|error| panic!("expected run dir creation: {error}"));
        fs::write(
            &paths.runtime_status_snapshot_path,
            format!(
                r#"{{
  "header": {{
    "schemaVersion": 1,
    "writer": {{"writer": "LIFECYCLE_RECORD_WRITER_RUNTIME", "writerId": "runtime:4242"}},
    "launch": {{"launchId": "launch-a", "dataDir": "{}", "runtimePid": 4242, "supervisorPid": 123, "supervisorGeneration": "1"}},
    "writtenAt": "2026-03-25T00:00:00Z"
  }},
  "status": {{
    "identity": {{"pid": 4242, "launchId": "launch-a", "dataDir": "{}"}},
    "phase": "RUNTIME_PHASE_READY",
    "runtimeSequence": "7",
    "updatedAt": "2026-03-25T00:00:00Z"
  }},
  "snapshotAt": "2026-03-25T00:00:00Z"
}}"#,
                paths.data_dir.display(),
                paths.data_dir.display()
            ),
        )
        .unwrap_or_else(|error| panic!("expected existing runtime snapshot write: {error}"));

        let supervisor = test_supervisor_identity(123);
        write_terminal_runtime_status_snapshot(
            &paths,
            TerminalRuntimeStatusSnapshotWrite {
                supervisor: &supervisor,
                launch_id: "launch-a",
                phase: types::RuntimePhase::RUNTIME_PHASE_FAILED,
                runtime_pid: 4242,
                failure: &SupervisorRuntimeFailureInfo {
                    code: types::RuntimeFailureCode::RUNTIME_FAILURE_CODE_INTERNAL,
                    message: "self-host server exited with code 1".to_owned(),
                    retryability: SupervisorFailureRetryability::Retryable,
                },
                exit_code: Some(1),
                signal: Some("SIGTERM"),
            },
            "onequery gateway start",
        )
        .unwrap_or_else(|error| panic!("expected terminal runtime status write: {error}"));

        let snapshot = lifecycle_records::decode_runtime_status_snapshot(
            &fs::read_to_string(&paths.runtime_status_snapshot_path)
                .unwrap_or_else(|error| panic!("expected runtime snapshot read: {error}")),
        )
        .unwrap_or_else(|error| panic!("expected runtime snapshot decode: {error}"));
        let header = snapshot
            .header
            .as_option()
            .expect("expected snapshot header");
        let writer = header.writer.as_option().expect("expected snapshot writer");
        let launch = header
            .launch
            .as_option()
            .expect("expected snapshot launch identity");
        let status = snapshot
            .status
            .as_option()
            .expect("expected runtime status");
        let runtime = status
            .identity
            .as_option()
            .expect("expected runtime identity");
        let failure = status
            .failure
            .as_option()
            .expect("expected runtime failure");

        assert_eq!(
            writer.writer.and_then(|writer| writer.as_known()),
            Some(types::LifecycleRecordWriter::LIFECYCLE_RECORD_WRITER_SUPERVISOR)
        );
        assert_eq!(writer.writer_id.as_deref(), Some("gateway-supervisor:123"));
        assert_eq!(launch.launch_id.as_deref(), Some("launch-a"));
        assert_eq!(launch.runtime_pid, Some(4242));
        assert_eq!(launch.supervisor_pid, Some(123));
        assert_eq!(launch.supervisor_generation, Some(1));
        assert_eq!(runtime.pid, Some(4242));
        assert_eq!(runtime.launch_id.as_deref(), Some("launch-a"));
        assert_eq!(
            status.phase.and_then(|phase| phase.as_known()),
            Some(types::RuntimePhase::RUNTIME_PHASE_FAILED)
        );
        assert_eq!(status.runtime_sequence, Some(8));
        assert_eq!(
            failure.code.and_then(|code| code.as_known()),
            Some(types::RuntimeFailureCode::RUNTIME_FAILURE_CODE_INTERNAL)
        );
        assert_eq!(
            failure.message.as_deref(),
            Some("self-host server exited with code 1; exit_code=1; signal=SIGTERM")
        );
        assert_eq!(failure.retryable, Some(true));

        let entries = lifecycle_records::decode_lifecycle_event_log_entries(
            &fs::read(&paths.lifecycle_event_log_path)
                .unwrap_or_else(|error| panic!("expected event log read: {error}")),
        )
        .unwrap_or_else(|error| panic!("expected event log decode: {error}"));
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].runtime_sequence, Some(8));
        assert_eq!(
            entries[0].kind.and_then(|kind| kind.as_known()),
            Some(types::LifecycleEventKind::LIFECYCLE_EVENT_KIND_PROCESS_EXIT_RECORDED)
        );
        let event_launch = entries[0]
            .header
            .as_option()
            .and_then(|header| header.launch.as_option())
            .expect("expected process exit event launch identity");
        assert_eq!(event_launch.launch_id.as_deref(), Some("launch-a"));
        assert_eq!(
            event_launch.data_dir.as_deref(),
            Some(paths.data_dir.to_string_lossy().as_ref())
        );
        assert_eq!(event_launch.runtime_pid, Some(4242));
        assert_eq!(event_launch.supervisor_pid, Some(123));
        assert_eq!(event_launch.supervisor_generation, Some(1));

        let process_exit = match entries[0].payload.as_ref().expect("expected event payload") {
            types::lifecycle_event_log_entry::Payload::ProcessExit(process_exit) => process_exit,
            payload => panic!("expected process exit payload, got {payload:?}"),
        };
        let event_runtime = process_exit
            .runtime
            .as_option()
            .expect("expected process exit runtime identity");
        assert_eq!(event_runtime.pid, Some(4242));
        assert_eq!(event_runtime.launch_id.as_deref(), Some("launch-a"));
        assert_eq!(
            event_runtime.data_dir.as_deref(),
            Some(paths.data_dir.to_string_lossy().as_ref())
        );
        assert_eq!(
            process_exit
                .runtime_phase
                .and_then(|phase| phase.as_known()),
            Some(types::RuntimePhase::RUNTIME_PHASE_FAILED)
        );
        assert_eq!(process_exit.exit_code, Some(1));
        assert_eq!(process_exit.signal.as_deref(), Some("SIGTERM"));
        assert_eq!(process_exit.retryable, Some(true));
    }

    #[test]
    fn supervisor_transition_event_log_records_ordered_transition_evidence() {
        let temp_dir = tempdir().unwrap_or_else(|error| panic!("expected temp dir: {error}"));
        let paths = SelfHostRuntimePaths::from_dirs(
            temp_dir.path().join("config").join("self-host"),
            temp_dir.path().join("data"),
        );
        fs::create_dir_all(&paths.run_dir)
            .unwrap_or_else(|error| panic!("expected run dir creation: {error}"));

        let supervisor = test_supervisor_identity(123);
        let context = SupervisorEffectContext {
            paths: &paths,
            supervisor: &supervisor,
            launch_id: "launch-a",
            runtime_pid: Some(4242),
            command_line: "onequery gateway start",
        };

        append_supervisor_transition_event_log_entry(
            &SupervisorTransitionEffect {
                event: SupervisorEventKind::LaunchRequested,
                previous_phase: types::SupervisorPhase::SUPERVISOR_PHASE_STARTING,
                current_phase: types::SupervisorPhase::SUPERVISOR_PHASE_STARTING,
                supervisor_sequence: 1,
                runtime_pid: None,
                reason: "launch_requested".to_owned(),
                caller_operation_id: None,
                failure: None,
                exit_code: None,
                signal: None,
            },
            context,
        )
        .unwrap_or_else(|error| panic!("expected first transition event append: {error}"));

        append_supervisor_transition_event_log_entry(
            &SupervisorTransitionEffect {
                event: SupervisorEventKind::ChildExited,
                previous_phase: types::SupervisorPhase::SUPERVISOR_PHASE_READY,
                current_phase: types::SupervisorPhase::SUPERVISOR_PHASE_FAILED,
                supervisor_sequence: 2,
                runtime_pid: Some(4242),
                reason: "child_exited: self-host server exited with code 1".to_owned(),
                caller_operation_id: None,
                failure: Some(SupervisorFailureInfo {
                    code: types::SupervisorFailureCode::SUPERVISOR_FAILURE_CODE_CHILD_EXITED_UNEXPECTEDLY,
                    message: "self-host server exited with code 1".to_owned(),
                    retryability: SupervisorFailureRetryability::Retryable,
                }),
                exit_code: Some(1),
                signal: None,
            },
            context,
        )
        .unwrap_or_else(|error| panic!("expected second transition event append: {error}"));

        let entries = lifecycle_records::decode_lifecycle_event_log_entries(
            &fs::read(&paths.lifecycle_event_log_path)
                .unwrap_or_else(|error| panic!("expected event log read: {error}")),
        )
        .unwrap_or_else(|error| panic!("expected event log decode: {error}"));

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].lifecycle_sequence, Some(1));
        assert_eq!(entries[1].lifecycle_sequence, Some(2));
        assert!(entries[1].monotonic_timestamp_nanos > entries[0].monotonic_timestamp_nanos);
        assert_eq!(entries[1].supervisor_sequence, Some(2));
        assert_eq!(
            entries[1].transition_id.as_deref(),
            Some("supervisor:2:child_exited")
        );
        assert_eq!(entries[1].correlation_id.as_deref(), Some("launch-a"));

        let header = entries[1]
            .header
            .as_option()
            .expect("expected event header");
        let launch = header.launch.as_option().expect("expected launch identity");
        assert_eq!(launch.launch_id.as_deref(), Some("launch-a"));
        assert_eq!(launch.runtime_pid, Some(4242));
        assert_eq!(launch.supervisor_pid, Some(123));
        assert_eq!(launch.supervisor_generation, Some(1));

        let transition = match entries[1].payload.as_ref().expect("expected event payload") {
            types::lifecycle_event_log_entry::Payload::SupervisorTransition(transition) => {
                transition
            }
            payload => panic!("expected supervisor transition payload, got {payload:?}"),
        };
        assert_eq!(
            transition.current_phase.and_then(|phase| phase.as_known()),
            Some(types::SupervisorPhase::SUPERVISOR_PHASE_FAILED)
        );
        assert_eq!(transition.exit_code, Some(1));
        assert_eq!(
            transition
                .failure
                .as_option()
                .expect("expected transition failure")
                .code
                .and_then(|code| code.as_known()),
            Some(types::SupervisorFailureCode::SUPERVISOR_FAILURE_CODE_CHILD_EXITED_UNEXPECTEDLY)
        );
    }

    fn test_supervisor_identity(supervisor_pid: u32) -> types::SupervisorIdentity {
        types::SupervisorIdentity {
            supervisor_id: Some(format!("gateway-supervisor:{supervisor_pid}")),
            pid: Some(supervisor_pid),
            generation: Some(1),
            ..Default::default()
        }
    }

    fn test_paths() -> (tempfile::TempDir, SelfHostRuntimePaths) {
        let temp_dir = tempdir().unwrap_or_else(|error| panic!("expected temp dir: {error}"));
        let paths = SelfHostRuntimePaths::from_dirs(
            temp_dir.path().join("config").join("self-host"),
            temp_dir.path().join("data"),
        );
        fs::create_dir_all(&paths.run_dir)
            .unwrap_or_else(|error| panic!("expected run dir creation: {error}"));

        (temp_dir, paths)
    }

    async fn dispatch_test_supervisor_event(
        machine: &mut SupervisorMachine,
        event: SupervisorEvent,
        paths: &SelfHostRuntimePaths,
        supervisor: &types::SupervisorIdentity,
        runtime_pid: Option<u32>,
    ) {
        dispatch_supervisor_event(
            machine,
            event,
            SupervisorEffectContext {
                paths,
                supervisor,
                launch_id: "launch-a",
                runtime_pid,
                command_line: "onequery gateway start",
            },
            None,
        )
        .await
        .unwrap_or_else(|error| panic!("expected supervisor event dispatch: {error}"));
    }

    fn unexpected_child_exit_event() -> SupervisorEvent {
        SupervisorEvent::ChildExited {
            runtime_pid: 4242,
            exit_kind: SupervisorChildExitKind::Unexpected,
            exit_code: Some(42),
            signal: None,
            message: "self-host server exited with code 42".to_owned(),
        }
    }

    struct ChildExitRecoveryExpectation {
        event_count: usize,
        previous_supervisor_phase: types::SupervisorPhase,
        supervisor_sequence: u64,
    }

    fn assert_unexpected_child_exit_recovery_records(
        paths: &SelfHostRuntimePaths,
        expected: ChildExitRecoveryExpectation,
    ) {
        let supervisor_snapshot = lifecycle_records::decode_supervisor_status_snapshot(
            &fs::read_to_string(&paths.supervisor_status_snapshot_path)
                .unwrap_or_else(|error| panic!("expected supervisor snapshot read: {error}")),
        )
        .unwrap_or_else(|error| panic!("expected supervisor snapshot decode: {error}"));
        let supervisor_status = supervisor_snapshot
            .status
            .as_option()
            .expect("expected supervisor status");
        let supervisor_failure = supervisor_status
            .failure
            .as_option()
            .expect("expected supervisor failure");
        let supervised_runtime = supervisor_status
            .runtime
            .as_option()
            .expect("expected supervisor runtime identity");

        assert_eq!(
            supervisor_status.phase.and_then(|phase| phase.as_known()),
            Some(types::SupervisorPhase::SUPERVISOR_PHASE_FAILED)
        );
        assert_eq!(
            supervisor_status.supervisor_sequence,
            Some(expected.supervisor_sequence)
        );
        assert_eq!(supervised_runtime.pid, Some(4242));
        assert_eq!(
            supervisor_failure.code.and_then(|code| code.as_known()),
            Some(types::SupervisorFailureCode::SUPERVISOR_FAILURE_CODE_CHILD_EXITED_UNEXPECTEDLY)
        );
        assert_eq!(
            supervisor_failure.message.as_deref(),
            Some("self-host server exited with code 42")
        );
        assert_eq!(supervisor_failure.retryable, Some(true));

        let runtime_snapshot = lifecycle_records::decode_runtime_status_snapshot(
            &fs::read_to_string(&paths.runtime_status_snapshot_path)
                .unwrap_or_else(|error| panic!("expected runtime snapshot read: {error}")),
        )
        .unwrap_or_else(|error| panic!("expected runtime snapshot decode: {error}"));
        let runtime_status = runtime_snapshot
            .status
            .as_option()
            .expect("expected runtime status");
        let runtime = runtime_status
            .identity
            .as_option()
            .expect("expected runtime identity");
        let runtime_failure = runtime_status
            .failure
            .as_option()
            .expect("expected runtime failure");

        assert_eq!(runtime.pid, Some(4242));
        assert_eq!(runtime.launch_id.as_deref(), Some("launch-a"));
        assert_eq!(
            runtime.data_dir.as_deref(),
            Some(paths.data_dir.to_string_lossy().as_ref())
        );
        assert_eq!(
            runtime_status.phase.and_then(|phase| phase.as_known()),
            Some(types::RuntimePhase::RUNTIME_PHASE_FAILED)
        );
        assert_eq!(runtime_status.runtime_sequence, Some(1));
        assert_eq!(
            runtime_failure.code.and_then(|code| code.as_known()),
            Some(types::RuntimeFailureCode::RUNTIME_FAILURE_CODE_INTERNAL)
        );
        assert_eq!(
            runtime_failure.message.as_deref(),
            Some("self-host server exited with code 42; exit_code=42; signal=none")
        );
        assert_eq!(runtime_failure.retryable, Some(true));

        let entries = lifecycle_records::decode_lifecycle_event_log_entries(
            &fs::read(&paths.lifecycle_event_log_path)
                .unwrap_or_else(|error| panic!("expected event log read: {error}")),
        )
        .unwrap_or_else(|error| panic!("expected event log decode: {error}"));
        assert_eq!(entries.len(), expected.event_count);

        let expected_transition_id =
            format!("supervisor:{}:child_exited", expected.supervisor_sequence);
        let child_exit_transition = entries
            .iter()
            .find(|entry| entry.transition_id.as_deref() == Some(expected_transition_id.as_str()))
            .expect("expected child-exited supervisor transition event");
        assert_eq!(
            child_exit_transition.kind.and_then(|kind| kind.as_known()),
            Some(types::LifecycleEventKind::LIFECYCLE_EVENT_KIND_SUPERVISOR_TRANSITION_RECORDED)
        );
        assert_eq!(
            child_exit_transition.supervisor_sequence,
            Some(expected.supervisor_sequence)
        );
        let transition = match child_exit_transition
            .payload
            .as_ref()
            .expect("expected transition payload")
        {
            types::lifecycle_event_log_entry::Payload::SupervisorTransition(transition) => {
                transition
            }
            payload => panic!("expected supervisor transition payload, got {payload:?}"),
        };
        assert_eq!(
            transition.previous_phase.and_then(|phase| phase.as_known()),
            Some(expected.previous_supervisor_phase)
        );
        assert_eq!(
            transition.current_phase.and_then(|phase| phase.as_known()),
            Some(types::SupervisorPhase::SUPERVISOR_PHASE_FAILED)
        );
        assert_eq!(transition.exit_code, Some(42));

        let process_exit = entries.last().expect("expected process exit event");
        assert_eq!(
            process_exit.kind.and_then(|kind| kind.as_known()),
            Some(types::LifecycleEventKind::LIFECYCLE_EVENT_KIND_PROCESS_EXIT_RECORDED)
        );
        assert_eq!(process_exit.runtime_sequence, Some(1));
        let process_exit = match process_exit
            .payload
            .as_ref()
            .expect("expected event payload")
        {
            types::lifecycle_event_log_entry::Payload::ProcessExit(process_exit) => process_exit,
            payload => panic!("expected process exit payload, got {payload:?}"),
        };
        assert_eq!(
            process_exit
                .runtime_phase
                .and_then(|phase| phase.as_known()),
            Some(types::RuntimePhase::RUNTIME_PHASE_FAILED)
        );
        assert_eq!(process_exit.exit_code, Some(42));
        assert_eq!(process_exit.signal.as_deref(), None);
        assert_eq!(process_exit.retryable, Some(true));
    }
}
