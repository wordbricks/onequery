use std::ffi::OsStr;
use std::path::Path;
use std::process::Child;
use std::process::Command as ProcessCommand;
use std::process::ExitStatus;
use std::process::Stdio;
use std::time::Duration;

use chrono::Utc;
use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;
use serde_json::json;
use tokio::time::sleep;

use crate::GatewayCommandOutput;
use crate::GatewaySupervisorArgs;
use crate::self_host::read_self_host_launch_id;
use crate::self_host::write_self_host_launch_supervisor_identity;
use crate::supervisor_control_proto::types;

use super::super::BACKGROUND_GATEWAY_RETRY_COMMAND;
use super::super::state::GatewayRuntimeState;
use super::process::background_log_stdio;
use super::status::describe_exit_status;
use super::status::exit_signal_label;
use super::status::is_expected_termination;
use super::supervisor_control::actor::SupervisorControlActor;
use super::supervisor_control::server::SupervisorControlServer;
use super::supervisor_control::server::start_supervisor_control_server;
use super::supervisor_control::service::SupervisorControlService;
use super::supervisor_crash_loop::SupervisorCrashLoopDecision;
use super::supervisor_crash_loop::SupervisorCrashLoopPolicy;
use super::supervisor_effects::SupervisorEffectContext;
use super::supervisor_effects::dispatch_supervisor_event;
use super::supervisor_effects::supervisor_effect_context;
use super::supervisor_generation::allocate_supervisor_generation;
use super::supervisor_lifecycle_writer::SupervisorStatusProjection;
use super::supervisor_lifecycle_writer::project_supervisor_status;
use super::supervisor_machine::SupervisorChildExitKind;
use super::supervisor_machine::SupervisorEvent;
use super::supervisor_machine::SupervisorMachine;
use super::supervisor_machine::SupervisorMachineState;
use super::supervisor_monitor::monitor_supervised_runtime;
use super::supervisor_startup::SupervisedRuntimeStartupOutcome;
use super::supervisor_startup::wait_for_supervised_runtime_ready;
use super::transport::retry_command_hint;
use super::transport::spawn_launch_error;

pub(crate) async fn run_gateway_supervisor(
    state: &GatewayRuntimeState,
    args: &GatewaySupervisorArgs,
    command_line: &str,
) -> Result<GatewayCommandOutput, CliError> {
    let launch_id = read_self_host_launch_id(
        args.launch_config.as_path(),
        command_line,
        retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND),
    )?;
    let exit = run_supervised_runtime_to_exit(
        state,
        SupervisedRuntimeLaunch {
            launch_id: launch_id.as_str(),
            runtime_command: args.runtime_command.as_os_str(),
            runtime_entry: args.runtime_entry.as_path(),
            launch_config: args.launch_config.as_path(),
            crash_loop_policy: supervisor_crash_loop_policy_from_args(args),
            retry_command: BACKGROUND_GATEWAY_RETRY_COMMAND,
            stdio: SupervisedRuntimeStdio::Background {
                log_path: state.paths.server_log_path.as_path(),
            },
        },
        command_line,
    )
    .await?;
    let status = exit.status;

    if exit.exit_kind == SupervisorChildExitKind::Expected {
        return Ok(GatewayCommandOutput::structured(
            Vec::new(),
            json!({
                "kind": "gateway-supervisor",
                "status": "stopped",
                "runtimePid": exit.runtime_pid,
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
            retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND),
        ],
    ))
}

pub(super) async fn run_foreground_supervised_runtime(
    state: &GatewayRuntimeState,
    launch_id: &str,
    runtime_command: &OsStr,
    runtime_entry: &Path,
    launch_config: &Path,
    command_line: &str,
    retry_command: &str,
) -> Result<MonitoredRuntimeExit, CliError> {
    let exit = run_supervised_runtime_to_exit(
        state,
        SupervisedRuntimeLaunch {
            launch_id,
            runtime_command,
            runtime_entry,
            launch_config,
            crash_loop_policy: SupervisorCrashLoopPolicy::disabled(),
            retry_command,
            stdio: SupervisedRuntimeStdio::Foreground,
        },
        command_line,
    )
    .await?;

    Ok(MonitoredRuntimeExit {
        status: exit.status,
        kind: monitored_runtime_exit_kind(exit.exit_kind),
    })
}

struct SupervisedRuntimeLaunch<'a> {
    launch_id: &'a str,
    runtime_command: &'a OsStr,
    runtime_entry: &'a Path,
    launch_config: &'a Path,
    crash_loop_policy: SupervisorCrashLoopPolicy,
    retry_command: &'a str,
    stdio: SupervisedRuntimeStdio<'a>,
}

enum SupervisedRuntimeStdio<'a> {
    Foreground,
    Background { log_path: &'a Path },
}

