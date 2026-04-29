use std::ffi::OsStr;
use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::process::Child;
use std::process::Command as ProcessCommand;
use std::process::ExitStatus;
use std::process::Stdio;
use std::time::Duration;

use connectrpc::ConnectError;
use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;
use serde_json::json;
use tokio::time::Instant;
use tokio::time::sleep;
use tokio::time::timeout;
use uuid::Uuid;

use crate::GatewayCommandOutput;
use crate::GatewaySupervisorArgs;
use crate::runtime_control::types;
use crate::runtime_probe_host;

use super::super::BACKGROUND_GATEWAY_RETRY_COMMAND;
use super::super::GATEWAY_START_POLL_ATTEMPTS;
use super::super::GATEWAY_START_POLL_INTERVAL_MS;
use super::super::state::GatewayRuntimeState;
use super::control::RuntimeControlCallHeaders;
use super::control::RuntimeControlStatus;
use super::control::RuntimeControlStatusWatchEvent;
use super::control::runtime_control_error_allows_fallback;
use super::control::runtime_control_phase_is_terminal;
use super::control::runtime_control_phase_label;
use super::control::runtime_control_watch_event_from_proto;
use super::control::watch_runtime_control_status;
use super::control_error::runtime_control_connect_error_summary;
use super::control_error::with_runtime_control_connect_error_metadata;
use super::lifecycle::read_runtime_status_snapshot_for_recovery;
use super::lifecycle::runtime_launch_id_matches;
use super::lifecycle::runtime_phase_label;
use super::lifecycle::runtime_status_snapshot_pid_and_phase;
use super::process::background_log_stdio;
use super::status::describe_exit_status;
use super::status::exit_signal_label;
use super::status::is_expected_termination;
use super::supervisor_crash_loop::SupervisorCrashLoopDecision;
use super::supervisor_crash_loop::SupervisorCrashLoopPolicy;
use super::supervisor_effects::SupervisorEffectContext;
use super::supervisor_effects::SupervisorTimers;
use super::supervisor_effects::dispatch_supervisor_event;
use super::supervisor_effects::supervisor_effect_context;
use super::supervisor_machine::SupervisorChildExitKind;
use super::supervisor_machine::SupervisorEvent;
use super::supervisor_machine::SupervisorMachine;
use super::supervisor_machine::SupervisorMachineState;
use super::supervisor_machine::SupervisorStopRpcFailureDisposition;
use super::transport::retry_command_hint;
use super::transport::spawn_launch_error;

const SUPERVISOR_GENERATION: u64 = 1;

pub(crate) async fn run_gateway_supervisor(
    state: &GatewayRuntimeState,
    args: &GatewaySupervisorArgs,
    command_line: &str,
) -> Result<GatewayCommandOutput, CliError> {
    let launch_id = read_supervised_launch_id(args.launch_config.as_path(), command_line)?;
    let exit = run_supervised_runtime_to_exit(
        state,
        SupervisedRuntimeLaunch {
            launch_id: launch_id.as_str(),
            runtime_command: args.runtime_command.as_os_str(),
            runtime_entry: args.runtime_entry.as_path(),
            launch_config: args.launch_config.as_path(),
            crash_loop_policy: supervisor_crash_loop_policy_from_args(args),
            retry_command: BACKGROUND_GATEWAY_RETRY_COMMAND,
            stdio: SupervisedRuntimeStdio::Background {
                log_path: state.paths.server_log_path.as_path(),
            },
        },
        command_line,
    )
    .await?;
    let status = exit.status;

    if exit.exit_kind == SupervisorChildExitKind::Expected {
        return Ok(GatewayCommandOutput::structured(
            Vec::new(),
            json!({
                "kind": "gateway-supervisor",
                "status": "stopped",
                "runtimePid": exit.runtime_pid,
                "exitCode": status.code(),
                "signal": exit_signal_label(status),
            }),
        ));
    }

    Err(CliError::new(
        "self-host server exited unexpectedly",
        command_line,
        ErrorStage::Internal,
        describe_exit_status(status),
        vec![
            format!("check log file {}", state.paths.server_log_path.display()),
            retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND),
        ],
    ))
}

pub(super) async fn run_foreground_supervised_runtime(
    state: &GatewayRuntimeState,
    launch_id: &str,
    runtime_command: &OsStr,
    runtime_entry: &Path,
    launch_config: &Path,
    command_line: &str,
    retry_command: &str,
) -> Result<MonitoredRuntimeExit, CliError> {
    let exit = run_supervised_runtime_to_exit(
        state,
        SupervisedRuntimeLaunch {
            launch_id,
            runtime_command,
            runtime_entry,
            launch_config,
            crash_loop_policy: SupervisorCrashLoopPolicy::disabled(),
            retry_command,
            stdio: SupervisedRuntimeStdio::Foreground,
        },
        command_line,
    )
    .await?;

    Ok(MonitoredRuntimeExit {
        status: exit.status,
        kind: monitored_runtime_exit_kind(exit.exit_kind),
    })
}

struct SupervisedRuntimeLaunch<'a> {
    launch_id: &'a str,
    runtime_command: &'a OsStr,
    runtime_entry: &'a Path,
    launch_config: &'a Path,
    crash_loop_policy: SupervisorCrashLoopPolicy,
    retry_command: &'a str,
    stdio: SupervisedRuntimeStdio<'a>,
}

enum SupervisedRuntimeStdio<'a> {
    Foreground,
    Background { log_path: &'a Path },
}

fn supervisor_crash_loop_policy_from_args(
    args: &GatewaySupervisorArgs,
) -> SupervisorCrashLoopPolicy {
    SupervisorCrashLoopPolicy::bounded(
        args.crash_loop_max_restarts,
        Duration::from_millis(args.crash_loop_initial_backoff_ms),
        Duration::from_millis(args.crash_loop_max_backoff_ms),
    )
}

