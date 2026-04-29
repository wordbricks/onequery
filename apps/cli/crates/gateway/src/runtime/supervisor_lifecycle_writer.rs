use buffa::MessageField;
use chrono::Utc;
use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;
use onequery_core::private_files;
use std::fs;

use crate::self_host::SelfHostRuntimePaths;
use crate::supervisor_control_proto::types;

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
    let supervisor_transition = project_supervisor_transition(transition, context, now);
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

pub(super) fn project_supervisor_transition(
    transition: &SupervisorTransitionEffect,
    context: SupervisorEffectContext<'_>,
    occurred_at: chrono::DateTime<Utc>,
) -> types::SupervisorTransition {
    let data_dir = context.paths.data_dir.display().to_string();
    let runtime = transition
        .runtime_pid
        .map(|pid| runtime_identity(pid, context.launch_id, &data_dir));

    types::SupervisorTransition {
        supervisor: MessageField::some(context.supervisor.clone()),
        supervisor_sequence: Some(transition.supervisor_sequence),
        previous_phase: Some(transition.previous_phase.into()),
        current_phase: Some(transition.current_phase.into()),
        reason: Some(transition.reason.clone()),
        occurred_at: MessageField::some(protobuf_timestamp(occurred_at)),
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
    }
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
        schema_version: Some(lifecycle_records::LIFECYCLE_SCHEMA_VERSION),
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

pub(super) struct SupervisorStatusProjection<'a> {
    pub(super) supervisor: &'a types::SupervisorIdentity,
    pub(super) launch_id: &'a str,
    pub(super) data_dir: &'a str,
    pub(super) phase: types::SupervisorPhase,
    pub(super) supervisor_sequence: u64,
    pub(super) runtime_pid: Option<u32>,
    pub(super) failure: Option<&'a SupervisorFailureInfo>,
    pub(super) active_session: bool,
    pub(super) updated_at: chrono::DateTime<Utc>,
}

pub(super) fn project_supervisor_status(
    projection: SupervisorStatusProjection<'_>,
) -> types::SupervisorStatus {
    let runtime = projection
        .runtime_pid
        .map(|pid| runtime_identity(pid, projection.launch_id, projection.data_dir));

    types::SupervisorStatus {
        identity: MessageField::some(projection.supervisor.clone()),
        launch: MessageField::some(lifecycle_launch_identity(
            projection.supervisor,
            projection.launch_id,
            projection.data_dir,
            projection.runtime_pid,
        )),
        phase: Some(projection.phase.into()),
        supervisor_sequence: Some(projection.supervisor_sequence),
        updated_at: MessageField::some(protobuf_timestamp(projection.updated_at)),
        runtime: runtime.map(MessageField::some).unwrap_or_default(),
        failure: projection
            .failure
            .map(supervisor_failure_to_proto)
            .map(MessageField::some)
            .unwrap_or_default(),
        active_session: Some(projection.active_session),
        ..Default::default()
    }
}

pub(super) fn write_supervisor_status_snapshot(
    paths: &SelfHostRuntimePaths,
    record: SupervisorStatusSnapshotWrite<'_>,
    command_line: &str,
) -> Result<types::SupervisorStatus, CliError> {
    let now = Utc::now();
    let data_dir = paths.data_dir.display().to_string();
    // Comment: supervisor-authored durable snapshots only project
    // supervisor-owned status. Runtime phase/sequence are owned by the live
    // runtime session and runtime-authored snapshots; active_session is always
    // false after recovery because no in-memory command stream survives.
    let status = project_supervisor_status(SupervisorStatusProjection {
        supervisor: record.supervisor,
        launch_id: record.launch_id,
        data_dir: &data_dir,
        phase: record.phase,
        supervisor_sequence: record.supervisor_sequence,
        runtime_pid: record.runtime_pid,
        failure: record.failure,
        active_session: false,
        updated_at: now,
    });
    let snapshot = types::SupervisorStatusSnapshot {
        header: MessageField::some(lifecycle_record_header(
            record.supervisor,
            record.launch_id,
            &data_dir,
            record.runtime_pid,
            now,
        )),
        status: MessageField::some(status.clone()),
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
                    lifecycle_records::durable_lifecycle_record_encoding_label(
                        lifecycle_records::DURABLE_STATE_FILE_ENCODING
                    )
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
    )?;

    Ok(status)
}

pub(super) struct TerminalRuntimeStatusSnapshotWrite<'a> {
    pub(super) supervisor: &'a types::SupervisorIdentity,
    pub(super) launch_id: &'a str,
    pub(super) phase: types::RuntimePhase,
    pub(super) runtime_pid: u32,
    pub(super) live_runtime_sequence: Option<u64>,
    pub(super) failure: Option<&'a SupervisorRuntimeFailureInfo>,
    pub(super) exit_code: Option<i32>,
    pub(super) signal: Option<&'a str>,
}

