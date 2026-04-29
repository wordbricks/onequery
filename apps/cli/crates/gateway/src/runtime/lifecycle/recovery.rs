//! Recovery folding for durable runtime lifecycle artifacts.

use std::fs;
use std::io;
use std::path::Path;

use buffa::MessageField;
use chrono::Utc;
use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;
use onequery_core::process::is_process_running;

use crate::runtime_control::types;
use crate::self_host::SelfHostRuntimePaths;

use super::super::lifecycle_event_log;
use super::super::lifecycle_event_log::protobuf_timestamp;
use super::super::lifecycle_records;

const LIFECYCLE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum DurableRecoveryStep {
    RuntimeStatusSnapshot,
    SupervisorTerminalRecord,
    RuntimeLeaseRecord,
}

const DURABLE_RECOVERY_PRECEDENCE: [DurableRecoveryStep; 3] = [
    DurableRecoveryStep::RuntimeStatusSnapshot,
    DurableRecoveryStep::SupervisorTerminalRecord,
    DurableRecoveryStep::RuntimeLeaseRecord,
];

#[derive(Debug, Clone, Eq, PartialEq)]
enum DurableRecoveryDecision {
    ActiveRuntime { identity: ManagedRuntimeIdentity },
    TerminalRuntime,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct ManagedRuntimeIdentity {
    pub(crate) launch_id: String,
    pub(crate) pid: u32,
    pub(crate) supervisor_pid: u32,
    pub(crate) supervisor_generation: u64,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct ManagedSupervisorIdentity {
    pub(crate) supervisor_id: String,
    pub(crate) pid: u32,
    pub(crate) generation: u64,
}

pub(crate) fn read_managed_runtime_pid(
    paths: &SelfHostRuntimePaths,
    command_line: &str,
) -> Result<Option<u32>, CliError> {
    Ok(read_managed_runtime_identity(paths, command_line)?.map(|identity| identity.pid))
}

pub(crate) fn read_active_supervisor_identity_for_runtime(
    paths: &SelfHostRuntimePaths,
    identity: &ManagedRuntimeIdentity,
    command_line: &str,
) -> Result<Option<ManagedSupervisorIdentity>, CliError> {
    let Some(supervisor_snapshot) =
        read_supervisor_status_snapshot_for_recovery(paths, command_line)?
    else {
        return Ok(None);
    };

    Ok(active_supervisor_identity_for_runtime(
        &supervisor_snapshot,
        identity,
        paths.data_dir.as_path(),
        is_process_running,
    ))
}

pub(crate) fn read_managed_runtime_identity(
    paths: &SelfHostRuntimePaths,
    command_line: &str,
) -> Result<Option<ManagedRuntimeIdentity>, CliError> {
    for step in DURABLE_RECOVERY_PRECEDENCE {
        match step {
            DurableRecoveryStep::RuntimeStatusSnapshot => {
                let Some(status_snapshot) =
                    read_runtime_status_snapshot_for_recovery(paths, command_line)?
                else {
                    continue;
                };
                if let Some(decision) = runtime_status_snapshot_recovery_decision(
                    &status_snapshot,
                    paths.data_dir.as_path(),
                ) {
                    return Ok(apply_process_liveness_recovery_step(
                        decision,
                        is_process_running,
                    ));
                }
            }
            DurableRecoveryStep::SupervisorTerminalRecord => {
                let Some(supervisor_snapshot) =
                    read_supervisor_status_snapshot_for_recovery(paths, command_line)?
                else {
                    continue;
                };
                if let Some(decision) = supervisor_terminal_recovery_decision(
                    &supervisor_snapshot,
                    paths.data_dir.as_path(),
                ) {
                    return Ok(apply_process_liveness_recovery_step(
                        decision,
                        is_process_running,
                    ));
                }
            }
            DurableRecoveryStep::RuntimeLeaseRecord => {
                let Some(lease_record) =
                    read_runtime_lease_record_for_recovery(paths, command_line)?
                else {
                    continue;
                };
                if let Some(decision) =
                    runtime_lease_recovery_decision(&lease_record, paths.data_dir.as_path())
                {
                    return Ok(apply_process_liveness_recovery_step(
                        decision,
                        is_process_running,
                    ));
                }
            }
        }
    }

    Ok(None)
}

fn read_runtime_lease_record_for_recovery(
    paths: &SelfHostRuntimePaths,
    command_line: &str,
) -> Result<Option<types::RuntimeLeaseRecord>, CliError> {
    read_lifecycle_proto_json_record_for_recovery(
        paths,
        paths.runtime_lease_path.as_path(),
        command_line,
        "failed to read runtime lease file",
        "failed to parse runtime lease file",
        "remove the stale runtime lease file and retry",
        lifecycle_records::decode_runtime_lease_record,
    )
}

pub(in crate::runtime) fn read_runtime_status_snapshot_for_recovery(
    paths: &SelfHostRuntimePaths,
    command_line: &str,
) -> Result<Option<types::RuntimeStatusSnapshot>, CliError> {
    read_lifecycle_proto_json_record_for_recovery(
        paths,
        paths.runtime_status_snapshot_path.as_path(),
        command_line,
        "failed to read runtime status snapshot file",
        "failed to parse runtime status snapshot file",
        "remove the stale runtime status snapshot file and retry",
        lifecycle_records::decode_runtime_status_snapshot,
    )
}

#[cfg(test)]
pub(super) fn read_runtime_status_snapshot(
    path: &Path,
    command_line: &str,
) -> Result<Option<types::RuntimeStatusSnapshot>, CliError> {
    read_lifecycle_proto_json_record(
        path,
        command_line,
        "failed to read runtime status snapshot file",
        "failed to parse runtime status snapshot file",
        "remove the stale runtime status snapshot file and retry",
        lifecycle_records::decode_runtime_status_snapshot,
    )
}

fn read_supervisor_status_snapshot_for_recovery(
    paths: &SelfHostRuntimePaths,
    command_line: &str,
) -> Result<Option<types::SupervisorStatusSnapshot>, CliError> {
    read_lifecycle_proto_json_record_for_recovery(
        paths,
        paths.supervisor_status_snapshot_path.as_path(),
        command_line,
        "failed to read supervisor status snapshot file",
        "failed to parse supervisor status snapshot file",
        "remove the stale supervisor status snapshot file and retry",
        lifecycle_records::decode_supervisor_status_snapshot,
    )
}

fn read_lifecycle_proto_json_record_for_recovery<T>(
    paths: &SelfHostRuntimePaths,
    path: &Path,
    command_line: &str,
    read_title: &'static str,
    parse_title: &'static str,
    try_next: &'static str,
    decode: impl FnOnce(&str) -> Result<T, serde_json::Error>,
) -> Result<Option<T>, CliError> {
    let Some(contents) = read_optional_runtime_file(path, command_line, read_title, try_next)?
    else {
        return Ok(None);
    };
    let trimmed = contents.trim();
    if trimmed.is_empty() {
        append_lifecycle_artifact_corruption_event(
            paths,
            path,
            command_line,
            parse_title,
            "record is empty",
            try_next,
        )?;
        return Ok(None);
    }

    match decode(trimmed) {
        Ok(record) => Ok(Some(record)),
        Err(error) => {
            append_lifecycle_artifact_corruption_event(
                paths,
                path,
                command_line,
                parse_title,
                &format!("{error}"),
                try_next,
            )?;
            Ok(None)
        }
    }
}

#[cfg(test)]
fn read_lifecycle_proto_json_record<T>(
    path: &Path,
    command_line: &str,
    read_title: &'static str,
    parse_title: &'static str,
    try_next: &'static str,
    decode: impl FnOnce(&str) -> Result<T, serde_json::Error>,
) -> Result<Option<T>, CliError> {
    let Some(contents) = read_optional_runtime_file(path, command_line, read_title, try_next)?
    else {
        return Ok(None);
    };
    let trimmed = contents.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    decode(trimmed).map(Some).map_err(|error| {
        CliError::new(
            parse_title,
            command_line,
            ErrorStage::LoadConfig,
            format!(
                "{error} ({}, encoding={})",
                path.display(),
                lifecycle_records::DURABLE_STATE_FILE_ENCODING
            ),
            vec![try_next.to_owned()],
        )
    })
}

fn append_lifecycle_artifact_corruption_event(
    paths: &SelfHostRuntimePaths,
    path: &Path,
    command_line: &str,
    summary: &str,
    message: &str,
    try_next: &str,
) -> Result<(), CliError> {
    let now = Utc::now();
    let lifecycle_sequence = lifecycle_event_log::next_lifecycle_event_sequence(
        paths.lifecycle_event_log_path.as_path(),
        command_line,
        vec!["check lifecycle event log permissions and retry".to_owned()],
        vec!["repair or remove the corrupt lifecycle event log and retry".to_owned()],
    )?;
    let data_dir = paths.data_dir.display().to_string();
    let corruption = types::LifecycleArtifactCorruption {
        path: Some(path.display().to_string()),
        message: Some(format!(
            "{summary}: {message} (encoding={})",
            lifecycle_records::DURABLE_STATE_FILE_ENCODING
        )),
        ..Default::default()
    };
    let entry = types::LifecycleEventLogEntry {
        header: MessageField::some(recovery_lifecycle_record_header(&data_dir, now)),
        lifecycle_sequence: Some(lifecycle_sequence),
        kind: Some(
            types::LifecycleEventKind::LIFECYCLE_EVENT_KIND_CORRUPT_DURABLE_RECORD_OBSERVED.into(),
        ),
        occurred_at: MessageField::some(protobuf_timestamp(now)),
        transition_id: Some(format!("artifact-corruption:{lifecycle_sequence}")),
        correlation_id: Some("artifact-recovery".to_owned()),
        monotonic_timestamp_nanos: Some(lifecycle_records::next_monotonic_timestamp_nanos()),
        payload: corruption.into(),
        ..Default::default()
    };
    let encoded = lifecycle_records::encode_lifecycle_event_log_entry(&entry);

    lifecycle_event_log::append_private_lifecycle_event_log_frame(
        paths.lifecycle_event_log_path.as_path(),
        &encoded,
        command_line,
        vec![try_next.to_owned()],
    )
}

fn recovery_lifecycle_record_header(
    data_dir: &str,
    written_at: chrono::DateTime<Utc>,
) -> types::LifecycleRecordHeader {
    types::LifecycleRecordHeader {
        schema_version: Some(LIFECYCLE_SCHEMA_VERSION),
        writer: MessageField::some(types::LifecycleRecordWriterIdentity {
            writer: Some(types::LifecycleRecordWriter::LIFECYCLE_RECORD_WRITER_SUPERVISOR.into()),
            writer_id: Some(format!("gateway-recovery:{}", std::process::id())),
            ..Default::default()
        }),
        launch: MessageField::some(types::LifecycleLaunchIdentity {
            launch_id: Some("artifact-recovery".to_owned()),
            data_dir: Some(data_dir.to_owned()),
            ..Default::default()
        }),
        written_at: MessageField::some(protobuf_timestamp(written_at)),
        ..Default::default()
    }
}

#[cfg(test)]
fn read_runtime_status_snapshot_during_startup_poll(
    path: &Path,
    command_line: &str,
) -> Result<Option<types::RuntimeStatusSnapshot>, CliError> {
    let Some(contents) = read_optional_runtime_file(
        path,
        command_line,
        "failed to read runtime status snapshot file",
        "remove the stale runtime status snapshot file and retry",
    )?
    else {
        return Ok(None);
    };

    let trimmed = contents.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    // CONTEXT: this bounded pre-handshake startup poll can race the runtime
    // replacing this file, so malformed protobuf JSON is retried instead of
    // recorded as recovery corruption.
    Ok(lifecycle_records::decode_runtime_status_snapshot(trimmed).ok())
}

fn read_optional_runtime_file(
    path: &Path,
    command_line: &str,
    title: &'static str,
    try_next: &'static str,
) -> Result<Option<String>, CliError> {
    match fs::read_to_string(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(CliError::new(
            title,
            command_line,
            ErrorStage::LoadConfig,
            format!("{error} ({})", path.display()),
            vec![try_next.to_owned()],
        )),
    }
}

#[cfg(test)]
fn runtime_ready_status_reported_during_startup_poll(
    path: &Path,
    expected_pid: u32,
    command_line: &str,
) -> Result<bool, CliError> {
    Ok(
        read_runtime_status_snapshot_during_startup_poll(path, command_line)?
            .and_then(|snapshot| runtime_status_snapshot_pid_and_phase(&snapshot))
            .is_some_and(|(pid, phase)| {
                pid == expected_pid && phase == types::RuntimePhase::RUNTIME_PHASE_READY
            }),
    )
}

#[cfg(test)]
fn runtime_ready_pid_reported_during_startup_poll(
    path: &Path,
    expected_data_dir: &Path,
    expected_launch_id: &str,
    command_line: &str,
) -> Result<Option<u32>, CliError> {
    Ok(
        read_runtime_status_snapshot_during_startup_poll(path, command_line)?.and_then(
            |snapshot| {
                let status = snapshot.status.as_option()?;
                let identity = status.identity.as_option()?;
                let pid = identity.pid?;
                let phase = runtime_status_phase(status)?;

                (phase == types::RuntimePhase::RUNTIME_PHASE_READY
                    && runtime_identity_matches_data_dir(identity, expected_data_dir)
                    && identity.launch_id.as_deref() == Some(expected_launch_id))
                .then_some(pid)
            },
        ),
    )
}

fn runtime_status_snapshot_recovery_decision(
    snapshot: &types::RuntimeStatusSnapshot,
    expected_data_dir: &Path,
) -> Option<DurableRecoveryDecision> {
    let status = snapshot.status.as_option()?;
    let runtime = status.identity.as_option()?;
    let launch = snapshot
        .header
        .as_option()
        .and_then(|header| header.launch.as_option())?;
    let identity = managed_runtime_identity_from_parts(runtime, launch, None, expected_data_dir)?;

    let phase = runtime_status_phase(status)?;
    if runtime_phase_is_terminal(phase) {
        return Some(DurableRecoveryDecision::TerminalRuntime);
    }
    if !runtime_phase_is_active(phase) {
        return None;
    }

    Some(DurableRecoveryDecision::ActiveRuntime { identity })
}

fn supervisor_terminal_recovery_decision(
    snapshot: &types::SupervisorStatusSnapshot,
    expected_data_dir: &Path,
) -> Option<DurableRecoveryDecision> {
    let status = snapshot.status.as_option()?;
    let phase = supervisor_status_phase(status)?;
    if !supervisor_phase_is_terminal(phase) {
        return None;
    }

    let launch = status.launch.as_option()?;
    let header_launch = snapshot
        .header
        .as_option()
        .and_then(|header| header.launch.as_option())?;
    let supervisor = status.identity.as_option()?;
    let runtime = status.runtime.as_option()?;

    if !launch_identity_matches_header(launch, header_launch, expected_data_dir)
        || !supervisor_identity_matches_launch(supervisor, launch)
        || !runtime_identity_matches_launch(runtime, launch, expected_data_dir)
    {
        return None;
    }

    Some(DurableRecoveryDecision::TerminalRuntime)
}

fn runtime_lease_recovery_decision(
    lease_record: &types::RuntimeLeaseRecord,
    expected_data_dir: &Path,
) -> Option<DurableRecoveryDecision> {
    let runtime = lease_record.runtime.as_option()?;
    let launch = lease_record
        .header
        .as_option()
        .and_then(|header| header.launch.as_option())?;
    let supervisor = lease_record.supervisor.as_option()?;

    managed_runtime_identity_from_parts(runtime, launch, Some(supervisor), expected_data_dir)
        .map(|identity| DurableRecoveryDecision::ActiveRuntime { identity })
}

fn managed_runtime_identity_from_parts(
    runtime: &types::RuntimeIdentity,
    launch: &types::LifecycleLaunchIdentity,
    supervisor: Option<&types::SupervisorIdentity>,
    expected_data_dir: &Path,
) -> Option<ManagedRuntimeIdentity> {
    if !runtime_identity_matches_launch(runtime, launch, expected_data_dir) {
        return None;
    }

    if let Some(supervisor) = supervisor
        && !supervisor_identity_matches_launch(supervisor, launch)
    {
        return None;
    }

    Some(ManagedRuntimeIdentity {
        launch_id: runtime
            .launch_id
            .as_deref()
            .filter(|launch_id| !launch_id.is_empty())?
            .to_owned(),
        pid: runtime.pid.filter(|pid| *pid > 0)?,
        supervisor_pid: launch.supervisor_pid.filter(|pid| *pid > 0)?,
        supervisor_generation: launch
            .supervisor_generation
            .filter(|generation| *generation > 0)?,
    })
}

fn apply_process_liveness_recovery_step(
    decision: DurableRecoveryDecision,
    is_process_running: impl Fn(u32) -> bool,
) -> Option<ManagedRuntimeIdentity> {
    match decision {
        DurableRecoveryDecision::ActiveRuntime { identity } if is_process_running(identity.pid) => {
            Some(identity)
        }
        DurableRecoveryDecision::ActiveRuntime { .. }
        | DurableRecoveryDecision::TerminalRuntime => None,
    }
}

fn active_supervisor_identity_for_runtime(
    snapshot: &types::SupervisorStatusSnapshot,
    identity: &ManagedRuntimeIdentity,
    expected_data_dir: &Path,
    is_process_running: impl Fn(u32) -> bool,
) -> Option<ManagedSupervisorIdentity> {
    let status = snapshot.status.as_option()?;
    let phase = supervisor_status_phase(status)?;
    if supervisor_phase_is_terminal(phase) {
        return None;
    }

    let supervisor = status.identity.as_option()?;
    let supervisor_id = supervisor
        .supervisor_id
        .as_deref()
        .filter(|supervisor_id| !supervisor_id.is_empty())?;
    let supervisor_pid = supervisor.pid?;
    let supervisor_generation = supervisor.generation?;

    if supervisor_pid != identity.supervisor_pid
        || supervisor_generation != identity.supervisor_generation
        || !is_process_running(supervisor_pid)
    {
        return None;
    }

    let launch = status.launch.as_option()?;

    if launch.launch_id.as_deref() != Some(identity.launch_id.as_str())
        || !launch_identity_matches_data_dir(launch, expected_data_dir)
        || launch
            .runtime_pid
            .is_some_and(|runtime_pid| runtime_pid != identity.pid)
        || launch.supervisor_pid != Some(identity.supervisor_pid)
        || launch.supervisor_generation != Some(identity.supervisor_generation)
    {
        return None;
    }

    if let Some(runtime) = status.runtime.as_option()
        && (runtime.pid != Some(identity.pid)
            || runtime.launch_id.as_deref() != Some(identity.launch_id.as_str())
            || !runtime_identity_matches_data_dir(runtime, expected_data_dir))
    {
        return None;
    }

    Some(ManagedSupervisorIdentity {
        supervisor_id: supervisor_id.to_owned(),
        pid: supervisor_pid,
        generation: supervisor_generation,
    })
}

fn runtime_identity_matches_data_dir(
    identity: &types::RuntimeIdentity,
    expected_data_dir: &Path,
) -> bool {
    identity
        .data_dir
        .as_deref()
        .is_some_and(|data_dir| Path::new(data_dir) == expected_data_dir)
}

fn launch_identity_matches_data_dir(
    identity: &types::LifecycleLaunchIdentity,
    expected_data_dir: &Path,
) -> bool {
    identity
        .data_dir
        .as_deref()
        .is_some_and(|data_dir| Path::new(data_dir) == expected_data_dir)
}

fn runtime_identity_matches_launch(
    runtime: &types::RuntimeIdentity,
    launch: &types::LifecycleLaunchIdentity,
    expected_data_dir: &Path,
) -> bool {
    runtime
        .launch_id
        .as_deref()
        .is_some_and(|launch_id| !launch_id.is_empty())
        && runtime.pid.is_some_and(|pid| pid > 0)
        && runtime_identity_matches_data_dir(runtime, expected_data_dir)
        && launch_identity_matches_data_dir(launch, expected_data_dir)
        && runtime.launch_id == launch.launch_id
        && runtime.pid == launch.runtime_pid
        && launch.supervisor_pid.is_some_and(|pid| pid > 0)
        && launch
            .supervisor_generation
            .is_some_and(|generation| generation > 0)
}

fn launch_identity_matches_header(
    launch: &types::LifecycleLaunchIdentity,
    header_launch: &types::LifecycleLaunchIdentity,
    expected_data_dir: &Path,
) -> bool {
    launch_identity_matches_data_dir(launch, expected_data_dir)
        && launch_identity_matches_data_dir(header_launch, expected_data_dir)
        && launch.launch_id == header_launch.launch_id
        && launch.runtime_pid == header_launch.runtime_pid
        && launch.supervisor_pid == header_launch.supervisor_pid
        && launch.supervisor_generation == header_launch.supervisor_generation
        && launch
            .launch_id
            .as_deref()
            .is_some_and(|launch_id| !launch_id.is_empty())
        && launch.runtime_pid.is_some_and(|pid| pid > 0)
        && launch.supervisor_pid.is_some_and(|pid| pid > 0)
        && launch
            .supervisor_generation
            .is_some_and(|generation| generation > 0)
}

fn supervisor_identity_matches_launch(
    supervisor: &types::SupervisorIdentity,
    launch: &types::LifecycleLaunchIdentity,
) -> bool {
    supervisor
        .supervisor_id
        .as_deref()
        .is_some_and(|supervisor_id| !supervisor_id.is_empty())
        && supervisor.pid == launch.supervisor_pid
        && supervisor.generation == launch.supervisor_generation
        && supervisor.pid.is_some_and(|pid| pid > 0)
        && supervisor
            .generation
            .is_some_and(|generation| generation > 0)
}

pub(in crate::runtime) fn runtime_phase_label(phase: types::RuntimePhase) -> &'static str {
    match phase {
        types::RuntimePhase::RUNTIME_PHASE_CHECKPOINTING => "checkpointing",
        types::RuntimePhase::RUNTIME_PHASE_DRAINING => "draining",
        types::RuntimePhase::RUNTIME_PHASE_FAILED => "failed",
        types::RuntimePhase::RUNTIME_PHASE_READY => "ready",
        types::RuntimePhase::RUNTIME_PHASE_SHUTDOWN_FAILED => "shutdown_failed",
        types::RuntimePhase::RUNTIME_PHASE_STARTING => "starting",
        types::RuntimePhase::RUNTIME_PHASE_STOPPED => "stopped",
        types::RuntimePhase::RUNTIME_PHASE_STOPPING => "stopping",
        types::RuntimePhase::RUNTIME_PHASE_UNSPECIFIED => "unspecified",
    }
}

#[cfg(test)]
fn runtime_status_snapshot_pid_and_phase(
    snapshot: &types::RuntimeStatusSnapshot,
) -> Option<(u32, types::RuntimePhase)> {
    let status = snapshot.status.as_option()?;
    let identity = status.identity.as_option()?;

    Some((identity.pid?, runtime_status_phase(status)?))
}

fn runtime_status_phase(status: &types::RuntimeStatus) -> Option<types::RuntimePhase> {
    status.phase.and_then(|phase| phase.as_known())
}

fn supervisor_status_phase(status: &types::SupervisorStatus) -> Option<types::SupervisorPhase> {
    status.phase.and_then(|phase| phase.as_known())
}

fn runtime_phase_is_active(phase: types::RuntimePhase) -> bool {
    matches!(
        phase,
        types::RuntimePhase::RUNTIME_PHASE_STARTING
            | types::RuntimePhase::RUNTIME_PHASE_READY
            | types::RuntimePhase::RUNTIME_PHASE_DRAINING
            | types::RuntimePhase::RUNTIME_PHASE_CHECKPOINTING
            | types::RuntimePhase::RUNTIME_PHASE_STOPPING
    )
}

fn runtime_phase_is_terminal(phase: types::RuntimePhase) -> bool {
    matches!(
        phase,
        types::RuntimePhase::RUNTIME_PHASE_STOPPED
            | types::RuntimePhase::RUNTIME_PHASE_SHUTDOWN_FAILED
            | types::RuntimePhase::RUNTIME_PHASE_FAILED
    )
}

fn supervisor_phase_is_terminal(phase: types::SupervisorPhase) -> bool {
    matches!(
        phase,
        types::SupervisorPhase::SUPERVISOR_PHASE_EXITED
            | types::SupervisorPhase::SUPERVISOR_PHASE_FAILED
    )
}

#[cfg(test)]
mod recovery_tests;