fn supervisor_crash_loop_policy_from_args(
    args: &GatewaySupervisorArgs,
) -> SupervisorCrashLoopPolicy {
    SupervisorCrashLoopPolicy::bounded(
        args.crash_loop_max_restarts,
        Duration::from_millis(args.crash_loop_initial_backoff_ms),
        Duration::from_millis(args.crash_loop_max_backoff_ms),
    )
}

async fn run_supervised_runtime_to_exit(
    state: &GatewayRuntimeState,
    launch: SupervisedRuntimeLaunch<'_>,
    command_line: &str,
) -> Result<SupervisedRuntimeExit, CliError> {
    let supervisor_pid = std::process::id();
    let supervisor_generation =
        allocate_supervisor_generation(&state.paths, supervisor_pid, command_line)?;
    let supervisor = supervisor_identity(supervisor_pid, supervisor_generation);
    stamp_launch_config_supervisor_identity(launch.launch_config, &supervisor, command_line)?;
    let supervisor_control = SupervisorControlActor::new(supervisor_control_status(
        state,
        &supervisor,
        launch.launch_id,
        types::SupervisorPhase::SUPERVISOR_PHASE_STARTING,
        0,
        None,
    ));
    let supervisor_control_server =
        start_supervisor_control_runtime_server(state, supervisor_control.clone(), command_line)
            .await?;
    let mut machine = SupervisorMachine::new();

    let result = async {
        loop {
            dispatch_supervisor_event(
                &mut machine,
                SupervisorEvent::LaunchRequested,
                supervisor_effect_context(
                    state,
                    &supervisor_control,
                    &supervisor,
                    launch.launch_id,
                    command_line,
                ),
                None,
            )
            .await?;

            let mut child = match spawn_supervised_runtime(&launch, command_line) {
                Ok(child) => child,
                Err(error) => {
                    let _ = dispatch_supervisor_event(
                        &mut machine,
                        SupervisorEvent::LaunchFailed {
                            message: error.to_string(),
                        },
                        supervisor_effect_context(
                            state,
                            &supervisor_control,
                            &supervisor,
                            launch.launch_id,
                            command_line,
                        ),
                        None,
                    )
                    .await;
                    return Err(error);
                }
            };
            let runtime_pid = child.id();
            dispatch_supervisor_event(
                &mut machine,
                SupervisorEvent::ChildSpawned { runtime_pid },
                supervisor_effect_context(
                    state,
                    &supervisor_control,
                    &supervisor,
                    launch.launch_id,
                    command_line,
                ),
                None,
            )
            .await?;

            let runtime_context = SupervisedRuntimeContext {
                state,
                supervisor_control: &supervisor_control,
                supervisor: &supervisor,
                launch_id: launch.launch_id,
                runtime_pid,
                command_line,
                retry_command: launch.retry_command,
            };

            let startup_outcome =
                wait_for_supervised_runtime_ready(runtime_context, &mut child, &mut machine)
                    .await?;

            match startup_outcome {
                SupervisedRuntimeStartupOutcome::Ready => {}
                SupervisedRuntimeStartupOutcome::StoppedBeforeReady { exit } => return Ok(exit),
                SupervisedRuntimeStartupOutcome::ExitedBeforeReady { error } => {
                    let restart_backoff = restart_backoff_after_unexpected_exit(
                        state,
                        &supervisor_control,
                        &supervisor,
                        launch.launch_id,
                        launch.crash_loop_policy,
                        command_line,
                        &mut machine,
                    )
                    .await?;

                    if let Some(backoff) = restart_backoff {
                        sleep(backoff).await;
                        continue;
                    }

                    return Err(error);
                }
            }

            let mut exit = monitor_supervised_runtime(runtime_context, &mut child, machine).await?;

            let restart_backoff = restart_backoff_after_unexpected_exit(
                state,
                &supervisor_control,
                &supervisor,
                launch.launch_id,
                launch.crash_loop_policy,
                command_line,
                &mut exit.machine,
            )
            .await?;

            if let Some(backoff) = restart_backoff {
                machine = exit.machine;
                sleep(backoff).await;
                continue;
            }

            return Ok(exit);
        }
    }
    .await;

    stop_supervisor_control_runtime_server(supervisor_control_server, command_line, result).await
}

