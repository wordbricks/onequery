use std::time::Duration;

use pretty_assertions::assert_eq;
use test_case::test_case;

use super::SupervisorChildExitKind;
use super::SupervisorEffect;
use super::SupervisorEvent;
use super::SupervisorFailureInfo;
use super::SupervisorFailureRetryability;
use super::SupervisorMachine;
use super::SupervisorMachineReduction;
use super::SupervisorMachineState;
use super::SupervisorRuntimeFailureInfo;
use super::SupervisorStopRpcFailureDisposition;
use super::reduce_supervisor_machine;
use crate::supervisor_control_proto::types;

#[test]
fn launch_path_moves_through_explicit_handshake_states() {
    let reduction = reduce_ok(&SupervisorMachine::new(), SupervisorEvent::LaunchRequested);
    assert_eq!(reduction.machine.state(), SupervisorMachineState::Starting);
    assert_eq!(reduction.machine.supervisor_sequence, 1);
    assert_eq!(
        reduction.effects,
        vec![SupervisorEffect::WriteStatusSnapshot {
            phase: types::SupervisorPhase::SUPERVISOR_PHASE_STARTING,
            supervisor_sequence: 1,
            runtime_pid: None,
            failure: None,
        }]
    );

    let reduction = reduce_ok(
        &reduction.machine,
        SupervisorEvent::ChildSpawned { runtime_pid: 4242 },
    );
    assert_eq!(
        reduction.machine.state(),
        SupervisorMachineState::Handshaking
    );
    assert_eq!(
        reduction.effects,
        vec![SupervisorEffect::WriteStatusSnapshot {
            phase: types::SupervisorPhase::SUPERVISOR_PHASE_HANDSHAKING,
            supervisor_sequence: 2,
            runtime_pid: Some(4242),
            failure: None,
        }]
    );

    let reduction = reduce_ok(&reduction.machine, SupervisorEvent::WatchReady);
    assert_eq!(reduction.machine.state(), SupervisorMachineState::Ready);
    assert_eq!(
        reduction.effects,
        vec![SupervisorEffect::WriteStatusSnapshot {
            phase: types::SupervisorPhase::SUPERVISOR_PHASE_READY,
            supervisor_sequence: 3,
            runtime_pid: Some(4242),
            failure: None,
        }]
    );
}

#[test]
fn graceful_stop_emits_deferred_rpc_and_deadline_effects() {
    let machine = ready_machine();

    let stop_requested = reduce_ok(&machine, stop_intent_received_event());
    assert_eq!(
        stop_requested.machine.state(),
        SupervisorMachineState::StopRequested
    );
    assert_eq!(
        stop_requested.effects,
        vec![
            SupervisorEffect::WriteStatusSnapshot {
                phase: types::SupervisorPhase::SUPERVISOR_PHASE_STOP_REQUESTED,
                supervisor_sequence: 4,
                runtime_pid: Some(4242),
                failure: None,
            },
            SupervisorEffect::RequestRuntimeStop {
                runtime_pid: 4242,
                operation_id: stop_operation_id(),
            },
        ]
    );
    assert_eq!(
        stop_requested.transition.caller_operation_id.as_deref(),
        Some(stop_operation_id().as_str())
    );

    let accepted = reduce_ok(&stop_requested.machine, stop_rpc_accepted_event());
    assert_eq!(
        accepted.machine.state(),
        SupervisorMachineState::StopRequested
    );
    assert_eq!(accepted.machine.supervisor_sequence, 5);
    assert_eq!(
        accepted.effects,
        vec![SupervisorEffect::ScheduleGraceDeadline]
    );
}

