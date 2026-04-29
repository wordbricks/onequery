use std::ffi::OsString;
use std::fs::OpenOptions;
use std::path::Path;
use std::path::PathBuf;
use std::process::Child;
use std::process::Command as ProcessCommand;
use std::process::Stdio;
use std::time::Duration;

use connectrpc::ConnectError;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use serde_json::json;
use tokio::time::Instant;
use tokio::time::sleep;
use tokio::time::timeout;

use crate::GatewayCommandOutput;
use crate::runtime_accepting_connections;
use crate::runtime_probe_host;
use crate::self_host::SelfHostRuntimePaths;
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
use super::control::RuntimeControlCallHeaders;
use super::control::RuntimeControlPhase;
use super::control::RuntimeControlStatus;
use super::control::RuntimeControlStatusWatchEvent;
use super::control::runtime_control_error_allows_fallback;
use super::control::runtime_control_watch_event_from_proto;
use super::control::watch_runtime_control_status;
use super::control_error::runtime_control_connect_error_summary;
use super::control_error::with_runtime_control_connect_error_metadata;
use super::lifecycle::read_managed_runtime_pid;
use super::lifecycle::read_runtime_status_snapshot;
use super::lifecycle::runtime_launch_id_matches;
use super::lifecycle::runtime_phase_label;
use super::lifecycle::runtime_ready_pid_reported_during_startup_poll;
use super::lifecycle::runtime_status_snapshot_path;
use super::lifecycle::runtime_status_snapshot_pid_and_phase;
use super::status::describe_exit_status;
use super::status::exit_signal_label;
use super::status::is_expected_termination;
use super::supervisor::monitor_foreground_runtime;
use super::supervisor::supervisor_id_for_pid;
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

pub(crate) async fn run_gateway_foreground(
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
    let runtime_pid = child.id();
    let status = monitor_foreground_runtime(
        state,
        &launch.launch_id,
        runtime_pid,
        &mut child,
        command_line,
    )
    .await?;

    if status.success() || is_expected_termination(status) {
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

pub(crate) async fn run_gateway_background(
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
    let supervisor_id = supervisor_id_for_pid(child.id());
    let status_snapshot_path = runtime_status_snapshot_path(state.paths.run_dir.as_path());

    let runtime_pid = wait_for_background_runtime_start(
        &mut child,
        BackgroundRuntimeStartCheck {
            paths: &state.paths,
            status_snapshot_path: status_snapshot_path.as_path(),
            data_dir: state.paths.data_dir.as_path(),
            log_path: state.paths.server_log_path.as_path(),
            listen_host: &config.server.listen_host,
            listen_port: config.server.port,
            launch_id: &launch.launch_id,
            supervisor_id: supervisor_id.as_str(),
            command_line,
            retry_command,
        },
    )
    .await?;

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
    paths: &'a SelfHostRuntimePaths,
    status_snapshot_path: &'a Path,
    data_dir: &'a Path,
    log_path: &'a Path,
    listen_host: &'a str,
    listen_port: u16,
    launch_id: &'a str,
    supervisor_id: &'a str,
    command_line: &'a str,
    retry_command: &'a str,
}

enum StartupWatchReadiness {
    Ready(u32),
    Pending { stream_established: bool },
    StreamError(Box<ConnectError>),
    Terminal(RuntimeControlPhase),
}

async fn wait_for_background_runtime_start(
    child: &mut Child,
    check: BackgroundRuntimeStartCheck<'_>,
) -> Result<u32, CliError> {
    // CONTEXT: background start waits for a ready state carrying this launch
    // token instead of accepting any stale runtime that shares the data dir.
    let startup_deadline = Instant::now()
        + Duration::from_millis(
            GATEWAY_START_POLL_ATTEMPTS as u64 * GATEWAY_START_POLL_INTERVAL_MS,
        );
    let poll_interval = Duration::from_millis(GATEWAY_START_POLL_INTERVAL_MS);
    let mut control_stream_established = false;
    let mut last_watch_error = None;

    while Instant::now() < startup_deadline {
        ensure_background_supervisor_still_running(child, &check)?;

        match poll_runtime_control_startup_readiness(&check, startup_deadline).await {
            Ok(StartupWatchReadiness::Ready(runtime_pid)) => return Ok(runtime_pid),
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
                return Err(runtime_control_terminal_startup_error(&check, phase));
            }
            Err(error) => {
                if !runtime_control_error_allows_fallback(&error) {
                    return Err(runtime_control_startup_watch_error(&check, &error));
                }
                last_watch_error = Some(error);
            }
        }

        if !control_stream_established
            && let Some(runtime_pid) = runtime_ready_pid_reported_during_startup_poll(
                check.status_snapshot_path,
                check.data_dir,
                check.launch_id,
                check.command_line,
            )?
            && runtime_accepting_connections(check.listen_host, check.listen_port)
        {
            return Ok(runtime_pid);
        }

        sleep(poll_interval.min(startup_deadline.saturating_duration_since(Instant::now()))).await;
    }

    ensure_background_supervisor_still_running(child, &check)?;

    if control_stream_established {
        return Err(runtime_control_startup_timeout_error(
            &check,
            last_watch_error.as_ref(),
        ));
    }

    let probe_host = runtime_probe_host(check.listen_host);

    let runtime_status_snapshot =
        read_runtime_status_snapshot(check.status_snapshot_path, check.command_line)?;

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

        phase == crate::runtime_control::types::RuntimePhase::RUNTIME_PHASE_READY
            && runtime_launch_id_matches(identity.launch_id.as_deref(), check.launch_id)
            && identity
                .data_dir
                .as_deref()
                .is_some_and(|data_dir| Path::new(data_dir) == check.data_dir)
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
            "runtime status snapshot {} did not report a ready runtime for launch {} in {}",
            check.status_snapshot_path.display(),
            check.launch_id,
            check.data_dir.display()
        ),
        vec![
            format!("check log file {}", check.log_path.display()),
            retry_command_hint(check.retry_command),
        ],
    ))
}

