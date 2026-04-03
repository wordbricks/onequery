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
use crate::config::self_host::write_self_host_launch_config;
use crate::output::CommandOutput;

use super::CommandContext;
use super::Runtime;
use super::ensure_self_host_runtime_supported;
use super::is_process_running;

const PACKAGED_RUNTIME_DIR: &str = "runtime";
const PACKAGED_SERVER_DIR: &str = "server";
const PACKAGED_SERVER_FILENAME: &str = "onequery-server";
const PACKAGED_SERVER_WINDOWS_FILENAME: &str = "onequery-server.exe";
const PACKAGED_SERVER_MUSL_FILENAME: &str = "onequery-server-musl";
const PACKAGED_VENDOR_CLI_DIR: &str = "onequery";
const WEB_INDEX_FILENAME: &str = "index.html";
const SERVE_LOG_PREVIEW_LINE_COUNT: usize = 20;
const SERVE_STOP_POLL_ATTEMPTS: usize = 50;
const SERVE_STOP_POLL_INTERVAL_MS: u64 = 100;
const RETRY_SERVE_COMMAND: &str = "retry onequery serve";
const RETRY_SERVE_STOP_COMMAND: &str = "retry onequery serve stop";
const CHECK_SERVER_LOG_AND_RETRY_SERVE_STOP: &str =
    "check the server log and retry onequery serve stop";
const REINSTALL_CLI_PACKAGE_COMMAND: &str = "reinstall the CLI package";
const LINUX_X64_GLIBC_LOADER_PATHS: &[&str] = &[
    "/lib64/ld-linux-x86-64.so.2",
    "/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2",
];
const LINUX_X64_MUSL_LOADER_PATHS: &[&str] = &["/lib/ld-musl-x86_64.so.1"];
const LINUX_ARM64_GLIBC_LOADER_PATHS: &[&str] = &[
    "/lib/ld-linux-aarch64.so.1",
    "/lib64/ld-linux-aarch64.so.1",
    "/lib/aarch64-linux-gnu/ld-linux-aarch64.so.1",
];
const LINUX_ARM64_MUSL_LOADER_PATHS: &[&str] = &["/lib/ld-musl-aarch64.so.1"];

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
    pglite_dir_present: bool,
    log_file_present: bool,
    pid_file_present: bool,
    lock_file_present: bool,
}

#[derive(Debug, Clone, Eq, PartialEq)]
struct LogPreview {
    lines: Vec<String>,
    truncated: bool,
}

#[derive(Debug, Clone, Eq, PartialEq)]
struct ServeLaunchPlan {
    launch_config_path: PathBuf,
    migrations_dir: PathBuf,
    runtime_entry_path: PathBuf,
    web_dist_dir: PathBuf,
}

