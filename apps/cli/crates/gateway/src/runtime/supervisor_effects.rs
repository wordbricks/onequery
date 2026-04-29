use std::time::Duration;

use chrono::Utc;
use connectrpc::ConnectError;
use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;
use tokio::time::Instant;

use crate::self_host::SelfHostRuntimePaths;
use crate::supervisor_control_proto::types;

use super::super::BACKGROUND_GATEWAY_RETRY_COMMAND;
use super::super::state::GatewayRuntimeState;
use super::shutdown::hard_kill_process;
use super::shutdown::terminate_process;
use super::supervisor_control::actor::SupervisorControlActor;
use super::supervisor_lifecycle_writer::SupervisorStatusSnapshotWrite;
use super::supervisor_lifecycle_writer::TerminalRuntimeStatusSnapshotWrite;
use super::supervisor_lifecycle_writer::append_supervisor_transition_event_log_entry;
use super::supervisor_lifecycle_writer::project_supervisor_transition;
use super::supervisor_lifecycle_writer::write_supervisor_status_snapshot;
use super::supervisor_lifecycle_writer::write_terminal_runtime_status_snapshot;
use super::supervisor_machine::SupervisorEffect;
use super::supervisor_machine::SupervisorEvent;
use super::supervisor_machine::SupervisorMachine;
use super::supervisor_machine::reduce_supervisor_machine;
use super::transport::retry_command_hint;

const SUPERVISOR_POLL_INTERVAL: Duration = Duration::from_millis(100);
const SUPERVISOR_RUNTIME_STOP_REASON: &str = "onequery gateway stop";
#[cfg(not(test))]
fn supervisor_runtime_stop_grace_timeout() -> Duration {
    Duration::from_secs(30)
}

#[cfg(test)]
fn supervisor_runtime_stop_grace_timeout() -> Duration {
    Duration::from_millis(150)
}

#[cfg(not(test))]
fn supervisor_runtime_terminate_timeout() -> Duration {
    Duration::from_secs(5)
}

#[cfg(test)]
fn supervisor_runtime_terminate_timeout() -> Duration {
    Duration::from_millis(500)
}

#[cfg(not(test))]
fn supervisor_runtime_kill_timeout() -> Duration {
    Duration::from_secs(5)
}

#[cfg(test)]
fn supervisor_runtime_kill_timeout() -> Duration {
    Duration::from_millis(150)
}

#[derive(Debug, Default)]
pub(super) struct SupervisorTimers {
    stop_deadline: Option<Instant>,
    terminate_deadline: Option<Instant>,
    kill_deadline: Option<Instant>,
}

impl SupervisorTimers {
    pub(super) fn no_active_deadlines(&self) -> bool {
        self.stop_deadline.is_none()
            && self.terminate_deadline.is_none()
            && self.kill_deadline.is_none()
    }

    pub(super) fn stop_deadline_elapsed(&self) -> bool {
        self.stop_deadline
            .is_some_and(|deadline| Instant::now() >= deadline)
    }

    pub(super) fn terminate_deadline_elapsed(&self) -> bool {
        self.terminate_deadline
            .is_some_and(|deadline| Instant::now() >= deadline)
    }

    pub(super) fn kill_deadline_elapsed(&self) -> bool {
        self.kill_deadline
            .is_some_and(|deadline| Instant::now() >= deadline)
    }

    fn schedule_grace_deadline(&mut self, now: Instant) {
        self.stop_deadline = Some(now + supervisor_runtime_stop_grace_timeout());
    }

    fn schedule_terminate_deadline(&mut self, now: Instant) {
        self.stop_deadline = None;
        self.terminate_deadline = Some(now + supervisor_runtime_terminate_timeout());
    }

    fn schedule_escalation_deadline(&mut self, now: Instant) {
        self.terminate_deadline = None;
        self.kill_deadline = Some(now + supervisor_runtime_kill_timeout());
    }

    pub(super) fn next_poll_interval(&self) -> Duration {
        let mut interval = SUPERVISOR_POLL_INTERVAL;
        let now = Instant::now();

        for deadline in [
            self.stop_deadline,
            self.terminate_deadline,
            self.kill_deadline,
        ]
        .into_iter()
        .flatten()
        {
            interval = interval.min(deadline.saturating_duration_since(now));
        }

        interval
    }
}

