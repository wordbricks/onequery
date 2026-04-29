use std::fs;
use std::fs::OpenOptions;
use std::io;
use std::io::Write;
use std::path::Path;

use buffa::MessageField;
use chrono::Utc;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use onequery_cli_core::process::is_process_running;

use crate::runtime_control::types;
use crate::self_host::SelfHostRuntimePaths;
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use super::lifecycle_records;

const LIFECYCLE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum DurableRecoveryStep {
    LifecycleEventLog,
    RuntimeStatusSnapshot,
    SupervisorTerminalRecord,
    RuntimeLeaseRecord,
    ProcessLivenessCheck,
}

const DURABLE_RECOVERY_PRECEDENCE: [DurableRecoveryStep; 5] = [
    DurableRecoveryStep::LifecycleEventLog,
    DurableRecoveryStep::RuntimeStatusSnapshot,
    DurableRecoveryStep::SupervisorTerminalRecord,
    DurableRecoveryStep::RuntimeLeaseRecord,
    DurableRecoveryStep::ProcessLivenessCheck,
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
    pub(crate) supervisor_pid: Option<u32>,
    pub(crate) supervisor_generation: Option<u64>,
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
    let supervisor_snapshot = read_supervisor_status_snapshot_for_recovery(paths, command_line)?;

    Ok(active_supervisor_identity_for_runtime(
        supervisor_snapshot.as_ref(),
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
            DurableRecoveryStep::LifecycleEventLog => {
                // Comment: lifecycle event frames are written by the
                // supervisor, but recovery folding is not wired yet. Until
                // then, recovery has no event-log decision and falls through
                // to snapshots.
            }
            DurableRecoveryStep::RuntimeStatusSnapshot => {
                let status_snapshot =
                    read_runtime_status_snapshot_for_recovery(paths, command_line)?;
                if let Some(decision) = runtime_status_snapshot_recovery_decision(
                    status_snapshot.as_ref(),
                    paths.data_dir.as_path(),
                ) {
                    return Ok(apply_process_liveness_recovery_step(
                        decision,
                        is_process_running,
                    ));
                }
            }
            DurableRecoveryStep::SupervisorTerminalRecord => {
                let supervisor_snapshot =
                    read_supervisor_status_snapshot_for_recovery(paths, command_line)?;
                if let Some(decision) = supervisor_terminal_recovery_decision(
                    supervisor_snapshot.as_ref(),
                    paths.data_dir.as_path(),
                ) {
                    return Ok(apply_process_liveness_recovery_step(
                        decision,
                        is_process_running,
                    ));
                }
            }
            DurableRecoveryStep::RuntimeLeaseRecord => {
                let lease_record = read_runtime_lease_record_for_recovery(paths, command_line)?;
                if let Some(decision) =
                    runtime_lease_recovery_decision(lease_record.as_ref(), paths.data_dir.as_path())
                {
                    return Ok(apply_process_liveness_recovery_step(
                        decision,
                        is_process_running,
                    ));
                }
            }
            DurableRecoveryStep::ProcessLivenessCheck => {}
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

pub(super) fn read_runtime_status_snapshot_for_recovery(
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
    let lifecycle_sequence = next_recovery_lifecycle_event_sequence(
        paths.lifecycle_event_log_path.as_path(),
        command_line,
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

    append_recovery_lifecycle_event_log_frame(
        paths.lifecycle_event_log_path.as_path(),
        &encoded,
        command_line,
        try_next,
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
            runtime_pid: Some(0),
            supervisor_pid: Some(0),
            supervisor_generation: Some(0),
            ..Default::default()
        }),
        written_at: MessageField::some(protobuf_timestamp(written_at)),
        ..Default::default()
    }
}

fn next_recovery_lifecycle_event_sequence(
    path: &Path,
    command_line: &str,
) -> Result<u64, CliError> {
    let contents = match fs::read(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(1),
        Err(error) => {
            return Err(CliError::new(
                "failed to read lifecycle event log",
                command_line,
                ErrorStage::Internal,
                format!("{error} ({})", path.display()),
                vec!["check lifecycle event log permissions and retry".to_owned()],
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
                vec!["repair or remove the corrupt lifecycle event log and retry".to_owned()],
            )
        })?;

    Ok(entries
        .into_iter()
        .filter_map(|entry| entry.lifecycle_sequence)
        .max()
        .unwrap_or(0)
        .saturating_add(1))
}

fn append_recovery_lifecycle_event_log_frame(
    path: &Path,
    frame: &[u8],
    command_line: &str,
    try_next: &str,
) -> Result<(), CliError> {
    let parent = path.parent().ok_or_else(|| {
        CliError::new(
            "failed to compute lifecycle event log directory",
            command_line,
            ErrorStage::Internal,
            format!("invalid path: {}", path.display()),
            vec![try_next.to_owned()],
        )
    })?;
    fs::create_dir_all(parent).map_err(|error| {
        CliError::new(
            "failed to create lifecycle event log directory",
            command_line,
            ErrorStage::Internal,
            format!("{error} ({})", parent.display()),
            vec![try_next.to_owned()],
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
            vec![try_next.to_owned()],
        )
    })?;

    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|error| {
        CliError::new(
            "failed to secure lifecycle event log",
            command_line,
            ErrorStage::Internal,
            format!("{error} ({})", path.display()),
            vec![try_next.to_owned()],
        )
    })?;

    file.write_all(frame).map_err(|error| {
        CliError::new(
            "failed to append lifecycle event log",
            command_line,
            ErrorStage::Internal,
            format!("{error} ({})", path.display()),
            vec![try_next.to_owned()],
        )
    })?;
    file.sync_all().map_err(|error| {
        CliError::new(
            "failed to sync lifecycle event log",
            command_line,
            ErrorStage::Internal,
            format!("{error} ({})", path.display()),
            vec![try_next.to_owned()],
        )
    })
}

fn protobuf_timestamp(value: chrono::DateTime<Utc>) -> buffa_types::google::protobuf::Timestamp {
    buffa_types::google::protobuf::Timestamp {
        nanos: value.timestamp_subsec_nanos() as i32,
        seconds: value.timestamp(),
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
                    && runtime_launch_id_matches(identity.launch_id.as_deref(), expected_launch_id))
                .then_some(pid)
            },
        ),
    )
}