#[test]
fn stop_rpc_escalation_enters_terminating_with_process_effects() {
    let stop_requested = reduce_ok(&ready_machine(), stop_intent_received_event());
    let terminating = reduce_ok(&stop_requested.machine, stop_rpc_failed_escalation_event());

    assert_eq!(
        terminating.machine.state(),
        SupervisorMachineState::Terminating
    );
    assert_eq!(
        terminating.effects,
        vec![
            SupervisorEffect::WriteStatusSnapshot {
                phase: types::SupervisorPhase::SUPERVISOR_PHASE_TERMINATING,
                supervisor_sequence: 5,
                runtime_pid: Some(4242),
                failure: None,
            },
            SupervisorEffect::SignalRuntimeTerminate { runtime_pid: 4242 },
            SupervisorEffect::ScheduleTerminateDeadline,
        ]
    );
}

#[test]
fn startup_timeout_after_child_spawn_owns_terminate_cleanup() {
    let timed_out = reduce_ok(&handshaking_machine(), startup_deadline_elapsed_event());

    assert_eq!(timed_out.machine.state(), SupervisorMachineState::Failed);
    assert_eq!(
        timed_out.effects,
        vec![
            SupervisorEffect::WriteStatusSnapshot {
                phase: types::SupervisorPhase::SUPERVISOR_PHASE_FAILED,
                supervisor_sequence: 3,
                runtime_pid: Some(4242),
                failure: Some(startup_timeout_failure()),
            },
            SupervisorEffect::SignalRuntimeTerminate { runtime_pid: 4242 },
            SupervisorEffect::ScheduleTerminateDeadline,
        ]
    );
}

#[test]
fn startup_timeout_cleanup_escalates_to_hard_kill_without_losing_failure() {
    let timed_out = reduce_ok(&handshaking_machine(), startup_deadline_elapsed_event());
    let escalated = reduce_ok(
        &timed_out.machine,
        SupervisorEvent::TerminateDeadlineElapsed,
    );

    assert_eq!(escalated.machine.state(), SupervisorMachineState::Failed);
    assert_eq!(
        escalated.effects,
        vec![
            SupervisorEffect::WriteStatusSnapshot {
                phase: types::SupervisorPhase::SUPERVISOR_PHASE_FAILED,
                supervisor_sequence: 4,
                runtime_pid: Some(4242),
                failure: Some(startup_timeout_failure()),
            },
            SupervisorEffect::SignalRuntimeKill { runtime_pid: 4242 },
            SupervisorEffect::ScheduleEscalationDeadline,
        ]
    );
}

#[test]
fn startup_timeout_cleanup_child_exit_writes_terminal_runtime_failure() {
    let timed_out = reduce_ok(&handshaking_machine(), startup_deadline_elapsed_event());
    let exited = reduce_ok(
        &timed_out.machine,
        SupervisorEvent::ChildExited {
            runtime_pid: 4242,
            exit_kind: SupervisorChildExitKind::Expected,
            exit_code: None,
            signal: Some("SIGTERM".to_owned()),
            message: "self-host server exited due to signal SIGTERM".to_owned(),
        },
    );

    assert_eq!(exited.machine.state(), SupervisorMachineState::Failed);
    assert_eq!(
        exited.effects,
        vec![
            SupervisorEffect::WriteStatusSnapshot {
                phase: types::SupervisorPhase::SUPERVISOR_PHASE_FAILED,
                supervisor_sequence: 4,
                runtime_pid: Some(4242),
                failure: Some(startup_timeout_failure()),
            },
            SupervisorEffect::WriteTerminalRuntimeStatusSnapshot {
                phase: types::RuntimePhase::RUNTIME_PHASE_FAILED,
                runtime_pid: 4242,
                failure: Some(SupervisorRuntimeFailureInfo {
                    code: types::RuntimeFailureCode::RUNTIME_FAILURE_CODE_INTERNAL,
                    message: "startup timed out".to_owned(),
                    retryability: SupervisorFailureRetryability::Retryable,
                }),
                exit_code: None,
                signal: Some("SIGTERM".to_owned()),
            },
        ]
    );
}