async fn restart_backoff_after_unexpected_exit(
    state: &GatewayRuntimeState,
    supervisor_control: &SupervisorControlActor,
    supervisor: &types::SupervisorIdentity,
    launch_id: &str,
    crash_loop_policy: SupervisorCrashLoopPolicy,
    command_line: &str,
    machine: &mut SupervisorMachine,
) -> Result<Option<Duration>, CliError> {
    if machine.state() != SupervisorMachineState::Failed {
        return Ok(None);
    }

    let SupervisorCrashLoopDecision::Restart { attempt, backoff } =
        crash_loop_policy.decision_after_unexpected_exit(machine.restart_count())
    else {
        return Ok(None);
    };

    let report = dispatch_supervisor_event(
        machine,
        SupervisorEvent::RestartScheduled {
            restart_attempt: attempt,
            backoff,
        },
        supervisor_effect_context(
            state,
            supervisor_control,
            supervisor,
            launch_id,
            command_line,
        ),
        None,
    )
    .await?;

    report.restart_backoff(command_line).map(Some)
}

fn spawn_supervised_runtime(
    launch: &SupervisedRuntimeLaunch<'_>,
    command_line: &str,
) -> Result<Child, CliError> {
    let mut child = ProcessCommand::new(launch.runtime_command);
    child.arg(launch.runtime_entry);
    child.arg(launch.launch_config);

    match launch.stdio {
        SupervisedRuntimeStdio::Foreground => {
            child
                .stdin(Stdio::inherit())
                .stdout(Stdio::inherit())
                .stderr(Stdio::inherit());
        }
        SupervisedRuntimeStdio::Background { log_path } => {
            child.stdin(Stdio::null());
            child.stdout(background_log_stdio(
                log_path,
                command_line,
                launch.retry_command,
            )?);
            child.stderr(background_log_stdio(
                log_path,
                command_line,
                launch.retry_command,
            )?);
        }
    }

    child.spawn().map_err(|spawn_error| {
        spawn_launch_error(
            &spawn_error,
            launch.runtime_command,
            launch.runtime_entry,
            command_line,
            launch.retry_command,
        )
    })
}

fn stamp_launch_config_supervisor_identity(
    launch_config_path: &Path,
    supervisor: &types::SupervisorIdentity,
    command_line: &str,
) -> Result<(), CliError> {
    write_self_host_launch_supervisor_identity(launch_config_path, command_line, supervisor.clone())
}

async fn start_supervisor_control_runtime_server(
    state: &GatewayRuntimeState,
    actor: SupervisorControlActor,
    command_line: &str,
) -> Result<SupervisorControlServer, CliError> {
    start_supervisor_control_server(
        state.paths.supervisor_control_socket_path.clone(),
        SupervisorControlService::new(actor),
    )
    .await
    .map_err(|error| supervisor_control_server_error(command_line, error))
}

async fn stop_supervisor_control_runtime_server(
    server: SupervisorControlServer,
    command_line: &str,
    result: Result<SupervisedRuntimeExit, CliError>,
) -> Result<SupervisedRuntimeExit, CliError> {
    let stop_result = server
        .stop()
        .await
        .map_err(|error| supervisor_control_server_error(command_line, error));

    match (result, stop_result) {
        (Ok(exit), Ok(())) => Ok(exit),
        (Ok(_), Err(error)) => Err(error),
        (Err(error), _) => Err(error),
    }
}

fn supervisor_control_status(
    state: &GatewayRuntimeState,
    supervisor: &types::SupervisorIdentity,
    launch_id: &str,
    phase: types::SupervisorPhase,
    supervisor_sequence: u64,
    runtime_pid: Option<u32>,
) -> types::SupervisorStatus {
    let data_dir = state.paths.data_dir.display().to_string();
    project_supervisor_status(SupervisorStatusProjection {
        supervisor,
        launch_id,
        data_dir: &data_dir,
        phase,
        supervisor_sequence,
        runtime_pid,
        failure: None,
        active_session: false,
        updated_at: Utc::now(),
    })
}

fn supervisor_control_server_error(
    command_line: &str,
    error: Box<dyn std::error::Error + Send + Sync>,
) -> CliError {
    CliError::new(
        "failed to run gateway supervisor control server",
        command_line,
        ErrorStage::Internal,
        error.to_string(),
        vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
    )
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(super) enum MonitoredRuntimeExitKind {
    Expected,
    Unexpected,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(super) struct MonitoredRuntimeExit {
    pub(super) status: ExitStatus,
    pub(super) kind: MonitoredRuntimeExitKind,
}

pub(super) struct SupervisedRuntimeExit {
    pub(super) runtime_pid: u32,
    pub(super) status: ExitStatus,
    pub(super) exit_kind: SupervisorChildExitKind,
    pub(super) machine: SupervisorMachine,
}

#[derive(Clone, Copy)]
pub(super) struct SupervisedRuntimeContext<'a> {
    pub(super) state: &'a GatewayRuntimeState,
    pub(super) supervisor_control: &'a SupervisorControlActor,
    pub(super) supervisor: &'a types::SupervisorIdentity,
    pub(super) launch_id: &'a str,
    pub(super) runtime_pid: u32,
    pub(super) command_line: &'a str,
    pub(super) retry_command: &'a str,
}

impl<'a> SupervisedRuntimeContext<'a> {
    pub(super) fn effect_context(self) -> SupervisorEffectContext<'a> {
        supervisor_effect_context(
            self.state,
            self.supervisor_control,
            self.supervisor,
            self.launch_id,
            self.command_line,
        )
    }
}