fn runtime_status_snapshot_recovery_decision(
    snapshot: Option<&types::RuntimeStatusSnapshot>,
    expected_data_dir: &Path,
) -> Option<DurableRecoveryDecision> {
    let snapshot = snapshot?;
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
    snapshot: Option<&types::SupervisorStatusSnapshot>,
    expected_data_dir: &Path,
) -> Option<DurableRecoveryDecision> {
    let snapshot = snapshot?;
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
    lease_record: Option<&types::RuntimeLeaseRecord>,
    expected_data_dir: &Path,
) -> Option<DurableRecoveryDecision> {
    let lease_record = lease_record?;
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
        supervisor_pid: launch.supervisor_pid.filter(|pid| *pid > 0),
        supervisor_generation: launch
            .supervisor_generation
            .filter(|generation| *generation > 0),
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
    snapshot: Option<&types::SupervisorStatusSnapshot>,
    identity: &ManagedRuntimeIdentity,
    expected_data_dir: &Path,
    is_process_running: impl Fn(u32) -> bool,
) -> Option<ManagedSupervisorIdentity> {
    let snapshot = snapshot?;
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

    if Some(supervisor_pid) != identity.supervisor_pid
        || Some(supervisor_generation) != identity.supervisor_generation
        || !is_process_running(supervisor_pid)
    {
        return None;
    }

    let launch = status.launch.as_option().or_else(|| {
        snapshot
            .header
            .as_option()
            .and_then(|header| header.launch.as_option())
    })?;

    if launch.launch_id.as_deref() != Some(identity.launch_id.as_str())
        || !launch_identity_matches_data_dir(launch, expected_data_dir)
        || launch
            .runtime_pid
            .is_some_and(|runtime_pid| runtime_pid != identity.pid)
        || launch.supervisor_pid != identity.supervisor_pid
        || launch.supervisor_generation != identity.supervisor_generation
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

pub(super) fn runtime_launch_id_matches(actual: Option<&str>, expected: &str) -> bool {
    actual == Some(expected)
}

pub(super) fn runtime_phase_label(phase: types::RuntimePhase) -> &'static str {
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

pub(super) fn runtime_status_snapshot_pid_and_phase(
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
mod tests {
    use std::fs;

    use pretty_assertions::assert_eq;
    use tempfile::tempdir;

    use super::DURABLE_RECOVERY_PRECEDENCE;
    use super::DurableRecoveryStep;
    use super::ManagedRuntimeIdentity;
    use super::ManagedSupervisorIdentity;
    use super::read_active_supervisor_identity_for_runtime;
    use super::read_managed_runtime_identity;
    use super::read_managed_runtime_pid;
    use super::read_runtime_status_snapshot;
    use super::runtime_ready_pid_reported_during_startup_poll;
    use super::runtime_ready_status_reported_during_startup_poll;
    use crate::runtime::lifecycle_records;
    use crate::runtime_control::types;
    use crate::self_host::SelfHostRuntimePaths;

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

    fn runtime_lease_json(paths: &SelfHostRuntimePaths, pid: u32, launch_id: &str) -> String {
        runtime_lease_json_with_supervisor(paths, pid, launch_id, 1, 1)
    }

    fn runtime_lease_json_with_supervisor(
        paths: &SelfHostRuntimePaths,
        pid: u32,
        launch_id: &str,
        header_supervisor_pid: u32,
        supervisor_pid: u32,
    ) -> String {
        format!(
            r#"{{
  "header": {{
    "schemaVersion": 1,
    "writer": {{"writer": "LIFECYCLE_RECORD_WRITER_RUNTIME", "writerId": "runtime:{pid}"}},
    "launch": {{"launchId": "{launch_id}", "dataDir": "{}", "runtimePid": {pid}, "supervisorPid": {header_supervisor_pid}, "supervisorGeneration": "1"}},
    "writtenAt": "2026-03-25T00:00:00Z"
  }},
  "runtime": {{"pid": {pid}, "launchId": "{launch_id}", "dataDir": "{}"}},
  "supervisor": {{"supervisorId": "supervisor-a", "pid": {supervisor_pid}, "generation": "1"}},
  "runtimeSequence": "1",
  "acquiredAt": "2026-03-25T00:00:00Z",
  "renewedAt": "2026-03-25T00:00:00Z",
  "leaseTtl": "60s"
}}"#,
            paths.data_dir.display(),
            paths.data_dir.display()
        )
    }

    fn runtime_status_snapshot_json(
        data_dir: &str,
        pid: u32,
        launch_id: &str,
        phase: &str,
    ) -> String {
        runtime_status_snapshot_json_with_header_pid(data_dir, pid, pid, launch_id, phase)
    }

    fn runtime_status_snapshot_json_with_header_pid(
        data_dir: &str,
        pid: u32,
        header_runtime_pid: u32,
        launch_id: &str,
        phase: &str,
    ) -> String {
        format!(
            r#"{{
  "header": {{
    "schemaVersion": 1,
    "writer": {{"writer": "LIFECYCLE_RECORD_WRITER_RUNTIME", "writerId": "runtime:{pid}"}},
    "launch": {{"launchId": "{launch_id}", "dataDir": "{data_dir}", "runtimePid": {header_runtime_pid}, "supervisorPid": 1, "supervisorGeneration": "1"}},
    "writtenAt": "2026-03-25T00:00:00Z"
  }},
  "status": {{
    "identity": {{"pid": {pid}, "launchId": "{launch_id}", "dataDir": "{data_dir}"}},
    "phase": "{phase}",
    "runtimeSequence": "1",
    "updatedAt": "2026-03-25T00:00:00Z"
  }},
  "snapshotAt": "2026-03-25T00:00:00Z"
}}"#
        )
    }

    fn supervisor_status_snapshot_json(
        data_dir: &str,
        runtime_pid: u32,
        launch_id: &str,
        phase: &str,
    ) -> String {
        format!(
            r#"{{
  "header": {{
    "schemaVersion": 1,
    "writer": {{"writer": "LIFECYCLE_RECORD_WRITER_SUPERVISOR", "writerId": "supervisor:1"}},
    "launch": {{"launchId": "{launch_id}", "dataDir": "{data_dir}", "runtimePid": {runtime_pid}, "supervisorPid": 1, "supervisorGeneration": "1"}},
    "writtenAt": "2026-03-25T00:00:00Z"
  }},
  "status": {{
    "identity": {{"supervisorId": "supervisor:1", "pid": 1, "generation": "1"}},
    "launch": {{"launchId": "{launch_id}", "dataDir": "{data_dir}", "runtimePid": {runtime_pid}, "supervisorPid": 1, "supervisorGeneration": "1"}},
    "phase": "{phase}",
    "supervisorSequence": "3",
    "updatedAt": "2026-03-25T00:00:00Z",
    "runtime": {{"pid": {runtime_pid}, "launchId": "{launch_id}", "dataDir": "{data_dir}"}}
  }},
  "snapshotAt": "2026-03-25T00:00:00Z"
}}"#
        )
    }

    fn supervisor_status_snapshot_json_with_supervisor(
        data_dir: &str,
        runtime_pid: u32,
        supervisor_pid: u32,
        launch_id: &str,
        phase: &str,
    ) -> String {
        format!(
            r#"{{
  "header": {{
    "schemaVersion": 1,
    "writer": {{"writer": "LIFECYCLE_RECORD_WRITER_SUPERVISOR", "writerId": "supervisor:{supervisor_pid}"}},
    "launch": {{"launchId": "{launch_id}", "dataDir": "{data_dir}", "runtimePid": {runtime_pid}, "supervisorPid": {supervisor_pid}, "supervisorGeneration": "1"}},
    "writtenAt": "2026-03-25T00:00:00Z"
  }},
  "status": {{
    "identity": {{"supervisorId": "supervisor:{supervisor_pid}", "pid": {supervisor_pid}, "generation": "1"}},
    "launch": {{"launchId": "{launch_id}", "dataDir": "{data_dir}", "runtimePid": {runtime_pid}, "supervisorPid": {supervisor_pid}, "supervisorGeneration": "1"}},
    "phase": "{phase}",
    "supervisorSequence": "3",
    "updatedAt": "2026-03-25T00:00:00Z",
    "runtime": {{"pid": {runtime_pid}, "launchId": "{launch_id}", "dataDir": "{data_dir}"}}
  }},
  "snapshotAt": "2026-03-25T00:00:00Z"
}}"#
        )
    }

    fn read_lifecycle_events(paths: &SelfHostRuntimePaths) -> Vec<types::LifecycleEventLogEntry> {
        let contents = fs::read(&paths.lifecycle_event_log_path)
            .unwrap_or_else(|error| panic!("expected lifecycle event log read: {error}"));

        lifecycle_records::decode_lifecycle_event_log_entries(&contents)
            .unwrap_or_else(|error| panic!("expected lifecycle event log decode: {error}"))
    }

    fn assert_corruption_event(
        entry: &types::LifecycleEventLogEntry,
        sequence: u64,
        path: &std::path::Path,
    ) {
        assert_eq!(entry.lifecycle_sequence, Some(sequence));
        assert_eq!(
            entry.kind.and_then(|kind| kind.as_known()),
            Some(types::LifecycleEventKind::LIFECYCLE_EVENT_KIND_CORRUPT_DURABLE_RECORD_OBSERVED)
        );
        let expected_transition_id = format!("artifact-corruption:{sequence}");
        assert_eq!(
            entry.transition_id.as_deref(),
            Some(expected_transition_id.as_str())
        );
        assert_eq!(entry.correlation_id.as_deref(), Some("artifact-recovery"));

        let header = entry.header.as_option().expect("expected event header");
        let writer = header.writer.as_option().expect("expected event writer");
        assert_eq!(
            writer.writer.and_then(|writer| writer.as_known()),
            Some(types::LifecycleRecordWriter::LIFECYCLE_RECORD_WRITER_SUPERVISOR)
        );
        assert!(
            writer
                .writer_id
                .as_deref()
                .is_some_and(|writer_id| writer_id.starts_with("gateway-recovery:"))
        );

        let launch = header.launch.as_option().expect("expected event launch");
        assert_eq!(launch.launch_id.as_deref(), Some("artifact-recovery"));
        assert_eq!(launch.runtime_pid, Some(0));
        assert_eq!(launch.supervisor_pid, Some(0));
        assert_eq!(launch.supervisor_generation, Some(0));

        let corruption = match entry.payload.as_ref().expect("expected event payload") {
            types::lifecycle_event_log_entry::Payload::ArtifactCorruption(corruption) => corruption,
            payload => panic!("expected artifact corruption payload, got {payload:?}"),
        };
        let expected_path = path.display().to_string();
        assert_eq!(corruption.path.as_deref(), Some(expected_path.as_str()));
        assert!(
            corruption
                .message
                .as_deref()
                .is_some_and(|message| message.contains("encoding=proto-json"))
        );
    }

    #[test]
    fn durable_recovery_precedence_matches_contract_order() {
        assert_eq!(
            DURABLE_RECOVERY_PRECEDENCE,
            [
                DurableRecoveryStep::LifecycleEventLog,
                DurableRecoveryStep::RuntimeStatusSnapshot,
                DurableRecoveryStep::SupervisorTerminalRecord,
                DurableRecoveryStep::RuntimeLeaseRecord,
                DurableRecoveryStep::ProcessLivenessCheck,
            ]
        );
    }

    #[test]
    fn startup_poll_treats_malformed_runtime_status_snapshot_as_retryable() {
        let (_temp_dir, paths) = test_paths();

        fs::write(&paths.runtime_status_snapshot_path, "{\"status\":")
            .unwrap_or_else(|error| panic!("expected malformed snapshot write: {error}"));

        assert!(
            !runtime_ready_status_reported_during_startup_poll(
                paths.runtime_status_snapshot_path.as_path(),
                4242,
                "onequery gateway start",
            )
            .unwrap_or_else(|error| panic!("expected retryable snapshot read: {error}"))
        );
    }

    #[test]
    fn startup_poll_returns_ready_pid_for_matching_data_dir() {
        let (_temp_dir, paths) = test_paths();

        fs::write(
            &paths.runtime_status_snapshot_path,
            runtime_status_snapshot_json(
                &paths.data_dir.display().to_string(),
                4242,
                "launch-a",
                "RUNTIME_PHASE_READY",
            ),
        )
        .unwrap_or_else(|error| panic!("expected snapshot write: {error}"));

        assert_eq!(
            runtime_ready_pid_reported_during_startup_poll(
                paths.runtime_status_snapshot_path.as_path(),
                paths.data_dir.as_path(),
                "launch-a",
                "onequery gateway start",
            )
            .unwrap_or_else(|error| panic!("expected ready pid read: {error}")),
            Some(4242)
        );
    }

    #[test]
    fn startup_poll_ignores_ready_pid_for_other_data_dir() {
        let (_temp_dir, paths) = test_paths();

        fs::write(
            &paths.runtime_status_snapshot_path,
            runtime_status_snapshot_json("/other", 4242, "launch-a", "RUNTIME_PHASE_READY"),
        )
        .unwrap_or_else(|error| panic!("expected snapshot write: {error}"));

        assert_eq!(
            runtime_ready_pid_reported_during_startup_poll(
                paths.runtime_status_snapshot_path.as_path(),
                paths.data_dir.as_path(),
                "launch-a",
                "onequery gateway start",
            )
            .unwrap_or_else(|error| panic!("expected ready pid read: {error}")),
            None
        );
    }

    #[test]
    fn startup_poll_ignores_ready_pid_for_other_launch() {
        let (_temp_dir, paths) = test_paths();

        fs::write(
            &paths.runtime_status_snapshot_path,
            runtime_status_snapshot_json(
                &paths.data_dir.display().to_string(),
                4242,
                "other-launch",
                "RUNTIME_PHASE_READY",
            ),
        )
        .unwrap_or_else(|error| panic!("expected snapshot write: {error}"));

        assert_eq!(
            runtime_ready_pid_reported_during_startup_poll(
                paths.runtime_status_snapshot_path.as_path(),
                paths.data_dir.as_path(),
                "launch-a",
                "onequery gateway start",
            )
            .unwrap_or_else(|error| panic!("expected ready pid read: {error}")),
            None
        );
    }

    #[test]
    fn strict_runtime_status_snapshot_reads_still_report_parse_failures() {
        let (_temp_dir, paths) = test_paths();

        fs::write(&paths.runtime_status_snapshot_path, "{\"status\":")
            .unwrap_or_else(|error| panic!("expected malformed snapshot write: {error}"));

        let error = read_runtime_status_snapshot(
            paths.runtime_status_snapshot_path.as_path(),
            "onequery gateway status",
        )
        .expect_err("expected malformed runtime status snapshot to fail strict reads");

        assert_eq!(
            error.title.as_str(),
            "failed to parse runtime status snapshot file"
        );
    }

    #[test]
    fn strict_runtime_status_snapshot_reads_report_read_failures() {
        let (temp_dir, _paths) = test_paths();
        let error = read_runtime_status_snapshot(temp_dir.path(), "onequery gateway status")
            .expect_err("expected directory read to fail strict runtime status snapshot reads");

        assert_eq!(
            error.title.as_str(),
            "failed to read runtime status snapshot file"
        );
        assert_eq!(
            error.try_next,
            vec!["remove the stale runtime status snapshot file and retry".to_owned()]
        );
    }

    #[test]
    fn startup_poll_reports_runtime_status_snapshot_read_failures() {
        let (temp_dir, paths) = test_paths();
        let error = runtime_ready_pid_reported_during_startup_poll(
            temp_dir.path(),
            paths.data_dir.as_path(),
            "launch-a",
            "onequery gateway start",
        )
        .expect_err("expected directory read to fail startup poll");

        assert_eq!(
            error.title.as_str(),
            "failed to read runtime status snapshot file"
        );
    }

    #[test]
    fn read_managed_runtime_pid_records_corrupt_runtime_status_snapshot_and_uses_live_lease() {
        let (_temp_dir, paths) = test_paths();
        let pid = std::process::id();

        fs::write(&paths.runtime_status_snapshot_path, "{\"status\":")
            .unwrap_or_else(|error| panic!("expected malformed snapshot write: {error}"));
        fs::write(
            &paths.runtime_lease_path,
            runtime_lease_json(&paths, pid, "launch-a"),
        )
        .unwrap_or_else(|error| panic!("expected lease write: {error}"));

        assert_eq!(
            read_managed_runtime_pid(&paths, "onequery gateway status")
                .unwrap_or_else(|error| panic!("expected recovery read: {error}")),
            Some(pid)
        );

        let events = read_lifecycle_events(&paths);
        assert_eq!(events.len(), 1);
        assert_corruption_event(&events[0], 1, paths.runtime_status_snapshot_path.as_path());
    }

    #[test]
    fn read_managed_runtime_pid_records_corrupt_supervisor_status_snapshot_and_uses_live_lease() {
        let (_temp_dir, paths) = test_paths();
        let pid = std::process::id();

        fs::write(&paths.supervisor_status_snapshot_path, "{\"status\":").unwrap_or_else(|error| {
            panic!("expected malformed supervisor snapshot write: {error}")
        });
        fs::write(
            &paths.runtime_lease_path,
            runtime_lease_json(&paths, pid, "launch-a"),
        )
        .unwrap_or_else(|error| panic!("expected lease write: {error}"));

        assert_eq!(
            read_managed_runtime_pid(&paths, "onequery gateway status")
                .unwrap_or_else(|error| panic!("expected recovery read: {error}")),
            Some(pid)
        );

        let events = read_lifecycle_events(&paths);
        assert_eq!(events.len(), 1);
        assert_corruption_event(
            &events[0],
            1,
            paths.supervisor_status_snapshot_path.as_path(),
        );
    }

    #[test]
    fn read_managed_runtime_pid_records_corrupt_runtime_lease_as_absent_evidence() {
        let (_temp_dir, paths) = test_paths();

        fs::write(&paths.runtime_lease_path, "{\"runtime\":")
            .unwrap_or_else(|error| panic!("expected malformed lease write: {error}"));

        assert_eq!(
            read_managed_runtime_pid(&paths, "onequery gateway status")
                .unwrap_or_else(|error| panic!("expected recovery read: {error}")),
            None
        );

        let events = read_lifecycle_events(&paths);
        assert_eq!(events.len(), 1);
        assert_corruption_event(&events[0], 1, paths.runtime_lease_path.as_path());
    }

    #[test]
    fn read_managed_runtime_pid_reports_unreadable_runtime_lease_file() {
        let (_temp_dir, paths) = test_paths();
        fs::create_dir(&paths.runtime_lease_path)
            .unwrap_or_else(|error| panic!("expected lease marker directory creation: {error}"));

        let error = read_managed_runtime_pid(&paths, "onequery gateway status")
            .expect_err("expected unreadable lease marker to fail");

        assert_eq!(error.title.as_str(), "failed to read runtime lease file");
    }

    #[test]
    fn read_managed_runtime_pid_uses_live_lease_after_missing_higher_evidence() {
        let (_temp_dir, paths) = test_paths();
        let pid = std::process::id();

        fs::write(
            &paths.runtime_lease_path,
            runtime_lease_json(&paths, pid, "launch-a"),
        )
        .unwrap_or_else(|error| panic!("expected lease write: {error}"));

        assert_eq!(
            read_managed_runtime_pid(&paths, "onequery gateway status")
                .unwrap_or_else(|error| panic!("expected pid read: {error}")),
            Some(pid)
        );
    }

    #[test]
    fn read_managed_runtime_pid_accepts_live_lease_with_matching_runtime_status_snapshot() {
        let (_temp_dir, paths) = test_paths();
        let pid = std::process::id();

        fs::write(
            &paths.runtime_lease_path,
            runtime_lease_json(&paths, pid, "launch-a"),
        )
        .unwrap_or_else(|error| panic!("expected lease write: {error}"));
        fs::write(
            &paths.runtime_status_snapshot_path,
            runtime_status_snapshot_json(
                &paths.data_dir.display().to_string(),
                pid,
                "launch-a",
                "RUNTIME_PHASE_READY",
            ),
        )
        .unwrap_or_else(|error| panic!("expected snapshot write: {error}"));

        assert_eq!(
            read_managed_runtime_pid(&paths, "onequery gateway status")
                .unwrap_or_else(|error| panic!("expected pid read: {error}")),
            Some(pid)
        );
    }

    #[test]
    fn read_managed_runtime_identity_preserves_supervisor_fencing_from_runtime_status_snapshot() {
        let (_temp_dir, paths) = test_paths();
        let pid = std::process::id();

        fs::write(
            &paths.runtime_status_snapshot_path,
            runtime_status_snapshot_json(
                &paths.data_dir.display().to_string(),
                pid,
                "launch-a",
                "RUNTIME_PHASE_READY",
            ),
        )
        .unwrap_or_else(|error| panic!("expected snapshot write: {error}"));

        assert_eq!(
            read_managed_runtime_identity(&paths, "onequery gateway stop")
                .unwrap_or_else(|error| panic!("expected identity read: {error}")),
            Some(super::ManagedRuntimeIdentity {
                launch_id: "launch-a".to_owned(),
                pid,
                supervisor_pid: Some(1),
                supervisor_generation: Some(1),
            })
        );
    }

    #[test]
    fn read_active_supervisor_identity_requires_matching_live_supervisor_snapshot() {
        let (_temp_dir, paths) = test_paths();
        let pid = std::process::id();

        fs::write(
            &paths.supervisor_status_snapshot_path,
            supervisor_status_snapshot_json_with_supervisor(
                &paths.data_dir.display().to_string(),
                pid,
                pid,
                "launch-a",
                "SUPERVISOR_PHASE_READY",
            ),
        )
        .unwrap_or_else(|error| panic!("expected supervisor snapshot write: {error}"));

        assert_eq!(
            read_active_supervisor_identity_for_runtime(
                &paths,
                &ManagedRuntimeIdentity {
                    launch_id: "launch-a".to_owned(),
                    pid,
                    supervisor_pid: Some(pid),
                    supervisor_generation: Some(1),
                },
                "onequery gateway stop",
            )
            .unwrap_or_else(|error| panic!("expected supervisor identity read: {error}")),
            Some(ManagedSupervisorIdentity {
                supervisor_id: format!("supervisor:{pid}"),
                pid,
                generation: 1
            })
        );
    }

    #[test]
    fn read_managed_runtime_pid_prefers_runtime_status_snapshot_over_lower_artifacts() {
        let (_temp_dir, paths) = test_paths();
        let pid = std::process::id();

        fs::write(
            &paths.runtime_status_snapshot_path,
            runtime_status_snapshot_json(
                &paths.data_dir.display().to_string(),
                pid,
                "launch-a",
                "RUNTIME_PHASE_READY",
            ),
        )
        .unwrap_or_else(|error| panic!("expected snapshot write: {error}"));
        fs::write(&paths.supervisor_status_snapshot_path, "{not-json").unwrap_or_else(|error| {
            panic!("expected malformed supervisor snapshot write: {error}")
        });
        fs::write(&paths.runtime_lease_path, "{not-json")
            .unwrap_or_else(|error| panic!("expected malformed lease write: {error}"));

        assert_eq!(
            read_managed_runtime_pid(&paths, "onequery gateway status")
                .unwrap_or_else(|error| panic!("expected pid read: {error}")),
            Some(pid)
        );
    }

    #[test]
    fn read_managed_runtime_pid_ignores_snapshot_with_mismatched_launch_identity() {
        let (_temp_dir, paths) = test_paths();
        let pid = std::process::id();

        fs::write(
            &paths.runtime_status_snapshot_path,
            runtime_status_snapshot_json_with_header_pid(
                &paths.data_dir.display().to_string(),
                pid,
                pid.saturating_add(1),
                "launch-a",
                "RUNTIME_PHASE_READY",
            ),
        )
        .unwrap_or_else(|error| panic!("expected snapshot write: {error}"));

        assert_eq!(
            read_managed_runtime_pid(&paths, "onequery gateway status")
                .unwrap_or_else(|error| panic!("expected pid read: {error}")),
            None
        );
    }

    #[test]
    fn read_managed_runtime_pid_ignores_lease_with_mismatched_supervisor_identity() {
        let (_temp_dir, paths) = test_paths();
        let pid = std::process::id();

        fs::write(
            &paths.runtime_lease_path,
            runtime_lease_json_with_supervisor(&paths, pid, "launch-a", 1, 2),
        )
        .unwrap_or_else(|error| panic!("expected lease write: {error}"));

        assert_eq!(
            read_managed_runtime_pid(&paths, "onequery gateway status")
                .unwrap_or_else(|error| panic!("expected pid read: {error}")),
            None
        );
    }

    #[test]
    fn read_managed_runtime_pid_ignores_invalid_terminal_supervisor_snapshot() {
        let (_temp_dir, paths) = test_paths();
        let pid = std::process::id();

        fs::write(
            &paths.supervisor_status_snapshot_path,
            supervisor_status_snapshot_json(
                "/other-data-dir",
                pid,
                "launch-a",
                "SUPERVISOR_PHASE_EXITED",
            ),
        )
        .unwrap_or_else(|error| panic!("expected supervisor snapshot write: {error}"));
        fs::write(
            &paths.runtime_lease_path,
            runtime_lease_json(&paths, pid, "launch-a"),
        )
        .unwrap_or_else(|error| panic!("expected lease write: {error}"));

        assert_eq!(
            read_managed_runtime_pid(&paths, "onequery gateway status")
                .unwrap_or_else(|error| panic!("expected pid read: {error}")),
            Some(pid)
        );
    }

    #[test]
    fn read_managed_runtime_pid_prefers_supervisor_terminal_record_over_live_lease() {
        let (_temp_dir, paths) = test_paths();
        let pid = std::process::id();

        fs::write(
            &paths.supervisor_status_snapshot_path,
            supervisor_status_snapshot_json(
                &paths.data_dir.display().to_string(),
                pid,
                "launch-a",
                "SUPERVISOR_PHASE_EXITED",
            ),
        )
        .unwrap_or_else(|error| panic!("expected supervisor snapshot write: {error}"));
        fs::write(
            &paths.runtime_lease_path,
            runtime_lease_json(&paths, pid, "launch-a"),
        )
        .unwrap_or_else(|error| panic!("expected lease write: {error}"));

        assert_eq!(
            read_managed_runtime_pid(&paths, "onequery gateway status")
                .unwrap_or_else(|error| panic!("expected pid read: {error}")),
            None
        );
    }
}
