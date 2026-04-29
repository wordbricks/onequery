use std::path::Path;
use std::process::Child;
use std::process::ExitStatus;
use std::time::Duration;

use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;
use tokio::time::Instant;
use tokio::time::timeout;

use crate::runtime_control::types;
use crate::runtime_probe_host;

use super::super::GATEWAY_START_POLL_ATTEMPTS;
use super::super::GATEWAY_START_POLL_INTERVAL_MS;
use super::super::state::GatewayRuntimeState;
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
    command_line: &'a str,
    retry_command: &'a str,
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
    let check = SupervisedRuntimeStartupCheck {
        state: context.state,
        launch_id: context.launch_id,
        runtime_pid: context.runtime_pid,
        command_line: context.command_line,
        retry_command: context.retry_command,
    };
    let startup_deadline = Instant::now()
        + Duration::from_millis(
            GATEWAY_START_POLL_ATTEMPTS as u64 * GATEWAY_START_POLL_INTERVAL_MS,
        );
    let poll_interval = Duration::from_millis(GATEWAY_START_POLL_INTERVAL_MS);
    dispatch_supervisor_event(
        machine,
        SupervisorEvent::ControlSocketObserved,
        context.effect_context(),
        None,
    )
    .await?;

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

        let remaining = startup_deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }

        if let Ok(ready_pid) = timeout(
            poll_interval.min(remaining),
            context.supervisor_control.wait_for_runtime_ready(),
        )
        .await
        {
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
    }

    let message = startup_timeout_detail(&check)?;
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

fn startup_timeout_detail(check: &SupervisedRuntimeStartupCheck<'_>) -> Result<String, CliError> {
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
            "supervisor runtime session did not report READY for launch {} in {}; durable snapshot reported pid {} as {phase} for listener {probe_host}:{}",
            check.launch_id,
            check.state.paths.data_dir.display(),
            snapshot.pid,
            listen_port,
        ));
    }

    Ok(format!(
        "supervisor runtime session did not report READY for launch {} in {}",
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