#[derive(Clone, Copy)]
pub(super) struct SupervisorEffectContext<'a> {
    pub(super) paths: &'a SelfHostRuntimePaths,
    pub(super) supervisor_control: &'a SupervisorControlActor,
    pub(super) supervisor: &'a types::SupervisorIdentity,
    pub(super) launch_id: &'a str,
    pub(super) command_line: &'a str,
}

#[derive(Default)]
pub(super) struct SupervisorEffectReport {
    runtime_stop_result: Option<Result<(), ConnectError>>,
    restart_backoff: Option<Duration>,
    supervisor_status: Option<types::SupervisorStatus>,
}

impl SupervisorEffectReport {
    pub(super) fn runtime_stop_result(
        self,
        command_line: &str,
    ) -> Result<Result<(), ConnectError>, CliError> {
        self.runtime_stop_result.ok_or_else(|| {
            supervisor_effect_context_error(
                command_line,
                "runtime stop effect completed without a stop RPC result",
            )
        })
    }

    pub(super) fn restart_backoff(self, command_line: &str) -> Result<Duration, CliError> {
        self.restart_backoff.ok_or_else(|| {
            supervisor_effect_context_error(
                command_line,
                "restart scheduling effect completed without a backoff duration",
            )
        })
    }
}

pub(super) fn supervisor_effect_context<'a>(
    state: &'a GatewayRuntimeState,
    supervisor_control: &'a SupervisorControlActor,
    supervisor: &'a types::SupervisorIdentity,
    launch_id: &'a str,
    command_line: &'a str,
) -> SupervisorEffectContext<'a> {
    SupervisorEffectContext {
        paths: &state.paths,
        supervisor_control,
        supervisor,
        launch_id,
        command_line,
    }
}

pub(super) async fn dispatch_supervisor_event(
    machine: &mut SupervisorMachine,
    event: SupervisorEvent,
    context: SupervisorEffectContext<'_>,
    timers: Option<&mut SupervisorTimers>,
) -> Result<SupervisorEffectReport, CliError> {
    let reduction = reduce_supervisor_machine(machine, event).map_err(|rejection| {
        CliError::new(
            "gateway supervisor rejected lifecycle transition",
            context.command_line,
            ErrorStage::Internal,
            format!(
                "event {} is invalid while supervisor is {}: {}",
                rejection.event.label(),
                rejection.state.label(),
                rejection.reason
            ),
            vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
        )
    })?;
    let transition = reduction.transition;
    let effects = reduction.effects;

    append_supervisor_transition_event_log_entry(&transition, context)?;

    *machine = reduction.machine;

    let report = execute_supervisor_effects(&effects, context, timers).await?;
    let supervisor_status = report.supervisor_status.clone();
    context
        .supervisor_control
        .apply_supervisor_transition(
            project_supervisor_transition(&transition, context, Utc::now()),
            supervisor_status,
        )
        .await;
    Ok(report)
}

