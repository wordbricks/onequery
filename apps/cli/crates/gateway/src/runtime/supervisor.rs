use std::ffi::OsStr;
use std::path::Path;
use std::process::Child;
use std::process::Command as ProcessCommand;
use std::process::ExitStatus;
use std::process::Stdio;
use std::time::Duration;

use connectrpc::ConnectError;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
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

        let startup_outcome = wait_for_supervised_runtime_ready(
            state,
            &supervisor,
            launch.launch_id,
            runtime_pid,
            &mut child,
            &mut machine,
            command_line,
            launch.retry_command,
        )
        .await?;

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

        let mut exit = monitor_supervised_runtime(
            state,
            &supervisor,
            launch.launch_id,
            runtime_pid,
            &mut child,
            command_line,
            launch.retry_command,
            machine,
        )
        .await?;

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
    state: &GatewayRuntimeState,
    supervisor: &types::SupervisorIdentity,
    launch_id: &str,
    runtime_pid: u32,
    child: &mut Child,
    machine: &mut SupervisorMachine,
    command_line: &str,
    retry_command: &str,
) -> Result<SupervisedRuntimeStartupOutcome, CliError> {
    let supervisor_id = supervisor
        .supervisor_id
        .as_deref()
        .ok_or_else(|| CliError::internal(command_line.to_owned(), "supervisor omitted id"))?;
    let check = SupervisedRuntimeStartupCheck {
        state,
        launch_id,
        runtime_pid,
        supervisor_id,
        command_line,
        retry_command,
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
                    runtime_pid,
                    exit_kind,
                    exit_code: status.code(),
                    signal: exit_signal_label(status),
                    message: describe_exit_status(status),
                },
                supervisor_effect_context(
                    state,
                    supervisor,
                    launch_id,
                    Some(runtime_pid),
                    command_line,
                ),
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
                    supervisor_effect_context(
                        state,
                        supervisor,
                        launch_id,
                        Some(runtime_pid),
                        command_line,
                    ),
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
                    supervisor_effect_context(
                        state,
                        supervisor,
                        launch_id,
                        Some(runtime_pid),
                        command_line,
                    ),
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
                supervisor_effect_context(
                    state,
                    supervisor,
                    launch_id,
                    Some(runtime_pid),
                    command_line,
                ),
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
        supervisor_effect_context(
            state,
            supervisor,
            launch_id,
            Some(runtime_pid),
            command_line,
        ),
        None,
    )
    .await?;
    Err(startup_timeout_error(&check, message))
}

async fn monitor_supervised_runtime(
    state: &GatewayRuntimeState,
    supervisor: &types::SupervisorIdentity,
    launch_id: &str,
    runtime_pid: u32,
    child: &mut Child,
    command_line: &str,
    retry_command: &str,
    mut machine: SupervisorMachine,
) -> Result<SupervisedRuntimeExit, CliError> {
    let mut stop_signal = SupervisorStopSignal::new(command_line)?;
    let mut timers = SupervisorTimers::default();

    loop {
        if let Some(status) = child.try_wait().map_err(|error| {
            CliError::new(
                "failed while monitoring supervised gateway",
                command_line,
                ErrorStage::Internal,
                error.to_string(),
                vec![retry_command_hint(retry_command)],
            )
        })? {
            let exit_kind = supervisor_child_exit_kind(&machine, status);
            dispatch_supervisor_event(
                &mut machine,
                SupervisorEvent::ChildExited {
                    runtime_pid,
                    exit_kind,
                    exit_code: status.code(),
                    signal: exit_signal_label(status),
                    message: describe_exit_status(status),
                },
                supervisor_effect_context(
                    state,
                    supervisor,
                    launch_id,
                    Some(runtime_pid),
                    command_line,
                ),
                Some(&mut timers),
            )
            .await?;
            return Ok(SupervisedRuntimeExit {
                runtime_pid,
                status,
                exit_kind,
                machine,
            });
        }

        if timers.kill_deadline_elapsed() {
            let message = format!("pid {runtime_pid} remained active after supervisor hard kill");
            dispatch_supervisor_event(
                &mut machine,
                SupervisorEvent::EscalationDeadlineElapsed {
                    message: message.clone(),
                },
                supervisor_effect_context(
                    state,
                    supervisor,
                    launch_id,
                    Some(runtime_pid),
                    command_line,
                ),
                Some(&mut timers),
            )
            .await?;
            return Err(supervisor_termination_timeout_error(
                command_line,
                retry_command,
                message,
            ));
        }

        if timers.terminate_deadline_elapsed() {
            dispatch_supervisor_event(
                &mut machine,
                SupervisorEvent::TerminateDeadlineElapsed,
                supervisor_effect_context(
                    state,
                    supervisor,
                    launch_id,
                    Some(runtime_pid),
                    command_line,
                ),
                Some(&mut timers),
            )
            .await?;
        }

        if timers.stop_deadline_elapsed() {
            dispatch_supervisor_event(
                &mut machine,
                SupervisorEvent::GraceDeadlineElapsed,
                supervisor_effect_context(
                    state,
                    supervisor,
                    launch_id,
                    Some(runtime_pid),
                    command_line,
                ),
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
                    supervisor_effect_context(
                        state,
                        supervisor,
                        launch_id,
                        Some(runtime_pid),
                        command_line,
                    ),
                    Some(&mut timers),
                )
                .await?;

                match report.runtime_stop_result(command_line)? {
                    Ok(()) => {
                        dispatch_supervisor_event(
                            &mut machine,
                            SupervisorEvent::StopRpcAccepted {
                                operation_id: stop_operation_id.clone(),
                            },
                            supervisor_effect_context(
                                state,
                                supervisor,
                                launch_id,
                                Some(runtime_pid),
                                command_line,
                            ),
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
                            supervisor_effect_context(
                                state,
                                supervisor,
                                launch_id,
                                Some(runtime_pid),
                                command_line,
                            ),
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
                            supervisor_effect_context(
                                state,
                                supervisor,
                                launch_id,
                                Some(runtime_pid),
                                command_line,
                            ),
                            Some(&mut timers),
                        )
                        .await?;
                        return Err(runtime_control_stop_error(error, command_line, retry_command));
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

#[cfg(unix)]
struct SupervisorStopSignal {
    interrupt: tokio::signal::unix::Signal,
    terminate: tokio::signal::unix::Signal,
}

#[cfg(unix)]
impl SupervisorStopSignal {
    fn new(command_line: &str) -> Result<Self, CliError> {
        Ok(Self {
            interrupt: tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())
                .map_err(|error| supervisor_signal_error(error, command_line))?,
            terminate: tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .map_err(|error| supervisor_signal_error(error, command_line))?,
        })
    }

    async fn recv(&mut self) {
        tokio::select! {
            _ = self.interrupt.recv() => {}
            _ = self.terminate.recv() => {}
        }
    }
}

#[cfg(not(unix))]
struct SupervisorStopSignal;

#[cfg(not(unix))]
impl SupervisorStopSignal {
    fn new(_command_line: &str) -> Result<Self, CliError> {
        Ok(Self)
    }

    async fn recv(&mut self) {
        std::future::pending::<()>().await;
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
