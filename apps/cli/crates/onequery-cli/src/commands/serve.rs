use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command as ProcessCommand;
use std::process::ExitStatus;
use std::process::Stdio;

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use serde_json::json;

use crate::cli::ServeCommand;
use crate::config::self_host::SelfHostConfig;
use crate::config::self_host::SelfHostRuntimePaths;
use crate::config::self_host::bootstrap_self_host_foundation;
use crate::config::self_host::load_self_host_config;
use crate::config::self_host::self_host_runtime_paths;
use crate::output::CommandOutput;
use crate::path_utils::resolve_env_directory_for_cli;
use crate::path_utils::resolve_user_path_for_cli;

use super::CommandContext;
use super::Runtime;
use super::ensure_self_host_runtime_supported;

const PACKAGED_RUNTIME_DIR: &str = "runtime";
const PACKAGED_WEB_DIR: &str = "web";
const REPO_SERVER_ENTRYPOINT: &[&str] = &["packages", "bun-server", "src", "index.ts"];
const REPO_WEB_CLIENT_DIR: &[&str] = &["apps", "web", "dist", "client"];
const REPO_WEB_DIST_DIR: &[&str] = &["apps", "web", "dist"];
const WEB_INDEX_FILENAME: &str = "index.html";
const SERVE_LOG_PREVIEW_LINE_COUNT: usize = 20;
const SERVE_STOP_POLL_ATTEMPTS: usize = 50;
const SERVE_STOP_POLL_INTERVAL_MS: u64 = 100;
const BUN_EXECUTABLE_NAME: &str = "bun";
const INSTALL_BUN_GUIDANCE: &str = "install bun and ensure it is on PATH";
const RETRY_SERVE_COMMAND: &str = "retry oneq serve";
const RETRY_SERVE_STOP_COMMAND: &str = "retry oneq serve stop";
const CHECK_SERVER_LOG_AND_RETRY_SERVE_STOP: &str =
    "check the server log and retry oneq serve stop";
const REINSTALL_CLI_PACKAGE_COMMAND: &str = "reinstall the CLI package";
const BUILD_REPO_WEB_COMMAND: &str = "run bun run --cwd apps/web build";
const ONEQUERY_NPM_ROOT_ENV_VAR: &str = "ONEQUERY_NPM_ROOT";
const ONEQUERY_SERVER_EXECUTABLE_ENV_VAR: &str = "ONEQUERY_SERVER_EXECUTABLE";
const ONEQUERY_SELF_HOST_CONFIG_DIR_ENV_VAR: &str = "ONEQUERY_SELF_HOST_CONFIG_DIR";
const ONEQUERY_SELF_HOST_DATA_DIR_ENV_VAR: &str = "ONEQUERY_SELF_HOST_DATA_DIR";
const ONEQUERY_RUNTIME_ROOT_ENV_VAR: &str = "ONEQUERY_RUNTIME_ROOT";
const ONEQUERY_WEB_DIST_DIR_ENV_VAR: &str = "ONEQUERY_WEB_DIST_DIR";

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum ServeStateAccessMode {
    BootstrapIfMissing,
    ReadOnly,
}

#[derive(Debug, Clone, Eq, PartialEq)]
struct ServeRuntimeState {
    paths: SelfHostRuntimePaths,
    bootstrapped: bool,
    config_created: bool,
    secrets_created: bool,
    config: Option<SelfHostConfig>,
    sqlite_file_present: bool,
    log_file_present: bool,
    pid_file_present: bool,
    lock_file_present: bool,
}

