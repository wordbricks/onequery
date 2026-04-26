use std::ffi::OsString;
use std::fs;
use std::fs::OpenOptions;
use std::path::Path;
use std::path::PathBuf;
use std::process::Child;
use std::process::Command as ProcessCommand;
use std::process::ExitStatus;
use std::process::Stdio;

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use serde::Deserialize;
use serde_json::json;

use crate::config::self_host::SelfHostRuntimePaths;
use crate::config::self_host::write_self_host_launch_config;
use crate::local_target::runtime_accepting_connections;
use crate::local_target::runtime_probe_host;
use crate::output::CommandOutput;
use crate::process_context::ProcessContext;

use super::super::is_process_running;
use super::CHECK_SERVER_LOG_AND_RETRY_GATEWAY_STOP;
use super::GATEWAY_LOG_PREVIEW_LINE_COUNT;
use super::GATEWAY_START_POLL_ATTEMPTS;
use super::GATEWAY_START_POLL_INTERVAL_MS;
use super::GATEWAY_STOP_POLL_ATTEMPTS;
use super::GATEWAY_STOP_POLL_INTERVAL_MS;
use super::PACKAGED_SERVER_JS_RUNTIME_ENV_VAR;
use super::REINSTALL_CLI_PACKAGE_COMMAND;
use super::RETRY_GATEWAY_STOP_COMMAND;
use super::launch::GatewayLaunchPlan;
use super::launch::resolve_launch_plan;
use super::render::paths_json;
use super::render::render_gateway_start_output;
use super::render::runtime_state_json;
use super::state::GatewayRuntimeState;
use super::state::GatewayStateAccessMode;
use super::state::resolve_runtime_state;

const MINIMUM_NODE_MAJOR_VERSION: u32 = 22;
const RUNTIME_STATE_FILENAME: &str = "server.state.json";

#[derive(Debug, Clone, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
struct RuntimeLockRecord {
    pid: u32,
    acquired_at: String,
    data_dir: String,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
struct RuntimeStateRecord {
    pid: u32,
    phase: RuntimeLifecyclePhase,
    updated_at: String,
    data_dir: String,
}

#[derive(Debug, Clone, Copy, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
enum RuntimeLifecyclePhase {
    Starting,
    Ready,
    Stopping,
}

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
    process: &ProcessContext,
    command_line: &str,
    retry_command: &str,
) -> Result<CommandOutput, CliError> {
    let (launch_plan, runtime_command) =
        prepare_runtime_launch(state, process, command_line, retry_command)?;
    let mut child = ProcessCommand::new(&runtime_command);
    child.arg(&launch_plan.runtime_entry_path);
    child.arg(&launch_plan.launch_config_path);
    child
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    let mut child = child.spawn().map_err(|spawn_error| {
        spawn_launch_error(
            &spawn_error,
            &runtime_command,
            launch_plan.runtime_entry_path.as_path(),
            command_line,
            retry_command,
        )
    })?;
    let child_pid = child.id();

    let status = child.wait().map_err(|wait_error| {
        CliError::new(
            "failed while waiting for self-host server",
            command_line,
            ErrorStage::Internal,
            wait_error.to_string(),
            vec![retry_command_hint(retry_command)],
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
            format!("retry {retry_command} after fixing the startup issue"),
        ],
    ))
}

