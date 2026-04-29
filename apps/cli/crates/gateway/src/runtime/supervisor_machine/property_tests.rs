use std::time::Duration;

use proptest::collection::vec;
use proptest::prelude::*;
use proptest::strategy::BoxedStrategy;
use proptest::test_runner::TestCaseResult;

use super::SupervisorChildExitKind;
use super::SupervisorEffect;
use super::SupervisorEvent;
use super::SupervisorFailureRetryability;
use super::SupervisorMachine;
use super::SupervisorMachineReduction;
use super::SupervisorMachineState;
use super::SupervisorStopRpcFailureDisposition;
use super::bounded_reason;
use super::reduce_supervisor_machine;
use crate::supervisor_control_proto::types;

proptest! {
    #[test]
    fn reducer_preserves_transition_invariants(events in vec(supervisor_event_strategy(), 0..80)) {
        let mut machine = SupervisorMachine::new();

        for event in events {
            let previous = machine.clone();
            let event_kind = event.kind();

            if let Ok(reduction) = reduce_supervisor_machine(&machine, event) {
                assert_reduction_invariants(&previous, event_kind, &reduction)?;
                machine = reduction.machine;
            }
        }
    }

    #[test]
    fn bounded_reason_keeps_generated_messages_within_proto_limit(message in any::<String>()) {
        let reason = bounded_reason("child_exited", &message);

        prop_assert!(reason.len() <= 512);
        prop_assert!(reason.starts_with("child_exited: "));
    }
}

fn assert_reduction_invariants(
    previous: &SupervisorMachine,
    event_kind: super::SupervisorEventKind,
    reduction: &SupervisorMachineReduction,
) -> TestCaseResult {
    prop_assert_eq!(
        reduction.machine.supervisor_sequence,
        previous.supervisor_sequence + 1
    );
    prop_assert_eq!(reduction.transition.event, event_kind);
    prop_assert_eq!(
        reduction.transition.previous_phase,
        previous.state().phase()
    );
    prop_assert_eq!(
        reduction.transition.current_phase,
        reduction.machine.state().phase()
    );
    prop_assert_eq!(
        reduction.transition.supervisor_sequence,
        reduction.machine.supervisor_sequence
    );
    prop_assert_eq!(
        reduction.transition.runtime_pid,
        reduction.machine.runtime_pid
    );
    prop_assert_eq!(&reduction.transition.failure, &reduction.machine.failure);

    let mut status_snapshot_count = 0;
    for effect in &reduction.effects {
        match effect {
            SupervisorEffect::WriteStatusSnapshot {
                phase,
                supervisor_sequence,
                runtime_pid,
                failure,
            } => {
                status_snapshot_count += 1;
                prop_assert_eq!(*phase, reduction.machine.state().phase());
                prop_assert_eq!(*supervisor_sequence, reduction.machine.supervisor_sequence);
                prop_assert_eq!(*runtime_pid, reduction.machine.runtime_pid);
                prop_assert_eq!(failure, &reduction.machine.failure);
            }
            SupervisorEffect::WriteTerminalRuntimeStatusSnapshot {
                phase,
                runtime_pid,
                failure,
                exit_code: _,
                signal: _,
            } => {
                prop_assert!(matches!(
                    reduction.machine.state(),
                    SupervisorMachineState::Exited | SupervisorMachineState::Failed
                ));
                prop_assert!(*runtime_pid > 0);
                if reduction.machine.state() == SupervisorMachineState::Failed {
                    let failure = failure.as_ref().expect("failed runtime exit has failure");
                    prop_assert_eq!(*phase, types::RuntimePhase::RUNTIME_PHASE_FAILED);
                    prop_assert_eq!(
                        failure.code,
                        types::RuntimeFailureCode::RUNTIME_FAILURE_CODE_INTERNAL
                    );
                    prop_assert_eq!(
                        failure.retryability,
                        SupervisorFailureRetryability::Retryable
                    );
                } else {
                    prop_assert_eq!(*phase, types::RuntimePhase::RUNTIME_PHASE_STOPPED);
                    prop_assert!(failure.is_none());
                }
            }
            SupervisorEffect::RequestRuntimeStop {
                runtime_pid,
                operation_id: _,
            }
            | SupervisorEffect::SignalRuntimeTerminate { runtime_pid }
            | SupervisorEffect::SignalRuntimeKill { runtime_pid } => {
                prop_assert_eq!(Some(*runtime_pid), reduction.machine.runtime_pid);
            }
            SupervisorEffect::ScheduleGraceDeadline
            | SupervisorEffect::ScheduleTerminateDeadline
            | SupervisorEffect::ScheduleEscalationDeadline
            | SupervisorEffect::ScheduleRestart { backoff: _ } => {}
        }
    }

    prop_assert!(status_snapshot_count <= 1);

    Ok(())
}