async fn run_supervised_runtime_to_exit(
    state: &GatewayRuntimeState,
    launch: SupervisedRuntimeLaunch<'_>,
    command_line: &str,
) -> Result<SupervisedRuntimeExit, CliError> {
    let supervisor = supervisor_identity(std::process::id());
    let mut machine = SupervisorMachine::new();

    loop {
        dispatch_supervisor_event(
            &mut machine,
            SupervisorEvent::LaunchRequested,
            supervisor_effect_context(state, &supervisor, launch.launch_id, None, command_line),
            None,
        )
        .await?;

        let mut child = match spawn_supervised_runtime(&launch, command_line) {
            Ok(child) => child,
            Err(error) => {
                let _ = dispatch_supervisor_event(
                    &mut machine,
                    SupervisorEvent::LaunchFailed {
                        message: error.to_string(),
                    },
                    supervisor_effect_context(
                        state,
                        &supervisor,
                        launch.launch_id,
                        None,
                        command_line,
                    ),
                    None,
                )
                .await;
                return Err(error);
            }
        };
        let runtime_pid = child.id();
        dispatch_supervisor_event(
            &mut machine,
            SupervisorEvent::ChildSpawned { runtime_pid },
            supervisor_effect_context(
                state,
                &supervisor,
                launch.launch_id,
                Some(runtime_pid),
                command_line,
            ),
            None,
        )
        .await?;

        let runtime_context = SupervisedRuntimeContext {
            state,
            supervisor: &supervisor,
            launch_id: launch.launch_id,
            runtime_pid,
            command_line,
            retry_command: launch.retry_command,
        };

        let startup_outcome =
            wait_for_supervised_runtime_ready(runtime_context, &mut child, &mut machine).await?;

        if let SupervisedRuntimeStartupOutcome::ExitedBeforeReady { error } = startup_outcome {
            let restart_backoff = restart_backoff_after_unexpected_exit(
                state,
                &supervisor,
                launch.launch_id,
                launch.crash_loop_policy,
                command_line,
                &mut machine,
            )
            .await?;

            if let Some(backoff) = restart_backoff {
                sleep(backoff).await;
                continue;
            }

            return Err(error);
        }

        let mut exit = monitor_supervised_runtime(runtime_context, &mut child, machine).await?;

        let restart_backoff = restart_backoff_after_unexpected_exit(
            state,
            &supervisor,
            launch.launch_id,
            launch.crash_loop_policy,
            command_line,
            &mut exit.machine,
        )
        .await?;

        if let Some(backoff) = restart_backoff {
            machine = exit.machine;
            sleep(backoff).await;
            continue;
        }

        return Ok(exit);
    }
}

async fn restart_backoff_after_unexpected_exit(
    state: &GatewayRuntimeState,
    supervisor: &types::SupervisorIdentity,
    launch_id: &str,
    crash_loop_policy: SupervisorCrashLoopPolicy,
    command_line: &str,
    machine: &mut SupervisorMachine,
) -> Result<Option<Duration>, CliError> {
    if machine.state() != SupervisorMachineState::Failed {
        return Ok(None);
    }

    let SupervisorCrashLoopDecision::Restart { attempt, backoff } =
        crash_loop_policy.decision_after_unexpected_exit(machine.restart_count())
    else {
        return Ok(None);
    };

    let report = dispatch_supervisor_event(
        machine,
        SupervisorEvent::RestartScheduled {
            restart_attempt: attempt,
            backoff,
        },
        supervisor_effect_context(state, supervisor, launch_id, None, command_line),
        None,
    )
    .await?;

    report.restart_backoff(command_line).map(Some)
}

fn spawn_supervised_runtime(
    launch: &SupervisedRuntimeLaunch<'_>,
    command_line: &str,
) -> Result<Child, CliError> {
    let mut child = ProcessCommand::new(launch.runtime_command);
    child.arg(launch.runtime_entry);
    child.arg(launch.launch_config);

    match launch.stdio {
        SupervisedRuntimeStdio::Foreground => {
            child
                .stdin(Stdio::inherit())
                .stdout(Stdio::inherit())
                .stderr(Stdio::inherit());
        }
        SupervisedRuntimeStdio::Background { log_path } => {
            child.stdin(Stdio::null());
            child.stdout(background_log_stdio(
                log_path,
                command_line,
                launch.retry_command,
            )?);
            child.stderr(background_log_stdio(
                log_path,
                command_line,
                launch.retry_command,
            )?);
        }
    }

    child.spawn().map_err(|spawn_error| {
        spawn_launch_error(
            &spawn_error,
            launch.runtime_command,
            launch.runtime_entry,
            command_line,
            launch.retry_command,
        )
    })
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(super) enum MonitoredRuntimeExitKind {
    Expected,
    Unexpected,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(super) struct MonitoredRuntimeExit {
    pub(super) status: ExitStatus,
    pub(super) kind: MonitoredRuntimeExitKind,
}

struct SupervisedRuntimeExit {
    runtime_pid: u32,
    status: ExitStatus,
    exit_kind: SupervisorChildExitKind,
    machine: SupervisorMachine,
}

#[derive(Clone, Copy)]
struct SupervisedRuntimeContext<'a> {
    state: &'a GatewayRuntimeState,
    supervisor: &'a types::SupervisorIdentity,
    launch_id: &'a str,
    runtime_pid: u32,
    command_line: &'a str,
    retry_command: &'a str,
}

impl<'a> SupervisedRuntimeContext<'a> {
    fn effect_context(self) -> SupervisorEffectContext<'a> {
        supervisor_effect_context(
            self.state,
            self.supervisor,
            self.launch_id,
            Some(self.runtime_pid),
            self.command_line,
        )
    }
}