pub(super) fn run_gateway_background(
    state: &GatewayRuntimeState,
    process: &ProcessContext,
    command_line: &str,
    retry_command: &str,
) -> Result<CommandOutput, CliError> {
    let config = state.config.as_ref().ok_or_else(|| {
        CliError::internal(
            command_line.to_owned(),
            "gateway background start requires a resolved self-host config",
        )
    })?;
    let (launch_plan, runtime_command) =
        prepare_runtime_launch(state, process, command_line, retry_command)?;
    let mut child = ProcessCommand::new(&runtime_command);
    child.arg(&launch_plan.runtime_entry_path);
    child.arg(&launch_plan.launch_config_path);
    child.stdin(Stdio::null());
    let stdout_log = background_log_stdio(
        state.paths.server_log_path.as_path(),
        command_line,
        retry_command,
    )?;
    let stderr_log = background_log_stdio(
        state.paths.server_log_path.as_path(),
        command_line,
        retry_command,
    )?;
    child.stdout(stdout_log);
    child.stderr(stderr_log);
    configure_background_process(&mut child);

    let mut child = child.spawn().map_err(|spawn_error| {
        spawn_launch_error(
            &spawn_error,
            &runtime_command,
            launch_plan.runtime_entry_path.as_path(),
            command_line,
            retry_command,
        )
    })?;
    let child_pid = child.id();
    let state_path = runtime_state_path(state.paths.run_dir.as_path());

    wait_for_background_runtime_start(
        &mut child,
        BackgroundRuntimeStartCheck {
            state_path: state_path.as_path(),
            log_path: state.paths.server_log_path.as_path(),
            expected_pid: child_pid,
            listen_host: &config.server.listen_host,
            listen_port: config.server.port,
            command_line,
            retry_command,
        },
    )?;

    let refreshed_state = resolve_runtime_state(command_line, GatewayStateAccessMode::ReadOnly)?;
    Ok(render_gateway_start_output(&refreshed_state, child_pid))
}

fn prepare_runtime_launch(
    state: &GatewayRuntimeState,
    process: &ProcessContext,
    command_line: &str,
    retry_command: &str,
) -> Result<(GatewayLaunchPlan, OsString), CliError> {
    ensure_runtime_not_running(state, command_line)?;
    let mut launch_plan = resolve_launch_plan(state, process, command_line)?;
    let runtime_command = resolve_runtime_command();
    ensure_runtime_command_support(
        &runtime_command,
        launch_plan.runtime_entry_path.as_path(),
        command_line,
        retry_command,
    )?;
    launch_plan.launch_config_path = write_self_host_launch_config(
        command_line,
        &launch_plan.web_dist_dir,
        &launch_plan.migrations_dir,
    )?;
    remove_if_exists(state.paths.stop_request_path.as_path());
    Ok((launch_plan, runtime_command))
}

fn ensure_runtime_not_running(
    state: &GatewayRuntimeState,
    command_line: &str,
) -> Result<(), CliError> {
    let running_pid = read_managed_runtime_pid(&state.paths, command_line)?;

    if let Some(pid) = running_pid {
        return Err(CliError::new(
            "self-host runtime is already running",
            command_line,
            ErrorStage::LoadConfig,
            format!("pid {pid} is already active"),
            vec![
                "onequery gateway status".to_owned(),
                "onequery gateway logs".to_owned(),
                "onequery gateway stop".to_owned(),
            ],
        ));
    }

    Ok(())
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
    retry_command: &str,
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
                        install_node_and_retry_command(retry_command),
                        REINSTALL_CLI_PACKAGE_COMMAND.to_owned(),
                    ],
                ),
                _ => (
                    format!(
                        "failed to run {} --version: {probe_error}",
                        Path::new(runtime_command).display()
                    ),
                    vec![install_node_and_retry_command(retry_command)],
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
            vec![install_node_and_retry_command(retry_command)],
        ));
    }

    validate_runtime_version_output(
        &String::from_utf8_lossy(&version_output.stdout),
        runtime_command,
        command_line,
        retry_command,
    )
}

