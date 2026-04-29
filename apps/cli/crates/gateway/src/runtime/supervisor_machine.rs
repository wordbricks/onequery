//! Deterministic supervisor lifecycle reducer.
//!
//! Formal transition table:
//!
//! | State | Event | Guard | Next state | Emitted effects | Durable payload | Rejected transition |
//! | --- | --- | --- | --- | --- | --- | --- |
//! | `starting` | `launch_requested` | no prior launch request | `starting` | write status snapshot | `SupervisorStatusSnapshot(starting)` | repeated launch requests reject |
//! | `starting` | `launch_failed` | prior launch request | `failed` | write status snapshot | `SupervisorStatusSnapshot(failed)` | non-starting states reject |
//! | `starting` | `child_spawned` | prior launch request and runtime pid > 0 | `handshaking` | write status snapshot | `SupervisorStatusSnapshot(handshaking)` | all other states reject |
//! | `starting`, `handshaking` | `startup_deadline_elapsed` | runtime pid optional | `failed` | write status snapshot; signal terminate and schedule terminate deadline when runtime pid is known | `SupervisorStatusSnapshot(failed)` | terminal states reject |
//! | `handshaking` | `control_socket_observed` | none | `handshaking` | none | none | all other states reject |
//! | `handshaking` | `watch_ready` | runtime pid known | `ready` | write status snapshot | `SupervisorStatusSnapshot(ready)` | all other states reject |
//! | `handshaking`, `ready` | `stop_intent_received` | runtime pid known | `stop_requested` | write status snapshot, request runtime stop | `SupervisorStatusSnapshot(stop_requested)` | states without a runtime reject |
//! | `stop_requested` | `stop_rpc_accepted` | none | `stop_requested` | schedule grace deadline | none | all other states reject |
//! | `stop_requested` | `stop_rpc_failed` | stop-control escalation allowed | `terminating` | write status snapshot, signal terminate, schedule terminate deadline | `SupervisorStatusSnapshot(terminating)` | all other states reject |
//! | `stop_requested` | `stop_rpc_failed` | stop-control escalation denied | `failed` | write status snapshot | `SupervisorStatusSnapshot(failed)` | all other states reject |
//! | `stop_requested` | `grace_deadline_elapsed` | runtime pid known | `terminating` | write status snapshot, signal terminate, schedule terminate deadline | `SupervisorStatusSnapshot(terminating)` | all other states reject |
//! | `terminating` | `terminate_deadline_elapsed` | runtime pid known | `escalating` | write status snapshot, signal hard kill, schedule escalation deadline | `SupervisorStatusSnapshot(escalating)` | all other states reject |
//! | startup-timeout `failed` | `terminate_deadline_elapsed` | runtime pid known | `failed` | write status snapshot, signal hard kill, schedule escalation deadline | `SupervisorStatusSnapshot(failed)` | non-startup failures reject |
//! | `escalating` | `escalation_deadline_elapsed` | none | `failed` | write status snapshot | `SupervisorStatusSnapshot(failed)` | all other states reject |
//! | any non-terminal state | `child_exited` | runtime pid is valid and expected exit | `exited` | write status snapshot, write terminal runtime status snapshot, write process exit event | `SupervisorStatusSnapshot(exited)`, `RuntimeStatusSnapshot(stopped)`, `LifecycleProcessExit` | terminal states reject; runtime pid mismatch rejects |
//! | any non-terminal state | `child_exited` | runtime pid is valid and unexpected exit | `failed` | write status snapshot, write terminal runtime status snapshot, write process exit event | `SupervisorStatusSnapshot(failed)`, `RuntimeStatusSnapshot(failed)`, `LifecycleProcessExit` | terminal states reject; runtime pid mismatch rejects |
//! | startup-timeout `failed` | `child_exited` | runtime pid matches startup cleanup child | `failed` | write status snapshot, write terminal runtime status snapshot, write process exit event | `SupervisorStatusSnapshot(failed)`, `RuntimeStatusSnapshot(failed)`, `LifecycleProcessExit` | non-startup failures reject; runtime pid mismatch rejects |
//! | `failed` | `restart_scheduled` | failure came from a retryable unexpected child exit and attempt advances | `starting` | write status snapshot, schedule restart backoff | `SupervisorStatusSnapshot(starting)` | disabled/exhausted policy does not dispatch; stale attempts reject |
//!
//! Every accepted transition, including self-transitions without status
//! snapshot effects, also emits one supervisor transition event-log effect.

use std::time::Duration;

use onequery_utils_string::take_bytes_at_char_boundary;

