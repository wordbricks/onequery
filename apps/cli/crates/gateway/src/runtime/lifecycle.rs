use std::fs;
use std::io;
use std::path::Path;
use std::path::PathBuf;

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use serde::Deserialize;

use crate::self_host::SelfHostRuntimePaths;

use onequery_cli_core::process::is_process_running;

const RUNTIME_STATE_FILENAME: &str = "server.state.json";

#[derive(Debug, Clone, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
struct RuntimeLockRecord {
    pid: u32,
    acquired_at: String,
    data_dir: String,
    launch_id: String,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(super) struct RuntimeStateRecord {
    pub(super) pid: u32,
    pub(super) phase: RuntimeLifecyclePhase,
    updated_at: String,
    pub(super) data_dir: String,
    pub(super) launch_id: String,
}

#[derive(Debug, Clone, Copy, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub(super) enum RuntimeLifecyclePhase {
    Checkpointing,
    Draining,
    Starting,
    Ready,
    ShutdownFailed,
    Stopping,
}

pub(crate) fn read_managed_runtime_pid(
    paths: &SelfHostRuntimePaths,
    command_line: &str,
) -> Result<Option<u32>, CliError> {
    let state_path = runtime_state_path(paths.run_dir.as_path());
    let runtime_state = read_runtime_state_record(state_path.as_path(), command_line)?;

    if let Some(lock_record) = read_runtime_lock_record(paths.lock_path.as_path(), command_line)?
        && is_process_running(lock_record.pid)
        && runtime_record_matches_data_dir(&lock_record.data_dir, paths.data_dir.as_path())
        && runtime_state_matches_lock(
            runtime_state.as_ref(),
            &lock_record,
            paths.data_dir.as_path(),
        )
    {
        return Ok(Some(lock_record.pid));
    }

    Ok(
        read_runtime_pid(paths.pid_path.as_path(), command_line)?.filter(|pid| {
            is_process_running(*pid)
                && runtime_state_matches_pid(runtime_state.as_ref(), *pid, paths.data_dir.as_path())
        }),
    )
}

