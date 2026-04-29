use std::ffi::OsString;
use std::fs::OpenOptions;
use std::path::Path;
use std::path::PathBuf;
use std::process::Child;
use std::process::Command as ProcessCommand;
use std::process::Stdio;
use std::time::Duration;

use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;
use serde_json::json;
use tokio::time::Instant;
use tokio::time::sleep;

use crate::GatewayCommandOutput;
use crate::self_host::SelfHostRuntimePaths;
use crate::self_host::write_self_host_launch_config;
use crate::supervisor_control_proto::types;
use onequery_core::process_context::ProcessContext;

use super::super::GATEWAY_START_POLL_ATTEMPTS;
use super::super::GATEWAY_START_POLL_INTERVAL_MS;
use super::super::launch::GatewayLaunchPlan;
use super::super::launch::resolve_launch_plan;
use super::super::render::render_gateway_start_output;
use super::super::state::GatewayRuntimeState;
use super::super::state::GatewayStateAccessMode;
use super::super::state::resolve_runtime_state;
use super::lifecycle::read_managed_runtime_pid;
use super::lifecycle_records;
use super::status::describe_exit_status;
use super::status::exit_signal_label;
use super::supervisor::MonitoredRuntimeExitKind;
use super::supervisor::run_foreground_supervised_runtime;
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
    let exit = run_foreground_supervised_runtime(
        state,
        &launch.launch_id,
        &launch.runtime_command,
        launch.launch_plan.runtime_entry_path.as_path(),
        launch.launch_config_path.as_path(),
        command_line,
        retry_command,
    )
    .await?;
    let status = exit.status;

    if exit.kind == MonitoredRuntimeExitKind::Expected {
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

    let runtime_pid = wait_for_background_supervisor_start(
        &mut child,
        BackgroundSupervisorStartCheck {
            paths: &state.paths,
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

struct BackgroundSupervisorStartCheck<'a> {
    paths: &'a SelfHostRuntimePaths,
    launch_id: &'a str,
    supervisor_id: &'a str,
    command_line: &'a str,
    retry_command: &'a str,
}

async fn wait_for_background_supervisor_start(
    child: &mut Child,
    check: BackgroundSupervisorStartCheck<'_>,
) -> Result<u32, CliError> {
    let startup_deadline = Instant::now()
        + Duration::from_millis(
            GATEWAY_START_POLL_ATTEMPTS as u64 * GATEWAY_START_POLL_INTERVAL_MS,
        );
    let poll_interval = Duration::from_millis(GATEWAY_START_POLL_INTERVAL_MS);

    while Instant::now() < startup_deadline {
        ensure_background_supervisor_still_running(child, &check)?;
        if let Some(observed) = read_background_supervisor_start_snapshot(&check)? {
            match observed {
                BackgroundSupervisorStartSnapshot::Ready { runtime_pid } => return Ok(runtime_pid),
                BackgroundSupervisorStartSnapshot::Terminal { phase } => {
                    return Err(background_supervisor_terminal_startup_error(&check, phase));
                }
                BackgroundSupervisorStartSnapshot::Pending => {}
            }
        }

        sleep(poll_interval.min(startup_deadline.saturating_duration_since(Instant::now()))).await;
    }

    ensure_background_supervisor_still_running(child, &check)?;

    Err(CliError::new(
        "self-host server did not report startup",
        check.command_line,
        ErrorStage::Internal,
        format!(
            "supervisor status snapshot {} did not report a ready runtime for launch {} in {}",
            check.paths.supervisor_status_snapshot_path.display(),
            check.launch_id,
            check.paths.data_dir.display()
        ),
        vec![
            format!("check log file {}", check.paths.server_log_path.display()),
            retry_command_hint(check.retry_command),
        ],
    ))
}

fn ensure_background_supervisor_still_running(
    child: &mut Child,
    check: &BackgroundSupervisorStartCheck<'_>,
) -> Result<(), CliError> {
    if let Some(status) = child.try_wait().map_err(|error| {
        CliError::new(
            "failed while monitoring self-host background start",
            check.command_line,
            ErrorStage::Internal,
            error.to_string(),
            vec![
                format!("check log file {}", check.paths.server_log_path.display()),
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
                format!("check log file {}", check.paths.server_log_path.display()),
                retry_command_hint(check.retry_command),
            ],
        ));
    }

    Ok(())
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum BackgroundSupervisorStartSnapshot {
    Pending,
    Ready { runtime_pid: u32 },
    Terminal { phase: types::SupervisorPhase },
}

fn read_background_supervisor_start_snapshot(
    check: &BackgroundSupervisorStartCheck<'_>,
) -> Result<Option<BackgroundSupervisorStartSnapshot>, CliError> {
    let path = check.paths.supervisor_status_snapshot_path.as_path();
    let contents = match std::fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(CliError::new(
                "failed to read gateway supervisor status snapshot",
                check.command_line,
                ErrorStage::Internal,
                format!("{error} ({})", path.display()),
                vec![
                    format!("check log file {}", check.paths.server_log_path.display()),
                    retry_command_hint(check.retry_command),
                ],
            ));
        }
    };
    let snapshot =
        lifecycle_records::decode_supervisor_status_snapshot(&contents).map_err(|error| {
            CliError::new(
                "failed to parse gateway supervisor status snapshot",
                check.command_line,
                ErrorStage::Internal,
                format!("{error} ({})", path.display()),
                vec![
                    format!("check log file {}", check.paths.server_log_path.display()),
                    retry_command_hint(check.retry_command),
                ],
            )
        })?;
    let Some(status) = snapshot.status.as_option() else {
        return Ok(Some(BackgroundSupervisorStartSnapshot::Pending));
    };
    if !supervisor_status_matches_background_start(status, check) {
        return Ok(Some(BackgroundSupervisorStartSnapshot::Pending));
    }
    let Some(phase) = status.phase.and_then(|phase| phase.as_known()) else {
        return Ok(Some(BackgroundSupervisorStartSnapshot::Pending));
    };

    match phase {
        types::SupervisorPhase::SUPERVISOR_PHASE_READY => {
            let runtime_pid = status
                .runtime
                .as_option()
                .and_then(|runtime| runtime.pid)
                .or_else(|| {
                    status
                        .launch
                        .as_option()
                        .and_then(|launch| launch.runtime_pid)
                })
                .ok_or_else(|| {
                    CliError::new(
                        "gateway supervisor reported ready without runtime pid",
                        check.command_line,
                        ErrorStage::Internal,
                        format!("{}", path.display()),
                        vec![
                            format!("check log file {}", check.paths.server_log_path.display()),
                            retry_command_hint(check.retry_command),
                        ],
                    )
                })?;

            Ok(Some(BackgroundSupervisorStartSnapshot::Ready {
                runtime_pid,
            }))
        }
        phase if supervisor_phase_is_terminal(phase) => {
            Ok(Some(BackgroundSupervisorStartSnapshot::Terminal { phase }))
        }
        _ => Ok(Some(BackgroundSupervisorStartSnapshot::Pending)),
    }
}

fn supervisor_status_matches_background_start(
    status: &types::SupervisorStatus,
    check: &BackgroundSupervisorStartCheck<'_>,
) -> bool {
    let Some(identity) = status.identity.as_option() else {
        return false;
    };
    if identity.supervisor_id.as_deref() != Some(check.supervisor_id) {
        return false;
    }

    let Some(launch) = status.launch.as_option() else {
        return false;
    };

    launch.launch_id.as_deref() == Some(check.launch_id)
        && launch
            .data_dir
            .as_deref()
            .is_some_and(|data_dir| Path::new(data_dir) == check.paths.data_dir.as_path())
}

fn supervisor_phase_is_terminal(phase: types::SupervisorPhase) -> bool {
    matches!(
        phase,
        types::SupervisorPhase::SUPERVISOR_PHASE_EXITED
            | types::SupervisorPhase::SUPERVISOR_PHASE_FAILED
    )
}

fn background_supervisor_terminal_startup_error(
    check: &BackgroundSupervisorStartCheck<'_>,
    phase: types::SupervisorPhase,
) -> CliError {
    CliError::new(
        "self-host server did not report startup",
        check.command_line,
        ErrorStage::Internal,
        format!(
            "gateway supervisor reported terminal phase {} for launch {} in {}",
            supervisor_phase_label(phase),
            check.launch_id,
            check.paths.data_dir.display()
        ),
        vec![
            format!("check log file {}", check.paths.server_log_path.display()),
            retry_command_hint(check.retry_command),
        ],
    )
}

fn supervisor_phase_label(phase: types::SupervisorPhase) -> &'static str {
    match phase {
        types::SupervisorPhase::SUPERVISOR_PHASE_UNSPECIFIED => "unspecified",
        types::SupervisorPhase::SUPERVISOR_PHASE_STARTING => "starting",
        types::SupervisorPhase::SUPERVISOR_PHASE_HANDSHAKING => "handshaking",
        types::SupervisorPhase::SUPERVISOR_PHASE_READY => "ready",
        types::SupervisorPhase::SUPERVISOR_PHASE_STOP_REQUESTED => "stop_requested",
        types::SupervisorPhase::SUPERVISOR_PHASE_TERMINATING => "terminating",
        types::SupervisorPhase::SUPERVISOR_PHASE_ESCALATING => "escalating",
        types::SupervisorPhase::SUPERVISOR_PHASE_EXITED => "exited",
        types::SupervisorPhase::SUPERVISOR_PHASE_FAILED => "failed",
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use buffa::MessageField;
    use pretty_assertions::assert_eq;
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn background_start_reads_ready_runtime_pid_from_matching_supervisor_snapshot() {
        let temp_dir = tempdir().unwrap_or_else(|error| panic!("expected temp dir: {error}"));
        let paths = SelfHostRuntimePaths::from_dirs(
            temp_dir.path().join("config").join("self-host"),
            temp_dir.path().join("data"),
        );
        fs::create_dir_all(&paths.run_dir)
            .unwrap_or_else(|error| panic!("expected run dir creation: {error}"));
        write_supervisor_snapshot(
            &paths,
            "launch-a",
            "gateway-supervisor:123",
            types::SupervisorPhase::SUPERVISOR_PHASE_READY,
            Some(4242),
        );

        let observed = read_background_supervisor_start_snapshot(&background_start_check(
            &paths,
            "launch-a",
            "gateway-supervisor:123",
        ))
        .unwrap_or_else(|error| panic!("expected supervisor snapshot read: {error}"));

        assert_eq!(
            observed,
            Some(BackgroundSupervisorStartSnapshot::Ready { runtime_pid: 4242 })
        );
    }

    #[test]
    fn background_start_ignores_supervisor_snapshot_for_other_launch() {
        let temp_dir = tempdir().unwrap_or_else(|error| panic!("expected temp dir: {error}"));
        let paths = SelfHostRuntimePaths::from_dirs(
            temp_dir.path().join("config").join("self-host"),
            temp_dir.path().join("data"),
        );
        fs::create_dir_all(&paths.run_dir)
            .unwrap_or_else(|error| panic!("expected run dir creation: {error}"));
        write_supervisor_snapshot(
            &paths,
            "launch-a",
            "gateway-supervisor:123",
            types::SupervisorPhase::SUPERVISOR_PHASE_READY,
            Some(4242),
        );

        let observed = read_background_supervisor_start_snapshot(&background_start_check(
            &paths,
            "launch-b",
            "gateway-supervisor:123",
        ))
        .unwrap_or_else(|error| panic!("expected supervisor snapshot read: {error}"));

        assert_eq!(observed, Some(BackgroundSupervisorStartSnapshot::Pending));
    }

    fn background_start_check<'a>(
        paths: &'a SelfHostRuntimePaths,
        launch_id: &'a str,
        supervisor_id: &'a str,
    ) -> BackgroundSupervisorStartCheck<'a> {
        BackgroundSupervisorStartCheck {
            paths,
            launch_id,
            supervisor_id,
            command_line: "onequery gateway start",
            retry_command: "onequery gateway start",
        }
    }

    fn write_supervisor_snapshot(
        paths: &SelfHostRuntimePaths,
        launch_id: &str,
        supervisor_id: &str,
        phase: types::SupervisorPhase,
        runtime_pid: Option<u32>,
    ) {
        let data_dir = paths.data_dir.display().to_string();
        let snapshot = types::SupervisorStatusSnapshot {
            status: MessageField::some(types::SupervisorStatus {
                identity: MessageField::some(types::SupervisorIdentity {
                    supervisor_id: Some(supervisor_id.to_owned()),
                    pid: Some(123),
                    generation: Some(1),
                    ..Default::default()
                }),
                launch: MessageField::some(types::LifecycleLaunchIdentity {
                    launch_id: Some(launch_id.to_owned()),
                    data_dir: Some(data_dir.clone()),
                    runtime_pid,
                    supervisor_pid: Some(123),
                    supervisor_generation: Some(1),
                    ..Default::default()
                }),
                runtime: runtime_pid
                    .map(|pid| {
                        MessageField::some(types::RuntimeIdentity {
                            pid: Some(pid),
                            launch_id: Some(launch_id.to_owned()),
                            data_dir: Some(data_dir),
                            ..Default::default()
                        })
                    })
                    .unwrap_or_default(),
                phase: Some(phase.into()),
                ..Default::default()
            }),
            ..Default::default()
        };
        let encoded = lifecycle_records::encode_supervisor_status_snapshot(&snapshot)
            .unwrap_or_else(|error| panic!("expected supervisor snapshot encode: {error}"));
        fs::write(&paths.supervisor_status_snapshot_path, encoded)
            .unwrap_or_else(|error| panic!("expected supervisor snapshot write: {error}"));
    }
}