use crate::supervisor_control_proto::types;

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
struct SupervisorReduction {
    machine: SupervisorMachine,
    effects: Vec<SupervisorEffect>,
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
        failure: Option<SupervisorRuntimeFailureInfo>,
        exit_code: Option<i32>,
        signal: Option<String>,
    },
    RequestRuntimeStop {
        runtime_pid: u32,
        operation_id: String,
    },
    SignalRuntimeTerminate {
        runtime_pid: u32,
    },
    SignalRuntimeKill {
        runtime_pid: u32,
    },
    ScheduleGraceDeadline,
    ScheduleTerminateDeadline,
    ScheduleEscalationDeadline,
    ScheduleRestart {
        backoff: Duration,
    },
}

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
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(super) enum SupervisorStopRpcFailureDisposition {
    EscalateToTerminate,
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
            | Self::TerminateDeadlineElapsed => self.kind().label().to_owned(),
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

    let reduction = match (machine.state, event.clone()) {
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
        ) => {
            let mut reduction = failed_transition(
                machine,
                types::SupervisorFailureCode::SUPERVISOR_FAILURE_CODE_STARTUP_TIMEOUT,
                message,
                SupervisorFailureRetryability::Retryable,
            );
            if let Some(runtime_pid) = machine.runtime_pid {
                reduction
                    .effects
                    .push(SupervisorEffect::SignalRuntimeTerminate { runtime_pid });
                reduction
                    .effects
                    .push(SupervisorEffect::ScheduleTerminateDeadline);
            }
            Ok(reduction)
        }
        (SupervisorMachineState::Handshaking, SupervisorEvent::ControlSocketObserved) => {
            Ok(self_transition(machine))
        }
        (SupervisorMachineState::Handshaking, SupervisorEvent::WatchReady) => {
            require_runtime_pid(machine, event_kind, "runtime pid is required before ready")?;

            Ok(snapshot_transition(machine, SupervisorMachineState::Ready))
        }
        (
            SupervisorMachineState::Handshaking | SupervisorMachineState::Ready,
            SupervisorEvent::StopIntentReceived { operation_id },
        ) => {
            let runtime_pid =
                require_runtime_pid(machine, event_kind, "runtime pid is required before stop")?;

            let next = next_machine(machine, SupervisorMachineState::StopRequested);
            let mut reduction = snapshot_reduction(next);
            reduction
                .effects
                .push(SupervisorEffect::RequestRuntimeStop {
                    runtime_pid,
                    operation_id,
                });
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
                disposition: SupervisorStopRpcFailureDisposition::EscalateToTerminate,
                message: _,
            },
        )
        | (SupervisorMachineState::StopRequested, SupervisorEvent::GraceDeadlineElapsed) => {
            let runtime_pid = require_runtime_pid(
                machine,
                event_kind,
                "runtime pid is required before termination",
            )?;

            let next = next_machine(machine, SupervisorMachineState::Terminating);
            let mut reduction = snapshot_reduction(next);
            reduction
                .effects
                .push(SupervisorEffect::SignalRuntimeTerminate { runtime_pid });
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
            let runtime_pid = require_runtime_pid(
                machine,
                event_kind,
                "runtime pid is required before escalation",
            )?;

            let next = next_machine(machine, SupervisorMachineState::Escalating);
            let mut reduction = snapshot_reduction(next);
            reduction
                .effects
                .push(SupervisorEffect::SignalRuntimeKill { runtime_pid });
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
        (SupervisorMachineState::Failed, SupervisorEvent::TerminateDeadlineElapsed)
            if startup_timeout_cleanup_is_active(machine) =>
        {
            let runtime_pid = require_runtime_pid(
                machine,
                event_kind,
                "runtime pid is required before startup cleanup escalation",
            )?;
            let mut reduction = failure_preserving_snapshot_reduction(machine);
            reduction
                .effects
                .push(SupervisorEffect::SignalRuntimeKill { runtime_pid });
            reduction
                .effects
                .push(SupervisorEffect::ScheduleEscalationDeadline);
            Ok(reduction)
        }
        (
            SupervisorMachineState::Failed,
            SupervisorEvent::EscalationDeadlineElapsed { message: _ },
        ) if startup_timeout_cleanup_is_active(machine) => {
            Ok(failure_preserving_snapshot_reduction(machine))
        }
        (
            SupervisorMachineState::Failed,
            SupervisorEvent::ChildExited {
                runtime_pid,
                exit_kind: _,
                exit_code,
                signal,
                message: _,
            },
        ) if startup_timeout_cleanup_is_active(machine) => {
            startup_cleanup_child_exited_transition(
                machine,
                event_kind,
                runtime_pid,
                exit_code,
                signal,
            )
        }
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
                ChildExitedRuntimeProjection {
                    phase: types::RuntimePhase::RUNTIME_PHASE_STOPPED,
                    failure: None,
                    exit_code,
                    signal,
                },
            ),
            SupervisorChildExitKind::Unexpected => {
                child_exited_transition(
                    machine,
                    event_kind,
                    runtime_pid,
                    SupervisorMachineState::Failed,
                    ChildExitedRuntimeProjection {
                        phase: types::RuntimePhase::RUNTIME_PHASE_FAILED,
                        failure: Some(ChildExitedUnexpectedFailure {
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
                        }),
                        exit_code,
                        signal,
                    },
                )
            }
        },
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

            if !matches!(
                failure.code,
                types::SupervisorFailureCode::SUPERVISOR_FAILURE_CODE_CHILD_EXITED_UNEXPECTEDLY
                    | types::SupervisorFailureCode::SUPERVISOR_FAILURE_CODE_STARTUP_TIMEOUT
            ) {
                return Err(rejected(
                    machine.state,
                    event_kind,
                    "restart scheduling requires a restartable failure",
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
            | SupervisorEvent::RestartScheduled { .. },
        ) => Err(rejected(
            machine.state,
            event_kind,
            "event is not valid for the current supervisor state",
        )),
    }?;

    let transition = supervisor_transition_effect(&previous, &reduction.machine, &event);
    Ok(SupervisorMachineReduction {
        machine: reduction.machine,
        transition,
        effects: reduction.effects,
    })
}