#[test]
fn unexpected_child_exit_from_ready_is_terminal_failure() {
    let failed = reduce_ok(&ready_machine(), unexpected_child_exited_event(4242));

    assert_eq!(failed.machine.state(), SupervisorMachineState::Failed);
    assert_eq!(
        failed.effects,
        vec![
            SupervisorEffect::WriteStatusSnapshot {
                phase: types::SupervisorPhase::SUPERVISOR_PHASE_FAILED,
                supervisor_sequence: 4,
                runtime_pid: Some(4242),
                failure: Some(SupervisorFailureInfo {
                    code: types::SupervisorFailureCode::SUPERVISOR_FAILURE_CODE_CHILD_EXITED_UNEXPECTEDLY,
                    message: "self-host server exited with code 1".to_owned(),
                    retryability: SupervisorFailureRetryability::Retryable,
                }),
            },
            SupervisorEffect::WriteTerminalRuntimeStatusSnapshot {
                phase: types::RuntimePhase::RUNTIME_PHASE_FAILED,
                runtime_pid: 4242,
                failure: Some(SupervisorRuntimeFailureInfo {
                    code: types::RuntimeFailureCode::RUNTIME_FAILURE_CODE_INTERNAL,
                    message: "self-host server exited with code 1".to_owned(),
                    retryability: SupervisorFailureRetryability::Retryable,
                }),
                exit_code: Some(1),
                signal: None,
            },
        ]
    );
}

#[test]
fn retryable_child_exit_can_schedule_bounded_restart() {
    let failed = reduce_ok(&ready_machine(), unexpected_child_exited_event(4242));
    let restarted = reduce_ok(
        &failed.machine,
        SupervisorEvent::RestartScheduled {
            restart_attempt: 1,
            backoff: Duration::from_millis(250),
        },
    );

    assert_eq!(restarted.machine.state(), SupervisorMachineState::Starting);
    assert_eq!(restarted.machine.restart_count(), 1);
    assert_eq!(
        restarted.effects,
        vec![
            SupervisorEffect::WriteStatusSnapshot {
                phase: types::SupervisorPhase::SUPERVISOR_PHASE_STARTING,
                supervisor_sequence: 5,
                runtime_pid: None,
                failure: None,
            },
            SupervisorEffect::ScheduleRestart {
                backoff: Duration::from_millis(250),
            },
        ]
    );

    let relaunched = reduce_ok(&restarted.machine, SupervisorEvent::LaunchRequested);

    assert_eq!(relaunched.machine.state(), SupervisorMachineState::Starting);
    assert_eq!(relaunched.machine.restart_count(), 1);
    assert_eq!(relaunched.machine.supervisor_sequence, 6);
}

#[test]
fn retryable_startup_timeout_can_schedule_bounded_restart() {
    let timed_out = reduce_ok(&handshaking_machine(), startup_deadline_elapsed_event());
    let cleaned_up = reduce_ok(
        &timed_out.machine,
        SupervisorEvent::ChildExited {
            runtime_pid: 4242,
            exit_kind: SupervisorChildExitKind::Expected,
            exit_code: None,
            signal: Some("SIGTERM".to_owned()),
            message: "self-host server exited due to signal SIGTERM".to_owned(),
        },
    );

    let restarted = reduce_ok(
        &cleaned_up.machine,
        SupervisorEvent::RestartScheduled {
            restart_attempt: 1,
            backoff: Duration::from_millis(250),
        },
    );

    assert_eq!(restarted.machine.state(), SupervisorMachineState::Starting);
    assert_eq!(restarted.machine.restart_count(), 1);
    assert_eq!(
        restarted.effects,
        vec![
            SupervisorEffect::WriteStatusSnapshot {
                phase: types::SupervisorPhase::SUPERVISOR_PHASE_STARTING,
                supervisor_sequence: 5,
                runtime_pid: None,
                failure: None,
            },
            SupervisorEffect::ScheduleRestart {
                backoff: Duration::from_millis(250),
            },
        ]
    );
}

