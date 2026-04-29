use std::path::Path;
use std::process::Child;
use std::process::ExitStatus;
use std::time::Duration;

use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;
use tokio::time::Instant;
use tokio::time::sleep;
use tokio::time::timeout;

use crate::runtime_probe_host;
use crate::supervisor_control_proto::types;

use super::super::GATEWAY_START_POLL_ATTEMPTS;
use super::super::GATEWAY_START_POLL_INTERVAL_MS;
use super::super::state::GatewayRuntimeState;
use super::lifecycle::read_runtime_status_snapshot_for_recovery;
use super::lifecycle::runtime_phase_label;
use super::status::describe_exit_status;
use super::status::exit_signal_label;
use super::supervisor::SupervisedRuntimeContext;
use super::supervisor::supervisor_child_exit_kind;
use super::supervisor_effects::SupervisorTimers;
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
    let mut timers = SupervisorTimers::default();
    dispatch_supervisor_event(
        machine,
        SupervisorEvent::StartupDeadlineElapsed {
            message: message.clone(),
        },
        context.effect_context(),
        Some(&mut timers),
    )
    .await?;
    cleanup_supervised_runtime_after_startup_timeout(
        context,
        child,
        machine,
        &mut timers,
        &check,
        &message,
    )
    .await?;
    Err(startup_timeout_error(&check, message))
}

