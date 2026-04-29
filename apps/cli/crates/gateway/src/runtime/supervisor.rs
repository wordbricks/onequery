use std::process::Child;
use std::process::Command as ProcessCommand;
use std::process::ExitStatus;
use std::process::Stdio;
use std::time::Duration;

use buffa::MessageField;
use chrono::Utc;
use connectrpc::ConnectError;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use serde_json::json;
use tokio::time::Instant;
use tokio::time::sleep;

use crate::GatewayCommandOutput;
use crate::GatewaySupervisorArgs;
use crate::runtime_control::types;
use crate::self_host::SelfHostRuntimePaths;
use onequery_cli_core::path_utils;

use super::super::BACKGROUND_GATEWAY_RETRY_COMMAND;
use super::super::state::GatewayRuntimeState;
use super::control::request_runtime_control_stop;
use super::control::runtime_control_error_allows_fallback;
use super::control_error::runtime_control_connect_error_summary;
use super::control_error::with_runtime_control_connect_error_metadata;
use super::lifecycle::ManagedRuntimeIdentity;
use super::lifecycle_records;
use super::process::background_log_stdio;
use super::shutdown::terminate_process;
use super::status::describe_exit_status;
use super::status::exit_signal_label;
use super::status::is_expected_termination;
use super::transport::retry_command_hint;
use super::transport::spawn_launch_error;

const SUPERVISOR_POLL_INTERVAL: Duration = Duration::from_millis(100);
const LIFECYCLE_SCHEMA_VERSION: u32 = 1;
const SUPERVISOR_GENERATION: u64 = 1;
const SUPERVISOR_RUNTIME_STOP_REASON: &str = "onequery gateway stop";
const SUPERVISOR_RUNTIME_STOP_GRACE_TIMEOUT: Duration = Duration::from_secs(30);
const SUPERVISOR_RUNTIME_TERMINATE_TIMEOUT: Duration = Duration::from_secs(5);