#[test_case(SupervisorMachineFixture::StartingFresh, 1, 4242; "starting fresh")]
#[test_case(SupervisorMachineFixture::StartingAfterLaunch, 2, 4242; "starting after launch")]
#[test_case(SupervisorMachineFixture::Handshaking, 3, 4242; "handshaking")]
#[test_case(SupervisorMachineFixture::StopRequested, 5, 4242; "stop requested")]
#[test_case(SupervisorMachineFixture::Terminating, 6, 4242; "terminating")]
#[test_case(SupervisorMachineFixture::Escalating, 7, 4242; "escalating")]
fn unexpected_child_exit_is_accepted_from_non_terminal_state(
    fixture: SupervisorMachineFixture,
    expected_sequence: u64,
    runtime_pid: u32,
) {
    let reduction = reduce_ok(
        &fixture.machine(),
        unexpected_child_exited_event(runtime_pid),
    );

    assert_eq!(reduction.machine.state(), SupervisorMachineState::Failed);
    assert_eq!(reduction.machine.supervisor_sequence, expected_sequence);
    assert_eq!(
        reduction.effects.last(),
        Some(&SupervisorEffect::WriteTerminalRuntimeStatusSnapshot {
            phase: types::RuntimePhase::RUNTIME_PHASE_FAILED,
            runtime_pid,
            failure: Some(SupervisorRuntimeFailureInfo {
                code: types::RuntimeFailureCode::RUNTIME_FAILURE_CODE_INTERNAL,
                message: "self-host server exited with code 1".to_owned(),
                retryability: SupervisorFailureRetryability::Retryable,
            }),
            exit_code: Some(1),
            signal: None,
        })
    );
}

#[test_case(SupervisorMachineFixture::StartingAfterLaunch, SupervisorEventSample::LaunchFailed, SupervisorMachineState::Failed; "starting after launch accepts launch failed")]
#[test_case(SupervisorMachineFixture::StartingFresh, SupervisorEventSample::StartupDeadlineElapsed, SupervisorMachineState::Failed; "starting accepts startup deadline elapsed")]
#[test_case(SupervisorMachineFixture::Handshaking, SupervisorEventSample::StartupDeadlineElapsed, SupervisorMachineState::Failed; "handshaking accepts startup deadline elapsed")]
#[test_case(SupervisorMachineFixture::Handshaking, SupervisorEventSample::ControlSocketObserved, SupervisorMachineState::Handshaking; "handshaking accepts control socket observed")]
#[test_case(SupervisorMachineFixture::Handshaking, SupervisorEventSample::StopIntentReceived, SupervisorMachineState::StopRequested; "handshaking accepts stop intent")]
#[test_case(SupervisorMachineFixture::StopRequested, SupervisorEventSample::StopRpcFailedTerminal, SupervisorMachineState::Failed; "stop requested accepts stop rpc failed terminal")]
#[test_case(SupervisorMachineFixture::StopRequested, SupervisorEventSample::GraceDeadlineElapsed, SupervisorMachineState::Terminating; "stop requested accepts grace deadline elapsed")]
#[test_case(SupervisorMachineFixture::Terminating, SupervisorEventSample::TerminateDeadlineElapsed, SupervisorMachineState::Escalating; "terminating accepts terminate deadline elapsed")]
#[test_case(SupervisorMachineFixture::Escalating, SupervisorEventSample::EscalationDeadlineElapsed, SupervisorMachineState::Failed; "escalating accepts escalation deadline elapsed")]
fn transition_table_accepts_allowed_state_event_row(
    fixture: SupervisorMachineFixture,
    event: SupervisorEventSample,
    expected_state: SupervisorMachineState,
) {
    let reduction = reduce_ok(&fixture.machine(), event.event());

    assert_eq!(
        reduction.machine.state(),
        expected_state,
        "{fixture:?} handling {event:?} should transition to {expected_state:?}",
    );
}