struct SupervisedRuntimeStartupCheck<'a> {
    state: &'a GatewayRuntimeState,
    launch_id: &'a str,
    runtime_pid: u32,
    supervisor_id: &'a str,
    command_line: &'a str,
    retry_command: &'a str,
}

enum StartupWatchReadiness {
    Ready(u32),
    Pending { stream_established: bool },
    StreamError(Box<ConnectError>),
    Terminal(types::RuntimePhase),
}

enum SupervisedRuntimeStartupOutcome {
    Ready,
    ExitedBeforeReady { error: CliError },
}

async fn wait_for_supervised_runtime_ready(
    context: SupervisedRuntimeContext<'_>,
    child: &mut Child,
    machine: &mut SupervisorMachine,
) -> Result<SupervisedRuntimeStartupOutcome, CliError> {
    let supervisor_id = context.supervisor.supervisor_id.as_deref().ok_or_else(|| {
        CliError::internal(context.command_line.to_owned(), "supervisor omitted id")
    })?;
    let check = SupervisedRuntimeStartupCheck {
        state: context.state,
        launch_id: context.launch_id,
        runtime_pid: context.runtime_pid,
        supervisor_id,
        command_line: context.command_line,
        retry_command: context.retry_command,
    };
    let startup_deadline = Instant::now()
        + Duration::from_millis(
            GATEWAY_START_POLL_ATTEMPTS as u64 * GATEWAY_START_POLL_INTERVAL_MS,
        );
    let poll_interval = Duration::from_millis(GATEWAY_START_POLL_INTERVAL_MS);
    let mut control_stream_established = false;
    let mut control_socket_observed = false;
    let mut last_watch_error = None;

    while Instant::now() < startup_deadline {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| supervised_runtime_monitor_error(&check, error))?
        {
            let exit_kind = supervisor_child_exit_kind(machine, status);
            dispatch_supervisor_event(
                machine,
                SupervisorEvent::ChildExited {
                    runtime_pid: context.runtime_pid,
                    exit_kind,
                    exit_code: status.code(),
                    signal: exit_signal_label(status),
                    message: describe_exit_status(status),
                },
                context.effect_context(),
                None,
            )
            .await?;
            return Ok(SupervisedRuntimeStartupOutcome::ExitedBeforeReady {
                error: supervised_runtime_exited_during_startup_error(&check, status),
            });
        }

        let poll_deadline = Instant::now()
            + poll_interval.min(startup_deadline.saturating_duration_since(Instant::now()));
        match poll_runtime_control_startup_readiness(&check, poll_deadline).await {
            Ok(StartupWatchReadiness::Ready(ready_pid)) => {
                ensure_startup_ready_pid_matches(&check, ready_pid)?;
                dispatch_supervisor_event(
                    machine,
                    SupervisorEvent::WatchReady,
                    context.effect_context(),
                    None,
                )
                .await?;
                return Ok(SupervisedRuntimeStartupOutcome::Ready);
            }
            Ok(StartupWatchReadiness::Pending { stream_established }) => {
                control_stream_established |= stream_established;
            }
            Ok(StartupWatchReadiness::StreamError(error)) => {
                control_stream_established = true;
                if !runtime_control_error_allows_fallback(error.as_ref()) {
                    return Err(runtime_control_startup_watch_error(&check, error.as_ref()));
                }
                last_watch_error = Some(*error);
            }
            Ok(StartupWatchReadiness::Terminal(phase)) => {
                let message = format!(
                    "runtime control WatchStatus reported terminal phase {}",
                    runtime_control_phase_label(phase)
                );
                dispatch_supervisor_event(
                    machine,
                    SupervisorEvent::StartupDeadlineElapsed { message },
                    context.effect_context(),
                    None,
                )
                .await?;
                return Err(runtime_control_terminal_startup_error(&check, phase));
            }
            Err(error) => {
                if !runtime_control_error_allows_fallback(&error) {
                    return Err(runtime_control_startup_watch_error(&check, &error));
                }
                last_watch_error = Some(error);
            }
        }

        if control_stream_established && !control_socket_observed {
            dispatch_supervisor_event(
                machine,
                SupervisorEvent::ControlSocketObserved,
                context.effect_context(),
                None,
            )
            .await?;
            control_socket_observed = true;
        }

        sleep(poll_interval.min(startup_deadline.saturating_duration_since(Instant::now()))).await;
    }

    let message = startup_timeout_detail(&check, last_watch_error.as_ref())?;
    dispatch_supervisor_event(
        machine,
        SupervisorEvent::StartupDeadlineElapsed {
            message: message.clone(),
        },
        context.effect_context(),
        None,
    )
    .await?;
    Err(startup_timeout_error(&check, message))
}

async fn monitor_supervised_runtime(
    context: SupervisedRuntimeContext<'_>,
    child: &mut Child,
    machine: SupervisorMachine,
) -> Result<SupervisedRuntimeExit, CliError> {
    let mut stop_signal = OsSupervisorStopSignal::new(context.command_line)?;

    monitor_supervised_runtime_with_stop_signal(context, child, machine, &mut stop_signal).await
}