pub(super) fn supervisor_child_exit_kind(
    machine: &SupervisorMachine,
    status: ExitStatus,
) -> SupervisorChildExitKind {
    if status.success()
        || is_expected_termination(status)
        || machine.state() == SupervisorMachineState::Escalating
    {
        SupervisorChildExitKind::Expected
    } else {
        SupervisorChildExitKind::Unexpected
    }
}

fn monitored_runtime_exit_kind(exit_kind: SupervisorChildExitKind) -> MonitoredRuntimeExitKind {
    match exit_kind {
        SupervisorChildExitKind::Expected => MonitoredRuntimeExitKind::Expected,
        SupervisorChildExitKind::Unexpected => MonitoredRuntimeExitKind::Unexpected,
    }
}

pub(super) fn supervisor_id_for_pid(supervisor_pid: u32) -> String {
    format!("gateway-supervisor:{supervisor_pid}")
}

fn supervisor_identity(supervisor_pid: u32, generation: u64) -> types::SupervisorIdentity {
    types::SupervisorIdentity {
        supervisor_id: Some(supervisor_id_for_pid(supervisor_pid)),
        pid: Some(supervisor_pid),
        generation: Some(generation),
        ..Default::default()
    }
}

#[cfg(all(test, unix))]
mod tests {
    use std::fs;
    use std::future::Future;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;
    use std::pin::Pin;

    use futures::StreamExt;
    use pretty_assertions::assert_eq;
    use serde_json::json;
    use tempfile::TempDir;
    use tempfile::tempdir;

    use super::super::lifecycle_records;
    use super::*;
    use crate::runtime::supervisor_effects::SupervisorTimeouts;
    use crate::runtime::supervisor_effects::SupervisorTimers;
    use crate::runtime::supervisor_monitor::SupervisorStopSignalSource;
    use crate::runtime::supervisor_monitor::monitor_supervised_runtime_with_stop_signal;
    use crate::runtime::supervisor_monitor::monitor_supervised_runtime_with_timers;
    use crate::self_host::SelfHostConfig;
    use crate::self_host::SelfHostRuntimePaths;

    const COMMAND_LINE: &str = "onequery gateway start";
    const LAUNCH_ID: &str = "launch-supervisor-escalation";
    const RETRY_COMMAND: &str = "onequery gateway start";

    #[tokio::test]
    async fn stop_monitor_exits_from_stop_requested_when_runtime_honors_graceful_stop() {
        let result = run_stop_escalation_fixture(&["exit-on-graceful-stop"]).await;

        assert_eq!(result.exit_kind, SupervisorChildExitKind::Expected);
        assert_eq!(
            result.child_exit_previous_phase(),
            Some(types::SupervisorPhase::SUPERVISOR_PHASE_STOP_REQUESTED)
        );
        assert_eq!(
            result.final_supervisor_phase,
            types::SupervisorPhase::SUPERVISOR_PHASE_EXITED
        );
        assert!(
            !result.has_phase(types::SupervisorPhase::SUPERVISOR_PHASE_TERMINATING),
            "graceful runtime exit should not require platform termination"
        );
    }

    #[tokio::test]
    async fn stop_monitor_terminates_runtime_that_ignores_graceful_stop() {
        let result =
            run_stop_escalation_fixture(&["ignore-graceful-stop", "exit-on-sigterm"]).await;

        assert_eq!(result.exit_kind, SupervisorChildExitKind::Expected);
        assert_eq!(
            result.child_exit_previous_phase(),
            Some(types::SupervisorPhase::SUPERVISOR_PHASE_TERMINATING)
        );
        assert_eq!(
            result.final_supervisor_phase,
            types::SupervisorPhase::SUPERVISOR_PHASE_EXITED
        );
        assert!(result.has_phase(types::SupervisorPhase::SUPERVISOR_PHASE_TERMINATING));
        assert!(
            !result.has_phase(types::SupervisorPhase::SUPERVISOR_PHASE_ESCALATING),
            "runtime exited during platform termination before hard-kill escalation"
        );
    }