fn failed_transition(
    machine: &SupervisorMachine,
    code: types::SupervisorFailureCode,
    message: String,
    retryability: SupervisorFailureRetryability,
) -> SupervisorReduction {
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
}

struct ChildExitedRuntimeProjection {
    phase: types::RuntimePhase,
    failure: Option<ChildExitedUnexpectedFailure>,
    exit_code: Option<i32>,
    signal: Option<String>,
}

fn child_exited_transition(
    machine: &SupervisorMachine,
    event_kind: SupervisorEventKind,
    runtime_pid: u32,
    state: SupervisorMachineState,
    runtime_projection: ChildExitedRuntimeProjection,
) -> Result<SupervisorReduction, SupervisorTransitionRejected> {
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

    let runtime_failure = if let Some(failure) = runtime_projection.failure {
        next.failure = Some(failure.supervisor_failure);
        Some(failure.runtime_failure)
    } else {
        None
    };
    let mut reduction = snapshot_reduction(next);
    reduction
        .effects
        .push(SupervisorEffect::WriteTerminalRuntimeStatusSnapshot {
            phase: runtime_projection.phase,
            runtime_pid,
            failure: runtime_failure,
            exit_code: runtime_projection.exit_code,
            signal: runtime_projection.signal,
        });
    Ok(reduction)
}

fn startup_cleanup_child_exited_transition(
    machine: &SupervisorMachine,
    event_kind: SupervisorEventKind,
    runtime_pid: u32,
    exit_code: Option<i32>,
    signal: Option<String>,
) -> Result<SupervisorReduction, SupervisorTransitionRejected> {
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

    let Some(supervisor_failure) = machine.failure.as_ref() else {
        return Err(rejected(
            machine.state,
            event_kind,
            "startup cleanup child exit requires a startup timeout failure",
        ));
    };

    let mut next = next_machine(machine, SupervisorMachineState::Failed);
    next.runtime_pid = Some(runtime_pid);
    next.failure = Some(supervisor_failure.clone());

    let mut reduction = snapshot_reduction(next);
    reduction
        .effects
        .push(SupervisorEffect::WriteTerminalRuntimeStatusSnapshot {
            phase: types::RuntimePhase::RUNTIME_PHASE_FAILED,
            runtime_pid,
            failure: Some(SupervisorRuntimeFailureInfo {
                code: types::RuntimeFailureCode::RUNTIME_FAILURE_CODE_INTERNAL,
                message: supervisor_failure.message.clone(),
                retryability: supervisor_failure.retryability,
            }),
            exit_code,
            signal,
        });
    Ok(reduction)
}

fn snapshot_transition(
    machine: &SupervisorMachine,
    state: SupervisorMachineState,
) -> SupervisorReduction {
    snapshot_reduction(next_machine(machine, state))
}

fn failure_preserving_snapshot_reduction(machine: &SupervisorMachine) -> SupervisorReduction {
    let mut next = next_machine(machine, machine.state);
    next.failure = machine.failure.clone();
    snapshot_reduction(next)
}

fn self_transition(machine: &SupervisorMachine) -> SupervisorReduction {
    SupervisorReduction {
        machine: next_machine(machine, machine.state),
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

fn snapshot_reduction(machine: SupervisorMachine) -> SupervisorReduction {
    SupervisorReduction {
        effects: vec![SupervisorEffect::WriteStatusSnapshot {
            phase: machine.state.phase(),
            supervisor_sequence: machine.supervisor_sequence,
            runtime_pid: machine.runtime_pid,
            failure: machine.failure.clone(),
        }],
        machine,
    }
}

fn require_runtime_pid(
    machine: &SupervisorMachine,
    event: SupervisorEventKind,
    reason: &'static str,
) -> Result<u32, SupervisorTransitionRejected> {
    machine
        .runtime_pid
        .ok_or_else(|| rejected(machine.state, event, reason))
}

fn startup_timeout_cleanup_is_active(machine: &SupervisorMachine) -> bool {
    machine.runtime_pid.is_some()
        && machine.failure.as_ref().is_some_and(|failure| {
            failure.code == types::SupervisorFailureCode::SUPERVISOR_FAILURE_CODE_STARTUP_TIMEOUT
        })
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

fn bounded_reason(event: &str, message: &str) -> String {
    const MAX_REASON_BYTES: usize = 512;

    let reason = format!("{event}: {message}");
    if reason.len() <= MAX_REASON_BYTES {
        return reason;
    }

    take_bytes_at_char_boundary(&reason, MAX_REASON_BYTES).to_owned()
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
mod tests;

#[cfg(test)]
mod property_tests;
