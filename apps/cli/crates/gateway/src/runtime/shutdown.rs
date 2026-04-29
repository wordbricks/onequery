use std::fs;
use std::path::Path;
use std::time::Duration;

use connectrpc::ConnectError;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use onequery_cli_core::process::is_process_running;
use serde_json::json;

use crate::GatewayCommandOutput;

use super::super::CHECK_SERVER_LOG_AND_RETRY_GATEWAY_STOP;
use super::super::GATEWAY_STOP_POLL_ATTEMPTS;
use super::super::GATEWAY_STOP_POLL_INTERVAL_MS;
use super::super::RETRY_GATEWAY_STOP_COMMAND;
use super::super::render::paths_json;
use super::super::render::runtime_state_json;
use super::super::state::GatewayRuntimeState;
use super::super::state::GatewayStateAccessMode;
use super::super::state::resolve_runtime_state;
use super::lifecycle::read_managed_runtime_pid;
use super::request_runtime_control_stop;
use super::runtime_control_error_allows_fallback;

const RUNTIME_CONTROL_STOP_GRACE_TIMEOUT: Duration = Duration::from_secs(30);

pub(crate) async fn stop_runtime(
    state: &GatewayRuntimeState,
    command_line: &str,
) -> Result<GatewayCommandOutput, CliError> {
    let running_pid = read_managed_runtime_pid(&state.paths, command_line)?;

    if let Some(pid) = running_pid {
        let stop_requested = match request_runtime_control_stop(
            &state.paths,
            "onequery gateway stop",
            RUNTIME_CONTROL_STOP_GRACE_TIMEOUT,
        )
        .await
        {
            Ok(()) => true,
            Err(error) if runtime_control_error_allows_fallback(&error) => false,
            Err(error) => return Err(runtime_control_stop_error(error, command_line)),
        };

        if !stop_requested {
            mark_stop_requested(state.paths.stop_request_path.as_path(), pid, command_line)?;
            if let Err(error) = terminate_process(pid, command_line) {
                remove_if_exists(state.paths.stop_request_path.as_path());
                return Err(error);
            }
        }
        if let Err(error) = wait_for_runtime_stop(
            state.paths.pid_path.as_path(),
            state.paths.lock_path.as_path(),
            pid,
            command_line,
        ) {
            remove_if_exists(state.paths.stop_request_path.as_path());
            return Err(error);
        }
        remove_if_exists(state.paths.stop_request_path.as_path());
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

    remove_if_exists(state.paths.pid_path.as_path());
    remove_if_exists(state.paths.lock_path.as_path());
    remove_if_exists(state.paths.stop_request_path.as_path());
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

fn runtime_control_stop_error(error: ConnectError, command_line: &str) -> CliError {
    CliError::new(
        "failed to request self-host runtime stop",
        command_line,
        ErrorStage::Internal,
        format!(
            "runtime control RPC returned {}: {error}",
            error.code.as_str()
        ),
        vec![CHECK_SERVER_LOG_AND_RETRY_GATEWAY_STOP.to_owned()],
    )
    .with_code(Some(format!("runtime_control_{}", error.code.as_str())))
}

fn wait_for_runtime_stop(
    pid_path: &Path,
    lock_path: &Path,
    pid: u32,
    command_line: &str,
) -> Result<(), CliError> {
    for _ in 0..GATEWAY_STOP_POLL_ATTEMPTS {
        if !is_process_running(pid) {
            remove_if_exists(pid_path);
            remove_if_exists(lock_path);
        }

        if !is_process_running(pid) && !pid_path.exists() && !lock_path.exists() {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(
            GATEWAY_STOP_POLL_INTERVAL_MS,
        ));
    }

    Err(CliError::new(
        "self-host runtime did not stop cleanly",
        command_line,
        ErrorStage::Internal,
        format!("pid {pid} is still active"),
        vec![CHECK_SERVER_LOG_AND_RETRY_GATEWAY_STOP.to_owned()],
    ))
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

pub(super) fn remove_if_exists(path: &Path) {
    let _ = fs::remove_file(path);
}

pub(super) fn mark_stop_requested(
    path: &Path,
    pid: u32,
    command_line: &str,
) -> Result<(), CliError> {
    fs::write(path, format!("{pid}\n")).map_err(|error| {
        CliError::new(
            "failed to prepare self-host stop request",
            command_line,
            ErrorStage::Internal,
            format!("{error} ({})", path.display()),
            vec![RETRY_GATEWAY_STOP_COMMAND.to_owned()],
        )
    })
}

pub(super) fn stop_request_matches(path: &Path, pid: u32) -> bool {
    let Ok(contents) = fs::read_to_string(path) else {
        return false;
    };

    contents.trim().parse::<u32>().ok() == Some(pid)
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::mark_stop_requested;
    use super::stop_request_matches;

    #[test]
    fn mark_stop_requested_records_pid_for_managed_shutdown() {
        let temp_dir =
            tempdir().unwrap_or_else(|error| panic!("expected stop-request temp dir: {error}"));
        let stop_request_path = temp_dir.path().join("server.stop");

        mark_stop_requested(stop_request_path.as_path(), 4321, "onequery gateway stop")
            .unwrap_or_else(|error| panic!("expected stop request write to succeed: {error}"));

        assert!(stop_request_matches(stop_request_path.as_path(), 4321));
    }
}
