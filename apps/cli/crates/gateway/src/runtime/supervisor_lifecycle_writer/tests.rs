use std::fs;

use futures::StreamExt;
use pretty_assertions::assert_eq;
use tempfile::tempdir;

use super::SupervisorRuntimeFailureInfo;
use super::SupervisorStatusSnapshotWrite;
use super::TerminalRuntimeStatusSnapshotWrite;
use super::append_supervisor_transition_event_log_entry;
use super::dispatch_supervisor_event;
use super::lifecycle_records;
use super::types;
use super::write_supervisor_status_snapshot;
use super::write_terminal_runtime_status_snapshot;
use crate::runtime::supervisor_control::actor::SupervisorControlActor;
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
async fn unexpected_child_exit_after_ready_writes_crash_recovery_records() {
    let (_temp_dir, paths) = test_paths();
    let supervisor = test_supervisor_identity(123);
    let mut machine = SupervisorMachine::new();

    dispatch_test_supervisor_event(
        &mut machine,
        SupervisorEvent::LaunchRequested,
        &paths,
        &supervisor,
    )
    .await;
    dispatch_test_supervisor_event(
        &mut machine,
        SupervisorEvent::ChildSpawned { runtime_pid: 4242 },
        &paths,
        &supervisor,
    )
    .await;
    dispatch_test_supervisor_event(
        &mut machine,
        SupervisorEvent::ControlSocketObserved,
        &paths,
        &supervisor,
    )
    .await;
    dispatch_test_supervisor_event(
        &mut machine,
        SupervisorEvent::WatchReady,
        &paths,
        &supervisor,
    )
    .await;
    dispatch_test_supervisor_event(
        &mut machine,
        unexpected_child_exit_event(),
        &paths,
        &supervisor,
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

#[tokio::test]
async fn expected_child_exit_projects_terminal_runtime_status_to_durable_and_live_status() {
    let (_temp_dir, paths) = test_paths();
    let supervisor = test_supervisor_identity(123);
    let supervisor_control = SupervisorControlActor::new(types::SupervisorStatus {
        identity: buffa::MessageField::some(supervisor.clone()),
        launch: buffa::MessageField::some(types::LifecycleLaunchIdentity {
            launch_id: Some("launch-a".to_owned()),
            data_dir: Some(paths.data_dir.display().to_string()),
            runtime_pid: Some(4242),
            supervisor_pid: supervisor.pid,
            supervisor_generation: supervisor.generation,
            ..Default::default()
        }),
        phase: Some(types::SupervisorPhase::SUPERVISOR_PHASE_STARTING.into()),
        supervisor_sequence: Some(0),
        active_session: Some(false),
        ..Default::default()
    });
    let mut machine = SupervisorMachine::new();

    for event in [
        SupervisorEvent::LaunchRequested,
        SupervisorEvent::ChildSpawned { runtime_pid: 4242 },
        SupervisorEvent::ControlSocketObserved,
        SupervisorEvent::WatchReady,
        expected_child_exit_event(),
    ] {
        dispatch_supervisor_event(
            &mut machine,
            event,
            SupervisorEffectContext {
                paths: &paths,
                supervisor_control: &supervisor_control,
                supervisor: &supervisor,
                launch_id: "launch-a",
                command_line: "onequery gateway start",
            },
            None,
        )
        .await
        .unwrap_or_else(|error| panic!("expected supervisor event dispatch: {error}"));
    }

    assert_eq!(machine.state(), SupervisorMachineState::Exited);

    let runtime_snapshot = lifecycle_records::decode_runtime_status_snapshot(
        &fs::read_to_string(&paths.runtime_status_snapshot_path)
            .unwrap_or_else(|error| panic!("expected runtime snapshot read: {error}")),
    )
    .unwrap_or_else(|error| panic!("expected runtime snapshot decode: {error}"));
    let durable_runtime_status = runtime_snapshot
        .status
        .as_option()
        .expect("expected runtime status");
    assert_eq!(
        durable_runtime_status
            .phase
            .and_then(|phase| phase.as_known()),
        Some(types::RuntimePhase::RUNTIME_PHASE_STOPPED)
    );
    assert_eq!(durable_runtime_status.runtime_sequence, Some(1));
    assert!(durable_runtime_status.failure.as_option().is_none());

    let live_status = supervisor_control.snapshot().await;
    assert_eq!(
        live_status.phase.and_then(|phase| phase.as_known()),
        Some(types::SupervisorPhase::SUPERVISOR_PHASE_EXITED)
    );
    assert_eq!(
        live_status.runtime_phase.and_then(|phase| phase.as_known()),
        Some(types::RuntimePhase::RUNTIME_PHASE_STOPPED)
    );
    assert_eq!(live_status.runtime_sequence, Some(1));
    assert_eq!(live_status.active_session, Some(false));
    let launch = runtime_snapshot
        .header
        .as_option()
        .and_then(|header| header.launch.as_option())
        .expect("expected runtime snapshot launch identity");
    assert_eq!(
        live_status
            .runtime
            .as_option()
            .and_then(|runtime| runtime.pid),
        launch.runtime_pid
    );
    assert_eq!(
        live_status
            .runtime
            .as_option()
            .and_then(|runtime| runtime.launch_id.as_deref()),
        launch.launch_id.as_deref()
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
            failure: Some(&SupervisorRuntimeFailureInfo {
                code: types::RuntimeFailureCode::RUNTIME_FAILURE_CODE_INTERNAL,
                message: "self-host server exited with code 1".to_owned(),
                retryability: SupervisorFailureRetryability::Retryable,
            }),
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
    let supervisor_control = SupervisorControlActor::new(types::SupervisorStatus::default());
    let context = SupervisorEffectContext {
        paths: &paths,
        supervisor_control: &supervisor_control,
        supervisor: &supervisor,
        launch_id: "launch-a",
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
                code:
                    types::SupervisorFailureCode::SUPERVISOR_FAILURE_CODE_CHILD_EXITED_UNEXPECTEDLY,
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
        types::lifecycle_event_log_entry::Payload::SupervisorTransition(transition) => transition,
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

#[tokio::test]
async fn dispatch_supervisor_event_publishes_transition_to_watch_status() {
    let (_temp_dir, paths) = test_paths();
    let supervisor = test_supervisor_identity(123);
    let supervisor_control = SupervisorControlActor::new(types::SupervisorStatus {
        identity: buffa::MessageField::some(supervisor.clone()),
        launch: buffa::MessageField::some(types::LifecycleLaunchIdentity {
            launch_id: Some("launch-a".to_owned()),
            data_dir: Some(paths.data_dir.display().to_string()),
            supervisor_pid: supervisor.pid,
            supervisor_generation: supervisor.generation,
            ..Default::default()
        }),
        phase: Some(types::SupervisorPhase::SUPERVISOR_PHASE_STARTING.into()),
        supervisor_sequence: Some(0),
        active_session: Some(false),
        ..Default::default()
    });
    let mut machine = SupervisorMachine::new();
    let mut watch = supervisor_control.watch_status(0, false).await;

    dispatch_supervisor_event(
        &mut machine,
        SupervisorEvent::LaunchRequested,
        SupervisorEffectContext {
            paths: &paths,
            supervisor_control: &supervisor_control,
            supervisor: &supervisor,
            launch_id: "launch-a",
            command_line: "onequery gateway start",
        },
        None,
    )
    .await
    .unwrap_or_else(|error| panic!("expected launch request dispatch: {error}"));

    let response = watch
        .next()
        .await
        .expect("expected supervisor transition response")
        .expect("expected successful watch response");
    let Some(
        types::supervisor_lifecycle_service_watch_status_response::Event::SupervisorTransition(
            transition,
        ),
    ) = response.event
    else {
        panic!("expected supervisor transition event");
    };
    assert_eq!(transition.supervisor_sequence, Some(1));
    assert_eq!(
        supervisor_control.snapshot().await.supervisor_sequence,
        Some(1)
    );

    assert_live_status_matches_durable_supervisor_projection(&paths, &supervisor_control).await;
}

#[test]
fn supervisor_status_snapshot_records_intentional_live_field_defaults() {
    let (_temp_dir, paths) = test_paths();
    let supervisor = test_supervisor_identity(123);

    write_supervisor_status_snapshot(
        &paths,
        SupervisorStatusSnapshotWrite {
            supervisor: &supervisor,
            launch_id: "launch-a",
            phase: types::SupervisorPhase::SUPERVISOR_PHASE_READY,
            supervisor_sequence: 5,
            runtime_pid: Some(4242),
            failure: None,
        },
        "onequery gateway start",
    )
    .unwrap_or_else(|error| panic!("expected supervisor status snapshot write: {error}"));

    let snapshot = lifecycle_records::decode_supervisor_status_snapshot(
        &fs::read_to_string(&paths.supervisor_status_snapshot_path)
            .unwrap_or_else(|error| panic!("expected supervisor snapshot read: {error}")),
    )
    .unwrap_or_else(|error| panic!("expected supervisor snapshot decode: {error}"));
    let status = snapshot
        .status
        .as_option()
        .expect("expected supervisor status");

    assert_eq!(status.active_session, Some(false));
    assert_eq!(status.runtime_phase, None);
    assert_eq!(status.runtime_sequence, None);
    assert_eq!(
        status
            .runtime
            .as_option()
            .expect("expected runtime identity")
            .pid,
        Some(4242)
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
) {
    let supervisor_control = SupervisorControlActor::new(types::SupervisorStatus::default());
    dispatch_supervisor_event(
        machine,
        event,
        SupervisorEffectContext {
            paths,
            supervisor_control: &supervisor_control,
            supervisor,
            launch_id: "launch-a",
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

fn expected_child_exit_event() -> SupervisorEvent {
    SupervisorEvent::ChildExited {
        runtime_pid: 4242,
        exit_kind: SupervisorChildExitKind::Expected,
        exit_code: Some(0),
        signal: None,
        message: "self-host server exited cleanly".to_owned(),
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
    let launch = runtime_snapshot
        .header
        .as_option()
        .and_then(|header| header.launch.as_option())
        .expect("expected runtime snapshot launch identity");
    let runtime_failure = runtime_status
        .failure
        .as_option()
        .expect("expected runtime failure");

    assert_eq!(launch.runtime_pid, Some(4242));
    assert_eq!(launch.launch_id.as_deref(), Some("launch-a"));
    assert_eq!(
        launch.data_dir.as_deref(),
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
        types::lifecycle_event_log_entry::Payload::SupervisorTransition(transition) => transition,
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

async fn assert_live_status_matches_durable_supervisor_projection(
    paths: &SelfHostRuntimePaths,
    supervisor_control: &SupervisorControlActor,
) {
    let durable_snapshot = lifecycle_records::decode_supervisor_status_snapshot(
        &fs::read_to_string(&paths.supervisor_status_snapshot_path)
            .unwrap_or_else(|error| panic!("expected supervisor snapshot read: {error}")),
    )
    .unwrap_or_else(|error| panic!("expected supervisor snapshot decode: {error}"));
    let durable = durable_snapshot
        .status
        .as_option()
        .expect("expected durable supervisor status");
    let live = supervisor_control.snapshot().await;

    assert_eq!(durable.identity, live.identity);
    assert_eq!(durable.launch, live.launch);
    assert_eq!(durable.phase, live.phase);
    assert_eq!(durable.supervisor_sequence, live.supervisor_sequence);
    assert_eq!(durable.runtime, live.runtime);
    assert_eq!(durable.failure, live.failure);
    assert_eq!(durable.active_session, Some(false));
    assert!(durable.updated_at.as_option().is_some());
}
