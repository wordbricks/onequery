use std::fs;
use std::path::Path;
use std::time::Duration;

use buffa::EnumValue;
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
use super::control::runtime_control_error_allows_fallback;
use super::control::runtime_phase_label;
use super::control_error::runtime_control_connect_error_summary;
use super::control_error::with_runtime_control_connect_error_metadata;
use super::lifecycle::ManagedRuntimeIdentity;
use super::lifecycle::ManagedSupervisorIdentity;
use super::lifecycle::read_active_supervisor_identity_for_runtime;
use super::lifecycle::read_managed_runtime_identity;
use super::supervisor_control::client::get_supervisor_status;
use super::supervisor_control::client::supervisor_control_client;

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
        submit_supervisor_stop_intent(&state.paths, &identity, &supervisor, command_line).await?;
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

async fn submit_supervisor_stop_intent(
    paths: &SelfHostRuntimePaths,
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

    match submit_supervisor_stop_rpc(paths, identity, supervisor).await {
        Ok(()) => Ok(()),
        Err(error) if runtime_control_error_allows_fallback(&error) => {
            submit_supervisor_stop_signal(identity, supervisor, command_line)
        }
        Err(error) => Err(supervisor_stop_rpc_error(
            &error,
            identity,
            supervisor,
            command_line,
        )),
    }
}

fn submit_supervisor_stop_signal(
    identity: &ManagedRuntimeIdentity,
    supervisor: &ManagedSupervisorIdentity,
    command_line: &str,
) -> Result<(), CliError> {
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

async fn submit_supervisor_stop_rpc(
    paths: &SelfHostRuntimePaths,
    identity: &ManagedRuntimeIdentity,
    supervisor: &ManagedSupervisorIdentity,
) -> Result<(), ConnectError> {
    let client = supervisor_control_client(paths).await?;
    client
        .stop(types::SupervisorLifecycleServiceStopRequest {
            command: buffa::MessageField::some(types::SupervisorStopCommand {
                operation_id: Some(uuid::Uuid::new_v4().to_string()),
                reason: Some("onequery gateway stop".to_owned()),
                completion: Some(
                    types::RuntimeStopCompletion::RUNTIME_STOP_COMPLETION_CLEANUP_AND_EXIT.into(),
                ),
                grace_timeout: buffa::MessageField::some(protobuf_duration(
                    RUNTIME_CONTROL_STOP_GRACE_TIMEOUT,
                )),
                target: buffa::MessageField::some(supervisor_stop_target(
                    paths, identity, supervisor,
                )),
                ..Default::default()
            }),
            ..Default::default()
        })
        .await?;

    Ok(())
}

pub(super) fn supervisor_stop_target(
    paths: &SelfHostRuntimePaths,
    identity: &ManagedRuntimeIdentity,
    supervisor: &ManagedSupervisorIdentity,
) -> types::SupervisorStopTarget {
    types::SupervisorStopTarget {
        launch_id: Some(identity.launch_id.clone()),
        data_dir: Some(paths.data_dir.display().to_string()),
        runtime_pid: Some(identity.pid),
        supervisor: buffa::MessageField::some(types::SupervisorIdentity {
            supervisor_id: Some(supervisor.supervisor_id.clone()),
            pid: Some(supervisor.pid),
            generation: Some(supervisor.generation),
            ..Default::default()
        }),
        ..Default::default()
    }
}

fn supervisor_stop_rpc_error(
    error: &ConnectError,
    identity: &ManagedRuntimeIdentity,
    supervisor: &ManagedSupervisorIdentity,
    command_line: &str,
) -> CliError {
    let detail = runtime_control_connect_error_summary(error).unwrap_or_else(|| {
        format!(
            "supervisor control RPC returned {} while stopping runtime pid {} through supervisor pid {}: {error}",
            error.code.as_str(),
            identity.pid,
            supervisor.pid
        )
    });
    let cli_error = CliError::new(
        "failed to submit gateway supervisor stop intent",
        command_line,
        ErrorStage::Internal,
        detail,
        vec![CHECK_SERVER_LOG_AND_RETRY_GATEWAY_STOP.to_owned()],
    );

    with_runtime_control_connect_error_metadata(error, cli_error, None)
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
    let mut last_status_error = None;

    loop {
        if runtime_process_has_exited_and_released_records(paths, identity.pid) {
            return Ok(());
        }

        let remaining = stop_deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(runtime_control_stop_timeout_error(
                identity.pid,
                command_line,
                last_status_error.as_ref(),
            ));
        }

        let wait_interval = remaining.min(runtime_stop_poll_interval());
        let status_result = timeout(
            wait_interval,
            get_supervisor_status(paths, supervisor_stop_target(paths, identity, supervisor)),
        )
        .await;

        match status_result {
            Ok(Ok(status)) => match runtime_control_stop_phase_outcome(runtime_phase_from_proto(
                status.runtime_phase,
            )) {
                RuntimeControlStopPhaseOutcome::Stopped => {}
                RuntimeControlStopPhaseOutcome::Failed(phase) => {
                    return Err(runtime_control_stop_terminal_error(phase, command_line));
                }
                RuntimeControlStopPhaseOutcome::Pending => {}
            },
            Ok(Err(error)) => {
                last_status_error = Some(error);
            }
            Err(_) => {}
        }

        sleep(wait_interval).await;
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
            "supervisor control GetStatus reported terminal runtime phase {}",
            runtime_phase_label(phase)
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

fn runtime_phase_from_proto(value: Option<EnumValue<types::RuntimePhase>>) -> types::RuntimePhase {
    value
        .and_then(|value| value.as_known())
        .unwrap_or(types::RuntimePhase::RUNTIME_PHASE_UNSPECIFIED)
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

fn protobuf_duration(value: Duration) -> buffa_types::google::protobuf::Duration {
    buffa_types::google::protobuf::Duration {
        seconds: value.as_secs().min(i64::MAX as u64) as i64,
        nanos: value.subsec_nanos() as i32,
        ..Default::default()
    }
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