pub(super) fn validate_runtime_version_output(
    version_output: &str,
    runtime_command: &OsString,
    command_line: &str,
    retry_command: &str,
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
            vec![install_node_and_retry_command(retry_command)],
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
            vec![install_node_and_retry_command(retry_command)],
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

fn retry_command_hint(retry_command: &str) -> String {
    format!("retry {retry_command}")
}

fn install_node_and_retry_command(retry_command: &str) -> String {
    format!("install Node.js 22+ and retry {retry_command}")
}

fn spawn_launch_error(
    spawn_error: &std::io::Error,
    runtime_command: &OsString,
    runtime_entry_path: &Path,
    command_line: &str,
    retry_command: &str,
) -> CliError {
    let (why, try_next) = match spawn_error.kind() {
        std::io::ErrorKind::NotFound => (
            format!(
                "JavaScript runtime executable was not found at {} while launching {}",
                Path::new(runtime_command).display(),
                runtime_entry_path.display()
            ),
            vec![
                install_node_and_retry_command(retry_command),
                REINSTALL_CLI_PACKAGE_COMMAND.to_owned(),
            ],
        ),
        _ => (
            spawn_error.to_string(),
            vec![retry_command_hint(retry_command)],
        ),
    };

    CliError::new(
        "failed to launch self-host server",
        command_line,
        ErrorStage::Internal,
        why,
        try_next,
    )
}

fn background_log_stdio(
    path: &Path,
    command_line: &str,
    retry_command: &str,
) -> Result<Stdio, CliError> {
    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| {
            CliError::new(
                "failed to prepare self-host log capture",
                command_line,
                ErrorStage::Internal,
                format!("{error} ({})", path.display()),
                vec![
                    format!("check log file {}", path.display()),
                    retry_command_hint(retry_command),
                ],
            )
        })?;

    Ok(Stdio::from(log_file))
}

fn configure_background_process(child: &mut ProcessCommand) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt as _;

        // SAFETY: `pre_exec` runs in the child after fork and before exec. This
        // closure only calls async-signal-safe `setsid` to detach the managed
        // background runtime from the caller's terminal session.
        unsafe {
            child.pre_exec(|| {
                if libc::setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        use windows_sys::Win32::System::Threading::CREATE_NEW_PROCESS_GROUP;
        use windows_sys::Win32::System::Threading::DETACHED_PROCESS;

        child.creation_flags(CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS);
    }
}

struct BackgroundRuntimeStartCheck<'a> {
    state_path: &'a Path,
    log_path: &'a Path,
    expected_pid: u32,
    listen_host: &'a str,
    listen_port: u16,
    command_line: &'a str,
    retry_command: &'a str,
}