#[derive(Debug, Clone, Eq, PartialEq)]
struct PackagedServerCandidate {
    path: PathBuf,
    required_loader_paths: &'static [&'static str],
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
        pglite_dir_present: paths.pglite_dir.is_dir(),
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
    let mut launch_plan = resolve_launch_plan(state, command_line)?;
    launch_plan.launch_config_path = write_self_host_launch_config(
        command_line,
        &launch_plan.web_dist_dir,
        &launch_plan.migrations_dir,
    )?;
    remove_if_exists(state.paths.stop_request_path.as_path());
    let mut child = ProcessCommand::new(&launch_plan.runtime_entry_path);
    child.arg(&launch_plan.launch_config_path);
    child
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    let mut child = child.spawn().map_err(|spawn_error| {
        let (why, try_next) = match spawn_error.kind() {
            std::io::ErrorKind::NotFound => (
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
    let child_pid = child.id();

    let status = child.wait().map_err(|wait_error| {
        CliError::new(
            "failed while waiting for self-host server",
            command_line,
            ErrorStage::Internal,
            wait_error.to_string(),
            vec![RETRY_SERVE_COMMAND.to_owned()],
        )
    })?;
    let stop_requested = stop_request_matches(state.paths.stop_request_path.as_path(), child_pid);
    remove_if_exists(state.paths.stop_request_path.as_path());

    if status.success() || is_expected_termination(status) || stop_requested {
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
    let bundle_root = resolve_packaged_bundle_root(command_line)?;
    let runtime_entry_path =
        resolve_packaged_server_executable(bundle_root.as_path(), command_line)?;
    let migrations_dir = join_path_segments(&bundle_root, &[PACKAGED_RUNTIME_DIR, "migrations"]);
    let web_dist_dir = join_path_segments(&bundle_root, &[PACKAGED_RUNTIME_DIR, "web"]);

    if runtime_entry_path.is_file()
        && migrations_dir.is_dir()
        && web_dist_dir.join(WEB_INDEX_FILENAME).is_file()
    {
        return Ok(ServeLaunchPlan {
            launch_config_path: state.paths.launch_config_path.clone(),
            migrations_dir,
            runtime_entry_path,
            web_dist_dir,
        });
    }

    Err(CliError::new(
        "packaged self-host runtime is incomplete",
        command_line,
        ErrorStage::LoadConfig,
        format!(
            "expected {}, {}, and {} inside {}",
            runtime_entry_path.display(),
            migrations_dir.display(),
            web_dist_dir.join(WEB_INDEX_FILENAME).display(),
            bundle_root.display()
        ),
        vec![REINSTALL_CLI_PACKAGE_COMMAND.to_owned()],
    ))
}

fn resolve_packaged_server_executable(
    bundle_root: &std::path::Path,
    command_line: &str,
) -> Result<PathBuf, CliError> {
    let server_dir = bundle_root.join(PACKAGED_SERVER_DIR);
    let candidates = packaged_server_candidates(
        server_dir.as_path(),
        std::env::consts::OS,
        std::env::consts::ARCH,
    )
    .map_err(|detail| {
        CliError::new(
            "failed to resolve packaged self-host server executable",
            command_line,
            ErrorStage::LoadConfig,
            detail,
            vec![REINSTALL_CLI_PACKAGE_COMMAND.to_owned()],
        )
    })?;
    let existing_candidates = candidates
        .iter()
        .filter(|candidate| candidate.path.is_file())
        .collect::<Vec<_>>();

    if existing_candidates.is_empty() {
        return Err(CliError::new(
            "packaged self-host runtime is incomplete",
            command_line,
            ErrorStage::LoadConfig,
            format!(
                "expected one of {} inside {}",
                render_packaged_server_candidate_paths(&candidates),
                server_dir.display()
            ),
            vec![REINSTALL_CLI_PACKAGE_COMMAND.to_owned()],
        ));
    }

    if let Some(candidate) =
        select_packaged_server_candidate(&existing_candidates, std::path::Path::exists)
    {
        return Ok(candidate.path.clone());
    }

    Err(CliError::new(
        "packaged self-host runtime is incomplete",
        command_line,
        ErrorStage::LoadConfig,
        format!(
            "none of the packaged server executables inside {} match an available runtime loader; checked {}",
            server_dir.display(),
            render_required_loader_paths(&existing_candidates)
        ),
        vec![REINSTALL_CLI_PACKAGE_COMMAND.to_owned()],
    ))
}

fn resolve_packaged_bundle_root(command_line: &str) -> Result<PathBuf, CliError> {
    let current_executable = env::current_exe().map_err(|error| {
        CliError::new(
            "failed to resolve packaged self-host runtime bundle",
            command_line,
            ErrorStage::LoadConfig,
            format!("failed to read current executable path: {error}"),
            vec![REINSTALL_CLI_PACKAGE_COMMAND.to_owned()],
        )
    })?;
    resolve_packaged_bundle_root_from_current_executable(current_executable.as_path()).ok_or_else(
        || {
            CliError::new(
                "failed to resolve packaged self-host runtime bundle",
                command_line,
                ErrorStage::LoadConfig,
                format!(
                    "expected {} to live under vendor/<target>/{PACKAGED_VENDOR_CLI_DIR}",
                    current_executable.display()
                ),
                vec![REINSTALL_CLI_PACKAGE_COMMAND.to_owned()],
            )
        },
    )
}

fn resolve_packaged_bundle_root_from_current_executable(
    current_executable: &std::path::Path,
) -> Option<PathBuf> {
    let cli_dir = current_executable.parent()?;
    if cli_dir.file_name()? != std::ffi::OsStr::new(PACKAGED_VENDOR_CLI_DIR) {
        return None;
    }

    cli_dir.parent().map(std::path::Path::to_path_buf)
}

fn packaged_server_candidates(
    server_dir: &std::path::Path,
    os: &str,
    arch: &str,
) -> Result<Vec<PackagedServerCandidate>, String> {
    let default_candidate = PackagedServerCandidate {
        path: server_dir.join(packaged_server_filename_for_os(os)),
        required_loader_paths: &[],
    };

    if os != "linux" {
        return Ok(vec![default_candidate]);
    }

    let glibc_loader_paths = match arch {
        "x86_64" => LINUX_X64_GLIBC_LOADER_PATHS,
        "aarch64" => LINUX_ARM64_GLIBC_LOADER_PATHS,
        _ => {
            return Err(format!(
                "unsupported Linux architecture {arch} for packaged self-host runtime"
            ));
        }
    };
    let musl_loader_paths = match arch {
        "x86_64" => LINUX_X64_MUSL_LOADER_PATHS,
        "aarch64" => LINUX_ARM64_MUSL_LOADER_PATHS,
        _ => {
            return Err(format!(
                "unsupported Linux architecture {arch} for packaged self-host runtime"
            ));
        }
    };

    // Comment: Bun's Linux musl executable requires the musl runtime loader at
    // startup, so package both glibc and musl server executables and select
    // the one whose loader exists on the host.
    Ok(vec![
        PackagedServerCandidate {
            path: default_candidate.path,
            required_loader_paths: glibc_loader_paths,
        },
        PackagedServerCandidate {
            path: server_dir.join(PACKAGED_SERVER_MUSL_FILENAME),
            required_loader_paths: musl_loader_paths,
        },
    ])
}

fn packaged_server_filename_for_os(os: &str) -> &'static str {
    if os == "windows" {
        return PACKAGED_SERVER_WINDOWS_FILENAME;
    }

    PACKAGED_SERVER_FILENAME
}

fn select_packaged_server_candidate<'a, F>(
    candidates: &'a [&PackagedServerCandidate],
    loader_exists: F,
) -> Option<&'a PackagedServerCandidate>
where
    F: Fn(&std::path::Path) -> bool,
{
    candidates.iter().copied().find(|candidate| {
        candidate.required_loader_paths.is_empty()
            || candidate
                .required_loader_paths
                .iter()
                .map(std::path::Path::new)
                .any(&loader_exists)
    })
}

fn render_packaged_server_candidate_paths(candidates: &[PackagedServerCandidate]) -> String {
    candidates
        .iter()
        .map(|candidate| candidate.path.display().to_string())
        .collect::<Vec<_>>()
        .join(", ")
}

fn render_required_loader_paths(candidates: &[&PackagedServerCandidate]) -> String {
    candidates
        .iter()
        .flat_map(|candidate| candidate.required_loader_paths.iter().copied())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>()
        .join(", ")
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
    remove_if_exists(state.paths.stop_request_path.as_path());
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
        if !is_process_running(pid) {
            remove_if_exists(pid_path);
            remove_if_exists(lock_path);
        }

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
                vec![RETRY_SERVE_STOP_COMMAND.to_owned()],
            ));
        }

        // Comment: Windows release builds do not yet expose a graceful
        // cross-process shutdown channel, so `serve stop` terminates the
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
            vec![RETRY_SERVE_STOP_COMMAND.to_owned()],
        ))
    }

    #[cfg(not(any(unix, windows)))]
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