async fn cleanup_supervised_runtime_after_startup_timeout(
    context: SupervisedRuntimeContext<'_>,
    child: &mut Child,
    machine: &mut SupervisorMachine,
    timers: &mut SupervisorTimers,
    check: &SupervisedRuntimeStartupCheck<'_>,
    startup_message: &str,
) -> Result<(), CliError> {
    if timers.no_active_deadlines() {
        return Ok(());
    }

    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| supervised_runtime_monitor_error(check, error))?
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
                Some(&mut *timers),
            )
            .await?;
            return Ok(());
        }

        if timers.kill_deadline_elapsed() {
            let message = format!(
                "pid {} remained active after supervisor startup cleanup hard kill",
                context.runtime_pid
            );
            dispatch_supervisor_event(
                machine,
                SupervisorEvent::EscalationDeadlineElapsed {
                    message: message.clone(),
                },
                context.effect_context(),
                Some(&mut *timers),
            )
            .await?;
            return Err(startup_cleanup_timeout_error(
                check,
                startup_message,
                message,
            ));
        }

        if timers.terminate_deadline_elapsed() {
            dispatch_supervisor_event(
                machine,
                SupervisorEvent::TerminateDeadlineElapsed,
                context.effect_context(),
                Some(&mut *timers),
            )
            .await?;
        }

        sleep(timers.next_poll_interval()).await;
    }
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
    // CONTEXT: this snapshot read only enriches the timeout message. Runtime
    // readiness remains owned by the supervisor session handshake.
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
    let launch = snapshot
        .header
        .as_option()
        .and_then(|header| header.launch.as_option())?;
    let pid = launch.runtime_pid?;
    let phase = status.phase.and_then(|phase| phase.as_known())?;

    (phase == types::RuntimePhase::RUNTIME_PHASE_READY
        && launch.launch_id.as_deref() == Some(check.launch_id)
        && launch
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

fn startup_cleanup_timeout_error(
    check: &SupervisedRuntimeStartupCheck<'_>,
    startup_detail: &str,
    cleanup_detail: String,
) -> CliError {
    CliError::new(
        "self-host server did not report startup",
        check.command_line,
        ErrorStage::Internal,
        format!("{startup_detail}; {cleanup_detail}"),
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

#[cfg(all(test, unix))]
mod tests {
    use std::fs;
    use std::process::Command as ProcessCommand;
    use std::process::Stdio;

    use buffa::MessageField;
    use onequery_core::process::is_process_running;
    use pretty_assertions::assert_eq;
    use tempfile::tempdir;

    use super::*;
    use crate::runtime::lifecycle_records;
    use crate::runtime::supervisor_control::actor::SupervisorControlActor;
    use crate::runtime::supervisor_effects::supervisor_effect_context;
    use crate::self_host::SelfHostConfig;
    use crate::self_host::SelfHostRuntimePaths;

    const COMMAND_LINE: &str = "onequery gateway start";
    const LAUNCH_ID: &str = "launch-startup-timeout";
    const RETRY_COMMAND: &str = "onequery gateway start";

    #[tokio::test]
    async fn startup_timeout_cleanup_terminates_child_before_returning() {
        let temp_dir = tempdir().unwrap_or_else(|error| panic!("expected temp dir: {error}"));
        let paths = SelfHostRuntimePaths::from_dirs(
            temp_dir.path().join("config").join("self-host"),
            temp_dir.path().join("data"),
        );
        fs::create_dir_all(&paths.run_dir)
            .unwrap_or_else(|error| panic!("expected run dir: {error}"));
        fs::create_dir_all(&paths.logs_dir)
            .unwrap_or_else(|error| panic!("expected logs dir: {error}"));
        let state = GatewayRuntimeState {
            paths: paths.clone(),
            bootstrapped: true,
            config_created: false,
            secrets_created: false,
            config: Some(SelfHostConfig::default()),
            pglite_dir_present: false,
            log_file_present: false,
            runtime_lease_present: false,
            runtime_status_snapshot_present: false,
        };
        let supervisor = supervisor_identity(1);
        let supervisor_control = SupervisorControlActor::new(supervisor_status(
            &paths,
            &supervisor,
            types::SupervisorPhase::SUPERVISOR_PHASE_STARTING,
            0,
            None,
        ));
        let mut machine = SupervisorMachine::new();

        dispatch_supervisor_event(
            &mut machine,
            SupervisorEvent::LaunchRequested,
            supervisor_effect_context(
                &state,
                &supervisor_control,
                &supervisor,
                LAUNCH_ID,
                COMMAND_LINE,
            ),
            None,
        )
        .await
        .unwrap_or_else(|error| panic!("expected launch request dispatch: {error}"));

        let mut child = ProcessCommand::new("sleep")
            .arg("30")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap_or_else(|error| panic!("expected sleep fixture spawn: {error}"));
        let runtime_pid = child.id();

        dispatch_supervisor_event(
            &mut machine,
            SupervisorEvent::ChildSpawned { runtime_pid },
            supervisor_effect_context(
                &state,
                &supervisor_control,
                &supervisor,
                LAUNCH_ID,
                COMMAND_LINE,
            ),
            None,
        )
        .await
        .unwrap_or_else(|error| panic!("expected child spawned dispatch: {error}"));

        let context = SupervisedRuntimeContext {
            state: &state,
            supervisor_control: &supervisor_control,
            supervisor: &supervisor,
            launch_id: LAUNCH_ID,
            runtime_pid,
            command_line: COMMAND_LINE,
            retry_command: RETRY_COMMAND,
        };
        let check = SupervisedRuntimeStartupCheck {
            state: &state,
            launch_id: LAUNCH_ID,
            runtime_pid,
            command_line: COMMAND_LINE,
            retry_command: RETRY_COMMAND,
        };
        let mut timers = SupervisorTimers::default();

        dispatch_supervisor_event(
            &mut machine,
            SupervisorEvent::StartupDeadlineElapsed {
                message: "startup timed out".to_owned(),
            },
            context.effect_context(),
            Some(&mut timers),
        )
        .await
        .unwrap_or_else(|error| panic!("expected startup timeout dispatch: {error}"));
        cleanup_supervised_runtime_after_startup_timeout(
            context,
            &mut child,
            &mut machine,
            &mut timers,
            &check,
            "startup timed out",
        )
        .await
        .unwrap_or_else(|error| panic!("expected startup cleanup to finish: {error}"));

        assert!(
            !is_process_running(runtime_pid),
            "startup cleanup must not leave the child process running"
        );
        assert_eq!(
            supervisor_snapshot_phase(&paths),
            types::SupervisorPhase::SUPERVISOR_PHASE_FAILED
        );
        assert_eq!(
            runtime_snapshot_phase(&paths),
            types::RuntimePhase::RUNTIME_PHASE_FAILED
        );
    }

    fn supervisor_identity(pid: u32) -> types::SupervisorIdentity {
        types::SupervisorIdentity {
            supervisor_id: Some(format!("gateway-supervisor:{pid}")),
            pid: Some(pid),
            generation: Some(1),
            ..Default::default()
        }
    }

    fn supervisor_status(
        paths: &SelfHostRuntimePaths,
        supervisor: &types::SupervisorIdentity,
        phase: types::SupervisorPhase,
        supervisor_sequence: u64,
        runtime_pid: Option<u32>,
    ) -> types::SupervisorStatus {
        let data_dir = paths.data_dir.display().to_string();
        let runtime = runtime_pid.map(|pid| types::RuntimeIdentity {
            pid: Some(pid),
            launch_id: Some(LAUNCH_ID.to_owned()),
            data_dir: Some(data_dir.clone()),
            ..Default::default()
        });

        types::SupervisorStatus {
            identity: MessageField::some(supervisor.clone()),
            launch: MessageField::some(types::LifecycleLaunchIdentity {
                launch_id: Some(LAUNCH_ID.to_owned()),
                data_dir: Some(data_dir),
                runtime_pid,
                supervisor_pid: supervisor.pid,
                supervisor_generation: supervisor.generation,
                ..Default::default()
            }),
            phase: Some(phase.into()),
            supervisor_sequence: Some(supervisor_sequence),
            runtime: runtime.map(MessageField::some).unwrap_or_default(),
            active_session: Some(false),
            ..Default::default()
        }
    }

    fn supervisor_snapshot_phase(paths: &SelfHostRuntimePaths) -> types::SupervisorPhase {
        let snapshot = lifecycle_records::decode_supervisor_status_snapshot(
            &fs::read_to_string(&paths.supervisor_status_snapshot_path)
                .unwrap_or_else(|error| panic!("expected supervisor snapshot: {error}")),
        )
        .unwrap_or_else(|error| panic!("expected supervisor snapshot decode: {error}"));

        snapshot
            .status
            .as_option()
            .and_then(|status| status.phase)
            .and_then(|phase| phase.as_known())
            .unwrap_or(types::SupervisorPhase::SUPERVISOR_PHASE_UNSPECIFIED)
    }

    fn runtime_snapshot_phase(paths: &SelfHostRuntimePaths) -> types::RuntimePhase {
        let snapshot = lifecycle_records::decode_runtime_status_snapshot(
            &fs::read_to_string(&paths.runtime_status_snapshot_path)
                .unwrap_or_else(|error| panic!("expected runtime snapshot: {error}")),
        )
        .unwrap_or_else(|error| panic!("expected runtime snapshot decode: {error}"));

        snapshot
            .status
            .as_option()
            .and_then(|status| status.phase)
            .and_then(|phase| phase.as_known())
            .unwrap_or(types::RuntimePhase::RUNTIME_PHASE_UNSPECIFIED)
    }
}
