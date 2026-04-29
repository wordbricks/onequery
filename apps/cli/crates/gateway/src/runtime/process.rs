use std::ffi::OsString;
use std::fs::OpenOptions;
use std::path::Path;
use std::path::PathBuf;
use std::process::Child;
use std::process::Command as ProcessCommand;
use std::process::Stdio;

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use serde_json::json;

use crate::GatewayCommandOutput;
use crate::runtime_accepting_connections;
use crate::runtime_probe_host;
use crate::self_host::write_self_host_launch_config;
use onequery_cli_core::process_context::ProcessContext;

use super::super::GATEWAY_START_POLL_ATTEMPTS;
use super::super::GATEWAY_START_POLL_INTERVAL_MS;
use super::super::launch::GatewayLaunchPlan;
use super::super::launch::resolve_launch_plan;
use super::super::render::render_gateway_start_output;
use super::super::state::GatewayRuntimeState;
use super::super::state::GatewayStateAccessMode;
use super::super::state::resolve_runtime_state;
use super::lifecycle::read_managed_runtime_pid;
use super::lifecycle::read_runtime_state_record;
use super::lifecycle::runtime_launch_id_matches;
use super::lifecycle::runtime_phase_label;
use super::lifecycle::runtime_ready_pid_reported_during_startup_poll;
use super::lifecycle::runtime_state_path;
use super::shutdown::remove_if_exists;
use super::shutdown::stop_request_matches;
use super::status::describe_exit_status;
use super::status::exit_signal_label;
use super::status::is_expected_termination;
use super::transport::ensure_runtime_command_support;
use super::transport::resolve_runtime_command;
use super::transport::retry_command_hint;
use super::transport::spawn_launch_error;

struct PreparedRuntimeLaunch {
    launch_config_path: PathBuf,
    launch_id: String,
    launch_plan: GatewayLaunchPlan,
    runtime_command: OsString,
}