    #[tokio::test]
    async fn stop_monitor_hard_kills_runtime_that_ignores_graceful_stop_and_sigterm() {
        // COMMENT: This fixture uses a real Bun child process. After SIGKILL,
        // CI can be slow to schedule the supervisor back onto the CPU to reap
        // the child, so this test gets a realistic hard-kill observation window
        // without slowing the other stop-escalation cases.
        let result = run_stop_escalation_fixture_with_kill_timeout(
            &["ignore-graceful-stop", "ignore-sigterm"],
            Duration::from_secs(1),
        )
        .await;

        assert_eq!(result.exit_kind, SupervisorChildExitKind::Expected);
        assert_eq!(
            result.child_exit_previous_phase(),
            Some(types::SupervisorPhase::SUPERVISOR_PHASE_ESCALATING)
        );
        assert_eq!(
            result.final_supervisor_phase,
            types::SupervisorPhase::SUPERVISOR_PHASE_EXITED
        );
        assert_eq!(result.signal.as_deref(), Some("SIGKILL"));
        assert!(result.has_phase(types::SupervisorPhase::SUPERVISOR_PHASE_TERMINATING));
        assert!(result.has_phase(types::SupervisorPhase::SUPERVISOR_PHASE_ESCALATING));
    }

    #[tokio::test]
    async fn stop_rpc_without_active_session_escalates_to_terminate_and_returns_accepted() {
        let fixture = SupervisorFixture::new();
        let state = fixture.state();
        let supervisor = supervisor_identity(std::process::id(), 1);
        let supervisor_control = SupervisorControlActor::new(supervisor_control_status(
            &state,
            &supervisor,
            LAUNCH_ID,
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
        dispatch_supervisor_event(
            &mut machine,
            SupervisorEvent::ControlSocketObserved,
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
        .unwrap_or_else(|error| panic!("expected control socket dispatch: {error}"));
        dispatch_supervisor_event(
            &mut machine,
            SupervisorEvent::WatchReady,
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
        .unwrap_or_else(|error| panic!("expected watch ready dispatch: {error}"));

        let runtime_context = SupervisedRuntimeContext {
            state: &state,
            supervisor_control: &supervisor_control,
            supervisor: &supervisor,
            launch_id: LAUNCH_ID,
            runtime_pid,
            command_line: COMMAND_LINE,
            retry_command: RETRY_COMMAND,
        };
        let mut watch = supervisor_control.watch_status(0, false).await;
        let mut stop_signal = PendingStopSignal;
        let stop_request =
            supervisor_control.request_stop("00000000-0000-4000-8000-000000000771".to_owned());
        let monitor = monitor_supervised_runtime_with_stop_signal(
            runtime_context,
            &mut child,
            machine,
            &mut stop_signal,
        );

        let (stop_response, exit) = tokio::join!(stop_request, monitor);
        let stop_response = stop_response
            .unwrap_or_else(|error| panic!("expected accepted stop response: {error}"));
        let exit = exit.unwrap_or_else(|error| panic!("expected stop escalation exit: {error}"));

        assert_eq!(
            stop_response.disposition.and_then(|value| value.as_known()),
            Some(types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ACCEPTED)
        );
        assert_eq!(exit.exit_kind, SupervisorChildExitKind::Expected);
        assert!(
            supervisor_transitions(&fixture.paths)
                .iter()
                .any(|transition| transition.current_phase
                    == types::SupervisorPhase::SUPERVISOR_PHASE_TERMINATING),
            "missing stop escalation terminate transition"
        );

        let watch_response = watch
            .next()
            .await
            .expect("expected stop transition watch response")
            .expect("expected successful watch response");
        let Some(
            types::supervisor_lifecycle_service_watch_status_response::Event::SupervisorTransition(
                transition,
            ),
        ) = watch_response.event
        else {
            panic!("expected supervisor transition watch event");
        };
        assert_eq!(
            transition.current_phase,
            Some(types::SupervisorPhase::SUPERVISOR_PHASE_STOP_REQUESTED.into())
        );
    }

    #[tokio::test]
    async fn stop_rpc_during_startup_returns_before_runtime_ready() {
        let fixture = SupervisorFixture::new();
        let state = fixture.state();
        let supervisor = supervisor_identity(std::process::id(), 1);
        let supervisor_control = SupervisorControlActor::new(supervisor_control_status(
            &state,
            &supervisor,
            LAUNCH_ID,
            types::SupervisorPhase::SUPERVISOR_PHASE_STARTING,
            0,
            None,
        ));
        let supervisor_control_server =
            start_supervisor_control_fixture_server(&fixture, supervisor_control.clone()).await;
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

        let mut child = spawn_supervisor_fixture_runtime(&fixture, &["--ready-delay-ms=1000"]);
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

        let runtime_context = SupervisedRuntimeContext {
            state: &state,
            supervisor_control: &supervisor_control,
            supervisor: &supervisor,
            launch_id: LAUNCH_ID,
            runtime_pid,
            command_line: COMMAND_LINE,
            retry_command: RETRY_COMMAND,
        };
        let mut startup = Box::pin(wait_for_supervised_runtime_ready(
            runtime_context,
            &mut child,
            &mut machine,
        ));

        loop {
            tokio::select! {
                outcome = &mut startup => {
                    let _ = outcome;
                    panic!("startup completed before stop request could be issued");
                }
                () = tokio::time::sleep(Duration::from_millis(10)) => {
                    if supervisor_control.snapshot().await.active_session == Some(true) {
                        break;
                    }
                }
            }
        }

        let stop_request =
            supervisor_control.request_stop("00000000-0000-4000-8000-000000000772".to_owned());
        let (stop_response, startup_outcome) = tokio::join!(stop_request, startup);
        let stop_response = stop_response
            .unwrap_or_else(|error| panic!("expected accepted startup stop response: {error}"));
        let startup_outcome =
            startup_outcome.unwrap_or_else(|error| panic!("expected startup stop exit: {error}"));

        assert_eq!(
            stop_response.disposition.and_then(|value| value.as_known()),
            Some(types::RuntimeStopDisposition::RUNTIME_STOP_DISPOSITION_ACCEPTED)
        );
        match startup_outcome {
            SupervisedRuntimeStartupOutcome::StoppedBeforeReady { exit } => {
                assert_eq!(exit.exit_kind, SupervisorChildExitKind::Expected);
            }
            SupervisedRuntimeStartupOutcome::Ready => {
                panic!("startup unexpectedly reported ready after startup stop")
            }
            SupervisedRuntimeStartupOutcome::ExitedBeforeReady { error } => {
                panic!("startup stop exited with an error: {error}")
            }
        }

        supervisor_control_server
            .stop()
            .await
            .unwrap_or_else(|error| panic!("expected supervisor control server stop: {error}"));
    }

    async fn run_stop_escalation_fixture(modes: &[&str]) -> StopEscalationResult {
        run_stop_escalation_fixture_with_kill_timeout(modes, Duration::from_millis(150)).await
    }

    async fn run_stop_escalation_fixture_with_kill_timeout(
        modes: &[&str],
        kill_timeout: Duration,
    ) -> StopEscalationResult {
        let fixture = SupervisorFixture::new();
        let state = fixture.state();
        let supervisor = supervisor_identity(std::process::id(), 1);
        let supervisor_control = SupervisorControlActor::new(supervisor_control_status(
            &state,
            &supervisor,
            LAUNCH_ID,
            types::SupervisorPhase::SUPERVISOR_PHASE_STARTING,
            0,
            None,
        ));
        let supervisor_control_server =
            start_supervisor_control_fixture_server(&fixture, supervisor_control.clone()).await;
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

        let mut child = spawn_supervisor_fixture_runtime(&fixture, modes);
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

        let runtime_context = SupervisedRuntimeContext {
            state: &state,
            supervisor_control: &supervisor_control,
            supervisor: &supervisor,
            launch_id: LAUNCH_ID,
            runtime_pid,
            command_line: COMMAND_LINE,
            retry_command: RETRY_COMMAND,
        };

        match wait_for_supervised_runtime_ready(runtime_context, &mut child, &mut machine)
            .await
            .unwrap_or_else(|error| panic!("expected runtime fixture readiness: {error}"))
        {
            SupervisedRuntimeStartupOutcome::Ready => {}
            SupervisedRuntimeStartupOutcome::StoppedBeforeReady { exit } => {
                panic!("runtime fixture stopped before ready: {:?}", exit.status);
            }
            SupervisedRuntimeStartupOutcome::ExitedBeforeReady { error } => {
                panic!("runtime fixture exited before ready: {error}");
            }
        }

        let mut stop_signal = ImmediateStopSignal::default();
        let timers = SupervisorTimers::with_timeouts(
            SupervisorTimeouts::default().with_kill_timeout(kill_timeout),
        );
        let exit = monitor_supervised_runtime_with_timers(
            runtime_context,
            &mut child,
            machine,
            &mut stop_signal,
            timers,
        )
        .await
        .unwrap_or_else(|error| panic!("expected supervised runtime stop: {error}"));
        supervisor_control_server
            .stop()
            .await
            .unwrap_or_else(|error| panic!("expected supervisor control server stop: {error}"));
        let transitions = supervisor_transitions(&fixture.paths);
        let final_supervisor_phase = supervisor_snapshot_phase(&fixture.paths);

        StopEscalationResult {
            exit_kind: exit.exit_kind,
            final_supervisor_phase,
            signal: exit_signal_label(exit.status),
            transitions,
        }
    }

    fn supervisor_fixture_runtime_path() -> PathBuf {
        onequery_utils::repo_root()
            .unwrap_or_else(|error| panic!("expected repo root from onequery-utils: {error}"))
            .join("apps")
            .join("cli")
            .join("crates")
            .join("gateway")
            .join("tests")
            .join("fixtures")
            .join("supervisor-escalation-runtime.ts")
    }

    fn spawn_supervisor_fixture_runtime(fixture: &SupervisorFixture, modes: &[&str]) -> Child {
        let repo_root = onequery_utils::repo_root()
            .unwrap_or_else(|error| panic!("expected repo root from onequery-utils: {error}"));
        let fixture_path = supervisor_fixture_runtime_path();
        let mut command = ProcessCommand::new("bun");
        command
            .arg(fixture_path)
            .arg(&fixture.launch_config_path)
            .args(modes)
            .current_dir(repo_root)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        command
            .spawn()
            .unwrap_or_else(|error| panic!("expected supervisor runtime fixture spawn: {error}"))
    }

    #[derive(Default)]
    struct ImmediateStopSignal {
        delivered: bool,
    }

    impl SupervisorStopSignalSource for ImmediateStopSignal {
        fn recv(&mut self) -> Pin<Box<dyn Future<Output = ()> + '_>> {
            if self.delivered {
                return Box::pin(std::future::pending());
            }

            self.delivered = true;
            Box::pin(std::future::ready(()))
        }
    }

    struct PendingStopSignal;

    impl SupervisorStopSignalSource for PendingStopSignal {
        fn recv(&mut self) -> Pin<Box<dyn Future<Output = ()> + '_>> {
            Box::pin(std::future::pending())
        }
    }

    struct SupervisorFixture {
        _temp_dir: TempDir,
        launch_config_path: PathBuf,
        paths: SelfHostRuntimePaths,
        socket_parent: PathBuf,
    }

    impl SupervisorFixture {
        fn new() -> Self {
            let temp_dir =
                tempdir().unwrap_or_else(|error| panic!("expected supervisor temp dir: {error}"));
            let paths = SelfHostRuntimePaths::from_dirs(
                temp_dir.path().join("self-host"),
                temp_dir.path().to_path_buf(),
            );
            fs::create_dir_all(&paths.run_dir)
                .unwrap_or_else(|error| panic!("expected run dir creation: {error}"));
            fs::create_dir_all(&paths.logs_dir)
                .unwrap_or_else(|error| panic!("expected logs dir creation: {error}"));

            let socket_parent = paths
                .supervisor_control_socket_path
                .parent()
                .unwrap_or_else(|| panic!("expected supervisor control socket parent"))
                .to_path_buf();
            fs::create_dir_all(&socket_parent)
                .unwrap_or_else(|error| panic!("expected socket parent creation: {error}"));
            let mut permissions = fs::metadata(&socket_parent)
                .unwrap_or_else(|error| panic!("expected socket parent metadata: {error}"))
                .permissions();
            permissions.set_mode(0o700);
            fs::set_permissions(&socket_parent, permissions)
                .unwrap_or_else(|error| panic!("expected private socket parent: {error}"));

            let launch_config_path = temp_dir.path().join("launch.json");
            let supervisor_pid = std::process::id();
            let launch_config = json!({
                "selfHost": {
                    "common": {
                        "assets": {
                            "distDir": temp_dir.path().join("assets").display().to_string(),
                        },
                        "auth": {
                            "secret": "fixture-auth-secret",
                        },
                        "connectors": {
                            "enrollmentToken": "fixture-enrollment-token",
                        },
                        "crypto": {
                            "masterEncryptionKey": "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
                        },
                        "listen": {
                            "host": "127.0.0.1",
                            "port": 7777,
                        },
                        "migrations": {
                            "dir": temp_dir.path().join("migrations").display().to_string(),
                        },
                        "publicOrigin": "http://127.0.0.1:7777",
                        "rateLimit": {
                            "api": {
                                "storage": "SERVER_LAUNCH_API_RATE_LIMIT_STORAGE_PERSISTENT",
                            },
                            "enabled": true,
                        },
                        "storage": {
                            "pglite": {
                                "dir": paths.pglite_dir.display().to_string(),
                            },
                        },
                    },
                    "launchId": LAUNCH_ID,
                    "supervisor": {
                        "generation": "1",
                        "pid": supervisor_pid,
                        "supervisorId": supervisor_id_for_pid(supervisor_pid),
                    },
                    "supervisorControl": {
                        "baseUrl": crate::supervisor_control_protocol::SUPERVISOR_CONTROL_AUTHORITY,
                        "maxMessageBytes": crate::supervisor_control_protocol::SUPERVISOR_CONTROL_MAX_MESSAGE_SIZE_BYTES,
                        "transport": {
                            "unix": {
                                "socketPath": paths.supervisor_control_socket_path.display().to_string(),
                            },
                        },
                    },
                    "runtimePaths": {
                        "backupsDir": paths.backups_dir.display().to_string(),
                        "dataDir": paths.data_dir.display().to_string(),
                        "lifecycleEventLogPath": paths.lifecycle_event_log_path.display().to_string(),
                        "logsDir": paths.logs_dir.display().to_string(),
                        "runDir": paths.run_dir.display().to_string(),
                        "runtimeLeasePath": paths.runtime_lease_path.display().to_string(),
                        "runtimeStatusSnapshotPath": paths.runtime_status_snapshot_path.display().to_string(),
                    },
                }
            });
            fs::write(
                &launch_config_path,
                serde_json::to_string_pretty(&launch_config).unwrap_or_else(|error| {
                    panic!("expected launch config serialization: {error}")
                }),
            )
            .unwrap_or_else(|error| panic!("expected launch config write: {error}"));

            Self {
                _temp_dir: temp_dir,
                launch_config_path,
                paths,
                socket_parent,
            }
        }

        fn state(&self) -> GatewayRuntimeState {
            GatewayRuntimeState {
                paths: self.paths.clone(),
                bootstrapped: true,
                config_created: false,
                secrets_created: false,
                config: Some(SelfHostConfig::default()),
                pglite_dir_present: false,
                log_file_present: false,
                runtime_lease_present: false,
                runtime_status_snapshot_present: false,
            }
        }
    }

    async fn start_supervisor_control_fixture_server(
        fixture: &SupervisorFixture,
        actor: SupervisorControlActor,
    ) -> SupervisorControlServer {
        start_supervisor_control_server(
            fixture.paths.supervisor_control_socket_path.clone(),
            SupervisorControlService::new(actor),
        )
        .await
        .unwrap_or_else(|error| panic!("expected supervisor control fixture server: {error}"))
    }

    impl Drop for SupervisorFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.socket_parent);
        }
    }

    struct StopEscalationResult {
        exit_kind: SupervisorChildExitKind,
        final_supervisor_phase: types::SupervisorPhase,
        signal: Option<String>,
        transitions: Vec<SupervisorTransitionRecord>,
    }

    impl StopEscalationResult {
        fn child_exit_previous_phase(&self) -> Option<types::SupervisorPhase> {
            self.transitions
                .iter()
                .find(|transition| transition.event == "child_exited")
                .map(|transition| transition.previous_phase)
        }

        fn has_phase(&self, phase: types::SupervisorPhase) -> bool {
            self.transitions
                .iter()
                .any(|transition| transition.current_phase == phase)
        }
    }

    #[derive(Debug, Clone, Eq, PartialEq)]
    struct SupervisorTransitionRecord {
        current_phase: types::SupervisorPhase,
        event: String,
        previous_phase: types::SupervisorPhase,
    }

    fn supervisor_transitions(paths: &SelfHostRuntimePaths) -> Vec<SupervisorTransitionRecord> {
        lifecycle_records::decode_lifecycle_event_log_entries(
            &fs::read(&paths.lifecycle_event_log_path)
                .unwrap_or_else(|error| panic!("expected lifecycle event log read: {error}")),
        )
        .unwrap_or_else(|error| panic!("expected lifecycle event log decode: {error}"))
        .into_iter()
        .filter_map(|entry| {
            let transition = match entry.payload.as_ref()? {
                types::lifecycle_event_log_entry::Payload::SupervisorTransition(transition) => {
                    transition
                }
                _ => return None,
            };
            Some(SupervisorTransitionRecord {
                current_phase: transition
                    .current_phase
                    .and_then(|phase| phase.as_known())
                    .unwrap_or(types::SupervisorPhase::SUPERVISOR_PHASE_UNSPECIFIED),
                event: entry
                    .transition_id
                    .as_deref()
                    .and_then(|transition_id| transition_id.rsplit(':').next())
                    .unwrap_or("unknown")
                    .to_owned(),
                previous_phase: transition
                    .previous_phase
                    .and_then(|phase| phase.as_known())
                    .unwrap_or(types::SupervisorPhase::SUPERVISOR_PHASE_UNSPECIFIED),
            })
        })
        .collect()
    }

    fn supervisor_snapshot_phase(paths: &SelfHostRuntimePaths) -> types::SupervisorPhase {
        let snapshot = lifecycle_records::decode_supervisor_status_snapshot(
            &fs::read_to_string(&paths.supervisor_status_snapshot_path)
                .unwrap_or_else(|error| panic!("expected supervisor snapshot read: {error}")),
        )
        .unwrap_or_else(|error| panic!("expected supervisor snapshot decode: {error}"));
        snapshot
            .status
            .as_option()
            .and_then(|status| status.phase)
            .and_then(|phase| phase.as_known())
            .unwrap_or(types::SupervisorPhase::SUPERVISOR_PHASE_UNSPECIFIED)
    }
}