pub(super) fn write_terminal_runtime_status_snapshot(
    paths: &SelfHostRuntimePaths,
    record: TerminalRuntimeStatusSnapshotWrite<'_>,
    command_line: &str,
) -> Result<types::RuntimeStatus, CliError> {
    let now = Utc::now();
    let data_dir = paths.data_dir.display().to_string();
    let runtime_sequence = next_terminal_runtime_sequence(
        paths,
        record.launch_id,
        record.runtime_pid,
        record.live_runtime_sequence,
        command_line,
    )?;
    let failure = record.failure.map(|failure| {
        let failure_message = format!(
            "{}; exit_code={}; signal={}",
            failure.message,
            record
                .exit_code
                .map_or_else(|| "none".to_owned(), |code| code.to_string()),
            record.signal.unwrap_or("none"),
        );

        types::RuntimeFailure {
            code: Some(failure.code.into()),
            message: Some(failure_message),
            retryable: Some(failure.retryability.as_bool()),
            ..Default::default()
        }
    });
    let status = terminal_runtime_status_projection(record.phase, runtime_sequence, now, failure);

    let snapshot = types::RuntimeStatusSnapshot {
        header: MessageField::some(lifecycle_record_header(
            record.supervisor,
            record.launch_id,
            &data_dir,
            Some(record.runtime_pid),
            now,
        )),
        status: MessageField::some(status.clone()),
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
                    lifecycle_records::durable_lifecycle_record_encoding_label(
                        lifecycle_records::DURABLE_STATE_FILE_ENCODING
                    )
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
            retryable: record
                .failure
                .is_some_and(|failure| failure.retryability.as_bool()),
            exit_code: record.exit_code,
            signal: record.signal,
        },
        command_line,
    )?;

    Ok(status)
}

fn terminal_runtime_status_projection(
    phase: types::RuntimePhase,
    runtime_sequence: u64,
    updated_at: chrono::DateTime<Utc>,
    failure: Option<types::RuntimeFailure>,
) -> types::RuntimeStatus {
    types::RuntimeStatus {
        phase: Some(phase.into()),
        runtime_sequence: Some(runtime_sequence),
        updated_at: MessageField::some(protobuf_timestamp(updated_at)),
        failure: failure.map(MessageField::some).unwrap_or_default(),
        ..Default::default()
    }
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
    live_runtime_sequence: Option<u64>,
    command_line: &str,
) -> Result<u64, CliError> {
    let mut latest_runtime_sequence = live_runtime_sequence.unwrap_or(0);

    if let Some(runtime_sequence) =
        runtime_sequence_from_runtime_status_snapshot(paths, launch_id, runtime_pid, command_line)?
    {
        latest_runtime_sequence = latest_runtime_sequence.max(runtime_sequence);
    }

    if let Some(runtime_sequence) =
        runtime_sequence_from_supervisor_snapshot(paths, launch_id, runtime_pid, command_line)?
    {
        latest_runtime_sequence = latest_runtime_sequence.max(runtime_sequence);
    }

    Ok(latest_runtime_sequence.saturating_add(1))
}

fn runtime_sequence_from_runtime_status_snapshot(
    paths: &SelfHostRuntimePaths,
    launch_id: &str,
    runtime_pid: u32,
    command_line: &str,
) -> Result<Option<u64>, CliError> {
    let Some(snapshot) = read_runtime_status_snapshot_for_recovery(paths, command_line)? else {
        return Ok(None);
    };
    let Some(status) = snapshot.status.as_option() else {
        return Ok(None);
    };
    let Some(identity) = snapshot
        .header
        .as_option()
        .and_then(|header| header.launch.as_option())
    else {
        return Ok(None);
    };

    if identity.runtime_pid != Some(runtime_pid)
        || identity.launch_id.as_deref() != Some(launch_id)
        || identity
            .data_dir
            .as_deref()
            .is_none_or(|data_dir| std::path::Path::new(data_dir) != paths.data_dir.as_path())
    {
        return Ok(None);
    }

    Ok(status.runtime_sequence)
}

fn runtime_sequence_from_supervisor_snapshot(
    paths: &SelfHostRuntimePaths,
    launch_id: &str,
    runtime_pid: u32,
    command_line: &str,
) -> Result<Option<u64>, CliError> {
    let path = paths.supervisor_status_snapshot_path.as_path();
    if !path.exists() {
        return Ok(None);
    }

    let contents = fs::read_to_string(path).map_err(|error| {
        CliError::new(
            "failed to write terminal runtime lifecycle snapshot",
            command_line,
            ErrorStage::Internal,
            format!(
                "failed to read supervisor status snapshot {}: {error}",
                path.display()
            ),
            vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
        )
    })?;
    let snapshot =
        lifecycle_records::decode_supervisor_status_snapshot(&contents).map_err(|error| {
            CliError::new(
                "failed to write terminal runtime lifecycle snapshot",
                command_line,
                ErrorStage::Internal,
                format!(
                    "failed to decode supervisor status snapshot {}: {error}",
                    path.display()
                ),
                vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
            )
        })?;
    let Some(status) = snapshot.status.as_option() else {
        return Ok(None);
    };
    let Some(runtime) = status.runtime.as_option() else {
        return Ok(None);
    };

    if runtime.pid != Some(runtime_pid)
        || runtime.launch_id.as_deref() != Some(launch_id)
        || runtime
            .data_dir
            .as_deref()
            .is_none_or(|data_dir| std::path::Path::new(data_dir) != paths.data_dir.as_path())
    {
        return Ok(None);
    }

    Ok(status.runtime_sequence)
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
