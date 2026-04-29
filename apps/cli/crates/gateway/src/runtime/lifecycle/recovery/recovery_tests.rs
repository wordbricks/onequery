use std::fs;

use buffa::MessageField;
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
use super::read_supervisor_control_identity_for_recovery;
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
    runtime_lease_json_with_supervisor(paths, pid, launch_id, 1, 1, 1, 1)
}

fn runtime_lease_json_with_supervisor(
    paths: &SelfHostRuntimePaths,
    pid: u32,
    launch_id: &str,
    header_supervisor_pid: u32,
    supervisor_pid: u32,
    header_supervisor_generation: u64,
    supervisor_generation: u64,
) -> String {
    runtime_lease_json_with_data_dir(
        paths.data_dir.as_path(),
        pid,
        launch_id,
        header_supervisor_pid,
        supervisor_pid,
        header_supervisor_generation,
        supervisor_generation,
    )
}

fn runtime_lease_json_with_data_dir(
    data_dir: &std::path::Path,
    pid: u32,
    launch_id: &str,
    header_supervisor_pid: u32,
    supervisor_pid: u32,
    header_supervisor_generation: u64,
    supervisor_generation: u64,
) -> String {
    format!(
        r#"{{
  "header": {{
    "schemaVersion": 1,
    "writer": {{"writer": "LIFECYCLE_RECORD_WRITER_RUNTIME", "writerId": "runtime:{pid}"}},
    "launch": {{"launchId": "{launch_id}", "dataDir": "{}", "runtimePid": {pid}, "supervisorPid": {header_supervisor_pid}, "supervisorGeneration": "{header_supervisor_generation}"}},
    "writtenAt": "2026-03-25T00:00:00Z"
  }},
  "runtime": {{"pid": {pid}, "launchId": "{launch_id}", "dataDir": "{}"}},
  "supervisor": {{"supervisorId": "supervisor-a", "pid": {supervisor_pid}, "generation": "{supervisor_generation}"}},
  "runtimeSequence": "1",
  "acquiredAt": "2026-03-25T00:00:00Z",
  "renewedAt": "2026-03-25T00:00:00Z",
  "leaseTtl": "60s"
}}"#,
        data_dir.display(),
        data_dir.display()
    )
}

fn runtime_status_snapshot_json(data_dir: &str, pid: u32, launch_id: &str, phase: &str) -> String {
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
    supervisor_status_snapshot_json_with_supervisor_generation(
        data_dir,
        runtime_pid,
        supervisor_pid,
        1,
        launch_id,
        phase,
    )
}

