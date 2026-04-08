use std::ffi::OsString;
use std::fs;
use std::path::Path;
use std::process::Command as ProcessCommand;
use std::process::ExitStatus;
use std::process::Stdio;

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use serde_json::json;

use crate::config::self_host::write_self_host_launch_config;
use crate::output::CommandOutput;

use super::super::is_process_running;
use super::CHECK_SERVER_LOG_AND_RETRY_GATEWAY_STOP;
use super::GATEWAY_LOG_PREVIEW_LINE_COUNT;
use super::GATEWAY_STOP_POLL_ATTEMPTS;
use super::GATEWAY_STOP_POLL_INTERVAL_MS;
use super::INSTALL_NODE_AND_RETRY_GATEWAY_COMMAND;
use super::PACKAGED_SERVER_JS_RUNTIME_ENV_VAR;
use super::REINSTALL_CLI_PACKAGE_COMMAND;
use super::RETRY_GATEWAY_COMMAND;
use super::RETRY_GATEWAY_STOP_COMMAND;
use super::launch::resolve_launch_plan;
use super::render::paths_json;
use super::render::runtime_state_json;
use super::state::GatewayRuntimeState;
use super::state::GatewayStateAccessMode;
use super::state::resolve_runtime_state;

const MINIMUM_NODE_MAJOR_VERSION: u32 = 22;

#[derive(Debug, Clone, Eq, PartialEq)]
pub(super) struct LogPreview {
    pub(super) lines: Vec<String>,
    pub(super) truncated: bool,
}

pub(super) fn read_log_preview(path: &Path, command_line: &str) -> Result<LogPreview, CliError> {
    if !path.is_file() {
        return Ok(LogPreview {
            lines: Vec::new(),
            truncated: false,
        });
    }

    let contents = fs::read_to_string(path).map_err(|read_error| {
        CliError::new(
            "failed to read gateway log",
            command_line,
            ErrorStage::LoadConfig,
            format!("{read_error} ({})", path.display()),
            vec![format!("check log file {}", path.display())],
        )
    })?;

    let all_lines = contents.lines().map(ToOwned::to_owned).collect::<Vec<_>>();
    let keep_from = all_lines
        .len()
        .saturating_sub(GATEWAY_LOG_PREVIEW_LINE_COUNT);

    Ok(LogPreview {
        truncated: keep_from > 0,
        lines: all_lines.into_iter().skip(keep_from).collect(),
    })
}

pub(super) fn run_gateway_foreground(
    state: &GatewayRuntimeState,
    command_line: &str,
) -> Result<CommandOutput, CliError> {
    let mut launch_plan = resolve_launch_plan(state, command_line)?;
    let runtime_command = resolve_runtime_command();
    ensure_runtime_command_support(
        &runtime_command,
        launch_plan.runtime_entry_path.as_path(),
        command_line,
    )?;
    launch_plan.launch_config_path = write_self_host_launch_config(
        command_line,
        &launch_plan.web_dist_dir,
        &launch_plan.migrations_dir,
    )?;
    remove_if_exists(state.paths.stop_request_path.as_path());
    let mut child = ProcessCommand::new(&runtime_command);
    child.arg(&launch_plan.runtime_entry_path);
    child.arg(&launch_plan.launch_config_path);
    child
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    let mut child = child.spawn().map_err(|spawn_error| {
        let (why, try_next) = match spawn_error.kind() {
            std::io::ErrorKind::NotFound => (
                format!(
                    "JavaScript runtime executable was not found at {} while launching {}",
                    Path::new(&runtime_command).display(),
                    launch_plan.runtime_entry_path.display()
                ),
                vec![
                    INSTALL_NODE_AND_RETRY_GATEWAY_COMMAND.to_owned(),
                    REINSTALL_CLI_PACKAGE_COMMAND.to_owned(),
                ],
            ),
            _ => (
                spawn_error.to_string(),
                vec![RETRY_GATEWAY_COMMAND.to_owned()],
            ),
        };
        CliError::new(
            "failed to launch self-host server",
            command_line,
            ErrorStage::Internal,
            why,
            try_next,
        )
    })?;
    let child_pid = child.id();

    let status = child.wait().map_err(|wait_error| {
        CliError::new(
            "failed while waiting for self-host server",
            command_line,
            ErrorStage::Internal,
            wait_error.to_string(),
            vec![RETRY_GATEWAY_COMMAND.to_owned()],
        )
    })?;
    let stop_requested = stop_request_matches(state.paths.stop_request_path.as_path(), child_pid);
    remove_if_exists(state.paths.stop_request_path.as_path());

    if status.success() || is_expected_termination(status) || stop_requested {
        return Ok(CommandOutput::structured(
            Vec::new(),
            json!({
                "kind": "gateway",
                "status": "stopped",
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
            format!("{RETRY_GATEWAY_COMMAND} after fixing the startup issue"),
        ],
    ))
}

fn resolve_runtime_command() -> OsString {
    std::env::var_os(PACKAGED_SERVER_JS_RUNTIME_ENV_VAR)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| OsString::from("node"))
}

fn ensure_runtime_command_support(
    runtime_command: &OsString,
    runtime_entry_path: &Path,
    command_line: &str,
) -> Result<(), CliError> {
    let version_output = ProcessCommand::new(runtime_command)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|probe_error| {
            let (why, try_next) = match probe_error.kind() {
                std::io::ErrorKind::NotFound => (
                    format!(
                        "JavaScript runtime executable was not found at {} while launching {}",
                        Path::new(runtime_command).display(),
                        runtime_entry_path.display()
                    ),
                    vec![
                        INSTALL_NODE_AND_RETRY_GATEWAY_COMMAND.to_owned(),
                        REINSTALL_CLI_PACKAGE_COMMAND.to_owned(),
                    ],
                ),
                _ => (
                    format!(
                        "failed to run {} --version: {probe_error}",
                        Path::new(runtime_command).display()
                    ),
                    vec![INSTALL_NODE_AND_RETRY_GATEWAY_COMMAND.to_owned()],
                ),
            };

            CliError::new(
                "failed to validate self-host server runtime",
                command_line,
                ErrorStage::Internal,
                why,
                try_next,
            )
        })?;

    if !version_output.status.success() {
        let stderr = String::from_utf8_lossy(&version_output.stderr);
        let detail = stderr.trim();

        return Err(CliError::new(
            "failed to validate self-host server runtime",
            command_line,
            ErrorStage::Internal,
            if detail.is_empty() {
                format!(
                    "{} --version exited with {}",
                    Path::new(runtime_command).display(),
                    describe_exit_status(version_output.status)
                )
            } else {
                format!(
                    "{} --version failed: {detail}",
                    Path::new(runtime_command).display()
                )
            },
            vec![INSTALL_NODE_AND_RETRY_GATEWAY_COMMAND.to_owned()],
        ));
    }

    validate_runtime_version_output(
        &String::from_utf8_lossy(&version_output.stdout),
        runtime_command,
        command_line,
    )
}