async fn execute_supervisor_effects(
    effects: &[SupervisorEffect],
    context: SupervisorEffectContext<'_>,
    mut timers: Option<&mut SupervisorTimers>,
) -> Result<SupervisorEffectReport, CliError> {
    let mut report = SupervisorEffectReport::default();
    let now = Instant::now();

    for effect in effects {
        match effect {
            SupervisorEffect::WriteStatusSnapshot {
                phase,
                supervisor_sequence,
                runtime_pid,
                failure,
            } => {
                let status = write_supervisor_status_snapshot(
                    context.paths,
                    SupervisorStatusSnapshotWrite {
                        supervisor: context.supervisor,
                        launch_id: context.launch_id,
                        phase: *phase,
                        supervisor_sequence: *supervisor_sequence,
                        runtime_pid: *runtime_pid,
                        failure: failure.as_ref(),
                    },
                    context.command_line,
                )?;
                report.supervisor_status = Some(status);
            }
            SupervisorEffect::WriteTerminalRuntimeStatusSnapshot {
                phase,
                runtime_pid,
                failure,
                exit_code,
                signal,
            } => {
                let live_status = context.supervisor_control.snapshot().await;
                let terminal_status = write_terminal_runtime_status_snapshot(
                    context.paths,
                    TerminalRuntimeStatusSnapshotWrite {
                        supervisor: context.supervisor,
                        launch_id: context.launch_id,
                        phase: *phase,
                        runtime_pid: *runtime_pid,
                        live_runtime_sequence: live_runtime_sequence_for_terminal_status(
                            &live_status,
                            context,
                            *runtime_pid,
                        ),
                        failure: failure.as_ref(),
                        exit_code: *exit_code,
                        signal: signal.as_deref(),
                    },
                    context.command_line,
                )?;
                context
                    .supervisor_control
                    .apply_supervisor_terminal_runtime_status(
                        terminal_status,
                        "supervisor-child-exit",
                    )
                    .await;
            }
            SupervisorEffect::RequestRuntimeStop {
                runtime_pid: _,
                operation_id,
            } => {
                let stop_result =
                    request_supervised_runtime_stop(context.supervisor_control, operation_id).await;

                if report.runtime_stop_result.replace(stop_result).is_some() {
                    return Err(supervisor_effect_context_error(
                        context.command_line,
                        "runtime stop effect ran more than once for one transition",
                    ));
                }
            }
            SupervisorEffect::SignalRuntimeTerminate { runtime_pid } => {
                terminate_process(*runtime_pid, context.command_line)?;
            }
            SupervisorEffect::SignalRuntimeKill { runtime_pid } => {
                hard_kill_process(*runtime_pid, context.command_line)?;
            }
            SupervisorEffect::ScheduleGraceDeadline => {
                supervisor_timers_mut(&mut timers, context.command_line)?
                    .schedule_grace_deadline(now);
            }
            SupervisorEffect::ScheduleTerminateDeadline => {
                supervisor_timers_mut(&mut timers, context.command_line)?
                    .schedule_terminate_deadline(now);
            }
            SupervisorEffect::ScheduleEscalationDeadline => {
                supervisor_timers_mut(&mut timers, context.command_line)?
                    .schedule_escalation_deadline(now);
            }
            SupervisorEffect::ScheduleRestart { backoff } => {
                if report.restart_backoff.replace(*backoff).is_some() {
                    return Err(supervisor_effect_context_error(
                        context.command_line,
                        "restart scheduling effect ran more than once for one transition",
                    ));
                }
            }
        }
    }

    Ok(report)
}

fn live_runtime_sequence_for_terminal_status(
    status: &types::SupervisorStatus,
    context: SupervisorEffectContext<'_>,
    runtime_pid: u32,
) -> Option<u64> {
    let runtime_sequence = status.runtime_sequence?;
    let data_dir = context.paths.data_dir.display().to_string();

    if status.runtime.as_option().is_some_and(|runtime| {
        runtime.pid == Some(runtime_pid)
            && runtime.launch_id.as_deref() == Some(context.launch_id)
            && runtime.data_dir.as_deref() == Some(data_dir.as_str())
    }) {
        return Some(runtime_sequence);
    }

    if status.launch.as_option().is_some_and(|launch| {
        launch.runtime_pid == Some(runtime_pid)
            && launch.launch_id.as_deref() == Some(context.launch_id)
            && launch.data_dir.as_deref() == Some(data_dir.as_str())
    }) {
        return Some(runtime_sequence);
    }

    None
}

async fn request_supervised_runtime_stop(
    supervisor_control: &SupervisorControlActor,
    operation_id: &str,
) -> Result<(), ConnectError> {
    supervisor_control
        .send_stop_command(types::SupervisorStopCommand {
            operation_id: Some(operation_id.to_owned()),
            reason: Some(SUPERVISOR_RUNTIME_STOP_REASON.to_owned()),
            completion: Some(
                types::RuntimeStopCompletion::RUNTIME_STOP_COMPLETION_CLEANUP_AND_EXIT.into(),
            ),
            grace_timeout: buffa::MessageField::some(protobuf_duration(
                supervisor_runtime_stop_grace_timeout(),
            )),
            ..Default::default()
        })
        .await
        .map(|_| ())
}

fn protobuf_duration(value: Duration) -> buffa_types::google::protobuf::Duration {
    buffa_types::google::protobuf::Duration {
        seconds: value.as_secs().min(i64::MAX as u64) as i64,
        nanos: value.subsec_nanos() as i32,
        ..Default::default()
    }
}

fn supervisor_timers_mut<'a>(
    timers: &'a mut Option<&mut SupervisorTimers>,
    command_line: &str,
) -> Result<&'a mut SupervisorTimers, CliError> {
    timers.as_deref_mut().ok_or_else(|| {
        supervisor_effect_context_error(
            command_line,
            "timer effect emitted without a supervisor timer context",
        )
    })
}

fn supervisor_effect_context_error(command_line: &str, detail: &'static str) -> CliError {
    CliError::new(
        "gateway supervisor could not execute lifecycle effect",
        command_line,
        ErrorStage::Internal,
        detail,
        vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
    )
}
