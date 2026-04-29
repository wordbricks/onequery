use std::ffi::OsStr;
use std::path::Path;
use std::process::Child;
use std::process::Command as ProcessCommand;
use std::process::ExitStatus;
use std::process::Stdio;
use std::time::Duration;

use buffa::MessageField;
use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;
use serde_json::json;
use tokio::time::sleep;

use crate::GatewayCommandOutput;
use crate::GatewaySupervisorArgs;
use crate::runtime_control::types;
use crate::self_host::ServerLaunchSupervisorConfig;
use crate::self_host::write_self_host_launch_supervisor_identity;

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
    let launch_id = read_supervised_launch_id(args.launch_config.as_path(), command_line)?;
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

            if let SupervisedRuntimeStartupOutcome::ExitedBeforeReady { error } = startup_outcome {
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
    let supervisor_id = supervisor.supervisor_id.clone().ok_or_else(|| {
        CliError::internal(
            command_line.to_owned(),
            "supervisor identity omitted supervisor id before runtime launch",
        )
    })?;
    let pid = supervisor.pid.ok_or_else(|| {
        CliError::internal(
            command_line.to_owned(),
            "supervisor identity omitted pid before runtime launch",
        )
    })?;
    let generation = supervisor.generation.ok_or_else(|| {
        CliError::internal(
            command_line.to_owned(),
            "supervisor identity omitted generation before runtime launch",
        )
    })?;

    write_self_host_launch_supervisor_identity(
        launch_config_path,
        command_line,
        ServerLaunchSupervisorConfig {
            generation: generation.to_string(),
            pid,
            supervisor_id,
        },
    )
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
    let runtime = runtime_pid.map(|pid| types::RuntimeIdentity {
        pid: Some(pid),
        launch_id: Some(launch_id.to_owned()),
        data_dir: Some(data_dir.clone()),
        ..Default::default()
    });

    types::SupervisorStatus {
        identity: MessageField::some(supervisor.clone()),
        launch: MessageField::some(types::LifecycleLaunchIdentity {
            launch_id: Some(launch_id.to_owned()),
            data_dir: Some(data_dir),
            runtime_pid,
            supervisor_pid: supervisor.pid,
            supervisor_generation: supervisor.generation,
            ..Default::default()
        }),
        phase: Some(phase.into()),
        supervisor_sequence: Some(supervisor_sequence),
        active_session: Some(false),
        runtime: runtime.map(MessageField::some).unwrap_or_default(),
        ..Default::default()
    }
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

fn read_supervised_launch_id(
    path: &std::path::Path,
    command_line: &str,
) -> Result<String, CliError> {
    let contents = std::fs::read_to_string(path).map_err(|error| {
        CliError::new(
            "failed to read self-host launch config for supervisor status",
            command_line,
            ErrorStage::Internal,
            format!("{error} ({})", path.display()),
            vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
        )
    })?;
    let value = serde_json::from_str::<serde_json::Value>(&contents).map_err(|error| {
        CliError::new(
            "failed to parse self-host launch config for supervisor status",
            command_line,
            ErrorStage::Internal,
            format!("{error} ({})", path.display()),
            vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
        )
    })?;

    value
        .get("launchId")
        .and_then(serde_json::Value::as_str)
        .filter(|launch_id| !launch_id.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| {
            CliError::new(
                "self-host launch config omitted launch id for supervisor status",
                command_line,
                ErrorStage::Internal,
                format!("{}", path.display()),
                vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
            )
        })
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
    use std::ffi::OsString;
    use std::fs;
    use std::future::Future;
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;
    use std::pin::Pin;

    use pretty_assertions::assert_eq;
    use serde_json::json;
    use tempfile::TempDir;
    use tempfile::tempdir;

    use super::super::lifecycle_records;
    use super::*;
    use crate::runtime::supervisor_monitor::SupervisorStopSignalSource;
    use crate::runtime::supervisor_monitor::monitor_supervised_runtime_with_stop_signal;
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
        let result = run_stop_escalation_fixture(&["ignore-graceful-stop", "ignore-sigterm"]).await;

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
    async fn foreground_and_background_launch_modes_share_startup_handshake() {
        let foreground = run_launch_mode_parity_fixture(LaunchParityMode::Foreground).await;
        let background = run_launch_mode_parity_fixture(LaunchParityMode::Background).await;

        assert_eq!(foreground.transitions, background.transitions);
        assert_eq!(
            foreground.transitions,
            vec![
                SupervisorTransitionRecord {
                    current_phase: types::SupervisorPhase::SUPERVISOR_PHASE_STARTING,
                    event: "launch_requested".to_owned(),
                    previous_phase: types::SupervisorPhase::SUPERVISOR_PHASE_STARTING,
                },
                SupervisorTransitionRecord {
                    current_phase: types::SupervisorPhase::SUPERVISOR_PHASE_HANDSHAKING,
                    event: "child_spawned".to_owned(),
                    previous_phase: types::SupervisorPhase::SUPERVISOR_PHASE_STARTING,
                },
                SupervisorTransitionRecord {
                    current_phase: types::SupervisorPhase::SUPERVISOR_PHASE_HANDSHAKING,
                    event: "control_socket_observed".to_owned(),
                    previous_phase: types::SupervisorPhase::SUPERVISOR_PHASE_HANDSHAKING,
                },
                SupervisorTransitionRecord {
                    current_phase: types::SupervisorPhase::SUPERVISOR_PHASE_READY,
                    event: "watch_ready".to_owned(),
                    previous_phase: types::SupervisorPhase::SUPERVISOR_PHASE_HANDSHAKING,
                },
                SupervisorTransitionRecord {
                    current_phase: types::SupervisorPhase::SUPERVISOR_PHASE_EXITED,
                    event: "child_exited".to_owned(),
                    previous_phase: types::SupervisorPhase::SUPERVISOR_PHASE_READY,
                },
            ]
        );
        assert!(
            !foreground.log_file_present,
            "foreground launch should inherit stdio without creating background log capture"
        );
        assert!(
            background.log_file_present,
            "background launch should capture runtime stdio in the gateway log"
        );
    }

    #[derive(Debug, Clone, Copy)]
    enum LaunchParityMode {
        Foreground,
        Background,
    }

    struct LaunchParityResult {
        log_file_present: bool,
        transitions: Vec<SupervisorTransitionRecord>,
    }

    async fn run_launch_mode_parity_fixture(mode: LaunchParityMode) -> LaunchParityResult {
        let fixture = SupervisorFixture::new_with_test_launch_options(
            &["exit-after-ready"],
            Some(500),
            Some(150),
        );
        let state = fixture.state();
        let runtime_entry = supervisor_fixture_runtime_path();

        match mode {
            LaunchParityMode::Foreground => {
                let runtime_command = OsString::from("bun");
                let exit = run_foreground_supervised_runtime(
                    &state,
                    LAUNCH_ID,
                    runtime_command.as_os_str(),
                    runtime_entry.as_path(),
                    fixture.launch_config_path.as_path(),
                    COMMAND_LINE,
                    RETRY_COMMAND,
                )
                .await
                .unwrap_or_else(|error| {
                    panic!("expected foreground supervisor parity run: {error}")
                });

                assert_eq!(exit.kind, MonitoredRuntimeExitKind::Expected);
            }
            LaunchParityMode::Background => {
                let output = run_gateway_supervisor(
                    &state,
                    &crate::GatewaySupervisorArgs {
                        runtime_command: OsString::from("bun"),
                        runtime_entry,
                        launch_config: fixture.launch_config_path.clone(),
                        crash_loop_max_restarts: 0,
                        crash_loop_initial_backoff_ms: 1,
                        crash_loop_max_backoff_ms: 1,
                    },
                    COMMAND_LINE,
                )
                .await
                .unwrap_or_else(|error| {
                    panic!("expected background supervisor parity run: {error}")
                });

                assert_eq!(
                    output
                        .data
                        .get("status")
                        .and_then(serde_json::Value::as_str),
                    Some("stopped")
                );
            }
        }

        LaunchParityResult {
            log_file_present: fixture.paths.server_log_path.is_file(),
            transitions: supervisor_transitions(&fixture.paths),
        }
    }

    async fn run_stop_escalation_fixture(modes: &[&str]) -> StopEscalationResult {
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
            SupervisedRuntimeStartupOutcome::ExitedBeforeReady { error } => {
                panic!("runtime fixture exited before ready: {error}");
            }
        }

        let mut stop_signal = ImmediateStopSignal::default();
        let exit = monitor_supervised_runtime_with_stop_signal(
            runtime_context,
            &mut child,
            machine,
            &mut stop_signal,
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

    struct SupervisorFixture {
        _temp_dir: TempDir,
        launch_config_path: PathBuf,
        paths: SelfHostRuntimePaths,
        socket_parent: PathBuf,
    }

    impl SupervisorFixture {
        fn new() -> Self {
            Self::new_with_test_launch_options(&[], None, None)
        }

        fn new_with_test_launch_options(
            test_modes: &[&str],
            test_ready_delay_ms: Option<u64>,
            test_exit_after_ready_delay_ms: Option<u64>,
        ) -> Self {
            let temp_dir =
                tempdir().unwrap_or_else(|error| panic!("expected supervisor temp dir: {error}"));
            let paths = SelfHostRuntimePaths::from_dirs(
                temp_dir.path().join("config").join("self-host"),
                temp_dir.path().join("data"),
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
            let mut launch_config = json!({
                "launchId": LAUNCH_ID,
                "supervisor": {
                    "generation": "1",
                    "pid": supervisor_pid,
                    "supervisorId": supervisor_id_for_pid(supervisor_pid),
                },
                "supervisorControl": {
                    "transport": {
                        "kind": "unix",
                        "socketPath": paths.supervisor_control_socket_path.display().to_string(),
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
            });
            if !test_modes.is_empty() {
                launch_config["testModes"] = json!(test_modes);
            }
            if let Some(delay_ms) = test_ready_delay_ms {
                launch_config["testReadyDelayMs"] = json!(delay_ms);
            }
            if let Some(delay_ms) = test_exit_after_ready_delay_ms {
                launch_config["testExitAfterReadyDelayMs"] = json!(delay_ms);
            }
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