#[test_case(SupervisorMachineFixture::StartingFresh, 1, 4242; "starting fresh")]
#[test_case(SupervisorMachineFixture::StartingAfterLaunch, 2, 4242; "starting after launch")]
#[test_case(SupervisorMachineFixture::Handshaking, 3, 4242; "handshaking")]
#[test_case(SupervisorMachineFixture::Ready, 4, 4242; "ready")]
#[test_case(SupervisorMachineFixture::StopRequested, 5, 4242; "stop requested")]
#[test_case(SupervisorMachineFixture::Terminating, 6, 4242; "terminating")]
#[test_case(SupervisorMachineFixture::Escalating, 7, 4242; "escalating")]
fn transition_table_accepts_expected_child_exit_from_non_terminal_state(
    fixture: SupervisorMachineFixture,
    expected_sequence: u64,
    runtime_pid: u32,
) {
    let reduction = reduce_ok(&fixture.machine(), expected_child_exited_event(runtime_pid));

    assert_eq!(reduction.machine.state(), SupervisorMachineState::Exited);
    assert_eq!(reduction.machine.supervisor_sequence, expected_sequence);
    assert_eq!(
        reduction.effects,
        vec![
            SupervisorEffect::WriteStatusSnapshot {
                phase: types::SupervisorPhase::SUPERVISOR_PHASE_EXITED,
                supervisor_sequence: expected_sequence,
                runtime_pid: Some(runtime_pid),
                failure: None,
            },
            SupervisorEffect::WriteTerminalRuntimeStatusSnapshot {
                phase: types::RuntimePhase::RUNTIME_PHASE_STOPPED,
                runtime_pid,
                failure: None,
                exit_code: Some(0),
                signal: None,
            },
        ]
    );
}

fn ready_machine() -> SupervisorMachine {
    let launched = reduce_ok(&SupervisorMachine::new(), SupervisorEvent::LaunchRequested);
    let spawned = reduce_ok(
        &launched.machine,
        SupervisorEvent::ChildSpawned { runtime_pid: 4242 },
    );
    reduce_ok(&spawned.machine, SupervisorEvent::WatchReady).machine
}

fn starting_after_launch_machine() -> SupervisorMachine {
    reduce_ok(&SupervisorMachine::new(), SupervisorEvent::LaunchRequested).machine
}

fn handshaking_machine() -> SupervisorMachine {
    let launched = reduce_ok(&SupervisorMachine::new(), SupervisorEvent::LaunchRequested);
    reduce_ok(
        &launched.machine,
        SupervisorEvent::ChildSpawned { runtime_pid: 4242 },
    )
    .machine
}

fn stop_requested_machine() -> SupervisorMachine {
    reduce_ok(&ready_machine(), stop_intent_received_event()).machine
}

fn terminating_machine() -> SupervisorMachine {
    reduce_ok(
        &stop_requested_machine(),
        stop_rpc_failed_escalation_event(),
    )
    .machine
}

fn escalating_machine() -> SupervisorMachine {
    reduce_ok(
        &terminating_machine(),
        SupervisorEvent::TerminateDeadlineElapsed,
    )
    .machine
}

fn expected_child_exited_event(runtime_pid: u32) -> SupervisorEvent {
    SupervisorEvent::ChildExited {
        runtime_pid,
        exit_kind: SupervisorChildExitKind::Expected,
        exit_code: Some(0),
        signal: None,
        message: "self-host server exited with code 0".to_owned(),
    }
}

fn unexpected_child_exited_event(runtime_pid: u32) -> SupervisorEvent {
    SupervisorEvent::ChildExited {
        runtime_pid,
        exit_kind: SupervisorChildExitKind::Unexpected,
        exit_code: Some(1),
        signal: None,
        message: "self-host server exited with code 1".to_owned(),
    }
}

fn launch_failed_event() -> SupervisorEvent {
    SupervisorEvent::LaunchFailed {
        message: "spawn failed".to_owned(),
    }
}