fn supervisor_event_strategy() -> impl Strategy<Value = SupervisorEvent> {
    prop_oneof![
        Just(SupervisorEvent::LaunchRequested),
        message_strategy().prop_map(|message| SupervisorEvent::LaunchFailed { message }),
        runtime_pid_strategy()
            .prop_map(|runtime_pid| SupervisorEvent::ChildSpawned { runtime_pid }),
        Just(SupervisorEvent::ControlSocketObserved),
        Just(SupervisorEvent::WatchReady),
        operation_id_strategy()
            .prop_map(|operation_id| { SupervisorEvent::StopIntentReceived { operation_id } }),
        operation_id_strategy()
            .prop_map(|operation_id| { SupervisorEvent::StopRpcAccepted { operation_id } }),
        (
            operation_id_strategy(),
            stop_rpc_failure_disposition_strategy(),
            message_strategy(),
        )
            .prop_map(|(operation_id, disposition, message)| {
                SupervisorEvent::StopRpcFailed {
                    operation_id,
                    disposition,
                    message,
                }
            }),
        Just(SupervisorEvent::GraceDeadlineElapsed),
        Just(SupervisorEvent::TerminateDeadlineElapsed),
        message_strategy()
            .prop_map(|message| { SupervisorEvent::EscalationDeadlineElapsed { message } }),
        (
            runtime_pid_strategy(),
            child_exit_kind_strategy(),
            prop::option::of(-128i32..128),
            prop::option::of("SIG[A-Z0-9_]{0,16}"),
            message_strategy(),
        )
            .prop_map(|(runtime_pid, exit_kind, exit_code, signal, message)| {
                SupervisorEvent::ChildExited {
                    runtime_pid,
                    exit_kind,
                    exit_code,
                    signal,
                    message,
                }
            }),
        message_strategy()
            .prop_map(|message| { SupervisorEvent::StartupDeadlineElapsed { message } }),
        (0u32..8, 0u64..60_000).prop_map(|(restart_attempt, backoff_millis)| {
            SupervisorEvent::RestartScheduled {
                restart_attempt,
                backoff: Duration::from_millis(backoff_millis),
            }
        }),
    ]
}

fn runtime_pid_strategy() -> impl Strategy<Value = u32> {
    0u32..10_000
}

fn operation_id_strategy() -> impl Strategy<Value = String> {
    "[a-zA-Z0-9:_-]{0,64}"
}

fn message_strategy() -> impl Strategy<Value = String> {
    any::<String>()
}

fn stop_rpc_failure_disposition_strategy() -> BoxedStrategy<SupervisorStopRpcFailureDisposition> {
    prop_oneof![
        Just(SupervisorStopRpcFailureDisposition::EscalateToTerminate),
        Just(SupervisorStopRpcFailureDisposition::TerminalFailure),
    ]
    .boxed()
}

fn child_exit_kind_strategy() -> impl Strategy<Value = SupervisorChildExitKind> {
    prop_oneof![
        Just(SupervisorChildExitKind::Expected),
        Just(SupervisorChildExitKind::Unexpected),
    ]
}
