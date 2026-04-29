//! Deterministic supervisor lifecycle reducer.
//!
//! Formal transition table:
//!
//! | State | Event | Guard | Next state | Emitted effects | Durable payload | Rejected transition |
//! | --- | --- | --- | --- | --- | --- | --- |
//! | `starting` | `launch_requested` | no prior launch request | `starting` | write status snapshot | `SupervisorStatusSnapshot(starting)` | repeated launch requests reject |
//! | `starting` | `launch_failed` | prior launch request | `failed` | write status snapshot | `SupervisorStatusSnapshot(failed)` | non-starting states reject |
//! | `starting` | `child_spawned` | prior launch request and runtime pid > 0 | `handshaking` | write status snapshot | `SupervisorStatusSnapshot(handshaking)` | all other states reject |
//! | `starting`, `handshaking` | `startup_deadline_elapsed` | none | `failed` | write status snapshot | `SupervisorStatusSnapshot(failed)` | terminal states reject |
//! | `handshaking` | `control_socket_observed` | none | `handshaking` | none | none | all other states reject |
//! | `handshaking` | `watch_ready` | runtime pid known | `ready` | write status snapshot | `SupervisorStatusSnapshot(ready)` | all other states reject |
//! | `ready` | `stop_intent_received` | runtime pid known | `stop_requested` | write status snapshot, request runtime stop | `SupervisorStatusSnapshot(stop_requested)` | states without a runtime reject |
//! | `stop_requested` | `stop_rpc_accepted` | none | `stop_requested` | schedule grace deadline | none | all other states reject |
//! | `stop_requested` | `stop_rpc_failed` | fallback allowed | `terminating` | write status snapshot, signal terminate, schedule terminate deadline | `SupervisorStatusSnapshot(terminating)` | all other states reject |
//! | `stop_requested` | `stop_rpc_failed` | fallback denied | `failed` | write status snapshot | `SupervisorStatusSnapshot(failed)` | all other states reject |
//! | `stop_requested` | `grace_deadline_elapsed` | runtime pid known | `terminating` | write status snapshot, signal terminate, schedule terminate deadline | `SupervisorStatusSnapshot(terminating)` | all other states reject |
//! | `terminating` | `terminate_deadline_elapsed` | runtime pid known | `escalating` | write status snapshot, signal hard kill, schedule escalation deadline | `SupervisorStatusSnapshot(escalating)` | all other states reject |
//! | `escalating` | `escalation_deadline_elapsed` | none | `failed` | write status snapshot | `SupervisorStatusSnapshot(failed)` | all other states reject |
//! | any non-terminal state | `child_exited` | runtime pid is valid and expected exit | `exited` | write status snapshot | `SupervisorStatusSnapshot(exited)` | terminal states reject; runtime pid mismatch rejects |
//! | any non-terminal state | `child_exited` | runtime pid is valid and unexpected exit | `failed` | write status snapshot, write terminal runtime status snapshot, write process exit event | `SupervisorStatusSnapshot(failed)`, `RuntimeStatusSnapshot(failed)`, `LifecycleProcessExit` | terminal states reject; runtime pid mismatch rejects |
//! | `failed` | `restart_scheduled` | failure came from a retryable unexpected child exit and attempt advances | `starting` | write status snapshot, schedule restart backoff | `SupervisorStatusSnapshot(starting)` | disabled/exhausted policy does not dispatch; stale attempts reject |
//! | any non-terminal state | `artifact_recovery_completed` | recovery found active launch | current state | none | none | terminal states reject |
//!
//! Every accepted transition, including self-transitions without status
//! snapshot effects, also emits one supervisor transition event-log effect.

use std::time::Duration;

use crate::runtime_control::types;