fn supervisor_status_snapshot_json_with_supervisor_generation(
    data_dir: &str,
    runtime_pid: u32,
    supervisor_pid: u32,
    supervisor_generation: u64,
    launch_id: &str,
    phase: &str,
) -> String {
    format!(
        r#"{{
  "header": {{
    "schemaVersion": 1,
    "writer": {{"writer": "LIFECYCLE_RECORD_WRITER_SUPERVISOR", "writerId": "supervisor:{supervisor_pid}"}},
    "launch": {{"launchId": "{launch_id}", "dataDir": "{data_dir}", "runtimePid": {runtime_pid}, "supervisorPid": {supervisor_pid}, "supervisorGeneration": "{supervisor_generation}"}},
    "writtenAt": "2026-03-25T00:00:00Z"
  }},
  "status": {{
    "identity": {{"supervisorId": "supervisor:{supervisor_pid}", "pid": {supervisor_pid}, "generation": "{supervisor_generation}"}},
    "launch": {{"launchId": "{launch_id}", "dataDir": "{data_dir}", "runtimePid": {runtime_pid}, "supervisorPid": {supervisor_pid}, "supervisorGeneration": "{supervisor_generation}"}},
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
    assert_eq!(launch.runtime_pid, None);
    assert_eq!(launch.supervisor_pid, None);
    assert_eq!(launch.supervisor_generation, None);

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
            DurableRecoveryStep::SupervisorTerminalRecord,
            DurableRecoveryStep::RuntimeStatusSnapshot,
            DurableRecoveryStep::RuntimeLeaseRecord,
        ]
    );
}

#[test]
fn read_managed_runtime_pid_ignores_lifecycle_event_log_as_recovery_input() {
    let (_temp_dir, paths) = test_paths();
    let pid = std::process::id();
    let launch_id = "launch-a";
    let data_dir = paths.data_dir.display().to_string();
    let entry = types::LifecycleEventLogEntry {
        header: MessageField::some(types::LifecycleRecordHeader {
            schema_version: Some(1),
            writer: MessageField::some(types::LifecycleRecordWriterIdentity {
                writer: Some(
                    types::LifecycleRecordWriter::LIFECYCLE_RECORD_WRITER_SUPERVISOR.into(),
                ),
                writer_id: Some(format!("supervisor:{pid}")),
                ..Default::default()
            }),
            launch: MessageField::some(types::LifecycleLaunchIdentity {
                launch_id: Some(launch_id.to_owned()),
                data_dir: Some(data_dir.clone()),
                runtime_pid: Some(pid),
                supervisor_pid: Some(pid),
                supervisor_generation: Some(1),
                ..Default::default()
            }),
            ..Default::default()
        }),
        lifecycle_sequence: Some(1),
        kind: Some(
            types::LifecycleEventKind::LIFECYCLE_EVENT_KIND_SUPERVISOR_TRANSITION_RECORDED.into(),
        ),
        supervisor_sequence: Some(1),
        payload: types::SupervisorTransition {
            supervisor: MessageField::some(types::SupervisorIdentity {
                supervisor_id: Some(format!("supervisor:{pid}")),
                pid: Some(pid),
                generation: Some(1),
                ..Default::default()
            }),
            supervisor_sequence: Some(1),
            current_phase: Some(types::SupervisorPhase::SUPERVISOR_PHASE_READY.into()),
            runtime: MessageField::some(types::RuntimeIdentity {
                pid: Some(pid),
                launch_id: Some(launch_id.to_owned()),
                data_dir: Some(data_dir),
                ..Default::default()
            }),
            ..Default::default()
        }
        .into(),
        ..Default::default()
    };

    fs::write(
        &paths.lifecycle_event_log_path,
        lifecycle_records::encode_lifecycle_event_log_entry(&entry),
    )
    .unwrap_or_else(|error| panic!("expected lifecycle event log write: {error}"));

    assert_eq!(
        read_managed_runtime_pid(&paths, "onequery gateway status")
            .unwrap_or_else(|error| panic!("expected recovery read: {error}")),
        None
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

    fs::write(&paths.supervisor_status_snapshot_path, "{\"status\":")
        .unwrap_or_else(|error| panic!("expected malformed supervisor snapshot write: {error}"));
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
            supervisor_pid: 1,
            supervisor_generation: 1,
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
                supervisor_pid: pid,
                supervisor_generation: 1,
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
fn read_active_supervisor_identity_rejects_mismatched_supervisor_generation() {
    let (_temp_dir, paths) = test_paths();
    let pid = std::process::id();

    fs::write(
        &paths.supervisor_status_snapshot_path,
        supervisor_status_snapshot_json_with_supervisor_generation(
            &paths.data_dir.display().to_string(),
            pid,
            pid,
            2,
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
                supervisor_pid: pid,
                supervisor_generation: 1,
            },
            "onequery gateway stop",
        )
        .unwrap_or_else(|error| panic!("expected supervisor identity read: {error}")),
        None
    );
}

#[test]
fn read_managed_runtime_pid_prefers_runtime_status_snapshot_over_live_lease() {
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
    fs::write(&paths.supervisor_status_snapshot_path, "{not-json")
        .unwrap_or_else(|error| panic!("expected malformed supervisor snapshot write: {error}"));
    fs::write(&paths.runtime_lease_path, "{not-json")
        .unwrap_or_else(|error| panic!("expected malformed lease write: {error}"));

    assert_eq!(
        read_managed_runtime_pid(&paths, "onequery gateway status")
            .unwrap_or_else(|error| panic!("expected pid read: {error}")),
        Some(pid)
    );
}

#[test]
fn read_managed_runtime_pid_prefers_supervisor_terminal_record_over_runtime_status_snapshot() {
    let (_temp_dir, paths) = test_paths();
    let pid = std::process::id();

    fs::write(
        &paths.supervisor_status_snapshot_path,
        supervisor_status_snapshot_json_with_supervisor(
            &paths.data_dir.display().to_string(),
            pid,
            pid,
            "launch-a",
            "SUPERVISOR_PHASE_EXITED",
        ),
    )
    .unwrap_or_else(|error| panic!("expected supervisor snapshot write: {error}"));
    fs::write(
        &paths.runtime_status_snapshot_path,
        runtime_status_snapshot_json(
            &paths.data_dir.display().to_string(),
            pid,
            "launch-a",
            "RUNTIME_PHASE_READY",
        ),
    )
    .unwrap_or_else(|error| panic!("expected runtime snapshot write: {error}"));

    assert_eq!(
        read_managed_runtime_pid(&paths, "onequery gateway status")
            .unwrap_or_else(|error| panic!("expected pid read: {error}")),
        None
    );
}

#[test]
fn supervisor_control_identity_recovery_can_probe_from_terminal_supervisor_snapshot() {
    let (_temp_dir, paths) = test_paths();
    let pid = std::process::id();

    fs::write(
        &paths.supervisor_status_snapshot_path,
        supervisor_status_snapshot_json_with_supervisor(
            &paths.data_dir.display().to_string(),
            pid,
            pid,
            "launch-a",
            "SUPERVISOR_PHASE_EXITED",
        ),
    )
    .unwrap_or_else(|error| panic!("expected supervisor snapshot write: {error}"));

    assert_eq!(
        read_managed_runtime_pid(&paths, "onequery gateway status")
            .unwrap_or_else(|error| panic!("expected durable recovery read: {error}")),
        None
    );

    let identity =
        read_supervisor_control_identity_for_recovery(&paths, "onequery gateway status")
            .unwrap_or_else(|error| {
                panic!("expected supervisor control identity recovery: {error}")
            })
            .expect("expected supervisor control identity from terminal snapshot");

    assert_eq!(identity.runtime.launch_id, "launch-a");
    assert_eq!(identity.runtime.pid, pid);
    assert_eq!(identity.supervisor.pid, pid);
    assert_eq!(identity.supervisor.generation, 1);
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
        runtime_lease_json_with_supervisor(&paths, pid, "launch-a", 1, 2, 1, 1),
    )
    .unwrap_or_else(|error| panic!("expected lease write: {error}"));

    assert_eq!(
        read_managed_runtime_pid(&paths, "onequery gateway status")
            .unwrap_or_else(|error| panic!("expected pid read: {error}")),
        None
    );
}

#[test]
fn read_managed_runtime_pid_ignores_stale_lease_with_live_unrelated_pid() {
    let (_temp_dir, paths) = test_paths();
    let live_unrelated_pid = std::process::id();

    fs::write(
        &paths.runtime_lease_path,
        runtime_lease_json_with_data_dir(
            std::path::Path::new("/tmp/onequery-other-data"),
            live_unrelated_pid,
            "launch-stale",
            1,
            1,
            1,
            1,
        ),
    )
    .unwrap_or_else(|error| panic!("expected stale lease write: {error}"));

    assert_eq!(
        read_managed_runtime_pid(&paths, "onequery gateway status")
            .unwrap_or_else(|error| panic!("expected pid read: {error}")),
        None
    );
}

#[test]
fn read_managed_runtime_pid_ignores_lease_with_mismatched_supervisor_generation() {
    let (_temp_dir, paths) = test_paths();
    let pid = std::process::id();

    fs::write(
        &paths.runtime_lease_path,
        runtime_lease_json_with_supervisor(&paths, pid, "launch-a", 1, 1, 1, 2),
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