fn read_runtime_pid(path: &Path, command_line: &str) -> Result<Option<u32>, CliError> {
    let Some(contents) = read_optional_runtime_file(
        path,
        command_line,
        "failed to read runtime pid file",
        "remove the stale pid file and retry",
    )?
    else {
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

fn read_runtime_lock_record(
    path: &Path,
    command_line: &str,
) -> Result<Option<RuntimeLockRecord>, CliError> {
    let Some(contents) = read_optional_runtime_file(
        path,
        command_line,
        "failed to read runtime lock file",
        "remove the stale lock file and retry",
    )?
    else {
        return Ok(None);
    };
    let trimmed = contents.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    serde_json::from_str::<RuntimeLockRecord>(trimmed)
        .map(Some)
        .map_err(|error| {
            CliError::new(
                "failed to parse runtime lock file",
                command_line,
                ErrorStage::LoadConfig,
                format!("{error} ({})", path.display()),
                vec!["remove the stale lock file and retry".to_owned()],
            )
        })
}

pub(super) fn runtime_state_path(run_dir: &Path) -> PathBuf {
    run_dir.join(RUNTIME_STATE_FILENAME)
}

pub(super) fn read_runtime_state_record(
    path: &Path,
    command_line: &str,
) -> Result<Option<RuntimeStateRecord>, CliError> {
    let Some(contents) = read_optional_runtime_file(
        path,
        command_line,
        "failed to read runtime state file",
        "remove the stale runtime state file and retry",
    )?
    else {
        return Ok(None);
    };
    let trimmed = contents.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    serde_json::from_str::<RuntimeStateRecord>(trimmed)
        .map(Some)
        .map_err(|error| {
            CliError::new(
                "failed to parse runtime state file",
                command_line,
                ErrorStage::LoadConfig,
                format!("{error} ({})", path.display()),
                vec!["remove the stale runtime state file and retry".to_owned()],
            )
        })
}

fn read_runtime_state_record_during_startup_poll(
    path: &Path,
    command_line: &str,
) -> Result<Option<RuntimeStateRecord>, CliError> {
    let Some(contents) = read_optional_runtime_file(
        path,
        command_line,
        "failed to read runtime state file",
        "remove the stale runtime state file and retry",
    )?
    else {
        return Ok(None);
    };

    let trimmed = contents.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    // CONTEXT: startup polling can race the runtime replacing this file, so
    // malformed JSON is retried instead of aborting launch.
    Ok(serde_json::from_str::<RuntimeStateRecord>(trimmed).ok())
}

fn read_optional_runtime_file(
    path: &Path,
    command_line: &str,
    title: &'static str,
    try_next: &'static str,
) -> Result<Option<String>, CliError> {
    match fs::read_to_string(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(CliError::new(
            title,
            command_line,
            ErrorStage::LoadConfig,
            format!("{error} ({})", path.display()),
            vec![try_next.to_owned()],
        )),
    }
}

#[cfg(test)]
fn runtime_ready_state_reported_during_startup_poll(
    path: &Path,
    expected_pid: u32,
    command_line: &str,
) -> Result<bool, CliError> {
    Ok(
        read_runtime_state_record_during_startup_poll(path, command_line)?.is_some_and(|state| {
            state.pid == expected_pid && state.phase == RuntimeLifecyclePhase::Ready
        }),
    )
}

pub(super) fn runtime_ready_pid_reported_during_startup_poll(
    path: &Path,
    expected_data_dir: &Path,
    expected_launch_id: &str,
    command_line: &str,
) -> Result<Option<u32>, CliError> {
    Ok(
        read_runtime_state_record_during_startup_poll(path, command_line)?.and_then(|state| {
            (state.phase == RuntimeLifecyclePhase::Ready
                && runtime_record_matches_data_dir(&state.data_dir, expected_data_dir)
                && runtime_launch_id_matches(&state.launch_id, expected_launch_id))
            .then_some(state.pid)
        }),
    )
}

fn runtime_record_matches_data_dir(record_data_dir: &str, expected_data_dir: &Path) -> bool {
    Path::new(record_data_dir) == expected_data_dir
}

fn runtime_state_matches_pid(
    state: Option<&RuntimeStateRecord>,
    expected_pid: u32,
    expected_data_dir: &Path,
) -> bool {
    state.is_some_and(|state| {
        state.pid == expected_pid
            && runtime_record_matches_data_dir(&state.data_dir, expected_data_dir)
    })
}

fn runtime_state_matches_lock(
    state: Option<&RuntimeStateRecord>,
    lock_record: &RuntimeLockRecord,
    expected_data_dir: &Path,
) -> bool {
    state.is_some_and(|state| {
        state.pid == lock_record.pid
            && runtime_launch_id_matches(&state.launch_id, &lock_record.launch_id)
            && runtime_record_matches_data_dir(&state.data_dir, expected_data_dir)
    })
}

pub(super) fn runtime_launch_id_matches(actual: &str, expected: &str) -> bool {
    actual == expected
}

pub(super) fn runtime_phase_label(phase: RuntimeLifecyclePhase) -> &'static str {
    match phase {
        RuntimeLifecyclePhase::Checkpointing => "checkpointing",
        RuntimeLifecyclePhase::Draining => "draining",
        RuntimeLifecyclePhase::Starting => "starting",
        RuntimeLifecyclePhase::Ready => "ready",
        RuntimeLifecyclePhase::ShutdownFailed => "shutdown_failed",
        RuntimeLifecyclePhase::Stopping => "stopping",
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use pretty_assertions::assert_eq;
    use tempfile::tempdir;

    use super::RUNTIME_STATE_FILENAME;
    use super::read_managed_runtime_pid;
    use super::read_runtime_state_record;
    use super::runtime_ready_pid_reported_during_startup_poll;
    use super::runtime_ready_state_reported_during_startup_poll;
    use crate::self_host::SelfHostRuntimePaths;

    fn test_paths() -> (tempfile::TempDir, SelfHostRuntimePaths) {
        let temp_dir = tempdir().unwrap_or_else(|error| panic!("expected temp dir: {error}"));
        let paths = SelfHostRuntimePaths::from_dirs(
            temp_dir.path().join("config").join("self-host"),
            temp_dir.path().join("data"),
        );

        fs::create_dir_all(&paths.run_dir)
            .unwrap_or_else(|error| panic!("expected run dir creation: {error}"));

        (temp_dir, paths)
    }

    #[test]
    fn startup_poll_treats_malformed_runtime_state_as_retryable() {
        let (_temp_dir, paths) = test_paths();
        let state_path = paths.run_dir.join(RUNTIME_STATE_FILENAME);

        fs::write(&state_path, "{\"pid\":")
            .unwrap_or_else(|error| panic!("expected malformed state write: {error}"));

        assert!(
            !runtime_ready_state_reported_during_startup_poll(
                state_path.as_path(),
                4242,
                "onequery gateway start",
            )
            .unwrap_or_else(|error| panic!("expected retryable state read: {error}"))
        );
    }

    #[test]
    fn startup_poll_returns_ready_pid_for_matching_data_dir() {
        let (_temp_dir, paths) = test_paths();
        let state_path = paths.run_dir.join(RUNTIME_STATE_FILENAME);

        fs::write(
            &state_path,
            format!(
                "{{\"pid\":4242,\"phase\":\"ready\",\"updatedAt\":\"2026-03-25T00:00:00.000Z\",\"dataDir\":\"{}\",\"launchId\":\"launch-a\"}}\n",
                paths.data_dir.display()
            ),
        )
        .unwrap_or_else(|error| panic!("expected state write: {error}"));

        assert_eq!(
            runtime_ready_pid_reported_during_startup_poll(
                state_path.as_path(),
                paths.data_dir.as_path(),
                "launch-a",
                "onequery gateway start",
            )
            .unwrap_or_else(|error| panic!("expected ready pid read: {error}")),
            Some(4242)
        );
    }

    #[test]
    fn startup_poll_ignores_ready_pid_for_other_data_dir() {
        let (_temp_dir, paths) = test_paths();
        let state_path = paths.run_dir.join(RUNTIME_STATE_FILENAME);

        fs::write(
            &state_path,
            "{\"pid\":4242,\"phase\":\"ready\",\"updatedAt\":\"2026-03-25T00:00:00.000Z\",\"dataDir\":\"/other\",\"launchId\":\"launch-a\"}\n",
        )
        .unwrap_or_else(|error| panic!("expected state write: {error}"));

        assert_eq!(
            runtime_ready_pid_reported_during_startup_poll(
                state_path.as_path(),
                paths.data_dir.as_path(),
                "launch-a",
                "onequery gateway start",
            )
            .unwrap_or_else(|error| panic!("expected ready pid read: {error}")),
            None
        );
    }

    #[test]
    fn startup_poll_ignores_ready_pid_for_other_launch() {
        let (_temp_dir, paths) = test_paths();
        let state_path = paths.run_dir.join(RUNTIME_STATE_FILENAME);

        fs::write(
            &state_path,
            format!(
                "{{\"pid\":4242,\"phase\":\"ready\",\"updatedAt\":\"2026-03-25T00:00:00.000Z\",\"dataDir\":\"{}\",\"launchId\":\"other-launch\"}}\n",
                paths.data_dir.display()
            ),
        )
        .unwrap_or_else(|error| panic!("expected state write: {error}"));

        assert_eq!(
            runtime_ready_pid_reported_during_startup_poll(
                state_path.as_path(),
                paths.data_dir.as_path(),
                "launch-a",
                "onequery gateway start",
            )
            .unwrap_or_else(|error| panic!("expected ready pid read: {error}")),
            None
        );
    }

    #[test]
    fn strict_runtime_state_reads_reject_missing_launch_id() {
        let (_temp_dir, paths) = test_paths();
        let state_path = paths.run_dir.join(RUNTIME_STATE_FILENAME);

        fs::write(
            &state_path,
            format!(
                "{{\"pid\":4242,\"phase\":\"ready\",\"updatedAt\":\"2026-03-25T00:00:00.000Z\",\"dataDir\":\"{}\"}}\n",
                paths.data_dir.display()
            ),
        )
        .unwrap_or_else(|error| panic!("expected state write: {error}"));

        let error = read_runtime_state_record(state_path.as_path(), "onequery gateway status")
            .expect_err("expected runtime state without launchId to fail strict reads");

        assert_eq!(error.title.as_str(), "failed to parse runtime state file");
    }

    #[test]
    fn strict_runtime_state_reads_still_report_parse_failures() {
        let (_temp_dir, paths) = test_paths();
        let state_path = paths.run_dir.join(RUNTIME_STATE_FILENAME);

        fs::write(&state_path, "{\"pid\":")
            .unwrap_or_else(|error| panic!("expected malformed state write: {error}"));

        let error = read_runtime_state_record(state_path.as_path(), "onequery gateway status")
            .expect_err("expected malformed runtime state to fail strict reads");

        assert_eq!(error.title.as_str(), "failed to parse runtime state file");
    }

    #[test]
    fn strict_runtime_state_reads_report_read_failures() {
        let (temp_dir, _paths) = test_paths();
        let error = read_runtime_state_record(temp_dir.path(), "onequery gateway status")
            .expect_err("expected directory read to fail strict runtime state reads");

        assert_eq!(error.title.as_str(), "failed to read runtime state file");
        assert_eq!(
            error.try_next,
            vec!["remove the stale runtime state file and retry".to_owned()]
        );
    }

    #[test]
    fn startup_poll_reports_runtime_state_read_failures() {
        let (temp_dir, paths) = test_paths();
        let error = runtime_ready_pid_reported_during_startup_poll(
            temp_dir.path(),
            paths.data_dir.as_path(),
            "launch-a",
            "onequery gateway start",
        )
        .expect_err("expected directory read to fail startup poll");

        assert_eq!(error.title.as_str(), "failed to read runtime state file");
    }

    #[test]
    fn read_managed_runtime_pid_reports_unreadable_pid_file() {
        let (_temp_dir, paths) = test_paths();
        fs::create_dir(&paths.pid_path)
            .unwrap_or_else(|error| panic!("expected pid marker directory creation: {error}"));

        let error = read_managed_runtime_pid(&paths, "onequery gateway status")
            .expect_err("expected unreadable pid marker to fail");

        assert_eq!(error.title.as_str(), "failed to read runtime pid file");
    }

    #[test]
    fn read_managed_runtime_pid_reports_unreadable_lock_file() {
        let (_temp_dir, paths) = test_paths();
        fs::create_dir(&paths.lock_path)
            .unwrap_or_else(|error| panic!("expected lock marker directory creation: {error}"));

        let error = read_managed_runtime_pid(&paths, "onequery gateway status")
            .expect_err("expected unreadable lock marker to fail");

        assert_eq!(error.title.as_str(), "failed to read runtime lock file");
    }

    #[test]
    fn read_managed_runtime_pid_ignores_live_lock_without_matching_runtime_state() {
        let (_temp_dir, paths) = test_paths();
        let pid = std::process::id();

        fs::write(
            &paths.lock_path,
            format!(
                "{{\"pid\":{pid},\"acquiredAt\":\"2026-03-25T00:00:00.000Z\",\"dataDir\":\"{}\",\"launchId\":\"launch-a\"}}\n",
                paths.data_dir.display()
            ),
        )
        .unwrap_or_else(|error| panic!("expected lock write: {error}"));

        assert_eq!(
            read_managed_runtime_pid(&paths, "onequery gateway status")
                .unwrap_or_else(|error| panic!("expected pid read: {error}")),
            None
        );
    }

    #[test]
    fn read_managed_runtime_pid_accepts_live_lock_with_matching_runtime_state() {
        let (_temp_dir, paths) = test_paths();
        let pid = std::process::id();

        fs::write(
            &paths.lock_path,
            format!(
                "{{\"pid\":{pid},\"acquiredAt\":\"2026-03-25T00:00:00.000Z\",\"dataDir\":\"{}\",\"launchId\":\"launch-a\"}}\n",
                paths.data_dir.display()
            ),
        )
        .unwrap_or_else(|error| panic!("expected lock write: {error}"));
        fs::write(
            paths.run_dir.join(RUNTIME_STATE_FILENAME),
            format!(
                "{{\"pid\":{pid},\"phase\":\"ready\",\"updatedAt\":\"2026-03-25T00:00:00.000Z\",\"dataDir\":\"{}\",\"launchId\":\"launch-a\"}}\n",
                paths.data_dir.display()
            ),
        )
        .unwrap_or_else(|error| panic!("expected state write: {error}"));

        assert_eq!(
            read_managed_runtime_pid(&paths, "onequery gateway status")
                .unwrap_or_else(|error| panic!("expected pid read: {error}")),
            Some(pid)
        );
    }
}