async fn monitor_supervised_runtime_with_stop_signal<S: SupervisorStopSignalSource + ?Sized>(
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

async fn poll_runtime_control_startup_readiness(
    check: &SupervisedRuntimeStartupCheck<'_>,
    startup_deadline: Instant,
) -> Result<StartupWatchReadiness, ConnectError> {
    let mut stream = watch_runtime_control_status(
        &check.state.paths,
        check.launch_id,
        RuntimeControlCallHeaders::for_launch(check.launch_id)
            .with_supervisor_id(check.supervisor_id),
    )
    .await?;
    let mut latest_status = None;

    loop {
        let remaining = startup_deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Ok(StartupWatchReadiness::Pending {
                stream_established: true,
            });
        }

        let response = match timeout(remaining, stream.message()).await {
            Ok(Ok(Some(response))) => response.to_owned_message(),
            Ok(Ok(None)) => {
                if let Some(error) = stream.error() {
                    return Ok(StartupWatchReadiness::StreamError(Box::new(error.clone())));
                }

                return Ok(StartupWatchReadiness::Pending {
                    stream_established: true,
                });
            }
            Ok(Err(error)) => return Ok(StartupWatchReadiness::StreamError(Box::new(error))),
            Err(_) => {
                return Ok(StartupWatchReadiness::Pending {
                    stream_established: true,
                });
            }
        };

        match runtime_control_watch_event_from_proto(response) {
            Some(RuntimeControlStatusWatchEvent::Snapshot(status)) => {
                if status.phase == types::RuntimePhase::RUNTIME_PHASE_READY {
                    return runtime_ready_pid_from_status(status).map(StartupWatchReadiness::Ready);
                }
                if runtime_control_phase_is_terminal(status.phase) {
                    return Ok(StartupWatchReadiness::Terminal(status.phase));
                }
                latest_status = Some(status);
            }
            Some(RuntimeControlStatusWatchEvent::Transition { phase, .. }) => {
                if phase == types::RuntimePhase::RUNTIME_PHASE_READY {
                    let Some(status) = latest_status else {
                        return Err(ConnectError::internal(
                            "runtime control WatchStatus reported READY before an identity snapshot",
                        ));
                    };

                    return runtime_ready_pid_from_status(status).map(StartupWatchReadiness::Ready);
                }
                if runtime_control_phase_is_terminal(phase) {
                    return Ok(StartupWatchReadiness::Terminal(phase));
                }
            }
            None => {}
        }
    }
}

fn runtime_ready_pid_from_status(status: RuntimeControlStatus) -> Result<u32, ConnectError> {
    status.pid.ok_or_else(|| {
        ConnectError::internal("runtime control WatchStatus READY event omitted runtime pid")
    })
}

fn ensure_startup_ready_pid_matches(
    check: &SupervisedRuntimeStartupCheck<'_>,
    ready_pid: u32,
) -> Result<(), CliError> {
    if ready_pid == check.runtime_pid {
        return Ok(());
    }

    Err(CliError::new(
        "self-host server reported mismatched runtime pid",
        check.command_line,
        ErrorStage::Internal,
        format!(
            "startup readiness for launch {} reported pid {ready_pid}, but supervisor spawned pid {}",
            check.launch_id, check.runtime_pid
        ),
        vec![
            format!(
                "check log file {}",
                check.state.paths.server_log_path.display()
            ),
            retry_command_hint(check.retry_command),
        ],
    ))
}

fn supervised_runtime_monitor_error(
    check: &SupervisedRuntimeStartupCheck<'_>,
    error: std::io::Error,
) -> CliError {
    CliError::new(
        "failed while monitoring supervised gateway startup",
        check.command_line,
        ErrorStage::Internal,
        error.to_string(),
        vec![
            format!(
                "check log file {}",
                check.state.paths.server_log_path.display()
            ),
            retry_command_hint(check.retry_command),
        ],
    )
}

fn supervised_runtime_exited_during_startup_error(
    check: &SupervisedRuntimeStartupCheck<'_>,
    status: ExitStatus,
) -> CliError {
    CliError::new(
        "self-host server exited before startup completed",
        check.command_line,
        ErrorStage::Internal,
        describe_exit_status(status),
        vec![
            format!(
                "check log file {}",
                check.state.paths.server_log_path.display()
            ),
            retry_command_hint(check.retry_command),
        ],
    )
}

fn runtime_control_terminal_startup_error(
    check: &SupervisedRuntimeStartupCheck<'_>,
    phase: types::RuntimePhase,
) -> CliError {
    CliError::new(
        "self-host server did not report startup",
        check.command_line,
        ErrorStage::Internal,
        format!(
            "runtime control WatchStatus reported terminal phase {} for launch {} in {}",
            runtime_control_phase_label(phase),
            check.launch_id,
            check.state.paths.data_dir.display()
        ),
        vec![
            format!(
                "check log file {}",
                check.state.paths.server_log_path.display()
            ),
            retry_command_hint(check.retry_command),
        ],
    )
}

fn runtime_control_startup_watch_error(
    check: &SupervisedRuntimeStartupCheck<'_>,
    error: &ConnectError,
) -> CliError {
    let detail = runtime_control_connect_error_summary(error).map_or_else(
        || {
            format!(
                "runtime control WatchStatus failed for launch {} in {}: {error}",
                check.launch_id,
                check.state.paths.data_dir.display()
            )
        },
        |summary| {
            format!(
                "runtime control WatchStatus failed for launch {} in {}: {summary}",
                check.launch_id,
                check.state.paths.data_dir.display()
            )
        },
    );

    let cli_error = CliError::new(
        "self-host server did not report startup",
        check.command_line,
        ErrorStage::Internal,
        detail,
        vec![
            format!(
                "check log file {}",
                check.state.paths.server_log_path.display()
            ),
            retry_command_hint(check.retry_command),
        ],
    );

    with_runtime_control_connect_error_metadata(error, cli_error, None)
}

