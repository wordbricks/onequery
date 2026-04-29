use std::path::Path;
use std::process::Child;
use std::process::ExitStatus;
use std::time::Duration;

use connectrpc::ConnectError;
use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;
use tokio::time::Instant;
use tokio::time::sleep;
use tokio::time::timeout;

use crate::runtime_control::types;
use crate::runtime_probe_host;

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
use super::lifecycle::runtime_phase_label;
use super::status::describe_exit_status;
use super::status::exit_signal_label;
use super::supervisor::SupervisedRuntimeContext;
use super::supervisor::supervisor_child_exit_kind;
use super::supervisor_effects::dispatch_supervisor_event;
use super::supervisor_machine::SupervisorEvent;
use super::supervisor_machine::SupervisorMachine;
use super::transport::retry_command_hint;

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
    Pending,
    StreamError(Box<ConnectError>),
    Terminal(types::RuntimePhase),
}

pub(super) enum SupervisedRuntimeStartupOutcome {
    Ready,
    ExitedBeforeReady { error: CliError },
}

pub(super) async fn wait_for_supervised_runtime_ready(
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
        let control_stream_observed =
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
                Ok(StartupWatchReadiness::Pending) => true,
                Ok(StartupWatchReadiness::StreamError(error)) => {
                    if !runtime_control_error_allows_fallback(error.as_ref()) {
                        return Err(runtime_control_startup_watch_error(&check, error.as_ref()));
                    }
                    last_watch_error = Some(*error);
                    true
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
                    false
                }
            };

        if control_stream_observed && !control_socket_observed {
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
            return Ok(StartupWatchReadiness::Pending);
        }

        let response = match timeout(remaining, stream.message()).await {
            Ok(Ok(Some(response))) => response.to_owned_message(),
            Ok(Ok(None)) => {
                if let Some(error) = stream.error() {
                    return Ok(StartupWatchReadiness::StreamError(Box::new(error.clone())));
                }

                return Ok(StartupWatchReadiness::Pending);
            }
            Ok(Err(error)) => return Ok(StartupWatchReadiness::StreamError(Box::new(error))),
            Err(_) => {
                return Ok(StartupWatchReadiness::Pending);
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

    if let Some(snapshot) = runtime_status_snapshot
        .as_ref()
        .and_then(|snapshot| startup_ready_snapshot_detail(check, snapshot))
    {
        let phase = runtime_phase_label(snapshot.phase);
        let listen_port = startup_listen_port(check)?;

        return Ok(format!(
            "runtime control WatchStatus did not report READY for launch {} in {}; durable snapshot reported pid {} as {phase} for listener {probe_host}:{}",
            check.launch_id,
            check.state.paths.data_dir.display(),
            snapshot.pid,
            listen_port,
        ));
    }

    Ok(format!(
        "runtime control WatchStatus did not report READY for launch {} in {}",
        check.launch_id,
        check.state.paths.data_dir.display()
    ))
}

struct StartupReadySnapshotDetail {
    pid: u32,
    phase: types::RuntimePhase,
}

fn startup_ready_snapshot_detail(
    check: &SupervisedRuntimeStartupCheck<'_>,
    snapshot: &types::RuntimeStatusSnapshot,
) -> Option<StartupReadySnapshotDetail> {
    let status = snapshot.status.as_option()?;
    let identity = status.identity.as_option()?;
    let pid = identity.pid?;
    let phase = status.phase.and_then(|phase| phase.as_known())?;

    (phase == types::RuntimePhase::RUNTIME_PHASE_READY
        && identity.launch_id.as_deref() == Some(check.launch_id)
        && identity
            .data_dir
            .as_deref()
            .is_some_and(|data_dir| Path::new(data_dir) == check.state.paths.data_dir.as_path()))
    .then_some(StartupReadySnapshotDetail { pid, phase })
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
