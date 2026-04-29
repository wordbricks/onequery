use std::fs;
use std::path::Path;
use std::time::Duration;

use connectrpc::ConnectError;
use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;
use onequery_core::process::is_process_running;
use serde_json::json;
use tokio::time::Instant;
use tokio::time::sleep;
use tokio::time::timeout;

use crate::GatewayCommandOutput;
use crate::runtime_control::types;
use crate::self_host::SelfHostRuntimePaths;

use super::super::CHECK_SERVER_LOG_AND_RETRY_GATEWAY_STOP;
use super::super::GATEWAY_STOP_POLL_ATTEMPTS;
use super::super::GATEWAY_STOP_POLL_INTERVAL_MS;
use super::super::RETRY_GATEWAY_STOP_COMMAND;
use super::super::render::paths_json;
use super::super::render::runtime_state_json;
use super::super::state::GatewayRuntimeState;
use super::super::state::GatewayStateAccessMode;
use super::super::state::resolve_runtime_state;
use super::control::RuntimeControlCallHeaders;
use super::control::RuntimeControlStatusWatchEvent;
use super::control::runtime_control_phase_label;
use super::control::runtime_control_watch_event_from_proto;
use super::control::watch_runtime_control_status_after;
use super::control_error::runtime_control_connect_error_summary;
use super::control_error::with_runtime_control_connect_error_metadata;
use super::lifecycle::ManagedRuntimeIdentity;
use super::lifecycle::ManagedSupervisorIdentity;
use super::lifecycle::read_active_supervisor_identity_for_runtime;
use super::lifecycle::read_managed_runtime_identity;

const RUNTIME_CONTROL_STOP_GRACE_TIMEOUT: Duration = Duration::from_secs(30);

pub(crate) async fn stop_runtime(
    state: &GatewayRuntimeState,
    command_line: &str,
) -> Result<GatewayCommandOutput, CliError> {
    let running_identity = read_managed_runtime_identity(&state.paths, command_line)?;

    if let Some(identity) = running_identity {
        let pid = identity.pid;
        let supervisor =
            read_active_supervisor_identity_for_runtime(&state.paths, &identity, command_line)?
                .ok_or_else(|| supervisor_identity_error(&identity, command_line))?;
        submit_supervisor_stop_intent(&identity, &supervisor, command_line)?;
        wait_for_supervised_runtime_stop(&state.paths, &identity, &supervisor, command_line)
            .await?;
        let refreshed_state =
            resolve_runtime_state(command_line, GatewayStateAccessMode::ReadOnly)?;
        return Ok(GatewayCommandOutput::structured(
            vec![
                "Gateway stop completed.".to_owned(),
                format!("Stopped pid: {pid}"),
                format!(
                    "Log path: {}",
                    refreshed_state.paths.server_log_path.display()
                ),
            ],
            json!({
                "kind": "gateway-stop",
                "phase": "managed",
                "bootstrapped": refreshed_state.bootstrapped,
                "stopIssued": true,
                "stoppedPid": pid,
                "runtimeState": runtime_state_json(&refreshed_state),
                "paths": paths_json(&refreshed_state.paths),
            }),
        ));
    }

    remove_if_exists(state.paths.runtime_status_snapshot_path.as_path());
    remove_if_exists(state.paths.runtime_lease_path.as_path());
    let refreshed_state = resolve_runtime_state(command_line, GatewayStateAccessMode::ReadOnly)?;
    Ok(GatewayCommandOutput::structured(
        vec![
            "Gateway stop found no running process.".to_owned(),
            format!(
                "Log path: {}",
                refreshed_state.paths.server_log_path.display()
            ),
        ],
        json!({
            "kind": "gateway-stop",
            "phase": "managed",
            "bootstrapped": refreshed_state.bootstrapped,
            "stopIssued": false,
            "runtimeState": runtime_state_json(&refreshed_state),
            "paths": paths_json(&refreshed_state.paths),
        }),
    ))
}