fn startup_timeout_detail(
    check: &SupervisedRuntimeStartupCheck<'_>,
    last_watch_error: Option<&ConnectError>,
) -> Result<String, CliError> {
    if let Some(error) = last_watch_error {
        let last_error =
            runtime_control_connect_error_summary(error).unwrap_or_else(|| error.to_string());

        return Ok(format!(
            "runtime control WatchStatus did not report READY for launch {} in {} (last error: {last_error})",
            check.launch_id,
            check.state.paths.data_dir.display()
        ));
    }

    let probe_host = runtime_probe_host(startup_listen_host(check)?);
    let runtime_status_snapshot =
        read_runtime_status_snapshot_for_recovery(&check.state.paths, check.command_line)?;

    if runtime_status_snapshot.as_ref().is_some_and(|snapshot| {
        let Some(status) = snapshot.status.as_option() else {
            return false;
        };
        let Some(identity) = status.identity.as_option() else {
            return false;
        };
        let Some(phase) = status.phase.and_then(|phase| phase.as_known()) else {
            return false;
        };

        phase == types::RuntimePhase::RUNTIME_PHASE_READY
            && runtime_launch_id_matches(identity.launch_id.as_deref(), check.launch_id)
            && identity
                .data_dir
                .as_deref()
                .is_some_and(|data_dir| Path::new(data_dir) == check.state.paths.data_dir.as_path())
    }) {
        let phase = runtime_status_snapshot
            .as_ref()
            .and_then(runtime_status_snapshot_pid_and_phase)
            .map(|(_pid, phase)| runtime_phase_label(phase))
            .unwrap_or("unknown");
        let runtime_pid = runtime_status_snapshot
            .as_ref()
            .and_then(runtime_status_snapshot_pid_and_phase)
            .map(|(pid, _phase)| pid)
            .unwrap_or(0);

        return Ok(format!(
            "runtime control WatchStatus did not report READY for launch {} in {}; durable snapshot reported pid {} as {phase} for listener {probe_host}:{}",
            check.launch_id,
            check.state.paths.data_dir.display(),
            runtime_pid,
            startup_listen_port(check)?,
        ));
    }

    Ok(format!(
        "runtime control WatchStatus did not report READY for launch {} in {}",
        check.launch_id,
        check.state.paths.data_dir.display()
    ))
}

fn startup_timeout_error(check: &SupervisedRuntimeStartupCheck<'_>, detail: String) -> CliError {
    CliError::new(
        "self-host server did not report startup",
        check.command_line,
        ErrorStage::Internal,
        detail,
        vec![
            format!(
                "check log file {}",
                check.state.paths.server_log_path.display()
            ),
            retry_command_hint(check.retry_command),
        ],
    )
}

fn startup_listen_host<'a>(
    check: &'a SupervisedRuntimeStartupCheck<'_>,
) -> Result<&'a str, CliError> {
    let config = check.state.config.as_ref().ok_or_else(|| {
        CliError::internal(
            check.command_line.to_owned(),
            "gateway supervisor startup handshake requires a resolved self-host config",
        )
    })?;

    Ok(config.server.listen_host.as_str())
}