pub(crate) fn run_gateway_foreground(
    state: &GatewayRuntimeState,
    process: &ProcessContext,
    command_line: &str,
    retry_command: &str,
) -> Result<GatewayCommandOutput, CliError> {
    let launch = prepare_runtime_launch(state, process, command_line, retry_command)?;
    let mut child = ProcessCommand::new(&launch.runtime_command);
    child.arg(&launch.launch_plan.runtime_entry_path);
    child.arg(&launch.launch_config_path);
    child
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    let mut child = child.spawn().map_err(|spawn_error| {
        spawn_launch_error(
            &spawn_error,
            &launch.runtime_command,
            launch.launch_plan.runtime_entry_path.as_path(),
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
        return Ok(GatewayCommandOutput::structured(
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

pub(crate) fn run_gateway_background(
    state: &GatewayRuntimeState,
    process: &ProcessContext,
    command_line: &str,
    retry_command: &str,
) -> Result<GatewayCommandOutput, CliError> {
    let config = state.config.as_ref().ok_or_else(|| {
        CliError::internal(
            command_line.to_owned(),
            "gateway background start requires a resolved self-host config",
        )
    })?;
    let launch = prepare_runtime_launch(state, process, command_line, retry_command)?;
    let supervisor_command = process.current_executable_or_error(
        "failed to resolve gateway supervisor executable",
        command_line,
        ErrorStage::Internal,
        vec![retry_command_hint(retry_command)],
    )?;
    let mut child = ProcessCommand::new(supervisor_command);
    child.arg("__gateway-supervisor");
    child.arg("--runtime-command");
    child.arg(&launch.runtime_command);
    child.arg("--runtime-entry");
    child.arg(&launch.launch_plan.runtime_entry_path);
    child.arg("--launch-config");
    child.arg(&launch.launch_config_path);
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
            &launch.runtime_command,
            launch.launch_plan.runtime_entry_path.as_path(),
            command_line,
            retry_command,
        )
    })?;
    let state_path = runtime_state_path(state.paths.run_dir.as_path());

    let runtime_pid = wait_for_background_runtime_start(
        &mut child,
        BackgroundRuntimeStartCheck {
            state_path: state_path.as_path(),
            data_dir: state.paths.data_dir.as_path(),
            log_path: state.paths.server_log_path.as_path(),
            listen_host: &config.server.listen_host,
            listen_port: config.server.port,
            launch_id: &launch.launch_id,
            command_line,
            retry_command,
        },
    )?;

    let refreshed_state = resolve_runtime_state(command_line, GatewayStateAccessMode::ReadOnly)?;
    Ok(render_gateway_start_output(&refreshed_state, runtime_pid))
}

fn prepare_runtime_launch(
    state: &GatewayRuntimeState,
    process: &ProcessContext,
    command_line: &str,
    retry_command: &str,
) -> Result<PreparedRuntimeLaunch, CliError> {
    ensure_runtime_not_running(state, command_line)?;
    let launch_plan = resolve_launch_plan(process, command_line)?;
    let runtime_command = resolve_runtime_command();
    ensure_runtime_command_support(
        &runtime_command,
        launch_plan.runtime_entry_path.as_path(),
        command_line,
        retry_command,
    )?;
    let launch_id = uuid::Uuid::new_v4().to_string();
    let launch_config_path = write_self_host_launch_config(
        &state.paths,
        command_line,
        &launch_plan.web_dist_dir,
        &launch_plan.migrations_dir,
        &launch_id,
    )?;
    remove_if_exists(state.paths.stop_request_path.as_path());
    Ok(PreparedRuntimeLaunch {
        launch_config_path,
        launch_id,
        launch_plan,
        runtime_command,
    })
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

pub(super) fn background_log_stdio(
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

pub(super) fn configure_background_process(child: &mut ProcessCommand) {
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
    data_dir: &'a Path,
    log_path: &'a Path,
    listen_host: &'a str,
    listen_port: u16,
    launch_id: &'a str,
    command_line: &'a str,
    retry_command: &'a str,
}

fn wait_for_background_runtime_start(
    child: &mut Child,
    check: BackgroundRuntimeStartCheck<'_>,
) -> Result<u32, CliError> {
    // CONTEXT: background start waits for a ready state carrying this launch
    // token instead of accepting any stale runtime that shares the data dir.
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
                "gateway supervisor exited during background start",
                check.command_line,
                ErrorStage::Internal,
                describe_exit_status(status),
                vec![
                    format!("check log file {}", check.log_path.display()),
                    retry_command_hint(check.retry_command),
                ],
            ));
        }

        if let Some(runtime_pid) = runtime_ready_pid_reported_during_startup_poll(
            check.state_path,
            check.data_dir,
            check.launch_id,
            check.command_line,
        )? && runtime_accepting_connections(check.listen_host, check.listen_port)
        {
            return Ok(runtime_pid);
        }

        std::thread::sleep(std::time::Duration::from_millis(
            GATEWAY_START_POLL_INTERVAL_MS,
        ));
    }

    let probe_host = runtime_probe_host(check.listen_host);

    let runtime_state = read_runtime_state_record(check.state_path, check.command_line)?;

    if runtime_state.as_ref().is_some_and(|state| {
        state.phase == super::lifecycle::RuntimeLifecyclePhase::Ready
            && runtime_launch_id_matches(&state.launch_id, check.launch_id)
            && Path::new(&state.data_dir) == check.data_dir
    }) {
        let phase = runtime_state
            .as_ref()
            .map(|state| runtime_phase_label(state.phase))
            .unwrap_or("unknown");
        let runtime_pid = runtime_state.as_ref().map(|state| state.pid).unwrap_or(0);
        return Err(CliError::new(
            "self-host server did not report startup",
            check.command_line,
            ErrorStage::Internal,
            format!(
                "{probe_host}:{} did not accept connections after pid {} reported {phase}",
                check.listen_port, runtime_pid,
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
            "runtime state file {} did not report a ready runtime for launch {} in {}",
            check.state_path.display(),
            check.launch_id,
            check.data_dir.display()
        ),
        vec![
            format!("check log file {}", check.log_path.display()),
            retry_command_hint(check.retry_command),
        ],
    ))
}
