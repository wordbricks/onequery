use std::fs;
use std::io;
use std::path::Path;
use std::path::PathBuf;

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use onequery_cli_core::process::is_process_running;

use crate::runtime_control::types;
use crate::self_host::SelfHostRuntimePaths;

use super::lifecycle_records;

const RUNTIME_STATUS_SNAPSHOT_FILENAME: &str = "runtime.status.json";

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
    let supervisor_snapshot = read_supervisor_status_snapshot(
        paths.supervisor_status_snapshot_path.as_path(),
        command_line,
    )?;

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
                // Comment: the event-log record format is defined, but the
                // binary reader is not implemented yet. Until then, recovery
                // has no event-log evidence and falls through to snapshots.
            }
            DurableRecoveryStep::RuntimeStatusSnapshot => {
                let status_snapshot = read_runtime_status_snapshot(
                    paths.runtime_status_snapshot_path.as_path(),
                    command_line,
                )?;
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
                let supervisor_snapshot = read_supervisor_status_snapshot(
                    paths.supervisor_status_snapshot_path.as_path(),
                    command_line,
                )?;
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
                let lease_record =
                    read_runtime_lease_record(paths.runtime_lease_path.as_path(), command_line)?;
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

fn read_runtime_lease_record(
    path: &Path,
    command_line: &str,
) -> Result<Option<types::RuntimeLeaseRecord>, CliError> {
    let Some(contents) = read_optional_runtime_file(
        path,
        command_line,
        "failed to read runtime lease file",
        "remove the stale runtime lease file and retry",
    )?
    else {
        return Ok(None);
    };
    let trimmed = contents.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    lifecycle_records::decode_runtime_lease_record(trimmed)
        .map(Some)
        .map_err(|error| {
            CliError::new(
                "failed to parse runtime lease file",
                command_line,
                ErrorStage::LoadConfig,
                format!(
                    "{error} ({}, encoding={})",
                    path.display(),
                    lifecycle_records::DURABLE_STATE_FILE_ENCODING
                ),
                vec!["remove the stale runtime lease file and retry".to_owned()],
            )
        })
}

pub(super) fn runtime_status_snapshot_path(run_dir: &Path) -> PathBuf {
    run_dir.join(RUNTIME_STATUS_SNAPSHOT_FILENAME)
}

pub(super) fn read_runtime_status_snapshot(
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

    lifecycle_records::decode_runtime_status_snapshot(trimmed)
        .map(Some)
        .map_err(|error| {
            CliError::new(
                "failed to parse runtime status snapshot file",
                command_line,
                ErrorStage::LoadConfig,
                format!(
                    "{error} ({}, encoding={})",
                    path.display(),
                    lifecycle_records::DURABLE_STATE_FILE_ENCODING
                ),
                vec!["remove the stale runtime status snapshot file and retry".to_owned()],
            )
        })
}

fn read_supervisor_status_snapshot(
    path: &Path,
    command_line: &str,
) -> Result<Option<types::SupervisorStatusSnapshot>, CliError> {
    let Some(contents) = read_optional_runtime_file(
        path,
        command_line,
        "failed to read supervisor status snapshot file",
        "remove the stale supervisor status snapshot file and retry",
    )?
    else {
        return Ok(None);
    };
    let trimmed = contents.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    lifecycle_records::decode_supervisor_status_snapshot(trimmed)
        .map(Some)
        .map_err(|error| {
            CliError::new(
                "failed to parse supervisor status snapshot file",
                command_line,
                ErrorStage::LoadConfig,
                format!(
                    "{error} ({}, encoding={})",
                    path.display(),
                    lifecycle_records::DURABLE_STATE_FILE_ENCODING
                ),
                vec!["remove the stale supervisor status snapshot file and retry".to_owned()],
            )
        })
}

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

    // CONTEXT: startup polling can race the runtime replacing this file, so
    // malformed protobuf JSON is retried instead of aborting launch.
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

pub(super) fn runtime_ready_pid_reported_during_startup_poll(
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

    if !runtime_identity_matches_data_dir(runtime, expected_data_dir)
        || !runtime_identity_has_launch_id(runtime)
    {
        return None;
    }

    let phase = runtime_status_phase(status)?;
    if runtime_phase_is_terminal(phase) {
        return Some(DurableRecoveryDecision::TerminalRuntime);
    }
    if !runtime_phase_is_active(phase) {
        return None;
    }

    managed_runtime_identity_from_parts(
        runtime,
        snapshot
            .header
            .as_option()
            .and_then(|header| header.launch.as_option()),
        None,
    )
    .map(|identity| DurableRecoveryDecision::ActiveRuntime { identity })
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

    let launch = status.launch.as_option().or_else(|| {
        snapshot
            .header
            .as_option()
            .and_then(|header| header.launch.as_option())
    })?;
    if !launch_identity_matches_data_dir(launch, expected_data_dir) {
        return None;
    }

    Some(DurableRecoveryDecision::TerminalRuntime)
}

fn runtime_lease_recovery_decision(
    lease_record: Option<&types::RuntimeLeaseRecord>,
    expected_data_dir: &Path,
) -> Option<DurableRecoveryDecision> {
    let runtime = lease_record?.runtime.as_option()?;
    if !runtime_identity_matches_data_dir(runtime, expected_data_dir)
        || !runtime_identity_has_launch_id(runtime)
    {
        return None;
    }

    managed_runtime_identity_from_parts(
        runtime,
        lease_record
            .and_then(|record| record.header.as_option())
            .and_then(|header| header.launch.as_option()),
        lease_record.and_then(|record| record.supervisor.as_option()),
    )
    .map(|identity| DurableRecoveryDecision::ActiveRuntime { identity })
}

fn managed_runtime_identity_from_parts(
    runtime: &types::RuntimeIdentity,
    launch: Option<&types::LifecycleLaunchIdentity>,
    supervisor: Option<&types::SupervisorIdentity>,
) -> Option<ManagedRuntimeIdentity> {
    Some(ManagedRuntimeIdentity {
        launch_id: runtime
            .launch_id
            .as_deref()
            .filter(|launch_id| !launch_id.is_empty())?
            .to_owned(),
        pid: runtime.pid?,
        supervisor_pid: supervisor
            .and_then(|supervisor| supervisor.pid)
            .or_else(|| launch.and_then(|launch| launch.supervisor_pid))
            .filter(|pid| *pid > 0),
        supervisor_generation: supervisor
            .and_then(|supervisor| supervisor.generation)
            .or_else(|| launch.and_then(|launch| launch.supervisor_generation))
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

fn runtime_identity_has_launch_id(identity: &types::RuntimeIdentity) -> bool {
    identity
        .launch_id
        .as_deref()
        .is_some_and(|launch_id| !launch_id.is_empty())
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
        format!(
            r#"{{
  "header": {{
    "schemaVersion": 1,
    "writer": {{"writer": "LIFECYCLE_RECORD_WRITER_RUNTIME", "writerId": "runtime:{pid}"}},
    "launch": {{"launchId": "{launch_id}", "dataDir": "{}", "runtimePid": {pid}, "supervisorPid": 1, "supervisorGeneration": "1"}},
    "writtenAt": "2026-03-25T00:00:00Z"
  }},
  "runtime": {{"pid": {pid}, "launchId": "{launch_id}", "dataDir": "{}"}},
  "supervisor": {{"supervisorId": "supervisor-a", "pid": 1, "generation": "1"}},
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
        format!(
            r#"{{
  "header": {{
    "schemaVersion": 1,
    "writer": {{"writer": "LIFECYCLE_RECORD_WRITER_RUNTIME", "writerId": "runtime:{pid}"}},
    "launch": {{"launchId": "{launch_id}", "dataDir": "{data_dir}", "runtimePid": {pid}, "supervisorPid": 1, "supervisorGeneration": "1"}},
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