async fn poll_runtime_control_startup_readiness(
    check: &BackgroundRuntimeStartCheck<'_>,
    startup_deadline: Instant,
) -> Result<StartupWatchReadiness, ConnectError> {
    let mut stream = watch_runtime_control_status(
        check.paths,
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
                if status.phase == RuntimeControlPhase::Ready {
                    return runtime_ready_pid_from_status(status).map(StartupWatchReadiness::Ready);
                }
                if runtime_control_phase_is_terminal(status.phase) {
                    return Ok(StartupWatchReadiness::Terminal(status.phase));
                }
                latest_status = Some(status);
            }
            Some(RuntimeControlStatusWatchEvent::Transition { phase, .. }) => {
                if phase == RuntimeControlPhase::Ready {
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

fn runtime_control_phase_is_terminal(phase: RuntimeControlPhase) -> bool {
    phase.is_terminal()
}

fn ensure_background_supervisor_still_running(
    child: &mut Child,
    check: &BackgroundRuntimeStartCheck<'_>,
) -> Result<(), CliError> {
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

    Ok(())
}

fn runtime_control_terminal_startup_error(
    check: &BackgroundRuntimeStartCheck<'_>,
    phase: RuntimeControlPhase,
) -> CliError {
    CliError::new(
        "self-host server did not report startup",
        check.command_line,
        ErrorStage::Internal,
        format!(
            "runtime control WatchStatus reported terminal phase {} for launch {} in {}",
            phase.label(),
            check.launch_id,
            check.data_dir.display()
        ),
        vec![
            format!("check log file {}", check.log_path.display()),
            retry_command_hint(check.retry_command),
        ],
    )
}

fn runtime_control_startup_watch_error(
    check: &BackgroundRuntimeStartCheck<'_>,
    error: &ConnectError,
) -> CliError {
    let detail = runtime_control_connect_error_summary(error).map_or_else(
        || {
            format!(
                "runtime control WatchStatus failed for launch {} in {}: {error}",
                check.launch_id,
                check.data_dir.display()
            )
        },
        |summary| {
            format!(
                "runtime control WatchStatus failed for launch {} in {}: {summary}",
                check.launch_id,
                check.data_dir.display()
            )
        },
    );

    let cli_error = CliError::new(
        "self-host server did not report startup",
        check.command_line,
        ErrorStage::Internal,
        detail,
        vec![
            format!("check log file {}", check.log_path.display()),
            retry_command_hint(check.retry_command),
        ],
    );

    with_runtime_control_connect_error_metadata(error, cli_error, None)
}

fn runtime_control_startup_timeout_error(
    check: &BackgroundRuntimeStartCheck<'_>,
    last_watch_error: Option<&ConnectError>,
) -> CliError {
    let detail = last_watch_error.map_or_else(
        || {
            format!(
                "runtime control WatchStatus did not report READY for launch {} in {}",
                check.launch_id,
                check.data_dir.display()
            )
        },
        |error| {
            let last_error = runtime_control_connect_error_summary(error)
                .unwrap_or_else(|| error.to_string());

            format!(
                "runtime control WatchStatus did not report READY for launch {} in {} (last error: {last_error})",
                check.launch_id,
                check.data_dir.display()
            )
        },
    );

    let cli_error = CliError::new(
        "self-host server did not report startup",
        check.command_line,
        ErrorStage::Internal,
        detail,
        vec![
            format!("check log file {}", check.log_path.display()),
            retry_command_hint(check.retry_command),
        ],
    );

    if let Some(error) = last_watch_error {
        with_runtime_control_connect_error_metadata(error, cli_error, None)
    } else {
        cli_error
    }
}