fn submit_supervisor_stop_intent(
    identity: &ManagedRuntimeIdentity,
    supervisor: &ManagedSupervisorIdentity,
    command_line: &str,
) -> Result<(), CliError> {
    if supervisor.pid == identity.pid {
        return Err(CliError::new(
            "failed to stop self-host runtime",
            command_line,
            ErrorStage::Internal,
            format!(
                "runtime pid {} is not supervised by a separate lifecycle owner",
                identity.pid
            ),
            vec![CHECK_SERVER_LOG_AND_RETRY_GATEWAY_STOP.to_owned()],
        ));
    }

    #[cfg(unix)]
    {
        let result = unsafe { libc::kill(supervisor.pid as i32, libc::SIGTERM) };
        if result == 0 {
            return Ok(());
        }

        Err(CliError::new(
            "failed to submit gateway supervisor stop intent",
            command_line,
            ErrorStage::Internal,
            format!(
                "unable to send stop intent to supervisor pid {} for runtime pid {}",
                supervisor.pid, identity.pid
            ),
            vec![CHECK_SERVER_LOG_AND_RETRY_GATEWAY_STOP.to_owned()],
        ))
    }

    #[cfg(not(unix))]
    {
        let _ = supervisor;

        Err(CliError::new(
            "failed to submit gateway supervisor stop intent",
            command_line,
            ErrorStage::Internal,
            "supervisor stop intent signaling is unavailable on this platform".to_owned(),
            vec![CHECK_SERVER_LOG_AND_RETRY_GATEWAY_STOP.to_owned()],
        ))
    }
}

fn supervisor_identity_error(identity: &ManagedRuntimeIdentity, command_line: &str) -> CliError {
    CliError::new(
        "failed to stop self-host runtime",
        command_line,
        ErrorStage::Internal,
        format!(
            "runtime pid {} launch {} does not have a matching live supervisor status snapshot (supervisor pid {} generation {})",
            identity.pid,
            identity.launch_id,
            identity.supervisor_pid,
            identity.supervisor_generation
        ),
        vec![CHECK_SERVER_LOG_AND_RETRY_GATEWAY_STOP.to_owned()],
    )
}

async fn wait_for_supervised_runtime_stop(
    paths: &SelfHostRuntimePaths,
    identity: &super::lifecycle::ManagedRuntimeIdentity,
    supervisor: &ManagedSupervisorIdentity,
    command_line: &str,
) -> Result<(), CliError> {
    let stop_deadline = runtime_stop_deadline();
    let (mut stream, mut last_watch_error) = match watch_runtime_control_status_after(
        paths,
        &identity.launch_id,
        0,
        true,
        RuntimeControlCallHeaders::for_launch(&identity.launch_id)
            .with_supervisor_id(&supervisor.supervisor_id),
    )
    .await
    {
        Ok(stream) => (Some(stream), None),
        Err(error) => (None, Some(error)),
    };

    loop {
        if runtime_process_has_exited_and_released_records(paths, identity.pid) {
            return Ok(());
        }

        let remaining = stop_deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(runtime_control_stop_timeout_error(
                identity.pid,
                command_line,
                last_watch_error.as_ref(),
            ));
        }

        let wait_interval = remaining.min(runtime_stop_poll_interval());
        let Some(active_stream) = stream.as_mut() else {
            sleep(wait_interval).await;
            continue;
        };

        let stream_message = timeout(wait_interval, active_stream.message()).await;
        match stream_message {
            Ok(Ok(Some(response))) => {
                let response = response.to_owned_message();
                if let Some(event) = runtime_control_watch_event_from_proto(response) {
                    match runtime_control_stop_watch_event_outcome(event) {
                        RuntimeControlStopPhaseOutcome::Stopped => {}
                        RuntimeControlStopPhaseOutcome::Failed(phase) => {
                            return Err(runtime_control_stop_terminal_error(phase, command_line));
                        }
                        RuntimeControlStopPhaseOutcome::Pending => {}
                    }
                }
            }
            Ok(Ok(None)) => {
                last_watch_error = stream
                    .as_ref()
                    .and_then(|closed_stream| closed_stream.error())
                    .cloned();
                stream = None;
            }
            Ok(Err(error)) => {
                last_watch_error = Some(error);
                stream = None;
            }
            Err(_) => {}
        }
    }
}