pub(crate) async fn run_gateway_supervisor(
    state: &GatewayRuntimeState,
    args: &GatewaySupervisorArgs,
    command_line: &str,
) -> Result<GatewayCommandOutput, CliError> {
    let supervisor_pid = std::process::id();
    let launch_id = read_supervised_launch_id(args.launch_config.as_path(), command_line)?;
    let supervisor = supervisor_identity(supervisor_pid);

    write_supervisor_status_snapshot(
        &state.paths,
        &supervisor,
        &launch_id,
        types::SupervisorPhase::SUPERVISOR_PHASE_STARTING,
        1,
        None,
        command_line,
    )?;

    let mut child = match spawn_supervised_runtime(state, args, command_line) {
        Ok(child) => child,
        Err(error) => {
            let _ = write_supervisor_status_snapshot(
                &state.paths,
                &supervisor,
                &launch_id,
                types::SupervisorPhase::SUPERVISOR_PHASE_FAILED,
                2,
                None,
                command_line,
            );
            return Err(error);
        }
    };
    let runtime_pid = child.id();
    let _ = write_supervisor_status_snapshot(
        &state.paths,
        &supervisor,
        &launch_id,
        types::SupervisorPhase::SUPERVISOR_PHASE_READY,
        2,
        Some(runtime_pid),
        command_line,
    );

    let exit = monitor_supervised_runtime(
        state,
        &supervisor,
        &launch_id,
        runtime_pid,
        &mut child,
        command_line,
        2,
    )
    .await?;
    let status = exit.status;

    finalize_supervisor_state(
        state,
        &supervisor,
        &launch_id,
        runtime_pid,
        status,
        exit.supervisor_sequence + 1,
        command_line,
    );

    if status.success() || is_expected_termination(status) {
        return Ok(GatewayCommandOutput::structured(
            Vec::new(),
            json!({
                "kind": "gateway-supervisor",
                "status": "stopped",
                "runtimePid": runtime_pid,
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

fn spawn_supervised_runtime(
    state: &GatewayRuntimeState,
    args: &GatewaySupervisorArgs,
    command_line: &str,
) -> Result<Child, CliError> {
    let mut child = ProcessCommand::new(&args.runtime_command);
    child.arg(&args.runtime_entry);
    child.arg(&args.launch_config);
    child.stdin(Stdio::null());
    child.stdout(background_log_stdio(
        state.paths.server_log_path.as_path(),
        command_line,
        BACKGROUND_GATEWAY_RETRY_COMMAND,
    )?);
    child.stderr(background_log_stdio(
        state.paths.server_log_path.as_path(),
        command_line,
        BACKGROUND_GATEWAY_RETRY_COMMAND,
    )?);

    child.spawn().map_err(|spawn_error| {
        spawn_launch_error(
            &spawn_error,
            &args.runtime_command,
            args.runtime_entry.as_path(),
            command_line,
            BACKGROUND_GATEWAY_RETRY_COMMAND,
        )
    })
}

pub(super) async fn monitor_foreground_runtime(
    state: &GatewayRuntimeState,
    launch_id: &str,
    runtime_pid: u32,
    child: &mut Child,
    command_line: &str,
) -> Result<ExitStatus, CliError> {
    let supervisor = supervisor_identity(std::process::id());

    write_supervisor_status_snapshot(
        &state.paths,
        &supervisor,
        launch_id,
        types::SupervisorPhase::SUPERVISOR_PHASE_READY,
        1,
        Some(runtime_pid),
        command_line,
    )?;

    let exit = monitor_supervised_runtime(
        state,
        &supervisor,
        launch_id,
        runtime_pid,
        child,
        command_line,
        1,
    )
    .await?;

    finalize_supervisor_state(
        state,
        &supervisor,
        launch_id,
        runtime_pid,
        exit.status,
        exit.supervisor_sequence + 1,
        command_line,
    );

    Ok(exit.status)
}

struct SupervisedRuntimeExit {
    status: ExitStatus,
    supervisor_sequence: u64,
}

async fn monitor_supervised_runtime(
    state: &GatewayRuntimeState,
    supervisor: &types::SupervisorIdentity,
    launch_id: &str,
    runtime_pid: u32,
    child: &mut Child,
    command_line: &str,
    initial_supervisor_sequence: u64,
) -> Result<SupervisedRuntimeExit, CliError> {
    let mut stop_signal = SupervisorStopSignal::new(command_line)?;
    let mut stop_deadline = None;
    let mut terminate_deadline = None;
    let mut supervisor_sequence = initial_supervisor_sequence;

    loop {
        if let Some(status) = child.try_wait().map_err(|error| {
            CliError::new(
                "failed while monitoring supervised gateway",
                command_line,
                ErrorStage::Internal,
                error.to_string(),
                vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
            )
        })? {
            return Ok(SupervisedRuntimeExit {
                status,
                supervisor_sequence,
            });
        }

        if stop_deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            supervisor_sequence += 1;
            write_supervisor_status_snapshot(
                &state.paths,
                supervisor,
                launch_id,
                types::SupervisorPhase::SUPERVISOR_PHASE_TERMINATING,
                supervisor_sequence,
                Some(runtime_pid),
                command_line,
            )?;
            terminate_process(runtime_pid, command_line)?;
            stop_deadline = None;
            terminate_deadline = Some(Instant::now() + SUPERVISOR_RUNTIME_TERMINATE_TIMEOUT);
        }

        if terminate_deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            return Err(CliError::new(
                "self-host runtime did not stop cleanly",
                command_line,
                ErrorStage::Internal,
                format!("pid {runtime_pid} remained active after supervisor termination"),
                vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
            ));
        }

        let poll_interval = next_supervisor_poll_interval(stop_deadline, terminate_deadline);
        tokio::select! {
            () = stop_signal.recv(), if stop_deadline.is_none() && terminate_deadline.is_none() => {
                supervisor_sequence += 1;
                write_supervisor_status_snapshot(
                    &state.paths,
                    supervisor,
                    launch_id,
                    types::SupervisorPhase::SUPERVISOR_PHASE_STOP_REQUESTED,
                    supervisor_sequence,
                    Some(runtime_pid),
                    command_line,
                )?;

                match request_supervised_runtime_stop(
                    &state.paths,
                    supervisor,
                    launch_id,
                    runtime_pid,
                )
                .await
                {
                    Ok(()) => {
                        stop_deadline = Some(Instant::now() + SUPERVISOR_RUNTIME_STOP_GRACE_TIMEOUT);
                    }
                    Err(error) if runtime_control_error_allows_fallback(&error) => {
                        supervisor_sequence += 1;
                        write_supervisor_status_snapshot(
                            &state.paths,
                            supervisor,
                            launch_id,
                            types::SupervisorPhase::SUPERVISOR_PHASE_TERMINATING,
                            supervisor_sequence,
                            Some(runtime_pid),
                            command_line,
                        )?;
                        terminate_process(runtime_pid, command_line)?;
                        terminate_deadline = Some(Instant::now() + SUPERVISOR_RUNTIME_TERMINATE_TIMEOUT);
                    }
                    Err(error) => return Err(runtime_control_stop_error(error, command_line)),
                }
            }
            () = sleep(poll_interval) => {}
        }
    }
}

async fn request_supervised_runtime_stop(
    paths: &SelfHostRuntimePaths,
    supervisor: &types::SupervisorIdentity,
    launch_id: &str,
    runtime_pid: u32,
) -> Result<(), ConnectError> {
    let identity = ManagedRuntimeIdentity {
        launch_id: launch_id.to_owned(),
        pid: runtime_pid,
        supervisor_pid: supervisor.pid,
        supervisor_generation: supervisor.generation,
    };

    let supervisor_id = supervisor.supervisor_id.as_deref().ok_or_else(|| {
        ConnectError::internal("supervisor identity omitted supervisor id for runtime stop")
    })?;

    request_runtime_control_stop(
        paths,
        &identity,
        supervisor_id,
        SUPERVISOR_RUNTIME_STOP_REASON,
        SUPERVISOR_RUNTIME_STOP_GRACE_TIMEOUT,
    )
    .await
    .map(|_| ())
}

fn runtime_control_stop_error(error: ConnectError, command_line: &str) -> CliError {
    let detail = runtime_control_connect_error_summary(&error).map_or_else(
        || {
            format!(
                "runtime control RPC returned {}: {error}",
                error.code.as_str()
            )
        },
        |summary| {
            format!(
                "runtime control RPC returned {}: {summary}",
                error.code.as_str()
            )
        },
    );
    let fallback_code = Some(format!("runtime_control_{}", error.code.as_str()));
    let cli_error = CliError::new(
        "failed to request self-host runtime stop",
        command_line,
        ErrorStage::Internal,
        detail,
        vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
    );

    with_runtime_control_connect_error_metadata(&error, cli_error, fallback_code)
}

fn next_supervisor_poll_interval(
    stop_deadline: Option<Instant>,
    terminate_deadline: Option<Instant>,
) -> Duration {
    let mut interval = SUPERVISOR_POLL_INTERVAL;
    let now = Instant::now();

    if let Some(deadline) = stop_deadline {
        interval = interval.min(deadline.saturating_duration_since(now));
    }
    if let Some(deadline) = terminate_deadline {
        interval = interval.min(deadline.saturating_duration_since(now));
    }

    interval
}

#[cfg(unix)]
struct SupervisorStopSignal {
    interrupt: tokio::signal::unix::Signal,
    terminate: tokio::signal::unix::Signal,
}

#[cfg(unix)]
impl SupervisorStopSignal {
    fn new(command_line: &str) -> Result<Self, CliError> {
        Ok(Self {
            interrupt: tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())
                .map_err(|error| supervisor_signal_error(error, command_line))?,
            terminate: tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .map_err(|error| supervisor_signal_error(error, command_line))?,
        })
    }

    async fn recv(&mut self) {
        tokio::select! {
            _ = self.interrupt.recv() => {}
            _ = self.terminate.recv() => {}
        }
    }
}

#[cfg(not(unix))]
struct SupervisorStopSignal;

#[cfg(not(unix))]
impl SupervisorStopSignal {
    fn new(_command_line: &str) -> Result<Self, CliError> {
        Ok(Self)
    }

    async fn recv(&mut self) {
        std::future::pending::<()>().await;
    }
}

#[cfg(unix)]
fn supervisor_signal_error(error: std::io::Error, command_line: &str) -> CliError {
    CliError::new(
        "failed to install gateway supervisor stop handler",
        command_line,
        ErrorStage::Internal,
        error.to_string(),
        vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
    )
}

fn finalize_supervisor_state(
    state: &GatewayRuntimeState,
    supervisor: &types::SupervisorIdentity,
    launch_id: &str,
    runtime_pid: u32,
    status: ExitStatus,
    supervisor_sequence: u64,
    command_line: &str,
) {
    let phase = if status.success() || is_expected_termination(status) {
        types::SupervisorPhase::SUPERVISOR_PHASE_EXITED
    } else {
        types::SupervisorPhase::SUPERVISOR_PHASE_FAILED
    };

    let _ = write_supervisor_status_snapshot(
        &state.paths,
        supervisor,
        launch_id,
        phase,
        supervisor_sequence,
        Some(runtime_pid),
        command_line,
    );
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

fn supervisor_identity(supervisor_pid: u32) -> types::SupervisorIdentity {
    types::SupervisorIdentity {
        supervisor_id: Some(supervisor_id_for_pid(supervisor_pid)),
        pid: Some(supervisor_pid),
        // Comment: durable supervisor generation is fixed until the explicit
        // Rust supervisor state machine owns generation allocation.
        generation: Some(SUPERVISOR_GENERATION),
        ..Default::default()
    }
}

fn write_supervisor_status_snapshot(
    paths: &SelfHostRuntimePaths,
    supervisor: &types::SupervisorIdentity,
    launch_id: &str,
    phase: types::SupervisorPhase,
    supervisor_sequence: u64,
    runtime_pid: Option<u32>,
    command_line: &str,
) -> Result<(), CliError> {
    let now = Utc::now();
    let data_dir = paths.data_dir.display().to_string();
    let runtime = runtime_pid.map(|pid| types::RuntimeIdentity {
        pid: Some(pid),
        launch_id: Some(launch_id.to_owned()),
        data_dir: Some(data_dir.clone()),
        ..Default::default()
    });
    let snapshot = types::SupervisorStatusSnapshot {
        header: MessageField::some(types::LifecycleRecordHeader {
            schema_version: Some(LIFECYCLE_SCHEMA_VERSION),
            writer: MessageField::some(types::LifecycleRecordWriterIdentity {
                writer: Some(
                    types::LifecycleRecordWriter::LIFECYCLE_RECORD_WRITER_SUPERVISOR.into(),
                ),
                writer_id: supervisor.supervisor_id.clone(),
                ..Default::default()
            }),
            launch: MessageField::some(types::LifecycleLaunchIdentity {
                launch_id: Some(launch_id.to_owned()),
                data_dir: Some(data_dir.clone()),
                runtime_pid,
                supervisor_pid: supervisor.pid,
                supervisor_generation: supervisor.generation,
                ..Default::default()
            }),
            written_at: MessageField::some(protobuf_timestamp(now)),
            ..Default::default()
        }),
        status: MessageField::some(types::SupervisorStatus {
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
            updated_at: MessageField::some(protobuf_timestamp(now)),
            runtime: runtime.map(MessageField::some).unwrap_or_default(),
            ..Default::default()
        }),
        snapshot_at: MessageField::some(protobuf_timestamp(now)),
        ..Default::default()
    };
    let serialized =
        lifecycle_records::encode_supervisor_status_snapshot(&snapshot).map_err(|error| {
            CliError::new(
                "failed to serialize gateway supervisor status snapshot",
                command_line,
                ErrorStage::Internal,
                format!(
                    "{error} (encoding={})",
                    lifecycle_records::DURABLE_STATE_FILE_ENCODING
                ),
                vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
            )
        })?;

    path_utils::atomic_write_private_file(
        paths.supervisor_status_snapshot_path.as_path(),
        &serialized,
        command_line,
        ErrorStage::Internal,
        "gateway supervisor status snapshot",
    )
}

fn protobuf_timestamp(value: chrono::DateTime<Utc>) -> buffa_types::google::protobuf::Timestamp {
    buffa_types::google::protobuf::Timestamp {
        seconds: value.timestamp(),
        nanos: value.timestamp_subsec_nanos() as i32,
        ..Default::default()
    }
}