fn startup_deadline_elapsed_event() -> SupervisorEvent {
    SupervisorEvent::StartupDeadlineElapsed {
        message: "startup timed out".to_owned(),
    }
}

fn startup_timeout_failure() -> SupervisorFailureInfo {
    SupervisorFailureInfo {
        code: types::SupervisorFailureCode::SUPERVISOR_FAILURE_CODE_STARTUP_TIMEOUT,
        message: "startup timed out".to_owned(),
        retryability: SupervisorFailureRetryability::Retryable,
    }
}

fn escalation_deadline_elapsed_event() -> SupervisorEvent {
    SupervisorEvent::EscalationDeadlineElapsed {
        message: "hard kill timed out".to_owned(),
    }
}

fn stop_intent_received_event() -> SupervisorEvent {
    SupervisorEvent::StopIntentReceived {
        operation_id: stop_operation_id(),
    }
}

fn stop_rpc_accepted_event() -> SupervisorEvent {
    SupervisorEvent::StopRpcAccepted {
        operation_id: stop_operation_id(),
    }
}

fn stop_rpc_failed_escalation_event() -> SupervisorEvent {
    SupervisorEvent::StopRpcFailed {
        operation_id: stop_operation_id(),
        disposition: SupervisorStopRpcFailureDisposition::EscalateToTerminate,
        message: "runtime control unavailable".to_owned(),
    }
}

fn stop_rpc_failed_terminal_event() -> SupervisorEvent {
    SupervisorEvent::StopRpcFailed {
        operation_id: stop_operation_id(),
        disposition: SupervisorStopRpcFailureDisposition::TerminalFailure,
        message: "runtime control rejected stop".to_owned(),
    }
}

fn stop_operation_id() -> String {
    "00000000-0000-4000-8000-000000000001".to_owned()
}

#[derive(Debug, Clone, Copy)]
enum SupervisorEventSample {
    LaunchFailed,
    ControlSocketObserved,
    StopIntentReceived,
    StopRpcFailedTerminal,
    GraceDeadlineElapsed,
    TerminateDeadlineElapsed,
    EscalationDeadlineElapsed,
    StartupDeadlineElapsed,
}

impl SupervisorEventSample {
    fn event(self) -> SupervisorEvent {
        match self {
            Self::LaunchFailed => launch_failed_event(),
            Self::ControlSocketObserved => SupervisorEvent::ControlSocketObserved,
            Self::StopIntentReceived => stop_intent_received_event(),
            Self::StopRpcFailedTerminal => stop_rpc_failed_terminal_event(),
            Self::GraceDeadlineElapsed => SupervisorEvent::GraceDeadlineElapsed,
            Self::TerminateDeadlineElapsed => SupervisorEvent::TerminateDeadlineElapsed,
            Self::EscalationDeadlineElapsed => escalation_deadline_elapsed_event(),
            Self::StartupDeadlineElapsed => startup_deadline_elapsed_event(),
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum SupervisorMachineFixture {
    StartingFresh,
    StartingAfterLaunch,
    Handshaking,
    Ready,
    StopRequested,
    Terminating,
    Escalating,
}

impl SupervisorMachineFixture {
    fn machine(self) -> SupervisorMachine {
        match self {
            Self::StartingFresh => SupervisorMachine::new(),
            Self::StartingAfterLaunch => starting_after_launch_machine(),
            Self::Handshaking => handshaking_machine(),
            Self::Ready => ready_machine(),
            Self::StopRequested => stop_requested_machine(),
            Self::Terminating => terminating_machine(),
            Self::Escalating => escalating_machine(),
        }
    }
}

fn reduce_ok(machine: &SupervisorMachine, event: SupervisorEvent) -> SupervisorMachineReduction {
    match reduce_supervisor_machine(machine, event) {
        Ok(reduction) => reduction,
        Err(rejection) => panic!("expected accepted transition, got {rejection:?}"),
    }
}