fn runtime_process_has_exited_and_released_records(paths: &SelfHostRuntimePaths, pid: u32) -> bool {
    !is_process_running(pid)
        && !paths.runtime_status_snapshot_path.exists()
        && !paths.runtime_lease_path.exists()
}

fn runtime_control_stop_timeout_error(
    pid: u32,
    command_line: &str,
    last_watch_error: Option<&ConnectError>,
) -> CliError {
    let detail = last_watch_error.map_or_else(
        || {
            format!(
                "supervisor stop intent did not produce runtime exit and durable record cleanup for pid {pid}"
            )
        },
        |error| {
            let last_error = runtime_control_connect_error_summary(error)
                .unwrap_or_else(|| error.to_string());

            format!(
                "supervisor stop intent did not produce runtime exit and durable record cleanup for pid {pid} (last error: {last_error})"
            )
        },
    );

    let cli_error = CliError::new(
        "self-host runtime did not stop cleanly",
        command_line,
        ErrorStage::Internal,
        detail,
        vec![CHECK_SERVER_LOG_AND_RETRY_GATEWAY_STOP.to_owned()],
    );

    if let Some(error) = last_watch_error {
        with_runtime_control_connect_error_metadata(error, cli_error, None)
    } else {
        cli_error
    }
}

fn runtime_control_stop_terminal_error(phase: types::RuntimePhase, command_line: &str) -> CliError {
    CliError::new(
        "self-host runtime did not stop cleanly",
        command_line,
        ErrorStage::Internal,
        format!(
            "runtime control WatchStatus reported terminal phase {}",
            runtime_control_phase_label(phase)
        ),
        vec![CHECK_SERVER_LOG_AND_RETRY_GATEWAY_STOP.to_owned()],
    )
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum RuntimeControlStopPhaseOutcome {
    Pending,
    Stopped,
    Failed(types::RuntimePhase),
}

fn runtime_control_stop_phase_outcome(
    phase: types::RuntimePhase,
) -> RuntimeControlStopPhaseOutcome {
    match phase {
        types::RuntimePhase::RUNTIME_PHASE_STOPPED => RuntimeControlStopPhaseOutcome::Stopped,
        types::RuntimePhase::RUNTIME_PHASE_SHUTDOWN_FAILED
        | types::RuntimePhase::RUNTIME_PHASE_FAILED => {
            RuntimeControlStopPhaseOutcome::Failed(phase)
        }
        _ => RuntimeControlStopPhaseOutcome::Pending,
    }
}

fn runtime_control_stop_watch_event_outcome(
    event: RuntimeControlStatusWatchEvent,
) -> RuntimeControlStopPhaseOutcome {
    match event {
        RuntimeControlStatusWatchEvent::Snapshot(status) => {
            runtime_control_stop_phase_outcome(status.phase)
        }
        RuntimeControlStatusWatchEvent::Transition { phase, .. } => {
            runtime_control_stop_phase_outcome(phase)
        }
    }
}

fn runtime_stop_deadline() -> Instant {
    Instant::now() + runtime_stop_timeout()
}

fn runtime_stop_timeout() -> Duration {
    RUNTIME_CONTROL_STOP_GRACE_TIMEOUT
        + runtime_stop_poll_interval() * GATEWAY_STOP_POLL_ATTEMPTS as u32
}

fn runtime_stop_poll_interval() -> Duration {
    Duration::from_millis(GATEWAY_STOP_POLL_INTERVAL_MS)
}

pub(super) fn terminate_process(pid: u32, command_line: &str) -> Result<(), CliError> {
    #[cfg(unix)]
    {
        let result = unsafe { libc::kill(pid as i32, libc::SIGTERM) };
        if result == 0 {
            return Ok(());
        }

        Err(CliError::new(
            "failed to stop self-host runtime",
            command_line,
            ErrorStage::Internal,
            format!("unable to send SIGTERM to pid {pid}"),
            vec![RETRY_GATEWAY_STOP_COMMAND.to_owned()],
        ))
    }

    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::OpenProcess;
        use windows_sys::Win32::System::Threading::PROCESS_TERMINATE;
        use windows_sys::Win32::System::Threading::TerminateProcess;

        let handle = unsafe { OpenProcess(PROCESS_TERMINATE, 0, pid) };
        if handle.is_null() {
            return Err(CliError::new(
                "failed to stop self-host runtime",
                command_line,
                ErrorStage::Internal,
                format!("unable to open pid {pid} for termination"),
                vec![RETRY_GATEWAY_STOP_COMMAND.to_owned()],
            ));
        }

        // CONTEXT: Windows release builds do not yet expose a graceful
        // cross-process shutdown channel, so `gateway stop` terminates the
        // helper process and then clears lifecycle markers once it exits.
        let result = unsafe { TerminateProcess(handle, 1) };
        let _ = unsafe { CloseHandle(handle) };

        if result != 0 {
            return Ok(());
        }

        Err(CliError::new(
            "failed to stop self-host runtime",
            command_line,
            ErrorStage::Internal,
            format!("unable to terminate pid {pid}"),
            vec![RETRY_GATEWAY_STOP_COMMAND.to_owned()],
        ))
    }

    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
        Err(CliError::new(
            "gateway stop is not supported on this platform",
            command_line,
            ErrorStage::Internal,
            "process signaling is unavailable".to_owned(),
            vec!["stop the runtime manually".to_owned()],
        ))
    }
}