fn startup_listen_port(check: &SupervisedRuntimeStartupCheck<'_>) -> Result<u16, CliError> {
    let config = check.state.config.as_ref().ok_or_else(|| {
        CliError::internal(
            check.command_line.to_owned(),
            "gateway supervisor startup handshake requires a resolved self-host config",
        )
    })?;

    Ok(config.server.port)
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

fn supervisor_child_exit_kind(
    machine: &SupervisorMachine,
    status: ExitStatus,
) -> SupervisorChildExitKind {
    if status.success()
        || is_expected_termination(status)
        || machine.state() == SupervisorMachineState::Escalating
    {
        SupervisorChildExitKind::Expected
    } else {
        SupervisorChildExitKind::Unexpected
    }
}

fn monitored_runtime_exit_kind(exit_kind: SupervisorChildExitKind) -> MonitoredRuntimeExitKind {
    match exit_kind {
        SupervisorChildExitKind::Expected => MonitoredRuntimeExitKind::Expected,
        SupervisorChildExitKind::Unexpected => MonitoredRuntimeExitKind::Unexpected,
    }
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

trait SupervisorStopSignalSource {
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

fn read_supervised_launch_id(
    path: &std::path::Path,
    command_line: &str,
) -> Result<String, CliError> {
    let contents = std::fs::read_to_string(path).map_err(|error| {
        CliError::new(
            "failed to read self-host launch config for supervisor status",
            command_line,
            ErrorStage::Internal,
            format!("{error} ({})", path.display()),
            vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
        )
    })?;
    let value = serde_json::from_str::<serde_json::Value>(&contents).map_err(|error| {
        CliError::new(
            "failed to parse self-host launch config for supervisor status",
            command_line,
            ErrorStage::Internal,
            format!("{error} ({})", path.display()),
            vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
        )
    })?;

    value
        .get("launchId")
        .and_then(serde_json::Value::as_str)
        .filter(|launch_id| !launch_id.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| {
            CliError::new(
                "self-host launch config omitted launch id for supervisor status",
                command_line,
                ErrorStage::Internal,
                format!("{}", path.display()),
                vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
            )
        })
}

pub(super) fn supervisor_id_for_pid(supervisor_pid: u32) -> String {
    format!("gateway-supervisor:{supervisor_pid}")
}

fn supervisor_identity(supervisor_pid: u32) -> types::SupervisorIdentity {
    types::SupervisorIdentity {
        supervisor_id: Some(supervisor_id_for_pid(supervisor_pid)),
        pid: Some(supervisor_pid),
        // Comment: durable supervisor generation allocation is still fixed;
        // the reducer owns transitions, not generation persistence yet.
        generation: Some(SUPERVISOR_GENERATION),
        ..Default::default()
    }
}

#[cfg(all(test, unix))]
mod tests {
    use std::ffi::OsString;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;

    use pretty_assertions::assert_eq;
    use serde_json::json;
    use tempfile::TempDir;
    use tempfile::tempdir;

    use super::super::lifecycle_records;
    use super::*;
    use crate::self_host::SelfHostConfig;
    use crate::self_host::SelfHostRuntimePaths;

    const COMMAND_LINE: &str = "onequery gateway start";
    const LAUNCH_ID: &str = "launch-supervisor-escalation";
    const RETRY_COMMAND: &str = "onequery gateway start";

    #[tokio::test]
    async fn stop_monitor_exits_from_stop_requested_when_runtime_honors_graceful_stop() {
        let result = run_stop_escalation_fixture(&["exit-on-graceful-stop"]).await;

        assert_eq!(result.exit_kind, SupervisorChildExitKind::Expected);
        assert_eq!(
            result.child_exit_previous_phase(),
            Some(types::SupervisorPhase::SUPERVISOR_PHASE_STOP_REQUESTED)
        );
        assert_eq!(
            result.final_supervisor_phase,
            types::SupervisorPhase::SUPERVISOR_PHASE_EXITED
        );
        assert!(
            !result.has_phase(types::SupervisorPhase::SUPERVISOR_PHASE_TERMINATING),
            "graceful runtime exit should not require platform termination"
        );
    }

    #[tokio::test]
    async fn stop_monitor_terminates_runtime_that_ignores_graceful_stop() {
        let result =
            run_stop_escalation_fixture(&["ignore-graceful-stop", "exit-on-sigterm"]).await;

        assert_eq!(result.exit_kind, SupervisorChildExitKind::Expected);
        assert_eq!(
            result.child_exit_previous_phase(),
            Some(types::SupervisorPhase::SUPERVISOR_PHASE_TERMINATING)
        );
        assert_eq!(
            result.final_supervisor_phase,
            types::SupervisorPhase::SUPERVISOR_PHASE_EXITED
        );
        assert!(result.has_phase(types::SupervisorPhase::SUPERVISOR_PHASE_TERMINATING));
        assert!(
            !result.has_phase(types::SupervisorPhase::SUPERVISOR_PHASE_ESCALATING),
            "runtime exited during platform termination before hard-kill escalation"
        );
    }

    #[tokio::test]
    async fn stop_monitor_hard_kills_runtime_that_ignores_graceful_stop_and_sigterm() {
        let result = run_stop_escalation_fixture(&["ignore-graceful-stop", "ignore-sigterm"]).await;

        assert_eq!(result.exit_kind, SupervisorChildExitKind::Expected);
        assert_eq!(
            result.child_exit_previous_phase(),
            Some(types::SupervisorPhase::SUPERVISOR_PHASE_ESCALATING)
        );
        assert_eq!(
            result.final_supervisor_phase,
            types::SupervisorPhase::SUPERVISOR_PHASE_EXITED
        );
        assert_eq!(result.signal.as_deref(), Some("SIGKILL"));
        assert!(result.has_phase(types::SupervisorPhase::SUPERVISOR_PHASE_TERMINATING));
        assert!(result.has_phase(types::SupervisorPhase::SUPERVISOR_PHASE_ESCALATING));
    }

    #[tokio::test]
    async fn foreground_and_background_launch_modes_share_startup_handshake() {
        let foreground = run_launch_mode_parity_fixture(LaunchParityMode::Foreground).await;
        let background = run_launch_mode_parity_fixture(LaunchParityMode::Background).await;

        assert_eq!(foreground.transitions, background.transitions);
        assert_eq!(
            foreground.transitions,
            vec![
                SupervisorTransitionRecord {
                    current_phase: types::SupervisorPhase::SUPERVISOR_PHASE_STARTING,
                    event: "launch_requested".to_owned(),
                    previous_phase: types::SupervisorPhase::SUPERVISOR_PHASE_STARTING,
                },
                SupervisorTransitionRecord {
                    current_phase: types::SupervisorPhase::SUPERVISOR_PHASE_HANDSHAKING,
                    event: "child_spawned".to_owned(),
                    previous_phase: types::SupervisorPhase::SUPERVISOR_PHASE_STARTING,
                },
                SupervisorTransitionRecord {
                    current_phase: types::SupervisorPhase::SUPERVISOR_PHASE_HANDSHAKING,
                    event: "control_socket_observed".to_owned(),
                    previous_phase: types::SupervisorPhase::SUPERVISOR_PHASE_HANDSHAKING,
                },
                SupervisorTransitionRecord {
                    current_phase: types::SupervisorPhase::SUPERVISOR_PHASE_READY,
                    event: "watch_ready".to_owned(),
                    previous_phase: types::SupervisorPhase::SUPERVISOR_PHASE_HANDSHAKING,
                },
                SupervisorTransitionRecord {
                    current_phase: types::SupervisorPhase::SUPERVISOR_PHASE_EXITED,
                    event: "child_exited".to_owned(),
                    previous_phase: types::SupervisorPhase::SUPERVISOR_PHASE_READY,
                },
            ]
        );
        assert!(
            !foreground.log_file_present,
            "foreground launch should inherit stdio without creating background log capture"
        );
        assert!(
            background.log_file_present,
            "background launch should capture runtime stdio in the gateway log"
        );
    }

    #[derive(Debug, Clone, Copy)]
    enum LaunchParityMode {
        Foreground,
        Background,
    }

    struct LaunchParityResult {
        log_file_present: bool,
        transitions: Vec<SupervisorTransitionRecord>,
    }

    async fn run_launch_mode_parity_fixture(mode: LaunchParityMode) -> LaunchParityResult {
        let fixture = SupervisorFixture::new_with_test_launch_options(
            &["exit-after-ready"],
            Some(500),
            Some(150),
        );
        let state = fixture.state();
        let runtime_entry = supervisor_fixture_runtime_path();

        match mode {
            LaunchParityMode::Foreground => {
                let runtime_command = OsString::from("bun");
                let exit = run_foreground_supervised_runtime(
                    &state,
                    LAUNCH_ID,
                    runtime_command.as_os_str(),
                    runtime_entry.as_path(),
                    fixture.launch_config_path.as_path(),
                    COMMAND_LINE,
                    RETRY_COMMAND,
                )
                .await
                .unwrap_or_else(|error| {
                    panic!("expected foreground supervisor parity run: {error}")
                });

                assert_eq!(exit.kind, MonitoredRuntimeExitKind::Expected);
            }
            LaunchParityMode::Background => {
                let output = run_gateway_supervisor(
                    &state,
                    &crate::GatewaySupervisorArgs {
                        runtime_command: OsString::from("bun"),
                        runtime_entry,
                        launch_config: fixture.launch_config_path.clone(),
                        crash_loop_max_restarts: 0,
                        crash_loop_initial_backoff_ms: 1,
                        crash_loop_max_backoff_ms: 1,
                    },
                    COMMAND_LINE,
                )
                .await
                .unwrap_or_else(|error| {
                    panic!("expected background supervisor parity run: {error}")
                });

                assert_eq!(
                    output
                        .data
                        .get("status")
                        .and_then(serde_json::Value::as_str),
                    Some("stopped")
                );
            }
        }

        LaunchParityResult {
            log_file_present: fixture.paths.server_log_path.is_file(),
            transitions: supervisor_transitions(&fixture.paths),
        }
    }

    async fn run_stop_escalation_fixture(modes: &[&str]) -> StopEscalationResult {
        let fixture = SupervisorFixture::new();
        let state = fixture.state();
        let supervisor = supervisor_identity(std::process::id());
        let mut machine = SupervisorMachine::new();

        dispatch_supervisor_event(
            &mut machine,
            SupervisorEvent::LaunchRequested,
            supervisor_effect_context(&state, &supervisor, LAUNCH_ID, None, COMMAND_LINE),
            None,
        )
        .await
        .unwrap_or_else(|error| panic!("expected launch request dispatch: {error}"));

        let mut child = spawn_supervisor_fixture_runtime(&fixture, modes);
        let runtime_pid = child.id();

        dispatch_supervisor_event(
            &mut machine,
            SupervisorEvent::ChildSpawned { runtime_pid },
            supervisor_effect_context(
                &state,
                &supervisor,
                LAUNCH_ID,
                Some(runtime_pid),
                COMMAND_LINE,
            ),
            None,
        )
        .await
        .unwrap_or_else(|error| panic!("expected child spawned dispatch: {error}"));

        let runtime_context = SupervisedRuntimeContext {
            state: &state,
            supervisor: &supervisor,
            launch_id: LAUNCH_ID,
            runtime_pid,
            command_line: COMMAND_LINE,
            retry_command: RETRY_COMMAND,
        };

        match wait_for_supervised_runtime_ready(runtime_context, &mut child, &mut machine)
            .await
            .unwrap_or_else(|error| panic!("expected runtime fixture readiness: {error}"))
        {
            SupervisedRuntimeStartupOutcome::Ready => {}
            SupervisedRuntimeStartupOutcome::ExitedBeforeReady { error } => {
                panic!("runtime fixture exited before ready: {error}");
            }
        }

        let mut stop_signal = ImmediateStopSignal::default();
        let exit = monitor_supervised_runtime_with_stop_signal(
            runtime_context,
            &mut child,
            machine,
            &mut stop_signal,
        )
        .await
        .unwrap_or_else(|error| panic!("expected supervised runtime stop: {error}"));
        let transitions = supervisor_transitions(&fixture.paths);
        let final_supervisor_phase = supervisor_snapshot_phase(&fixture.paths);

        StopEscalationResult {
            exit_kind: exit.exit_kind,
            final_supervisor_phase,
            signal: exit_signal_label(exit.status),
            transitions,
        }
    }

    fn supervisor_fixture_runtime_path() -> PathBuf {
        onequery_utils::repo_root()
            .unwrap_or_else(|error| panic!("expected repo root from onequery-utils: {error}"))
            .join("apps")
            .join("cli")
            .join("crates")
            .join("gateway")
            .join("tests")
            .join("fixtures")
            .join("supervisor-escalation-runtime.ts")
    }

    fn spawn_supervisor_fixture_runtime(fixture: &SupervisorFixture, modes: &[&str]) -> Child {
        let repo_root = onequery_utils::repo_root()
            .unwrap_or_else(|error| panic!("expected repo root from onequery-utils: {error}"));
        let fixture_path = supervisor_fixture_runtime_path();
        let supervisor_pid = std::process::id();
        let mut command = ProcessCommand::new("bun");
        command
            .arg(fixture_path)
            .arg(&fixture.launch_config_path)
            .arg(supervisor_pid.to_string())
            .arg(supervisor_id_for_pid(supervisor_pid))
            .arg("1")
            .args(modes)
            .current_dir(repo_root)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        command
            .spawn()
            .unwrap_or_else(|error| panic!("expected supervisor runtime fixture spawn: {error}"))
    }

    #[derive(Default)]
    struct ImmediateStopSignal {
        delivered: bool,
    }

    impl SupervisorStopSignalSource for ImmediateStopSignal {
        fn recv(&mut self) -> Pin<Box<dyn Future<Output = ()> + '_>> {
            if self.delivered {
                return Box::pin(std::future::pending());
            }

            self.delivered = true;
            Box::pin(std::future::ready(()))
        }
    }

    struct SupervisorFixture {
        _temp_dir: TempDir,
        launch_config_path: PathBuf,
        paths: SelfHostRuntimePaths,
        socket_parent: PathBuf,
    }

    impl SupervisorFixture {
        fn new() -> Self {
            Self::new_with_test_launch_options(&[], None, None)
        }

        fn new_with_test_launch_options(
            test_modes: &[&str],
            test_ready_delay_ms: Option<u64>,
            test_exit_after_ready_delay_ms: Option<u64>,
        ) -> Self {
            let temp_dir =
                tempdir().unwrap_or_else(|error| panic!("expected supervisor temp dir: {error}"));
            let paths = SelfHostRuntimePaths::from_dirs(
                temp_dir.path().join("config").join("self-host"),
                temp_dir.path().join("data"),
            );
            fs::create_dir_all(&paths.run_dir)
                .unwrap_or_else(|error| panic!("expected run dir creation: {error}"));
            fs::create_dir_all(&paths.logs_dir)
                .unwrap_or_else(|error| panic!("expected logs dir creation: {error}"));

            let socket_parent = paths
                .runtime_control_socket_path
                .parent()
                .unwrap_or_else(|| panic!("expected runtime control socket parent"))
                .to_path_buf();
            fs::create_dir_all(&socket_parent)
                .unwrap_or_else(|error| panic!("expected socket parent creation: {error}"));
            let mut permissions = fs::metadata(&socket_parent)
                .unwrap_or_else(|error| panic!("expected socket parent metadata: {error}"))
                .permissions();
            permissions.set_mode(0o700);
            fs::set_permissions(&socket_parent, permissions)
                .unwrap_or_else(|error| panic!("expected private socket parent: {error}"));

            let launch_config_path = temp_dir.path().join("launch.json");
            let mut launch_config = json!({
                "launchId": LAUNCH_ID,
                "runtimeControl": {
                    "transport": {
                        "kind": "unix",
                        "socketPath": paths.runtime_control_socket_path.display().to_string(),
                    },
                },
                "runtimePaths": {
                    "backupsDir": paths.backups_dir.display().to_string(),
                    "dataDir": paths.data_dir.display().to_string(),
                    "lifecycleEventLogPath": paths.lifecycle_event_log_path.display().to_string(),
                    "logsDir": paths.logs_dir.display().to_string(),
                    "runDir": paths.run_dir.display().to_string(),
                    "runtimeLeasePath": paths.runtime_lease_path.display().to_string(),
                    "runtimeStatusSnapshotPath": paths.runtime_status_snapshot_path.display().to_string(),
                },
            });
            if !test_modes.is_empty() {
                launch_config["testModes"] = json!(test_modes);
            }
            if let Some(delay_ms) = test_ready_delay_ms {
                launch_config["testReadyDelayMs"] = json!(delay_ms);
            }
            if let Some(delay_ms) = test_exit_after_ready_delay_ms {
                launch_config["testExitAfterReadyDelayMs"] = json!(delay_ms);
            }
            fs::write(
                &launch_config_path,
                serde_json::to_string_pretty(&launch_config).unwrap_or_else(|error| {
                    panic!("expected launch config serialization: {error}")
                }),
            )
            .unwrap_or_else(|error| panic!("expected launch config write: {error}"));

            Self {
                _temp_dir: temp_dir,
                launch_config_path,
                paths,
                socket_parent,
            }
        }

        fn state(&self) -> GatewayRuntimeState {
            GatewayRuntimeState {
                paths: self.paths.clone(),
                bootstrapped: true,
                config_created: false,
                secrets_created: false,
                config: Some(SelfHostConfig::default()),
                pglite_dir_present: false,
                log_file_present: false,
                runtime_lease_present: false,
                runtime_status_snapshot_present: false,
            }
        }
    }

    impl Drop for SupervisorFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.socket_parent);
        }
    }

    struct StopEscalationResult {
        exit_kind: SupervisorChildExitKind,
        final_supervisor_phase: types::SupervisorPhase,
        signal: Option<String>,
        transitions: Vec<SupervisorTransitionRecord>,
    }

    impl StopEscalationResult {
        fn child_exit_previous_phase(&self) -> Option<types::SupervisorPhase> {
            self.transitions
                .iter()
                .find(|transition| transition.event == "child_exited")
                .map(|transition| transition.previous_phase)
        }

        fn has_phase(&self, phase: types::SupervisorPhase) -> bool {
            self.transitions
                .iter()
                .any(|transition| transition.current_phase == phase)
        }
    }

    #[derive(Debug, Clone, Eq, PartialEq)]
    struct SupervisorTransitionRecord {
        current_phase: types::SupervisorPhase,
        event: String,
        previous_phase: types::SupervisorPhase,
    }

    fn supervisor_transitions(paths: &SelfHostRuntimePaths) -> Vec<SupervisorTransitionRecord> {
        lifecycle_records::decode_lifecycle_event_log_entries(
            &fs::read(&paths.lifecycle_event_log_path)
                .unwrap_or_else(|error| panic!("expected lifecycle event log read: {error}")),
        )
        .unwrap_or_else(|error| panic!("expected lifecycle event log decode: {error}"))
        .into_iter()
        .filter_map(|entry| {
            let transition = match entry.payload.as_ref()? {
                types::lifecycle_event_log_entry::Payload::SupervisorTransition(transition) => {
                    transition
                }
                _ => return None,
            };
            Some(SupervisorTransitionRecord {
                current_phase: transition
                    .current_phase
                    .and_then(|phase| phase.as_known())
                    .unwrap_or(types::SupervisorPhase::SUPERVISOR_PHASE_UNSPECIFIED),
                event: entry
                    .transition_id
                    .as_deref()
                    .and_then(|transition_id| transition_id.rsplit(':').next())
                    .unwrap_or("unknown")
                    .to_owned(),
                previous_phase: transition
                    .previous_phase
                    .and_then(|phase| phase.as_known())
                    .unwrap_or(types::SupervisorPhase::SUPERVISOR_PHASE_UNSPECIFIED),
            })
        })
        .collect()
    }

    fn supervisor_snapshot_phase(paths: &SelfHostRuntimePaths) -> types::SupervisorPhase {
        let snapshot = lifecycle_records::decode_supervisor_status_snapshot(
            &fs::read_to_string(&paths.supervisor_status_snapshot_path)
                .unwrap_or_else(|error| panic!("expected supervisor snapshot read: {error}")),
        )
        .unwrap_or_else(|error| panic!("expected supervisor snapshot decode: {error}"));
        snapshot
            .status
            .as_option()
            .and_then(|status| status.phase)
            .and_then(|phase| phase.as_known())
            .unwrap_or(types::SupervisorPhase::SUPERVISOR_PHASE_UNSPECIFIED)
    }
}