pub(super) fn validate_runtime_version_output(
    version_output: &str,
    runtime_command: &OsString,
    command_line: &str,
) -> Result<(), CliError> {
    let Some(major_version) = parse_runtime_major_version(version_output) else {
        return Err(CliError::new(
            "failed to validate self-host server runtime",
            command_line,
            ErrorStage::Internal,
            format!(
                "unable to parse {} --version output: {}",
                Path::new(runtime_command).display(),
                version_output.trim()
            ),
            vec![INSTALL_NODE_AND_RETRY_GATEWAY_COMMAND.to_owned()],
        ));
    };

    if major_version < MINIMUM_NODE_MAJOR_VERSION {
        return Err(CliError::new(
            "unsupported self-host server runtime",
            command_line,
            ErrorStage::Internal,
            format!(
                "{} reports major version {major_version}, but packaged onequery gateway requires Node.js {MINIMUM_NODE_MAJOR_VERSION}+",
                Path::new(runtime_command).display()
            ),
            vec![INSTALL_NODE_AND_RETRY_GATEWAY_COMMAND.to_owned()],
        ));
    }

    Ok(())
}

pub(super) fn parse_runtime_major_version(version_output: &str) -> Option<u32> {
    let trimmed = version_output.trim();
    let trimmed = trimmed.strip_prefix('v').unwrap_or(trimmed);
    let major = trimmed.split('.').next()?;

    if major.is_empty() {
        return None;
    }

    major.parse::<u32>().ok()
}

fn describe_exit_status(status: ExitStatus) -> String {
    if let Some(code) = status.code() {
        return format!("self-host server exited with code {code}");
    }

    format!(
        "self-host server exited due to signal {}",
        exit_signal_label(status).unwrap_or_else(|| "unknown".to_owned())
    )
}

fn is_expected_termination(status: ExitStatus) -> bool {
    matches!(
        exit_signal_label(status).as_deref(),
        Some("SIGINT" | "SIGTERM")
    )
}

pub(super) fn stop_runtime(
    state: &GatewayRuntimeState,
    command_line: &str,
) -> Result<CommandOutput, CliError> {
    let pid = read_runtime_pid(state.paths.pid_path.as_path(), command_line)?;
    let running_pid = pid.filter(|pid| is_process_running(*pid));

    if let Some(pid) = running_pid {
        mark_stop_requested(state.paths.stop_request_path.as_path(), pid, command_line)?;
        if let Err(error) = terminate_process(pid, command_line) {
            remove_if_exists(state.paths.stop_request_path.as_path());
            return Err(error);
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
        let refreshed_state =
            resolve_runtime_state(command_line, GatewayStateAccessMode::ReadOnly)?;
        return Ok(CommandOutput::structured(
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
    Ok(CommandOutput::structured(
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

pub(super) fn read_runtime_pid(path: &Path, command_line: &str) -> Result<Option<u32>, CliError> {
    let Ok(contents) = fs::read_to_string(path) else {
        return Ok(None);
    };

    let trimmed = contents.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    trimmed.parse::<u32>().map(Some).map_err(|error| {
        CliError::new(
            "failed to parse runtime pid file",
            command_line,
            ErrorStage::LoadConfig,
            format!("{error} ({})", path.display()),
            vec!["remove the stale pid file and retry".to_owned()],
        )
    })
}

fn terminate_process(pid: u32, command_line: &str) -> Result<(), CliError> {
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

        // Comment: Windows release builds do not yet expose a graceful
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

fn remove_if_exists(path: &Path) {
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

fn exit_signal_label(status: ExitStatus) -> Option<String> {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;

        let signal = status.signal()?;
        let label = match signal {
            2 => "SIGINT",
            15 => "SIGTERM",
            _ => return Some(signal.to_string()),
        };
        Some(label.to_owned())
    }

    #[cfg(not(unix))]
    {
        let _ = status;
        None
    }
}
