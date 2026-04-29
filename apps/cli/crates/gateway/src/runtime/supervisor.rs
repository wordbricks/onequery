use std::process::Child;
use std::process::Command as ProcessCommand;
use std::process::ExitStatus;
use std::process::Stdio;
use std::time::Duration;

use chrono::Utc;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use serde::Serialize;
use serde_json::json;

use crate::GatewayCommandOutput;
use crate::GatewaySupervisorArgs;
use crate::self_host::SelfHostRuntimePaths;
use onequery_cli_core::path_utils;

use super::super::BACKGROUND_GATEWAY_RETRY_COMMAND;
use super::super::state::GatewayRuntimeState;
use super::process::background_log_stdio;
use super::shutdown::remove_if_exists;
use super::shutdown::stop_request_matches;
use super::status::describe_exit_status;
use super::status::exit_signal_label;
use super::status::is_expected_termination;
use super::transport::retry_command_hint;
use super::transport::spawn_launch_error;

const SUPERVISOR_POLL_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SupervisorStateRecord<'a> {
    pid: u32,
    phase: SupervisorPhase,
    runtime_pid: Option<u32>,
    updated_at: String,
    data_dir: &'a str,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
enum SupervisorPhase {
    Starting,
    Ready,
    Stopped,
    Failed,
}

pub(crate) fn run_gateway_supervisor(
    state: &GatewayRuntimeState,
    args: &GatewaySupervisorArgs,
    command_line: &str,
) -> Result<GatewayCommandOutput, CliError> {
    let supervisor_pid = std::process::id();

    write_supervisor_pid(&state.paths, supervisor_pid, command_line)?;
    write_supervisor_state(&state.paths, SupervisorPhase::Starting, None, command_line)?;

    let mut child = match spawn_supervised_runtime(state, args, command_line) {
        Ok(child) => child,
        Err(error) => {
            let _ =
                write_supervisor_state(&state.paths, SupervisorPhase::Failed, None, command_line);
            remove_if_exists(state.paths.supervisor_pid_path.as_path());
            return Err(error);
        }
    };
    let runtime_pid = child.id();
    let _ = write_supervisor_state(
        &state.paths,
        SupervisorPhase::Ready,
        Some(runtime_pid),
        command_line,
    );

    let status = loop {
        if let Some(status) = child.try_wait().map_err(|error| {
            CliError::new(
                "failed while monitoring supervised gateway",
                command_line,
                ErrorStage::Internal,
                error.to_string(),
                vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
            )
        })? {
            break status;
        }

        std::thread::sleep(SUPERVISOR_POLL_INTERVAL);
    };
    let stop_requested = stop_request_matches(state.paths.stop_request_path.as_path(), runtime_pid);

    finalize_supervisor_state(state, runtime_pid, status, stop_requested, command_line);

    if status.success() || is_expected_termination(status) || stop_requested {
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

fn finalize_supervisor_state(
    state: &GatewayRuntimeState,
    runtime_pid: u32,
    status: ExitStatus,
    stop_requested: bool,
    command_line: &str,
) {
    let phase = if status.success() || is_expected_termination(status) || stop_requested {
        SupervisorPhase::Stopped
    } else {
        SupervisorPhase::Failed
    };

    let _ = write_supervisor_state(&state.paths, phase, Some(runtime_pid), command_line);
    remove_if_exists(state.paths.supervisor_pid_path.as_path());
    if stop_request_matches(state.paths.stop_request_path.as_path(), runtime_pid) {
        remove_if_exists(state.paths.stop_request_path.as_path());
    }
}

fn write_supervisor_pid(
    paths: &SelfHostRuntimePaths,
    supervisor_pid: u32,
    command_line: &str,
) -> Result<(), CliError> {
    path_utils::atomic_write_private_file(
        paths.supervisor_pid_path.as_path(),
        &format!("{supervisor_pid}\n"),
        command_line,
        ErrorStage::Internal,
        "gateway supervisor pid",
    )
}

fn write_supervisor_state(
    paths: &SelfHostRuntimePaths,
    phase: SupervisorPhase,
    runtime_pid: Option<u32>,
    command_line: &str,
) -> Result<(), CliError> {
    let data_dir = paths.data_dir.display().to_string();
    let record = SupervisorStateRecord {
        pid: std::process::id(),
        phase,
        runtime_pid,
        updated_at: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        data_dir: &data_dir,
    };
    let serialized = serde_json::to_string_pretty(&record).map_err(|error| {
        CliError::new(
            "failed to serialize gateway supervisor state",
            command_line,
            ErrorStage::Internal,
            error.to_string(),
            vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
        )
    })?;

    path_utils::atomic_write_private_file(
        paths.supervisor_state_path.as_path(),
        &serialized,
        command_line,
        ErrorStage::Internal,
        "gateway supervisor state",
    )
}
