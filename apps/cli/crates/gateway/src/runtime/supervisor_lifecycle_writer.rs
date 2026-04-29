use buffa::MessageField;
use chrono::Utc;
use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;
use onequery_core::private_files;

use crate::runtime_control::types;
use crate::self_host::SelfHostRuntimePaths;

use super::super::BACKGROUND_GATEWAY_RETRY_COMMAND;
use super::lifecycle::read_runtime_status_snapshot_for_recovery;
use super::lifecycle_event_log;
use super::lifecycle_event_log::protobuf_timestamp;
use super::lifecycle_records;
use super::supervisor_effects::SupervisorEffectContext;
#[cfg(test)]
use super::supervisor_effects::dispatch_supervisor_event;
use super::supervisor_machine::SupervisorFailureInfo;
use super::supervisor_machine::SupervisorRuntimeFailureInfo;
use super::supervisor_machine::SupervisorTransitionEffect;
use super::transport::retry_command_hint;

const LIFECYCLE_SCHEMA_VERSION: u32 = 1;

pub(super) fn append_supervisor_transition_event_log_entry(
    transition: &SupervisorTransitionEffect,
    context: SupervisorEffectContext<'_>,
) -> Result<(), CliError> {
    let now = Utc::now();
    let lifecycle_sequence = lifecycle_event_log::next_lifecycle_event_sequence(
        context.paths.lifecycle_event_log_path.as_path(),
        context.command_line,
        vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
        vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
    )?;
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

    lifecycle_event_log::append_private_lifecycle_event_log_frame(
        context.paths.lifecycle_event_log_path.as_path(),
        &encoded,
        context.command_line,
        vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
    )
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

pub(super) struct SupervisorStatusSnapshotWrite<'a> {
    pub(super) supervisor: &'a types::SupervisorIdentity,
    pub(super) launch_id: &'a str,
    pub(super) phase: types::SupervisorPhase,
    pub(super) supervisor_sequence: u64,
    pub(super) runtime_pid: Option<u32>,
    pub(super) failure: Option<&'a SupervisorFailureInfo>,
}

pub(super) fn write_supervisor_status_snapshot(
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

pub(super) struct TerminalRuntimeStatusSnapshotWrite<'a> {
    pub(super) supervisor: &'a types::SupervisorIdentity,
    pub(super) launch_id: &'a str,
    pub(super) phase: types::RuntimePhase,
    pub(super) runtime_pid: u32,
    pub(super) failure: &'a SupervisorRuntimeFailureInfo,
    pub(super) exit_code: Option<i32>,
    pub(super) signal: Option<&'a str>,
}

pub(super) fn write_terminal_runtime_status_snapshot(
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
    // come from the supervisor-control session.
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
    let lifecycle_sequence = lifecycle_event_log::next_lifecycle_event_sequence(
        paths.lifecycle_event_log_path.as_path(),
        command_line,
        vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
        vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
    )?;
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

    lifecycle_event_log::append_private_lifecycle_event_log_frame(
        paths.lifecycle_event_log_path.as_path(),
        &encoded,
        command_line,
        vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
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

#[cfg(test)]
mod tests;
