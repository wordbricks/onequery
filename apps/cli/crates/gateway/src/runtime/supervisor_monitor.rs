use std::future::Future;
use std::pin::Pin;
use std::process::Child;

use connectrpc::ConnectError;
use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;
use tokio::time::sleep;
use uuid::Uuid;

use super::super::BACKGROUND_GATEWAY_RETRY_COMMAND;
use super::control::runtime_control_error_allows_fallback;
use super::control_error::runtime_control_connect_error_summary;
use super::control_error::with_runtime_control_connect_error_metadata;
use super::status::describe_exit_status;
use super::status::exit_signal_label;
use super::supervisor::SupervisedRuntimeContext;
use super::supervisor::SupervisedRuntimeExit;
use super::supervisor::supervisor_child_exit_kind;
use super::supervisor_effects::SupervisorTimers;
use super::supervisor_effects::dispatch_supervisor_event;
use super::supervisor_machine::SupervisorEvent;
use super::supervisor_machine::SupervisorMachine;
use super::supervisor_machine::SupervisorStopRpcFailureDisposition;
use super::transport::retry_command_hint;

pub(super) async fn monitor_supervised_runtime(
    context: SupervisedRuntimeContext<'_>,
    child: &mut Child,
    machine: SupervisorMachine,
) -> Result<SupervisedRuntimeExit, CliError> {
    let mut stop_signal = OsSupervisorStopSignal::new(context.command_line)?;

    monitor_supervised_runtime_with_stop_signal(context, child, machine, &mut stop_signal).await
}

pub(super) async fn monitor_supervised_runtime_with_stop_signal<
    S: SupervisorStopSignalSource + ?Sized,
>(
    context: SupervisedRuntimeContext<'_>,
    child: &mut Child,
    mut machine: SupervisorMachine,
    stop_signal: &mut S,
) -> Result<SupervisedRuntimeExit, CliError> {
    let mut timers = SupervisorTimers::default();

    loop {
        if let Some(status) = child.try_wait().map_err(|error| {
            CliError::new(
                "failed while monitoring supervised gateway",
                context.command_line,
                ErrorStage::Internal,
                error.to_string(),
                vec![retry_command_hint(context.retry_command)],
            )
        })? {
            let exit_kind = supervisor_child_exit_kind(&machine, status);
            dispatch_supervisor_event(
                &mut machine,
                SupervisorEvent::ChildExited {
                    runtime_pid: context.runtime_pid,
                    exit_kind,
                    exit_code: status.code(),
                    signal: exit_signal_label(status),
                    message: describe_exit_status(status),
                },
                context.effect_context(),
                Some(&mut timers),
            )
            .await?;
            return Ok(SupervisedRuntimeExit {
                runtime_pid: context.runtime_pid,
                status,
                exit_kind,
                machine,
            });
        }

        if timers.kill_deadline_elapsed() {
            let message = format!(
                "pid {} remained active after supervisor hard kill",
                context.runtime_pid
            );
            dispatch_supervisor_event(
                &mut machine,
                SupervisorEvent::EscalationDeadlineElapsed {
                    message: message.clone(),
                },
                context.effect_context(),
                Some(&mut timers),
            )
            .await?;
            return Err(supervisor_termination_timeout_error(
                context.command_line,
                context.retry_command,
                message,
            ));
        }

        if timers.terminate_deadline_elapsed() {
            dispatch_supervisor_event(
                &mut machine,
                SupervisorEvent::TerminateDeadlineElapsed,
                context.effect_context(),
                Some(&mut timers),
            )
            .await?;
        }

        if timers.stop_deadline_elapsed() {
            dispatch_supervisor_event(
                &mut machine,
                SupervisorEvent::GraceDeadlineElapsed,
                context.effect_context(),
                Some(&mut timers),
            )
            .await?;
        }

        let poll_interval = timers.next_poll_interval();
        tokio::select! {
            () = stop_signal.recv(), if timers.no_active_deadlines() => {
                let stop_operation_id = Uuid::new_v4().to_string();
                let report = dispatch_supervisor_event(
                    &mut machine,
                    SupervisorEvent::StopIntentReceived {
                        operation_id: stop_operation_id.clone(),
                    },
                    context.effect_context(),
                    Some(&mut timers),
                )
                .await?;

                match report.runtime_stop_result(context.command_line)? {
                    Ok(()) => {
                        dispatch_supervisor_event(
                            &mut machine,
                            SupervisorEvent::StopRpcAccepted {
                                operation_id: stop_operation_id.clone(),
                            },
                            context.effect_context(),
                            Some(&mut timers),
                        )
                        .await?;
                    }
                    Err(error) if runtime_control_error_allows_fallback(&error) => {
                        dispatch_supervisor_event(
                            &mut machine,
                            SupervisorEvent::StopRpcFailed {
                                operation_id: stop_operation_id.clone(),
                                disposition: SupervisorStopRpcFailureDisposition::FallbackToTerminate,
                                message: runtime_control_stop_failure_message(&error),
                            },
                            context.effect_context(),
                            Some(&mut timers),
                        )
                        .await?;
                    }
                    Err(error) => {
                        dispatch_supervisor_event(
                            &mut machine,
                            SupervisorEvent::StopRpcFailed {
                                operation_id: stop_operation_id,
                                disposition: SupervisorStopRpcFailureDisposition::TerminalFailure,
                                message: runtime_control_stop_failure_message(&error),
                            },
                            context.effect_context(),
                            Some(&mut timers),
                        )
                        .await?;
                        return Err(runtime_control_stop_error(
                            error,
                            context.command_line,
                            context.retry_command,
                        ));
                    }
                }
            }
            () = sleep(poll_interval) => {}
        }
    }
}