#[derive(Debug, Clone, Eq, PartialEq)]
struct LogPreview {
    lines: Vec<String>,
    truncated: bool,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum ServeLaunchKind {
    PackagedExecutable,
    RepoBunEntry,
}

#[derive(Debug, Clone, Eq, PartialEq)]
struct ServeLaunchPlan {
    config_dir: PathBuf,
    data_dir: PathBuf,
    launch_kind: ServeLaunchKind,
    runtime_entry_path: PathBuf,
    runtime_root: PathBuf,
    web_dist_dir: PathBuf,
}

pub(super) async fn execute<B, T>(
    command: ServeCommand,
    context: &CommandContext,
    _runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError> {
    ensure_self_host_runtime_supported(&context.command_line)?;

    match command {
        ServeCommand::Root => {
            let state = resolve_runtime_state(
                &context.command_line,
                ServeStateAccessMode::BootstrapIfMissing,
            )?;
            run_serve_foreground(&state, &context.command_line)
        }
        ServeCommand::Start => {
            let state = resolve_runtime_state(
                &context.command_line,
                ServeStateAccessMode::BootstrapIfMissing,
            )?;
            run_serve_foreground(&state, &context.command_line)
        }
        ServeCommand::Stop => {
            let state =
                resolve_runtime_state(&context.command_line, ServeStateAccessMode::ReadOnly)?;
            stop_runtime(&state, &context.command_line)
        }
        ServeCommand::Status => {
            let state =
                resolve_runtime_state(&context.command_line, ServeStateAccessMode::ReadOnly)?;
            Ok(render_serve_status_output(&state))
        }
        ServeCommand::Logs => {
            let state =
                resolve_runtime_state(&context.command_line, ServeStateAccessMode::ReadOnly)?;
            let preview = read_log_preview(&state.paths.server_log_path, &context.command_line)?;
            Ok(render_serve_logs_output(&state, &preview))
        }
    }
}

fn resolve_runtime_state(
    command_line: &str,
    access_mode: ServeStateAccessMode,
) -> Result<ServeRuntimeState, CliError> {
    let bootstrap_result = match access_mode {
        ServeStateAccessMode::BootstrapIfMissing => {
            Some(bootstrap_self_host_foundation(command_line)?)
        }
        ServeStateAccessMode::ReadOnly => None,
    };
    let paths = bootstrap_result
        .as_ref()
        .map(|result| result.paths.clone())
        .unwrap_or(self_host_runtime_paths(command_line)?);

    let config = if paths.config_path.is_file() && paths.secrets_path.is_file() {
        Some(load_self_host_config(command_line)?.config)
    } else {
        None
    };

    Ok(ServeRuntimeState {
        bootstrapped: paths.config_path.is_file()
            && paths.secrets_path.is_file()
            && paths.config_dir.is_dir()
            && paths.data_dir.is_dir(),
        config_created: bootstrap_result
            .as_ref()
            .map(|result| result.config_created)
            .unwrap_or(false),
        secrets_created: bootstrap_result
            .as_ref()
            .map(|result| result.secrets_created)
            .unwrap_or(false),
        sqlite_file_present: paths.sqlite_path.is_file(),
        log_file_present: paths.server_log_path.is_file(),
        pid_file_present: paths.pid_path.is_file(),
        lock_file_present: paths.lock_path.is_file(),
        paths,
        config,
    })
}

fn read_log_preview(path: &std::path::Path, command_line: &str) -> Result<LogPreview, CliError> {
    if !path.is_file() {
        return Ok(LogPreview {
            lines: Vec::new(),
            truncated: false,
        });
    }

    let contents = fs::read_to_string(path).map_err(|read_error| {
        CliError::new(
            "failed to read serve log",
            command_line,
            ErrorStage::LoadConfig,
            format!("{read_error} ({})", path.display()),
            vec![format!("check log file {}", path.display())],
        )
    })?;

    let all_lines = contents.lines().map(ToOwned::to_owned).collect::<Vec<_>>();
    let keep_from = all_lines.len().saturating_sub(SERVE_LOG_PREVIEW_LINE_COUNT);

    Ok(LogPreview {
        truncated: keep_from > 0,
        lines: all_lines.into_iter().skip(keep_from).collect(),
    })
}

fn run_serve_foreground(
    state: &ServeRuntimeState,
    command_line: &str,
) -> Result<CommandOutput, CliError> {
    let launch_plan = resolve_launch_plan(state, command_line)?;
    let mut child = match launch_plan.launch_kind {
        ServeLaunchKind::PackagedExecutable => ProcessCommand::new(&launch_plan.runtime_entry_path),
        ServeLaunchKind::RepoBunEntry => {
            let mut child = ProcessCommand::new(BUN_EXECUTABLE_NAME);
            child.arg(&launch_plan.runtime_entry_path);
            child
        }
    };
    child
        .env(
            ONEQUERY_SELF_HOST_CONFIG_DIR_ENV_VAR,
            &launch_plan.config_dir,
        )
        .env(ONEQUERY_SELF_HOST_DATA_DIR_ENV_VAR, &launch_plan.data_dir)
        .env(ONEQUERY_RUNTIME_ROOT_ENV_VAR, &launch_plan.runtime_root)
        .env(ONEQUERY_WEB_DIST_DIR_ENV_VAR, &launch_plan.web_dist_dir)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    let mut child = child.spawn().map_err(|spawn_error| {
        let (why, try_next) = match (launch_plan.launch_kind, spawn_error.kind()) {
            (ServeLaunchKind::RepoBunEntry, std::io::ErrorKind::NotFound) => (
                "bun executable was not found on PATH".to_owned(),
                vec![
                    INSTALL_BUN_GUIDANCE.to_owned(),
                    RETRY_SERVE_COMMAND.to_owned(),
                ],
            ),
            (ServeLaunchKind::PackagedExecutable, std::io::ErrorKind::NotFound) => (
                format!(
                    "compiled self-host server executable was not found at {}",
                    launch_plan.runtime_entry_path.display()
                ),
                vec![
                    REINSTALL_CLI_PACKAGE_COMMAND.to_owned(),
                    RETRY_SERVE_COMMAND.to_owned(),
                ],
            ),
            _ => (
                spawn_error.to_string(),
                vec![RETRY_SERVE_COMMAND.to_owned()],
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

    let status = child.wait().map_err(|wait_error| {
        CliError::new(
            "failed while waiting for self-host server",
            command_line,
            ErrorStage::Internal,
            wait_error.to_string(),
            vec![RETRY_SERVE_COMMAND.to_owned()],
        )
    })?;

    if status.success() || is_expected_termination(status) {
        return Ok(CommandOutput::structured(
            Vec::new(),
            json!({
                "kind": "serve",
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
            format!("{RETRY_SERVE_COMMAND} after fixing the startup issue"),
        ],
    ))
}

fn resolve_launch_plan(
    state: &ServeRuntimeState,
    command_line: &str,
) -> Result<ServeLaunchPlan, CliError> {
    if let Some(npm_root) = env::var_os(ONEQUERY_NPM_ROOT_ENV_VAR)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    {
        let npm_root = resolve_env_directory_for_cli(
            ONEQUERY_NPM_ROOT_ENV_VAR,
            npm_root.as_path(),
            command_line,
            ErrorStage::LoadConfig,
            "failed to resolve packaged runtime root",
            vec![format!(
                "set {ONEQUERY_NPM_ROOT_ENV_VAR} to a valid directory"
            )],
        )?;
        let packaged_runtime = resolve_packaged_server_executable(command_line)?;
        let packaged_web = join_path_segments(&npm_root, &[PACKAGED_RUNTIME_DIR, PACKAGED_WEB_DIR]);

        if packaged_runtime.is_file() && packaged_web.join(WEB_INDEX_FILENAME).is_file() {
            return Ok(ServeLaunchPlan {
                config_dir: state.paths.config_dir.clone(),
                data_dir: state.paths.data_dir.clone(),
                launch_kind: ServeLaunchKind::PackagedExecutable,
                runtime_entry_path: packaged_runtime,
                runtime_root: npm_root,
                web_dist_dir: packaged_web,
            });
        }

        return Err(CliError::new(
            "packaged self-host runtime is incomplete",
            command_line,
            ErrorStage::LoadConfig,
            format!(
                "expected {} and {} inside {}",
                packaged_runtime.display(),
                packaged_web.join(WEB_INDEX_FILENAME).display(),
                npm_root.display()
            ),
            vec![REINSTALL_CLI_PACKAGE_COMMAND.to_owned()],
        ));
    }

    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../");
    let repo_runtime = join_path_segments(&repo_root, REPO_SERVER_ENTRYPOINT);
    let repo_web_client = join_path_segments(&repo_root, REPO_WEB_CLIENT_DIR);
    let repo_web_dist = join_path_segments(&repo_root, REPO_WEB_DIST_DIR);
    let web_dist_dir = if repo_web_client.join(WEB_INDEX_FILENAME).is_file() {
        repo_web_client
    } else {
        repo_web_dist
    };

    if !repo_runtime.is_file() || !web_dist_dir.join(WEB_INDEX_FILENAME).is_file() {
        return Err(CliError::new(
            "repo-local self-host runtime is not built",
            command_line,
            ErrorStage::LoadConfig,
            format!(
                "expected {} and {}",
                repo_runtime.display(),
                web_dist_dir.join(WEB_INDEX_FILENAME).display()
            ),
            vec![
                BUILD_REPO_WEB_COMMAND.to_owned(),
                RETRY_SERVE_COMMAND.to_owned(),
            ],
        ));
    }

    Ok(ServeLaunchPlan {
        config_dir: state.paths.config_dir.clone(),
        data_dir: state.paths.data_dir.clone(),
        launch_kind: ServeLaunchKind::RepoBunEntry,
        runtime_entry_path: repo_runtime,
        runtime_root: repo_root,
        web_dist_dir,
    })
}

fn resolve_packaged_server_executable(command_line: &str) -> Result<PathBuf, CliError> {
    let server_executable = env::var_os(ONEQUERY_SERVER_EXECUTABLE_ENV_VAR)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| {
            CliError::new(
                "packaged self-host runtime is incomplete",
                command_line,
                ErrorStage::LoadConfig,
                format!(
                    "expected {ONEQUERY_SERVER_EXECUTABLE_ENV_VAR} to point to the packaged server executable"
                ),
                vec![REINSTALL_CLI_PACKAGE_COMMAND.to_owned()],
            )
        })?;
    let resolved_server_executable = resolve_user_path_for_cli(
        server_executable.as_path(),
        command_line,
        ErrorStage::LoadConfig,
        "failed to resolve packaged self-host server executable",
        vec![format!(
            "set {ONEQUERY_SERVER_EXECUTABLE_ENV_VAR} to an absolute executable path"
        )],
    )?;

    let metadata = fs::metadata(&resolved_server_executable).map_err(|error| {
        CliError::new(
            "packaged self-host runtime is incomplete",
            command_line,
            ErrorStage::LoadConfig,
            format!(
                "failed to read packaged server executable {}: {error}",
                resolved_server_executable.display()
            ),
            vec![REINSTALL_CLI_PACKAGE_COMMAND.to_owned()],
        )
    })?;

    if !metadata.is_file() {
        return Err(CliError::new(
            "packaged self-host runtime is incomplete",
            command_line,
            ErrorStage::LoadConfig,
            format!(
                "expected {} to be a file",
                resolved_server_executable.display()
            ),
            vec![REINSTALL_CLI_PACKAGE_COMMAND.to_owned()],
        ));
    }

    Ok(resolved_server_executable)
}

fn join_path_segments(root: &std::path::Path, segments: &[&str]) -> PathBuf {
    segments
        .iter()
        .fold(root.to_path_buf(), |path, segment| path.join(segment))
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

fn stop_runtime(state: &ServeRuntimeState, command_line: &str) -> Result<CommandOutput, CliError> {
    let pid = read_runtime_pid(state.paths.pid_path.as_path(), command_line)?;
    let running_pid = pid.filter(|pid| is_process_running(*pid));

    if let Some(pid) = running_pid {
        terminate_process(pid, command_line)?;
        wait_for_runtime_stop(
            state.paths.pid_path.as_path(),
            state.paths.lock_path.as_path(),
            pid,
            command_line,
        )?;
        let refreshed_state = resolve_runtime_state(command_line, ServeStateAccessMode::ReadOnly)?;
        return Ok(CommandOutput::structured(
            vec![
                "Serve stop completed.".to_owned(),
                format!("Stopped pid: {pid}"),
                format!(
                    "Log path: {}",
                    refreshed_state.paths.server_log_path.display()
                ),
            ],
            json!({
                "kind": "serve-stop",
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
    let refreshed_state = resolve_runtime_state(command_line, ServeStateAccessMode::ReadOnly)?;
    Ok(CommandOutput::structured(
        vec![
            "Serve stop found no running process.".to_owned(),
            format!(
                "Log path: {}",
                refreshed_state.paths.server_log_path.display()
            ),
        ],
        json!({
            "kind": "serve-stop",
            "phase": "managed",
            "bootstrapped": refreshed_state.bootstrapped,
            "stopIssued": false,
            "runtimeState": runtime_state_json(&refreshed_state),
            "paths": paths_json(&refreshed_state.paths),
        }),
    ))
}

fn wait_for_runtime_stop(
    pid_path: &std::path::Path,
    lock_path: &std::path::Path,
    pid: u32,
    command_line: &str,
) -> Result<(), CliError> {
    for _ in 0..SERVE_STOP_POLL_ATTEMPTS {
        if !is_process_running(pid) && !pid_path.exists() && !lock_path.exists() {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(
            SERVE_STOP_POLL_INTERVAL_MS,
        ));
    }

    Err(CliError::new(
        "self-host runtime did not stop cleanly",
        command_line,
        ErrorStage::Internal,
        format!("pid {pid} is still active"),
        vec![CHECK_SERVER_LOG_AND_RETRY_SERVE_STOP.to_owned()],
    ))
}

fn read_runtime_pid(path: &std::path::Path, command_line: &str) -> Result<Option<u32>, CliError> {
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

fn is_process_running(pid: u32) -> bool {
    #[cfg(unix)]
    {
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }

    #[cfg(not(unix))]
    {
        let _ = pid;
        false
    }
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
            vec![RETRY_SERVE_STOP_COMMAND.to_owned()],
        ))
    }

    #[cfg(not(unix))]
    {
        let _ = pid;
        Err(CliError::new(
            "serve stop is not supported on this platform",
            command_line,
            ErrorStage::Internal,
            "process signaling is unavailable".to_owned(),
            vec!["stop the runtime manually".to_owned()],
        ))
    }
}

fn remove_if_exists(path: &std::path::Path) {
    let _ = fs::remove_file(path);
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
fn render_serve_output(state: &ServeRuntimeState) -> CommandOutput {
    let listen = server_listen_label(state.config.as_ref());

    CommandOutput::structured(
        vec![
            "Serve foundation ready.".to_owned(),
            format!("Config dir: {}", state.paths.config_dir.display()),
            format!("Data dir: {}", state.paths.data_dir.display()),
            format!("Listen: {listen}"),
            format!(
                "Created self-host config.toml: {}",
                yes_no_label(state.config_created)
            ),
            format!(
                "Created secrets.toml: {}",
                yes_no_label(state.secrets_created)
            ),
            "Next step: oneq serve start".to_owned(),
        ],
        json!({
            "kind": "serve",
            "phase": "skeleton",
            "bootstrapped": state.bootstrapped,
            "configCreated": state.config_created,
            "secretsCreated": state.secrets_created,
            "server": state.config.as_ref().map(server_json),
            "runtimeState": runtime_state_json(state),
            "paths": paths_json(&state.paths),
        }),
    )
}

#[cfg(test)]
fn render_serve_start_output(state: &ServeRuntimeState) -> CommandOutput {
    let listen = server_listen_label(state.config.as_ref());

    CommandOutput::structured(
        vec![
            "Serve start is wired as a Phase 2 skeleton.".to_owned(),
            format!("Bootstrapped: {}", yes_no_label(state.bootstrapped)),
            format!("Listen: {listen}"),
            format!("Log path: {}", state.paths.server_log_path.display()),
            format!(
                "Running markers present: {}",
                yes_no_label(state.pid_file_present || state.lock_file_present)
            ),
            "No server process was launched in this milestone.".to_owned(),
        ],
        json!({
            "kind": "serve-start",
            "phase": "skeleton",
            "bootstrapped": state.bootstrapped,
            "processStarted": false,
            "server": state.config.as_ref().map(server_json),
            "runtimeState": runtime_state_json(state),
            "paths": paths_json(&state.paths),
        }),
    )
}

fn render_serve_status_output(state: &ServeRuntimeState) -> CommandOutput {
    let listen = server_listen_label(state.config.as_ref());
    let runtime_status = runtime_status_label(state);

    CommandOutput::structured(
        vec![
            "Serve status".to_owned(),
            format!("Bootstrapped: {}", yes_no_label(state.bootstrapped)),
            format!("Listen: {listen}"),
            format!("Runtime: {runtime_status}"),
            format!(
                "SQLite file present: {}",
                yes_no_label(state.sqlite_file_present)
            ),
            format!("Log file present: {}", yes_no_label(state.log_file_present)),
            format!("PID file present: {}", yes_no_label(state.pid_file_present)),
            format!(
                "Lock file present: {}",
                yes_no_label(state.lock_file_present)
            ),
        ],
        json!({
            "kind": "serve-status",
            "phase": "managed",
            "bootstrapped": state.bootstrapped,
            "server": state.config.as_ref().map(server_json),
            "runtimeState": runtime_state_json(state),
            "paths": paths_json(&state.paths),
        }),
    )
}

fn render_serve_logs_output(state: &ServeRuntimeState, preview: &LogPreview) -> CommandOutput {
    let mut lines = vec![
        "Serve logs".to_owned(),
        format!("Log path: {}", state.paths.server_log_path.display()),
        format!("Log file present: {}", yes_no_label(state.log_file_present)),
    ];

    if preview.lines.is_empty() {
        lines.push("Preview: <no log lines available>".to_owned());
    } else {
        if preview.truncated {
            lines.push("Preview: last 20 lines".to_owned());
        } else {
            lines.push("Preview:".to_owned());
        }
        lines.extend(preview.lines.iter().cloned());
    }

    CommandOutput::structured(
        lines,
        json!({
            "kind": "serve-logs",
            "phase": "managed",
            "bootstrapped": state.bootstrapped,
            "logFilePresent": state.log_file_present,
            "logPath": state.paths.server_log_path.display().to_string(),
            "previewLines": preview.lines,
            "previewTruncated": preview.truncated,
            "runtimeState": runtime_state_json(state),
            "paths": paths_json(&state.paths),
        }),
    )
}

fn server_listen_label(config: Option<&SelfHostConfig>) -> String {
    config
        .map(|config| format!("{}:{}", config.server.listen_host, config.server.port))
        .unwrap_or_else(|| "<uninitialized>".to_owned())
}

fn yes_no_label(value: bool) -> &'static str {
    if value { "yes" } else { "no" }
}

fn server_json(config: &SelfHostConfig) -> serde_json::Value {
    json!({
        "listenHost": config.server.listen_host,
        "port": config.server.port,
        "logLevel": config.server.log_level,
        "publicOrigin": config.server.public_origin,
    })
}

fn runtime_state_json(state: &ServeRuntimeState) -> serde_json::Value {
    let running = read_runtime_pid(state.paths.pid_path.as_path(), "oneq serve status")
        .ok()
        .flatten()
        .is_some_and(is_process_running);
    json!({
        "running": running,
        "status": if running {
            "running"
        } else if state.pid_file_present || state.lock_file_present {
            "stale_markers"
        } else if state.bootstrapped {
            "not_running"
        } else {
            "not_initialized"
        },
        "sqliteFilePresent": state.sqlite_file_present,
        "logFilePresent": state.log_file_present,
        "pidFilePresent": state.pid_file_present,
        "lockFilePresent": state.lock_file_present,
    })
}

fn runtime_status_label(state: &ServeRuntimeState) -> &'static str {
    if read_runtime_pid(state.paths.pid_path.as_path(), "oneq serve status")
        .ok()
        .flatten()
        .is_some_and(is_process_running)
    {
        return "running";
    }

    if state.pid_file_present || state.lock_file_present {
        return "stale_markers";
    }

    if state.bootstrapped {
        return "not_running";
    }

    "not_initialized"
}

fn paths_json(paths: &SelfHostRuntimePaths) -> serde_json::Value {
    json!({
        "configDir": paths.config_dir.display().to_string(),
        "dataDir": paths.data_dir.display().to_string(),
        "configPath": paths.config_path.display().to_string(),
        "secretsPath": paths.secrets_path.display().to_string(),
        "sqlitePath": paths.sqlite_path.display().to_string(),
        "logsDir": paths.logs_dir.display().to_string(),
        "serverLogPath": paths.server_log_path.display().to_string(),
        "backupsDir": paths.backups_dir.display().to_string(),
        "runDir": paths.run_dir.display().to_string(),
        "pidPath": paths.pid_path.display().to_string(),
        "lockPath": paths.lock_path.display().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use std::fs;

    use insta::assert_snapshot;
    use pretty_assertions::assert_eq;
    use uuid::Uuid;

    use super::LogPreview;
    use super::ServeRuntimeState;
    use super::ServeStateAccessMode;
    use super::render_serve_logs_output;
    use super::render_serve_output;
    use super::render_serve_start_output;
    use super::render_serve_status_output;
    use crate::config::self_host::SelfHostConfig;
    use crate::config::self_host::SelfHostRuntimePaths;
    use crate::config::self_host::bootstrap_self_host_foundation_for_test;
    use crate::config::self_host::load_self_host_config_for_test;

    fn sample_paths() -> SelfHostRuntimePaths {
        SelfHostRuntimePaths {
            config_dir: "/tmp/onequery/config/self-host".into(),
            data_dir: "/tmp/onequery/data".into(),
            config_path: "/tmp/onequery/config/self-host/config.toml".into(),
            secrets_path: "/tmp/onequery/config/self-host/secrets.toml".into(),
            sqlite_path: "/tmp/onequery/data/sqlite/onequery.sqlite".into(),
            logs_dir: "/tmp/onequery/data/logs".into(),
            server_log_path: "/tmp/onequery/data/logs/server.log".into(),
            backups_dir: "/tmp/onequery/data/backups".into(),
            run_dir: "/tmp/onequery/data/run".into(),
            pid_path: "/tmp/onequery/data/run/server.pid".into(),
            lock_path: "/tmp/onequery/data/run/server.lock".into(),
        }
    }

    fn sample_state() -> ServeRuntimeState {
        ServeRuntimeState {
            paths: sample_paths(),
            bootstrapped: true,
            config_created: true,
            secrets_created: true,
            config: Some(SelfHostConfig::default()),
            sqlite_file_present: false,
            log_file_present: false,
            pid_file_present: false,
            lock_file_present: false,
        }
    }

    #[test]
    fn render_serve_output_snapshot() {
        let output = render_serve_output(&sample_state());
        assert_snapshot!(output.lines.join("\n"));
    }

    #[test]
    fn render_serve_start_output_snapshot() {
        let output = render_serve_start_output(&sample_state());
        assert_snapshot!(output.lines.join("\n"));
    }

    #[test]
    fn render_serve_status_output_snapshot() {
        let output = render_serve_status_output(&sample_state());
        assert_snapshot!(output.lines.join("\n"));
    }

    #[test]
    fn render_serve_logs_output_snapshot() {
        let output = render_serve_logs_output(
            &ServeRuntimeState {
                log_file_present: true,
                ..sample_state()
            },
            &LogPreview {
                lines: vec![
                    "[bun-server] listening on http://127.0.0.1:4545".to_owned(),
                    "[api] GET /api/health 200".to_owned(),
                ],
                truncated: false,
            },
        );
        assert_snapshot!(output.lines.join("\n"));
    }

    #[test]
    fn runtime_state_json_reports_marker_status_when_pid_or_lock_is_present() {
        let state = ServeRuntimeState {
            pid_file_present: true,
            ..sample_state()
        };

        assert_eq!(
            super::runtime_state_json(&state)
                .get("status")
                .and_then(serde_json::Value::as_str),
            Some("stale_markers")
        );
    }

    #[test]
    fn serve_bootstrap_creates_phase_two_foundation_and_reports_it() {
        let test_dir =
            std::env::temp_dir().join(format!("onequery-serve-proof-{}", Uuid::new_v4()));
        let paths = SelfHostRuntimePaths::for_test(
            test_dir.join("config").join("self-host"),
            test_dir.join("data"),
        );

        let state = resolve_runtime_state_with_paths_for_test(
            paths.clone(),
            ServeStateAccessMode::BootstrapIfMissing,
            "oneq serve",
        )
        .unwrap_or_else(|error| panic!("expected serve bootstrap to succeed: {error}"));

        assert_eq!(state.bootstrapped, true);
        assert_eq!(state.config_created, true);
        assert_eq!(state.secrets_created, true);
        assert_eq!(state.config, Some(SelfHostConfig::default()));
        assert_eq!(paths.config_path.is_file(), true);
        assert_eq!(paths.secrets_path.is_file(), true);
        assert_eq!(paths.logs_dir.is_dir(), true);
        assert_eq!(paths.backups_dir.is_dir(), true);
        assert_eq!(paths.run_dir.is_dir(), true);

        let output = render_serve_output(&state);
        let data = output.into_data();

        assert_eq!(
            data.get("kind").and_then(serde_json::Value::as_str),
            Some("serve")
        );
        assert_eq!(
            data.get("bootstrapped")
                .and_then(serde_json::Value::as_bool),
            Some(true)
        );
        assert_eq!(
            data.pointer("/paths/configPath")
                .and_then(serde_json::Value::as_str),
            Some(paths.config_path.to_string_lossy().as_ref())
        );
        assert_eq!(
            data.pointer("/runtimeState/status")
                .and_then(serde_json::Value::as_str),
            Some("not_running")
        );

        fs::remove_dir_all(test_dir)
            .unwrap_or_else(|error| panic!("expected serve proof temp dir cleanup: {error}"));
    }

    fn resolve_runtime_state_with_paths_for_test(
        paths: SelfHostRuntimePaths,
        access_mode: ServeStateAccessMode,
        command_line: &str,
    ) -> Result<ServeRuntimeState, onequery_cli_core::error::CliError> {
        let bootstrap_result = match access_mode {
            ServeStateAccessMode::BootstrapIfMissing => Some(
                bootstrap_self_host_foundation_for_test(paths.clone(), command_line)?,
            ),
            ServeStateAccessMode::ReadOnly => None,
        };

        let config = if paths.config_path.is_file() && paths.secrets_path.is_file() {
            Some(load_self_host_config_for_test(paths.clone(), command_line)?.config)
        } else {
            None
        };

        Ok(ServeRuntimeState {
            bootstrapped: paths.config_path.is_file()
                && paths.secrets_path.is_file()
                && paths.config_dir.is_dir()
                && paths.data_dir.is_dir(),
            config_created: bootstrap_result
                .as_ref()
                .map(|result| result.config_created)
                .unwrap_or(false),
            secrets_created: bootstrap_result
                .as_ref()
                .map(|result| result.secrets_created)
                .unwrap_or(false),
            sqlite_file_present: paths.sqlite_path.is_file(),
            log_file_present: paths.server_log_path.is_file(),
            pid_file_present: paths.pid_path.is_file(),
            lock_file_present: paths.lock_path.is_file(),
            paths,
            config,
        })
    }
}