fn wait_for_background_runtime_start(
    child: &mut Child,
    check: BackgroundRuntimeStartCheck<'_>,
) -> Result<(), CliError> {
    // Comment: background start now waits for an explicit runtime-owned ready
    // state from the launched pid instead of inferring success from whichever
    // process happens to accept TCP on the configured port.
    for _ in 0..GATEWAY_START_POLL_ATTEMPTS {
        if let Some(status) = child.try_wait().map_err(|error| {
            CliError::new(
                "failed while monitoring self-host background start",
                check.command_line,
                ErrorStage::Internal,
                error.to_string(),
                vec![
                    format!("check log file {}", check.log_path.display()),
                    retry_command_hint(check.retry_command),
                ],
            )
        })? {
            return Err(CliError::new(
                "self-host server exited during background start",
                check.command_line,
                ErrorStage::Internal,
                describe_exit_status(status),
                vec![
                    format!("check log file {}", check.log_path.display()),
                    retry_command_hint(check.retry_command),
                ],
            ));
        }

        if runtime_ready_state_reported_during_startup_poll(
            check.state_path,
            check.expected_pid,
            check.command_line,
        )? && runtime_accepting_connections(check.listen_host, check.listen_port)
        {
            return Ok(());
        }

        std::thread::sleep(std::time::Duration::from_millis(
            GATEWAY_START_POLL_INTERVAL_MS,
        ));
    }

    let probe_host = runtime_probe_host(check.listen_host);

    let runtime_state = read_runtime_state_record(check.state_path, check.command_line)?;

    if runtime_state
        .as_ref()
        .is_some_and(|state| state.pid == check.expected_pid)
    {
        let phase = runtime_state
            .as_ref()
            .map(|state| runtime_phase_label(state.phase))
            .unwrap_or("unknown");
        return Err(CliError::new(
            "self-host server did not report startup",
            check.command_line,
            ErrorStage::Internal,
            format!(
                "{probe_host}:{} did not accept connections after pid {} reported {phase}",
                check.listen_port, check.expected_pid,
            ),
            vec![
                format!("check log file {}", check.log_path.display()),
                retry_command_hint(check.retry_command),
            ],
        ));
    }

    Err(CliError::new(
        "self-host server did not report startup",
        check.command_line,
        ErrorStage::Internal,
        format!(
            "runtime state file {} did not report pid {} as ready",
            check.state_path.display(),
            check.expected_pid
        ),
        vec![
            format!("check log file {}", check.log_path.display()),
            retry_command_hint(check.retry_command),
        ],
    ))
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

fn runtime_phase_label(phase: RuntimeLifecyclePhase) -> &'static str {
    match phase {
        RuntimeLifecyclePhase::Starting => "starting",
        RuntimeLifecyclePhase::Ready => "ready",
        RuntimeLifecyclePhase::Stopping => "stopping",
    }
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
    let running_pid = read_managed_runtime_pid(&state.paths, command_line)?;

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

pub(super) fn read_managed_runtime_pid(
    paths: &SelfHostRuntimePaths,
    command_line: &str,
) -> Result<Option<u32>, CliError> {
    let state_path = runtime_state_path(paths.run_dir.as_path());
    let runtime_state = read_runtime_state_record(state_path.as_path(), command_line)?;

    if let Some(lock_record) = read_runtime_lock_record(paths.lock_path.as_path(), command_line)?
        && is_process_running(lock_record.pid)
        && runtime_record_matches_data_dir(&lock_record.data_dir, paths.data_dir.as_path())
        && runtime_state_matches_pid(
            runtime_state.as_ref(),
            lock_record.pid,
            paths.data_dir.as_path(),
        )
    {
        return Ok(Some(lock_record.pid));
    }

    Ok(
        read_runtime_pid(paths.pid_path.as_path(), command_line)?.filter(|pid| {
            is_process_running(*pid)
                && runtime_state_matches_pid(runtime_state.as_ref(), *pid, paths.data_dir.as_path())
        }),
    )
}

fn read_runtime_lock_record(
    path: &Path,
    command_line: &str,
) -> Result<Option<RuntimeLockRecord>, CliError> {
    let Ok(contents) = fs::read_to_string(path) else {
        return Ok(None);
    };

    let trimmed = contents.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    serde_json::from_str::<RuntimeLockRecord>(trimmed)
        .map(Some)
        .map_err(|error| {
            CliError::new(
                "failed to parse runtime lock file",
                command_line,
                ErrorStage::LoadConfig,
                format!("{error} ({})", path.display()),
                vec!["remove the stale lock file and retry".to_owned()],
            )
        })
}

fn runtime_state_path(run_dir: &Path) -> PathBuf {
    run_dir.join(RUNTIME_STATE_FILENAME)
}

fn read_runtime_state_record(
    path: &Path,
    command_line: &str,
) -> Result<Option<RuntimeStateRecord>, CliError> {
    let Ok(contents) = fs::read_to_string(path) else {
        return Ok(None);
    };

    let trimmed = contents.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    serde_json::from_str::<RuntimeStateRecord>(trimmed)
        .map(Some)
        .map_err(|error| {
            CliError::new(
                "failed to parse runtime state file",
                command_line,
                ErrorStage::LoadConfig,
                format!("{error} ({})", path.display()),
                vec!["remove the stale runtime state file and retry".to_owned()],
            )
        })
}

fn read_runtime_state_record_during_startup_poll(
    path: &Path,
    command_line: &str,
) -> Result<Option<RuntimeStateRecord>, CliError> {
    match read_runtime_state_record(path, command_line) {
        Ok(record) => Ok(record),
        Err(_) => {
            // Comment: startup polling can race the runtime replacing this file,
            // so malformed reads are retried instead of aborting launch.
            Ok(None)
        }
    }
}

fn runtime_ready_state_reported_during_startup_poll(
    path: &Path,
    expected_pid: u32,
    command_line: &str,
) -> Result<bool, CliError> {
    Ok(
        read_runtime_state_record_during_startup_poll(path, command_line)?.is_some_and(|state| {
            state.pid == expected_pid && state.phase == RuntimeLifecyclePhase::Ready
        }),
    )
}

fn runtime_record_matches_data_dir(record_data_dir: &str, expected_data_dir: &Path) -> bool {
    Path::new(record_data_dir) == expected_data_dir
}

fn runtime_state_matches_pid(
    state: Option<&RuntimeStateRecord>,
    expected_pid: u32,
    expected_data_dir: &Path,
) -> bool {
    state.is_some_and(|state| {
        state.pid == expected_pid
            && runtime_record_matches_data_dir(&state.data_dir, expected_data_dir)
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

#[cfg(test)]
mod tests {
    use std::fs;

    use pretty_assertions::assert_eq;
    use tempfile::tempdir;

    use super::RUNTIME_STATE_FILENAME;
    use super::read_managed_runtime_pid;
    use super::read_runtime_state_record;
    use super::runtime_ready_state_reported_during_startup_poll;
    use crate::config::self_host::SelfHostRuntimePaths;

    fn test_paths() -> (tempfile::TempDir, SelfHostRuntimePaths) {
        let temp_dir = tempdir().unwrap_or_else(|error| panic!("expected temp dir: {error}"));
        let paths = SelfHostRuntimePaths::for_test(
            temp_dir.path().join("config").join("self-host"),
            temp_dir.path().join("data"),
        );

        fs::create_dir_all(&paths.run_dir)
            .unwrap_or_else(|error| panic!("expected run dir creation: {error}"));

        (temp_dir, paths)
    }

    #[test]
    fn startup_poll_treats_malformed_runtime_state_as_retryable() {
        let (_temp_dir, paths) = test_paths();
        let state_path = paths.run_dir.join(RUNTIME_STATE_FILENAME);

        fs::write(&state_path, "{\"pid\":")
            .unwrap_or_else(|error| panic!("expected malformed state write: {error}"));

        assert_eq!(
            runtime_ready_state_reported_during_startup_poll(
                state_path.as_path(),
                4242,
                "onequery gateway start",
            )
            .unwrap_or_else(|error| panic!("expected retryable state read: {error}")),
            false
        );
    }

    #[test]
    fn strict_runtime_state_reads_still_report_parse_failures() {
        let (_temp_dir, paths) = test_paths();
        let state_path = paths.run_dir.join(RUNTIME_STATE_FILENAME);

        fs::write(&state_path, "{\"pid\":")
            .unwrap_or_else(|error| panic!("expected malformed state write: {error}"));

        let error = read_runtime_state_record(state_path.as_path(), "onequery gateway status")
            .expect_err("expected malformed runtime state to fail strict reads");

        assert_eq!(error.title.as_str(), "failed to parse runtime state file");
    }

    #[test]
    fn read_managed_runtime_pid_ignores_live_lock_without_matching_runtime_state() {
        let (_temp_dir, paths) = test_paths();
        let pid = std::process::id();

        fs::write(
            &paths.lock_path,
            format!(
                "{{\"pid\":{pid},\"acquiredAt\":\"2026-03-25T00:00:00.000Z\",\"dataDir\":\"{}\"}}\n",
                paths.data_dir.display()
            ),
        )
        .unwrap_or_else(|error| panic!("expected lock write: {error}"));

        assert_eq!(
            read_managed_runtime_pid(&paths, "onequery gateway status")
                .unwrap_or_else(|error| panic!("expected pid read: {error}")),
            None
        );
    }

    #[test]
    fn read_managed_runtime_pid_accepts_live_lock_with_matching_runtime_state() {
        let (_temp_dir, paths) = test_paths();
        let pid = std::process::id();

        fs::write(
            &paths.lock_path,
            format!(
                "{{\"pid\":{pid},\"acquiredAt\":\"2026-03-25T00:00:00.000Z\",\"dataDir\":\"{}\"}}\n",
                paths.data_dir.display()
            ),
        )
        .unwrap_or_else(|error| panic!("expected lock write: {error}"));
        fs::write(
            paths.run_dir.join(RUNTIME_STATE_FILENAME),
            format!(
                "{{\"pid\":{pid},\"phase\":\"ready\",\"updatedAt\":\"2026-03-25T00:00:00.000Z\",\"dataDir\":\"{}\"}}\n",
                paths.data_dir.display()
            ),
        )
        .unwrap_or_else(|error| panic!("expected state write: {error}"));

        assert_eq!(
            read_managed_runtime_pid(&paths, "onequery gateway status")
                .unwrap_or_else(|error| panic!("expected pid read: {error}")),
            Some(pid)
        );
    }
}