fn runtime_control_stop_error(
    error: ConnectError,
    command_line: &str,
    retry_command: &str,
) -> CliError {
    let detail = runtime_control_stop_failure_message(&error);
    let fallback_code = Some(format!("runtime_control_{}", error.code.as_str()));
    let cli_error = CliError::new(
        "failed to request self-host runtime stop",
        command_line,
        ErrorStage::Internal,
        detail,
        vec![retry_command_hint(retry_command)],
    );

    with_runtime_control_connect_error_metadata(&error, cli_error, fallback_code)
}

fn runtime_control_stop_failure_message(error: &ConnectError) -> String {
    runtime_control_connect_error_summary(error).map_or_else(
        || {
            format!(
                "runtime control RPC returned {}: {error}",
                error.code.as_str()
            )
        },
        |summary| {
            format!(
                "runtime control RPC returned {}: {summary}",
                error.code.as_str()
            )
        },
    )
}

fn supervisor_termination_timeout_error(
    command_line: &str,
    retry_command: &str,
    detail: String,
) -> CliError {
    CliError::new(
        "self-host runtime did not stop cleanly",
        command_line,
        ErrorStage::Internal,
        detail,
        vec![retry_command_hint(retry_command)],
    )
}

pub(super) trait SupervisorStopSignalSource {
    fn recv(&mut self) -> Pin<Box<dyn Future<Output = ()> + '_>>;
}

#[cfg(unix)]
struct OsSupervisorStopSignal {
    interrupt: tokio::signal::unix::Signal,
    terminate: tokio::signal::unix::Signal,
}

#[cfg(unix)]
impl OsSupervisorStopSignal {
    fn new(command_line: &str) -> Result<Self, CliError> {
        Ok(Self {
            interrupt: tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())
                .map_err(|error| supervisor_signal_error(error, command_line))?,
            terminate: tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .map_err(|error| supervisor_signal_error(error, command_line))?,
        })
    }
}

#[cfg(unix)]
impl SupervisorStopSignalSource for OsSupervisorStopSignal {
    fn recv(&mut self) -> Pin<Box<dyn Future<Output = ()> + '_>> {
        Box::pin(async {
            tokio::select! {
                _ = self.interrupt.recv() => {}
                _ = self.terminate.recv() => {}
            }
        })
    }
}

#[cfg(not(unix))]
struct OsSupervisorStopSignal;

#[cfg(not(unix))]
impl OsSupervisorStopSignal {
    fn new(_command_line: &str) -> Result<Self, CliError> {
        Ok(Self)
    }
}

#[cfg(not(unix))]
impl SupervisorStopSignalSource for OsSupervisorStopSignal {
    fn recv(&mut self) -> Pin<Box<dyn Future<Output = ()> + '_>> {
        Box::pin(std::future::pending())
    }
}

#[cfg(unix)]
fn supervisor_signal_error(error: std::io::Error, command_line: &str) -> CliError {
    CliError::new(
        "failed to install gateway supervisor stop handler",
        command_line,
        ErrorStage::Internal,
        error.to_string(),
        vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
    )
}