#[cfg(windows)]
fn mark_stop_requested(
    path: &std::path::Path,
    pid: u32,
    command_line: &str,
) -> Result<(), CliError> {
    fs::write(path, format!("{pid}\n")).map_err(|error| {
        CliError::new(
            "failed to prepare self-host stop request",
            command_line,
            ErrorStage::Internal,
            format!("{error} ({})", path.display()),
            vec![RETRY_SERVE_STOP_COMMAND.to_owned()],
        )
    })
}

#[cfg(not(windows))]
fn mark_stop_requested(
    path: &std::path::Path,
    pid: u32,
    command_line: &str,
) -> Result<(), CliError> {
    let _ = (path, pid, command_line);
    Ok(())
}

fn stop_request_matches(path: &std::path::Path, pid: u32) -> bool {
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
            "Next step: onequery serve start".to_owned(),
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
                "PGlite directory present: {}",
                yes_no_label(state.pglite_dir_present)
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
    let running = read_runtime_pid(state.paths.pid_path.as_path(), "onequery serve status")
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
        "pgliteDirPresent": state.pglite_dir_present,
        "logFilePresent": state.log_file_present,
        "pidFilePresent": state.pid_file_present,
        "lockFilePresent": state.lock_file_present,
    })
}

fn runtime_status_label(state: &ServeRuntimeState) -> &'static str {
    if read_runtime_pid(state.paths.pid_path.as_path(), "onequery serve status")
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
        "pgliteDir": paths.pglite_dir.display().to_string(),
        "logsDir": paths.logs_dir.display().to_string(),
        "serverLogPath": paths.server_log_path.display().to_string(),
        "backupsDir": paths.backups_dir.display().to_string(),
        "runDir": paths.run_dir.display().to_string(),
        "pidPath": paths.pid_path.display().to_string(),
        "lockPath": paths.lock_path.display().to_string(),
        "stopRequestPath": paths.stop_request_path.display().to_string(),
        "launchConfigPath": paths.launch_config_path.display().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use insta::assert_snapshot;
    use pretty_assertions::assert_eq;
    use tempfile::tempdir;
    use uuid::Uuid;

    use super::LogPreview;
    use super::PACKAGED_SERVER_DIR;
    use super::PACKAGED_SERVER_FILENAME;
    use super::PACKAGED_SERVER_MUSL_FILENAME;
    use super::PACKAGED_SERVER_WINDOWS_FILENAME;
    use super::PACKAGED_VENDOR_CLI_DIR;
    use super::ServeRuntimeState;
    use super::ServeStateAccessMode;
    use super::packaged_server_candidates;
    use super::render_serve_logs_output;
    use super::render_serve_output;
    use super::render_serve_start_output;
    use super::render_serve_status_output;
    use super::resolve_packaged_bundle_root_from_current_executable;
    use super::select_packaged_server_candidate;
    use crate::config::self_host::DEFAULT_SELF_HOST_LISTEN_HOST;
    use crate::config::self_host::SelfHostConfig;
    use crate::config::self_host::SelfHostRuntimePaths;
    use crate::config::self_host::bootstrap_self_host_foundation_for_test;
    use crate::config::self_host::default_port;
    use crate::config::self_host::load_self_host_config_for_test;
    use crate::config::self_host::write_self_host_launch_config_for_test;

    fn sample_paths() -> SelfHostRuntimePaths {
        SelfHostRuntimePaths {
            config_dir: "/tmp/onequery/config/self-host".into(),
            data_dir: "/tmp/onequery/data".into(),
            config_path: "/tmp/onequery/config/self-host/config.toml".into(),
            secrets_path: "/tmp/onequery/config/self-host/secrets.toml".into(),
            pglite_dir: "/tmp/onequery/data/pglite/onequery".into(),
            logs_dir: "/tmp/onequery/data/logs".into(),
            server_log_path: "/tmp/onequery/data/logs/server.log".into(),
            backups_dir: "/tmp/onequery/data/backups".into(),
            run_dir: "/tmp/onequery/data/run".into(),
            pid_path: "/tmp/onequery/data/run/server.pid".into(),
            lock_path: "/tmp/onequery/data/run/server.lock".into(),
            stop_request_path: "/tmp/onequery/data/run/server.stop".into(),
            launch_config_path: "/tmp/onequery/data/run/launch.json".into(),
        }
    }

    fn sample_state() -> ServeRuntimeState {
        ServeRuntimeState {
            paths: sample_paths(),
            bootstrapped: true,
            config_created: true,
            secrets_created: true,
            config: Some(SelfHostConfig::default()),
            pglite_dir_present: false,
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
                    format!(
                        "[bun-server] listening on {}",
                        crate::config::self_host::default_public_origin()
                    ),
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
    fn resolve_packaged_bundle_root_from_current_executable_uses_target_bundle_dir() {
        let temp_dir = tempdir().unwrap();
        let current_executable = temp_dir
            .path()
            .join("vendor")
            .join("x86_64-unknown-linux-musl")
            .join(PACKAGED_VENDOR_CLI_DIR)
            .join("onequery");

        fs::create_dir_all(current_executable.parent().unwrap())
            .unwrap_or_else(|error| panic!("expected current executable parent dir: {error}"));
        fs::write(&current_executable, b"")
            .unwrap_or_else(|error| panic!("expected fake current executable: {error}"));

        assert_eq!(
            resolve_packaged_bundle_root_from_current_executable(current_executable.as_path()),
            Some(
                temp_dir
                    .path()
                    .join("vendor")
                    .join("x86_64-unknown-linux-musl")
            )
        );
    }

    #[test]
    fn select_packaged_server_candidate_prefers_glibc_binary_when_loader_exists() {
        let temp_dir = tempdir().unwrap();
        let server_dir = temp_dir.path().join(PACKAGED_SERVER_DIR);
        fs::create_dir_all(&server_dir)
            .unwrap_or_else(|error| panic!("expected packaged server dir: {error}"));
        fs::write(server_dir.join(PACKAGED_SERVER_FILENAME), b"")
            .unwrap_or_else(|error| panic!("expected glibc server binary: {error}"));
        fs::write(server_dir.join(PACKAGED_SERVER_MUSL_FILENAME), b"")
            .unwrap_or_else(|error| panic!("expected musl server binary: {error}"));

        let candidates =
            packaged_server_candidates(server_dir.as_path(), "linux", "x86_64").unwrap();
        let existing_candidates = candidates.iter().collect::<Vec<_>>();
        let selected = select_packaged_server_candidate(&existing_candidates, |loader_path| {
            loader_path == Path::new("/lib64/ld-linux-x86-64.so.2")
        })
        .unwrap_or_else(|| panic!("expected glibc packaged server executable"));

        assert_eq!(selected.path, server_dir.join(PACKAGED_SERVER_FILENAME));
    }

    #[test]
    fn select_packaged_server_candidate_falls_back_to_musl_binary() {
        let temp_dir = tempdir().unwrap();
        let server_dir = temp_dir.path().join(PACKAGED_SERVER_DIR);
        fs::create_dir_all(&server_dir)
            .unwrap_or_else(|error| panic!("expected packaged server dir: {error}"));
        fs::write(server_dir.join(PACKAGED_SERVER_FILENAME), b"")
            .unwrap_or_else(|error| panic!("expected glibc server binary: {error}"));
        fs::write(server_dir.join(PACKAGED_SERVER_MUSL_FILENAME), b"")
            .unwrap_or_else(|error| panic!("expected musl server binary: {error}"));

        let candidates =
            packaged_server_candidates(server_dir.as_path(), "linux", "x86_64").unwrap();
        let existing_candidates = candidates.iter().collect::<Vec<_>>();
        let selected = select_packaged_server_candidate(&existing_candidates, |loader_path| {
            loader_path == Path::new("/lib/ld-musl-x86_64.so.1")
        })
        .unwrap_or_else(|| panic!("expected musl packaged server executable"));

        assert_eq!(
            selected.path,
            server_dir.join(PACKAGED_SERVER_MUSL_FILENAME)
        );
    }

    #[test]
    fn packaged_server_candidates_use_windows_executable_name() {
        let temp_dir = tempdir().unwrap();
        let server_dir = temp_dir.path().join(PACKAGED_SERVER_DIR);
        fs::create_dir_all(&server_dir)
            .unwrap_or_else(|error| panic!("expected packaged server dir: {error}"));

        let candidates =
            packaged_server_candidates(server_dir.as_path(), "windows", "x86_64").unwrap();

        assert_eq!(candidates.len(), 1);
        assert_eq!(
            candidates[0].path,
            server_dir.join(PACKAGED_SERVER_WINDOWS_FILENAME)
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
            "onequery serve",
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

    #[test]
    fn serve_writes_launch_contract_with_default_self_host_port() {
        let test_dir =
            std::env::temp_dir().join(format!("onequery-serve-launch-{}", Uuid::new_v4()));
        let paths = SelfHostRuntimePaths::for_test(
            test_dir.join("config").join("self-host"),
            test_dir.join("data"),
        );
        let asset_dir = test_dir.join("runtime").join("web");
        let migrations_dir = test_dir.join("runtime").join("migrations");

        fs::create_dir_all(&asset_dir)
            .unwrap_or_else(|error| panic!("expected asset dir creation to succeed: {error}"));

        let state = resolve_runtime_state_with_paths_for_test(
            paths,
            ServeStateAccessMode::BootstrapIfMissing,
            "onequery serve",
        )
        .unwrap_or_else(|error| panic!("expected serve bootstrap to succeed: {error}"));

        let launch_config_path = write_self_host_launch_config_for_test(
            state.paths,
            &asset_dir,
            &migrations_dir,
            "onequery serve",
        )
        .unwrap_or_else(|error| panic!("expected serve launch config write to succeed: {error}"));
        let launch_config_contents = fs::read_to_string(&launch_config_path)
            .unwrap_or_else(|error| panic!("expected launch config read to succeed: {error}"));
        let launch_config: serde_json::Value = serde_json::from_str(&launch_config_contents)
            .unwrap_or_else(|error| panic!("expected launch config JSON to parse: {error}"));

        assert_eq!(
            launch_config.pointer("/listen/host"),
            Some(&serde_json::Value::String(
                DEFAULT_SELF_HOST_LISTEN_HOST.to_owned(),
            ))
        );
        assert_eq!(
            launch_config.pointer("/listen/port"),
            Some(&serde_json::Value::Number(default_port().into()))
        );
        assert_eq!(
            launch_config.get("publicOrigin"),
            Some(&serde_json::Value::String(
                crate::config::self_host::default_public_origin(),
            ))
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
            pglite_dir_present: paths.pglite_dir.is_dir(),
            log_file_present: paths.server_log_path.is_file(),
            pid_file_present: paths.pid_path.is_file(),
            lock_file_present: paths.lock_path.is_file(),
            paths,
            config,
        })
    }
}