pub(super) fn hard_kill_process(pid: u32, command_line: &str) -> Result<(), CliError> {
    #[cfg(unix)]
    {
        let result = unsafe { libc::kill(pid as i32, libc::SIGKILL) };
        if result == 0 {
            return Ok(());
        }

        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            return Ok(());
        }

        Err(CliError::new(
            "failed to hard-kill self-host runtime",
            command_line,
            ErrorStage::Internal,
            format!("unable to send SIGKILL to pid {pid}: {error}"),
            vec![RETRY_GATEWAY_STOP_COMMAND.to_owned()],
        ))
    }

    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::OpenProcess;
        use windows_sys::Win32::System::Threading::PROCESS_TERMINATE;
        use windows_sys::Win32::System::Threading::TerminateProcess;

        let handle = unsafe { OpenProcess(PROCESS_TERMINATE, 0, pid) };
        if handle.is_null() {
            return Err(CliError::new(
                "failed to hard-kill self-host runtime",
                command_line,
                ErrorStage::Internal,
                format!("unable to open pid {pid} for hard kill"),
                vec![RETRY_GATEWAY_STOP_COMMAND.to_owned()],
            ));
        }

        let result = unsafe { TerminateProcess(handle, 1) };
        let _ = unsafe { CloseHandle(handle) };

        if result != 0 {
            return Ok(());
        }

        Err(CliError::new(
            "failed to hard-kill self-host runtime",
            command_line,
            ErrorStage::Internal,
            format!("unable to hard-kill pid {pid}"),
            vec![RETRY_GATEWAY_STOP_COMMAND.to_owned()],
        ))
    }

    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
        Err(CliError::new(
            "gateway stop is not supported on this platform",
            command_line,
            ErrorStage::Internal,
            "process hard kill is unavailable".to_owned(),
            vec!["stop the runtime manually".to_owned()],
        ))
    }
}

pub(super) fn remove_if_exists(path: &Path) {
    let _ = fs::remove_file(path);
}