#[derive(Debug, Clone, Eq, PartialEq)]
pub(super) struct SupervisorMachine {
    state: SupervisorMachineState,
    supervisor_sequence: u64,
    runtime_pid: Option<u32>,
    failure: Option<SupervisorFailureInfo>,
    launch_requested: bool,
    restart_count: u32,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(super) enum SupervisorMachineState {
    Starting,
    Handshaking,
    Ready,
    StopRequested,
    Terminating,
    Escalating,
    Exited,
    Failed,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(super) struct SupervisorMachineReduction {
    pub(super) machine: SupervisorMachine,
    pub(super) transition: SupervisorTransitionEffect,
    pub(super) effects: Vec<SupervisorEffect>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(super) struct SupervisorTransitionEffect {
    pub(super) event: SupervisorEventKind,
    pub(super) previous_phase: types::SupervisorPhase,
    pub(super) current_phase: types::SupervisorPhase,
    pub(super) supervisor_sequence: u64,
    pub(super) runtime_pid: Option<u32>,
    pub(super) reason: String,
    pub(super) caller_operation_id: Option<String>,
    pub(super) failure: Option<SupervisorFailureInfo>,
    pub(super) exit_code: Option<i32>,
    pub(super) signal: Option<String>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(super) enum SupervisorEffect {
    WriteStatusSnapshot {
        phase: types::SupervisorPhase,
        supervisor_sequence: u64,
        runtime_pid: Option<u32>,
        failure: Option<SupervisorFailureInfo>,
    },
    WriteTerminalRuntimeStatusSnapshot {
        phase: types::RuntimePhase,
        runtime_pid: u32,
        failure: SupervisorRuntimeFailureInfo,
        exit_code: Option<i32>,
        signal: Option<String>,
    },
    RequestRuntimeStop {
        operation_id: String,
    },
    SignalRuntimeTerminate,
    SignalRuntimeKill,
    ScheduleGraceDeadline,
    ScheduleTerminateDeadline,
    ScheduleEscalationDeadline,
    ScheduleRestart {
        backoff: Duration,
    },
}

#[allow(dead_code)]
#[derive(Debug, Clone, Eq, PartialEq)]
pub(super) enum SupervisorEvent {
    LaunchRequested,
    LaunchFailed {
        message: String,
    },
    ChildSpawned {
        runtime_pid: u32,
    },
    ControlSocketObserved,
    WatchReady,
    StopIntentReceived {
        operation_id: String,
    },
    StopRpcAccepted {
        operation_id: String,
    },
    StopRpcFailed {
        operation_id: String,
        disposition: SupervisorStopRpcFailureDisposition,
        message: String,
    },
    GraceDeadlineElapsed,
    TerminateDeadlineElapsed,
    EscalationDeadlineElapsed {
        message: String,
    },
    ChildExited {
        runtime_pid: u32,
        exit_kind: SupervisorChildExitKind,
        exit_code: Option<i32>,
        signal: Option<String>,
        message: String,
    },
    StartupDeadlineElapsed {
        message: String,
    },
    RestartScheduled {
        restart_attempt: u32,
        backoff: Duration,
    },
    ArtifactRecoveryCompleted,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(super) enum SupervisorEventKind {
    LaunchRequested,
    LaunchFailed,
    ChildSpawned,
    ControlSocketObserved,
    WatchReady,
    StopIntentReceived,
    StopRpcAccepted,
    StopRpcFailed,
    GraceDeadlineElapsed,
    TerminateDeadlineElapsed,
    EscalationDeadlineElapsed,
    ChildExited,
    StartupDeadlineElapsed,
    RestartScheduled,
    ArtifactRecoveryCompleted,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(super) enum SupervisorStopRpcFailureDisposition {
    FallbackToTerminate,
    TerminalFailure,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(super) enum SupervisorChildExitKind {
    Expected,
    Unexpected,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(super) struct SupervisorFailureInfo {
    pub(super) code: types::SupervisorFailureCode,
    pub(super) message: String,
    pub(super) retryability: SupervisorFailureRetryability,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(super) struct SupervisorRuntimeFailureInfo {
    pub(super) code: types::RuntimeFailureCode,
    pub(super) message: String,
    pub(super) retryability: SupervisorFailureRetryability,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(super) enum SupervisorFailureRetryability {
    Retryable,
    Terminal,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(super) struct SupervisorTransitionRejected {
    pub(super) state: SupervisorMachineState,
    pub(super) event: SupervisorEventKind,
    pub(super) reason: &'static str,
}

impl SupervisorMachine {
    pub(super) const fn new() -> Self {
        Self {
            state: SupervisorMachineState::Starting,
            supervisor_sequence: 0,
            runtime_pid: None,
            failure: None,
            launch_requested: false,
            restart_count: 0,
        }
    }

    pub(super) const fn state(&self) -> SupervisorMachineState {
        self.state
    }

    pub(super) const fn restart_count(&self) -> u32 {
        self.restart_count
    }
}

impl SupervisorMachineState {
    pub(super) const fn label(self) -> &'static str {
        match self {
            Self::Starting => "starting",
            Self::Handshaking => "handshaking",
            Self::Ready => "ready",
            Self::StopRequested => "stop_requested",
            Self::Terminating => "terminating",
            Self::Escalating => "escalating",
            Self::Exited => "exited",
            Self::Failed => "failed",
        }
    }

    const fn phase(self) -> types::SupervisorPhase {
        match self {
            Self::Starting => types::SupervisorPhase::SUPERVISOR_PHASE_STARTING,
            Self::Handshaking => types::SupervisorPhase::SUPERVISOR_PHASE_HANDSHAKING,
            Self::Ready => types::SupervisorPhase::SUPERVISOR_PHASE_READY,
            Self::StopRequested => types::SupervisorPhase::SUPERVISOR_PHASE_STOP_REQUESTED,
            Self::Terminating => types::SupervisorPhase::SUPERVISOR_PHASE_TERMINATING,
            Self::Escalating => types::SupervisorPhase::SUPERVISOR_PHASE_ESCALATING,
            Self::Exited => types::SupervisorPhase::SUPERVISOR_PHASE_EXITED,
            Self::Failed => types::SupervisorPhase::SUPERVISOR_PHASE_FAILED,
        }
    }
}

impl SupervisorEvent {
    pub(super) const fn kind(&self) -> SupervisorEventKind {
        match self {
            Self::LaunchRequested => SupervisorEventKind::LaunchRequested,
            Self::LaunchFailed { .. } => SupervisorEventKind::LaunchFailed,
            Self::ChildSpawned { .. } => SupervisorEventKind::ChildSpawned,
            Self::ControlSocketObserved => SupervisorEventKind::ControlSocketObserved,
            Self::WatchReady => SupervisorEventKind::WatchReady,
            Self::StopIntentReceived { .. } => SupervisorEventKind::StopIntentReceived,
            Self::StopRpcAccepted { .. } => SupervisorEventKind::StopRpcAccepted,
            Self::StopRpcFailed { .. } => SupervisorEventKind::StopRpcFailed,
            Self::GraceDeadlineElapsed => SupervisorEventKind::GraceDeadlineElapsed,
            Self::TerminateDeadlineElapsed => SupervisorEventKind::TerminateDeadlineElapsed,
            Self::EscalationDeadlineElapsed { .. } => {
                SupervisorEventKind::EscalationDeadlineElapsed
            }
            Self::ChildExited { .. } => SupervisorEventKind::ChildExited,
            Self::StartupDeadlineElapsed { .. } => SupervisorEventKind::StartupDeadlineElapsed,
            Self::RestartScheduled { .. } => SupervisorEventKind::RestartScheduled,
            Self::ArtifactRecoveryCompleted => SupervisorEventKind::ArtifactRecoveryCompleted,
        }
    }

    fn reason(&self) -> String {
        match self {
            Self::LaunchRequested
            | Self::ChildSpawned { .. }
            | Self::ControlSocketObserved
            | Self::WatchReady
            | Self::StopIntentReceived { .. }
            | Self::StopRpcAccepted { .. }
            | Self::GraceDeadlineElapsed
            | Self::TerminateDeadlineElapsed
            | Self::ArtifactRecoveryCompleted => self.kind().label().to_owned(),
            Self::RestartScheduled {
                restart_attempt,
                backoff,
            } => format!(
                "restart_scheduled: attempt {restart_attempt} after {}ms",
                backoff.as_millis()
            ),
            Self::LaunchFailed { message }
            | Self::StartupDeadlineElapsed { message }
            | Self::EscalationDeadlineElapsed { message } => {
                bounded_reason(self.kind().label(), message)
            }
            Self::StopRpcFailed { message, .. } => bounded_reason(self.kind().label(), message),
            Self::ChildExited { message, .. } => bounded_reason(self.kind().label(), message),
        }
    }

    fn exit_status(&self) -> (Option<i32>, Option<String>) {
        match self {
            Self::ChildExited {
                exit_code, signal, ..
            } => (*exit_code, signal.clone()),
            _ => (None, None),
        }
    }

    fn caller_operation_id(&self) -> Option<String> {
        match self {
            Self::StopIntentReceived { operation_id }
            | Self::StopRpcAccepted { operation_id }
            | Self::StopRpcFailed { operation_id, .. } => Some(operation_id.clone()),
            _ => None,
        }
    }
}

impl SupervisorEventKind {
    pub(super) const fn label(self) -> &'static str {
        match self {
            Self::LaunchRequested => "launch_requested",
            Self::LaunchFailed => "launch_failed",
            Self::ChildSpawned => "child_spawned",
            Self::ControlSocketObserved => "control_socket_observed",
            Self::WatchReady => "watch_ready",
            Self::StopIntentReceived => "stop_intent_received",
            Self::StopRpcAccepted => "stop_rpc_accepted",
            Self::StopRpcFailed => "stop_rpc_failed",
            Self::GraceDeadlineElapsed => "grace_deadline_elapsed",
            Self::TerminateDeadlineElapsed => "terminate_deadline_elapsed",
            Self::EscalationDeadlineElapsed => "escalation_deadline_elapsed",
            Self::ChildExited => "child_exited",
            Self::StartupDeadlineElapsed => "startup_deadline_elapsed",
            Self::RestartScheduled => "restart_scheduled",
            Self::ArtifactRecoveryCompleted => "artifact_recovery_completed",
        }
    }
}

impl SupervisorFailureRetryability {
    pub(super) const fn as_bool(self) -> bool {
        match self {
            Self::Retryable => true,
            Self::Terminal => false,
        }
    }
}

pub(super) fn reduce_supervisor_machine(
    machine: &SupervisorMachine,
    event: SupervisorEvent,
) -> Result<SupervisorMachineReduction, SupervisorTransitionRejected> {
    let event_kind = event.kind();
    let previous = machine.clone();

    let mut reduction = match (machine.state, event.clone()) {
        (SupervisorMachineState::Starting, SupervisorEvent::LaunchRequested) => {
            if machine.launch_requested {
                return Err(rejected(
                    machine.state,
                    event_kind,
                    "launch was already requested",
                ));
            }

            let mut next = next_machine(machine, SupervisorMachineState::Starting);
            next.launch_requested = true;
            Ok(snapshot_reduction(next))
        }
        (SupervisorMachineState::Starting, SupervisorEvent::LaunchFailed { message }) => {
            if !machine.launch_requested {
                return Err(rejected(
                    machine.state,
                    event_kind,
                    "launch failure requires a prior launch request",
                ));
            }

            Ok(failed_transition(
                machine,
                types::SupervisorFailureCode::SUPERVISOR_FAILURE_CODE_INTERNAL,
                message,
                SupervisorFailureRetryability::Terminal,
            ))
        }
        (SupervisorMachineState::Starting, SupervisorEvent::ChildSpawned { runtime_pid }) => {
            if !machine.launch_requested {
                return Err(rejected(
                    machine.state,
                    event_kind,
                    "child spawn requires a prior launch request",
                ));
            }

            if runtime_pid == 0 {
                return Err(rejected(
                    machine.state,
                    event_kind,
                    "runtime pid must be greater than zero",
                ));
            }

            let mut next = next_machine(machine, SupervisorMachineState::Handshaking);
            next.runtime_pid = Some(runtime_pid);
            next.launch_requested = true;
            Ok(snapshot_reduction(next))
        }
        (
            SupervisorMachineState::Starting | SupervisorMachineState::Handshaking,
            SupervisorEvent::StartupDeadlineElapsed { message },
        ) => Ok(failed_transition(
            machine,
            types::SupervisorFailureCode::SUPERVISOR_FAILURE_CODE_STARTUP_TIMEOUT,
            message,
            SupervisorFailureRetryability::Retryable,
        )),
        (SupervisorMachineState::Handshaking, SupervisorEvent::ControlSocketObserved) => {
            Ok(self_transition(machine))
        }
        (SupervisorMachineState::Handshaking, SupervisorEvent::WatchReady) => {
            if machine.runtime_pid.is_none() {
                return Err(rejected(
                    machine.state,
                    event_kind,
                    "runtime pid is required before ready",
                ));
            }

            Ok(snapshot_transition(machine, SupervisorMachineState::Ready))
        }
        (
            SupervisorMachineState::Ready,
            SupervisorEvent::StopIntentReceived { operation_id },
        ) => {
            if machine.runtime_pid.is_none() {
                return Err(rejected(
                    machine.state,
                    event_kind,
                    "runtime pid is required before stop",
                ));
            }

            let next = next_machine(machine, SupervisorMachineState::StopRequested);
            let mut reduction = snapshot_reduction(next);
            reduction
                .effects
                .push(SupervisorEffect::RequestRuntimeStop { operation_id });
            Ok(reduction)
        }
        (
            SupervisorMachineState::StopRequested,
            SupervisorEvent::StopRpcAccepted { .. },
        ) => {
            let mut reduction = self_transition(machine);
            reduction.effects.push(SupervisorEffect::ScheduleGraceDeadline);
            Ok(reduction)
        }
        (
            SupervisorMachineState::StopRequested,
            SupervisorEvent::StopRpcFailed {
                operation_id: _,
                disposition: SupervisorStopRpcFailureDisposition::FallbackToTerminate,
                message: _,
            },
        )
        | (SupervisorMachineState::StopRequested, SupervisorEvent::GraceDeadlineElapsed) => {
            if machine.runtime_pid.is_none() {
                return Err(rejected(
                    machine.state,
                    event_kind,
                    "runtime pid is required before termination",
                ));
            }

            let next = next_machine(machine, SupervisorMachineState::Terminating);
            let mut reduction = snapshot_reduction(next);
            reduction
                .effects
                .push(SupervisorEffect::SignalRuntimeTerminate);
            reduction
                .effects
                .push(SupervisorEffect::ScheduleTerminateDeadline);
            Ok(reduction)
        }
        (
            SupervisorMachineState::StopRequested,
            SupervisorEvent::StopRpcFailed {
                operation_id: _,
                disposition: SupervisorStopRpcFailureDisposition::TerminalFailure,
                message,
            },
        ) => Ok(failed_transition(
            machine,
            types::SupervisorFailureCode::SUPERVISOR_FAILURE_CODE_STOP_RPC_FAILED,
            message,
            SupervisorFailureRetryability::Retryable,
        )),
        (SupervisorMachineState::Terminating, SupervisorEvent::TerminateDeadlineElapsed) => {
            if machine.runtime_pid.is_none() {
                return Err(rejected(
                    machine.state,
                    event_kind,
                    "runtime pid is required before escalation",
                ));
            }

            let next = next_machine(machine, SupervisorMachineState::Escalating);
            let mut reduction = snapshot_reduction(next);
            reduction.effects.push(SupervisorEffect::SignalRuntimeKill);
            reduction
                .effects
                .push(SupervisorEffect::ScheduleEscalationDeadline);
            Ok(reduction)
        }
        (
            SupervisorMachineState::Escalating,
            SupervisorEvent::EscalationDeadlineElapsed { message },
        ) => Ok(failed_transition(
            machine,
            types::SupervisorFailureCode::SUPERVISOR_FAILURE_CODE_TERMINATION_TIMEOUT,
            message,
            SupervisorFailureRetryability::Retryable,
        )),
        (
            SupervisorMachineState::Starting
            | SupervisorMachineState::Handshaking
            | SupervisorMachineState::Ready
            | SupervisorMachineState::StopRequested
            | SupervisorMachineState::Terminating
            | SupervisorMachineState::Escalating,
            SupervisorEvent::ChildExited {
                runtime_pid,
                exit_kind,
                exit_code,
                signal,
                message,
            },
        ) => match exit_kind {
            SupervisorChildExitKind::Expected => child_exited_transition(
                machine,
                event_kind,
                runtime_pid,
                SupervisorMachineState::Exited,
                None,
            ),
            SupervisorChildExitKind::Unexpected => {
                child_exited_transition(
                    machine,
                    event_kind,
                    runtime_pid,
                    SupervisorMachineState::Failed,
                    Some(ChildExitedUnexpectedFailure {
                        supervisor_failure: SupervisorFailureInfo {
                            code: types::SupervisorFailureCode::SUPERVISOR_FAILURE_CODE_CHILD_EXITED_UNEXPECTEDLY,
                            message: message.clone(),
                            retryability: SupervisorFailureRetryability::Retryable,
                        },
                        runtime_failure: SupervisorRuntimeFailureInfo {
                            code: types::RuntimeFailureCode::RUNTIME_FAILURE_CODE_INTERNAL,
                            message,
                            retryability: SupervisorFailureRetryability::Retryable,
                        },
                        exit_code,
                        signal,
                    }),
                )
            }
        },
        (
            SupervisorMachineState::Starting
            | SupervisorMachineState::Handshaking
            | SupervisorMachineState::Ready
            | SupervisorMachineState::StopRequested
            | SupervisorMachineState::Terminating
            | SupervisorMachineState::Escalating,
            SupervisorEvent::ArtifactRecoveryCompleted,
        ) => Ok(SupervisorMachineReduction {
            machine: next_machine(machine, machine.state),
            transition: pending_transition(),
            effects: Vec::new(),
        }),
        (
            SupervisorMachineState::Failed,
            SupervisorEvent::RestartScheduled {
                restart_attempt,
                backoff,
            },
        ) => {
            let Some(failure) = machine.failure.as_ref() else {
                return Err(rejected(
                    machine.state,
                    event_kind,
                    "restart scheduling requires a recorded failure",
                ));
            };

            if failure.code
                != types::SupervisorFailureCode::SUPERVISOR_FAILURE_CODE_CHILD_EXITED_UNEXPECTEDLY
            {
                return Err(rejected(
                    machine.state,
                    event_kind,
                    "restart scheduling requires an unexpected child exit failure",
                ));
            }

            if failure.retryability != SupervisorFailureRetryability::Retryable {
                return Err(rejected(
                    machine.state,
                    event_kind,
                    "restart scheduling requires a retryable failure",
                ));
            }

            if restart_attempt <= machine.restart_count {
                return Err(rejected(
                    machine.state,
                    event_kind,
                    "restart attempt must advance the crash-loop counter",
                ));
            }

            let mut next = next_machine(machine, SupervisorMachineState::Starting);
            next.runtime_pid = None;
            next.launch_requested = false;
            next.restart_count = restart_attempt;
            let mut reduction = snapshot_reduction(next);
            reduction
                .effects
                .push(SupervisorEffect::ScheduleRestart { backoff });
            Ok(reduction)
        }
        (
            SupervisorMachineState::Starting
            | SupervisorMachineState::Handshaking
            | SupervisorMachineState::Ready
            | SupervisorMachineState::StopRequested
            | SupervisorMachineState::Terminating
            | SupervisorMachineState::Escalating
            | SupervisorMachineState::Exited
            | SupervisorMachineState::Failed,
            SupervisorEvent::LaunchRequested
            | SupervisorEvent::LaunchFailed { .. }
            | SupervisorEvent::ChildSpawned { .. }
            | SupervisorEvent::ControlSocketObserved
            | SupervisorEvent::WatchReady
            | SupervisorEvent::StopIntentReceived { .. }
            | SupervisorEvent::StopRpcAccepted { .. }
            | SupervisorEvent::StopRpcFailed { .. }
            | SupervisorEvent::GraceDeadlineElapsed
            | SupervisorEvent::TerminateDeadlineElapsed
            | SupervisorEvent::EscalationDeadlineElapsed { .. }
            | SupervisorEvent::ChildExited { .. }
            | SupervisorEvent::StartupDeadlineElapsed { .. }
            | SupervisorEvent::RestartScheduled { .. }
            | SupervisorEvent::ArtifactRecoveryCompleted,
        ) => Err(rejected(
            machine.state,
            event_kind,
            "event is not valid for the current supervisor state",
        )),
    }?;

    reduction.transition = supervisor_transition_effect(&previous, &reduction.machine, &event);
    Ok(reduction)
}

fn failed_transition(
    machine: &SupervisorMachine,
    code: types::SupervisorFailureCode,
    message: String,
    retryability: SupervisorFailureRetryability,
) -> SupervisorMachineReduction {
    let mut next = next_machine(machine, SupervisorMachineState::Failed);
    next.failure = Some(SupervisorFailureInfo {
        code,
        message,
        retryability,
    });
    snapshot_reduction(next)
}

struct ChildExitedUnexpectedFailure {
    supervisor_failure: SupervisorFailureInfo,
    runtime_failure: SupervisorRuntimeFailureInfo,
    exit_code: Option<i32>,
    signal: Option<String>,
}

fn child_exited_transition(
    machine: &SupervisorMachine,
    event_kind: SupervisorEventKind,
    runtime_pid: u32,
    state: SupervisorMachineState,
    failure: Option<ChildExitedUnexpectedFailure>,
) -> Result<SupervisorMachineReduction, SupervisorTransitionRejected> {
    if runtime_pid == 0 {
        return Err(rejected(
            machine.state,
            event_kind,
            "runtime pid must be greater than zero",
        ));
    }

    if machine
        .runtime_pid
        .is_some_and(|known_runtime_pid| known_runtime_pid != runtime_pid)
    {
        return Err(rejected(
            machine.state,
            event_kind,
            "child exit runtime pid does not match supervised runtime",
        ));
    }

    let mut next = next_machine(machine, state);
    next.runtime_pid = Some(runtime_pid);

    if let Some(failure) = failure {
        next.failure = Some(failure.supervisor_failure);
        let mut reduction = snapshot_reduction(next);
        reduction
            .effects
            .push(SupervisorEffect::WriteTerminalRuntimeStatusSnapshot {
                phase: types::RuntimePhase::RUNTIME_PHASE_FAILED,
                runtime_pid,
                failure: failure.runtime_failure,
                exit_code: failure.exit_code,
                signal: failure.signal,
            });
        return Ok(reduction);
    }

    Ok(snapshot_reduction(next))
}

fn snapshot_transition(
    machine: &SupervisorMachine,
    state: SupervisorMachineState,
) -> SupervisorMachineReduction {
    snapshot_reduction(next_machine(machine, state))
}

fn self_transition(machine: &SupervisorMachine) -> SupervisorMachineReduction {
    SupervisorMachineReduction {
        machine: next_machine(machine, machine.state),
        transition: pending_transition(),
        effects: Vec::new(),
    }
}

fn next_machine(machine: &SupervisorMachine, state: SupervisorMachineState) -> SupervisorMachine {
    SupervisorMachine {
        state,
        supervisor_sequence: machine.supervisor_sequence + 1,
        runtime_pid: machine.runtime_pid,
        failure: None,
        launch_requested: machine.launch_requested,
        restart_count: machine.restart_count,
    }
}

fn snapshot_reduction(machine: SupervisorMachine) -> SupervisorMachineReduction {
    SupervisorMachineReduction {
        transition: pending_transition(),
        effects: vec![SupervisorEffect::WriteStatusSnapshot {
            phase: machine.state.phase(),
            supervisor_sequence: machine.supervisor_sequence,
            runtime_pid: machine.runtime_pid,
            failure: machine.failure.clone(),
        }],
        machine,
    }
}

fn supervisor_transition_effect(
    previous: &SupervisorMachine,
    current: &SupervisorMachine,
    event: &SupervisorEvent,
) -> SupervisorTransitionEffect {
    let (exit_code, signal) = event.exit_status();

    SupervisorTransitionEffect {
        event: event.kind(),
        previous_phase: previous.state.phase(),
        current_phase: current.state.phase(),
        supervisor_sequence: current.supervisor_sequence,
        runtime_pid: current.runtime_pid,
        reason: event.reason(),
        caller_operation_id: event.caller_operation_id(),
        failure: current.failure.clone(),
        exit_code,
        signal,
    }
}

fn pending_transition() -> SupervisorTransitionEffect {
    SupervisorTransitionEffect {
        event: SupervisorEventKind::LaunchRequested,
        previous_phase: types::SupervisorPhase::SUPERVISOR_PHASE_UNSPECIFIED,
        current_phase: types::SupervisorPhase::SUPERVISOR_PHASE_UNSPECIFIED,
        supervisor_sequence: 0,
        runtime_pid: None,
        reason: String::new(),
        caller_operation_id: None,
        failure: None,
        exit_code: None,
        signal: None,
    }
}

fn bounded_reason(event: &str, message: &str) -> String {
    const MAX_REASON_BYTES: usize = 512;

    let mut reason = format!("{event}: {message}");
    if reason.len() <= MAX_REASON_BYTES {
        return reason;
    }

    reason.truncate(MAX_REASON_BYTES);
    while !reason.is_char_boundary(reason.len()) {
        reason.pop();
    }
    reason
}

fn rejected(
    state: SupervisorMachineState,
    event: SupervisorEventKind,
    reason: &'static str,
) -> SupervisorTransitionRejected {
    SupervisorTransitionRejected {
        state,
        event,
        reason,
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::SupervisorChildExitKind;
    use super::SupervisorEffect;
    use super::SupervisorEvent;
    use super::SupervisorEventKind;
    use super::SupervisorFailureInfo;
    use super::SupervisorFailureRetryability;
    use super::SupervisorMachine;
    use super::SupervisorMachineReduction;
    use super::SupervisorMachineState;
    use super::SupervisorRuntimeFailureInfo;
    use super::SupervisorStopRpcFailureDisposition;
    use super::reduce_supervisor_machine;
    use crate::runtime_control::types;
    use std::time::Duration;

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
                    operation_id: "stop-operation-a".to_owned(),
                },
            ]
        );
        assert_eq!(
            stop_requested.transition.caller_operation_id.as_deref(),
            Some("stop-operation-a")
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
    fn stop_rpc_fallback_enters_terminating_with_process_effects() {
        let stop_requested = reduce_ok(&ready_machine(), stop_intent_received_event());
        let terminating = reduce_ok(
            &stop_requested.machine,
            SupervisorEvent::StopRpcFailed {
                operation_id: "stop-operation-a".to_owned(),
                disposition: SupervisorStopRpcFailureDisposition::FallbackToTerminate,
                message: "runtime control unavailable".to_owned(),
            },
        );

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
                SupervisorEffect::SignalRuntimeTerminate,
                SupervisorEffect::ScheduleTerminateDeadline,
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
                    failure: SupervisorRuntimeFailureInfo {
                        code: types::RuntimeFailureCode::RUNTIME_FAILURE_CODE_INTERNAL,
                        message: "self-host server exited with code 1".to_owned(),
                        retryability: SupervisorFailureRetryability::Retryable,
                    },
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
    fn restart_scheduled_rejects_stale_attempt() {
        let failed = reduce_ok(&ready_machine(), unexpected_child_exited_event(4242));
        let restarted = reduce_ok(
            &failed.machine,
            SupervisorEvent::RestartScheduled {
                restart_attempt: 1,
                backoff: Duration::from_millis(250),
            },
        );
        let failed_again = reduce_ok(
            &reduce_ok(
                &reduce_ok(&restarted.machine, SupervisorEvent::LaunchRequested).machine,
                SupervisorEvent::ChildSpawned { runtime_pid: 4243 },
            )
            .machine,
            unexpected_child_exited_event(4243),
        );

        let rejection = match reduce_supervisor_machine(
            &failed_again.machine,
            SupervisorEvent::RestartScheduled {
                restart_attempt: 1,
                backoff: Duration::from_millis(250),
            },
        ) {
            Ok(reduction) => panic!("expected rejected transition, got {reduction:?}"),
            Err(rejection) => rejection,
        };

        assert_eq!(rejection.state, SupervisorMachineState::Failed);
        assert_eq!(rejection.event, SupervisorEventKind::RestartScheduled);
        assert_eq!(
            rejection.reason,
            "restart attempt must advance the crash-loop counter"
        );
    }

    #[test]
    fn unexpected_child_exit_is_accepted_from_every_non_terminal_state() {
        let cases = [
            (
                SupervisorMachine::new(),
                SupervisorMachineState::Failed,
                1,
                4242,
            ),
            (
                handshaking_machine(),
                SupervisorMachineState::Failed,
                3,
                4242,
            ),
            (ready_machine(), SupervisorMachineState::Failed, 4, 4242),
            (
                stop_requested_machine(),
                SupervisorMachineState::Failed,
                5,
                4242,
            ),
            (
                terminating_machine(),
                SupervisorMachineState::Failed,
                6,
                4242,
            ),
            (
                escalating_machine(),
                SupervisorMachineState::Failed,
                7,
                4242,
            ),
        ];

        for (machine, expected_state, expected_sequence, runtime_pid) in cases {
            let reduction = reduce_ok(&machine, unexpected_child_exited_event(runtime_pid));

            assert_eq!(reduction.machine.state(), expected_state);
            assert_eq!(reduction.machine.supervisor_sequence, expected_sequence);
            assert_eq!(
                reduction.effects.last(),
                Some(&SupervisorEffect::WriteTerminalRuntimeStatusSnapshot {
                    phase: types::RuntimePhase::RUNTIME_PHASE_FAILED,
                    runtime_pid,
                    failure: SupervisorRuntimeFailureInfo {
                        code: types::RuntimeFailureCode::RUNTIME_FAILURE_CODE_INTERNAL,
                        message: "self-host server exited with code 1".to_owned(),
                        retryability: SupervisorFailureRetryability::Retryable,
                    },
                    exit_code: Some(1),
                    signal: None,
                })
            );
        }
    }

    #[test]
    fn child_exit_rejects_mismatched_runtime_pid() {
        let rejection = match reduce_supervisor_machine(
            &ready_machine(),
            unexpected_child_exited_event(4343),
        ) {
            Ok(reduction) => panic!("expected rejected transition, got {reduction:?}"),
            Err(rejection) => rejection,
        };

        assert_eq!(rejection.state, SupervisorMachineState::Ready);
        assert_eq!(rejection.event, SupervisorEventKind::ChildExited);
        assert_eq!(
            rejection.reason,
            "child exit runtime pid does not match supervised runtime"
        );
    }

    #[test]
    fn rejects_watch_ready_before_child_spawned() {
        let rejection =
            match reduce_supervisor_machine(&SupervisorMachine::new(), SupervisorEvent::WatchReady)
            {
                Ok(reduction) => panic!("expected rejected transition, got {reduction:?}"),
                Err(rejection) => rejection,
            };

        assert_eq!(rejection.state, SupervisorMachineState::Starting);
        assert_eq!(rejection.event, SupervisorEventKind::WatchReady);
    }

    fn ready_machine() -> SupervisorMachine {
        let launched = reduce_ok(&SupervisorMachine::new(), SupervisorEvent::LaunchRequested);
        let spawned = reduce_ok(
            &launched.machine,
            SupervisorEvent::ChildSpawned { runtime_pid: 4242 },
        );
        reduce_ok(&spawned.machine, SupervisorEvent::WatchReady).machine
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
            SupervisorEvent::StopRpcFailed {
                operation_id: "stop-operation-a".to_owned(),
                disposition: SupervisorStopRpcFailureDisposition::FallbackToTerminate,
                message: "runtime control unavailable".to_owned(),
            },
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

    fn unexpected_child_exited_event(runtime_pid: u32) -> SupervisorEvent {
        SupervisorEvent::ChildExited {
            runtime_pid,
            exit_kind: SupervisorChildExitKind::Unexpected,
            exit_code: Some(1),
            signal: None,
            message: "self-host server exited with code 1".to_owned(),
        }
    }

    fn stop_intent_received_event() -> SupervisorEvent {
        SupervisorEvent::StopIntentReceived {
            operation_id: "stop-operation-a".to_owned(),
        }
    }

    fn stop_rpc_accepted_event() -> SupervisorEvent {
        SupervisorEvent::StopRpcAccepted {
            operation_id: "stop-operation-a".to_owned(),
        }
    }

    fn reduce_ok(
        machine: &SupervisorMachine,
        event: SupervisorEvent,
    ) -> SupervisorMachineReduction {
        match reduce_supervisor_machine(machine, event) {
            Ok(reduction) => reduction,
            Err(rejection) => panic!("expected accepted transition, got {rejection:?}"),
        }
    }
}
