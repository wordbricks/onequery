use std::ffi::OsStr;
use std::fs::OpenOptions;
use std::io::ErrorKind;
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt as _;
use std::path::Path;
use std::path::PathBuf;

use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;
use onequery_core::private_files;

use crate::self_host::SelfHostRuntimePaths;

use super::super::BACKGROUND_GATEWAY_RETRY_COMMAND;
use super::transport::retry_command_hint;

const SUPERVISOR_GENERATION_DIR_NAME: &str = "supervisor-generations";
const SUPERVISOR_GENERATION_MARKER_PREFIX: &str = "generation-";
const SUPERVISOR_GENERATION_MARKER_SUFFIX: &str = ".json";

pub(super) fn allocate_supervisor_generation(
    paths: &SelfHostRuntimePaths,
    supervisor_pid: u32,
    command_line: &str,
) -> Result<u64, CliError> {
    let ledger_dir = supervisor_generation_ledger_dir(paths);
    private_files::create_private_dir(
        ledger_dir.as_path(),
        command_line,
        ErrorStage::Internal,
        "supervisor generation ledger",
    )?;

    let mut candidate = next_supervisor_generation_candidate(ledger_dir.as_path(), command_line)?;

    loop {
        let marker_path = ledger_dir.join(supervisor_generation_marker_filename(candidate));
        match create_supervisor_generation_marker(
            marker_path.as_path(),
            candidate,
            supervisor_pid,
            command_line,
        ) {
            Ok(()) => {
                sync_supervisor_generation_ledger_dir(ledger_dir.as_path(), command_line)?;
                return Ok(candidate);
            }
            Err(SupervisorGenerationMarkerCreateError::AlreadyExists) => {
                candidate = candidate.checked_add(1).ok_or_else(|| {
                    supervisor_generation_overflow_error(ledger_dir.as_path(), command_line)
                })?;
            }
            Err(SupervisorGenerationMarkerCreateError::Cli(error)) => return Err(error),
        }
    }
}

fn supervisor_generation_ledger_dir(paths: &SelfHostRuntimePaths) -> PathBuf {
    paths.state_dir.join(SUPERVISOR_GENERATION_DIR_NAME)
}

fn next_supervisor_generation_candidate(
    ledger_dir: &Path,
    command_line: &str,
) -> Result<u64, CliError> {
    max_allocated_supervisor_generation(ledger_dir, command_line)?
        .checked_add(1)
        .ok_or_else(|| supervisor_generation_overflow_error(ledger_dir, command_line))
}

fn max_allocated_supervisor_generation(
    ledger_dir: &Path,
    command_line: &str,
) -> Result<u64, CliError> {
    let mut max_generation = 0;

    for entry in std::fs::read_dir(ledger_dir).map_err(|error| {
        supervisor_generation_io_error(
            "failed to read supervisor generation ledger",
            error,
            ledger_dir,
            command_line,
        )
    })? {
        let entry = entry.map_err(|error| {
            supervisor_generation_io_error(
                "failed to read supervisor generation marker",
                error,
                ledger_dir,
                command_line,
            )
        })?;

        if let Some(generation) = supervisor_generation_from_marker_filename(
            &entry.file_name(),
            ledger_dir,
            command_line,
        )? {
            max_generation = max_generation.max(generation);
        }
    }

    Ok(max_generation)
}

fn supervisor_generation_from_marker_filename(
    file_name: &OsStr,
    ledger_dir: &Path,
    command_line: &str,
) -> Result<Option<u64>, CliError> {
    let Some(file_name) = file_name.to_str() else {
        return Ok(None);
    };
    let Some(generation) = file_name
        .strip_prefix(SUPERVISOR_GENERATION_MARKER_PREFIX)
        .and_then(|value| value.strip_suffix(SUPERVISOR_GENERATION_MARKER_SUFFIX))
    else {
        return Ok(None);
    };

    if generation.len() != 20 || !generation.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(supervisor_generation_corrupt_marker_error(
            file_name,
            ledger_dir,
            command_line,
        ));
    }

    let generation = generation.parse::<u64>().map_err(|_| {
        supervisor_generation_corrupt_marker_error(file_name, ledger_dir, command_line)
    })?;

    if generation == 0 {
        return Err(supervisor_generation_corrupt_marker_error(
            file_name,
            ledger_dir,
            command_line,
        ));
    }

    Ok(Some(generation))
}

fn supervisor_generation_marker_filename(generation: u64) -> String {
    format!(
        "{SUPERVISOR_GENERATION_MARKER_PREFIX}{generation:020}{SUPERVISOR_GENERATION_MARKER_SUFFIX}"
    )
}

enum SupervisorGenerationMarkerCreateError {
    AlreadyExists,
    Cli(CliError),
}

fn create_supervisor_generation_marker(
    path: &Path,
    generation: u64,
    supervisor_pid: u32,
    command_line: &str,
) -> Result<(), SupervisorGenerationMarkerCreateError> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;

        options.mode(0o600);
    }

    let mut file = options.open(path).map_err(|error| match error.kind() {
        ErrorKind::AlreadyExists => SupervisorGenerationMarkerCreateError::AlreadyExists,
        _ => SupervisorGenerationMarkerCreateError::Cli(supervisor_generation_io_error(
            "failed to create supervisor generation marker",
            error,
            path,
            command_line,
        )),
    })?;

    #[cfg(unix)]
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).map_err(|error| {
        SupervisorGenerationMarkerCreateError::Cli(supervisor_generation_io_error(
            "failed to secure supervisor generation marker",
            error,
            path,
            command_line,
        ))
    })?;

    let marker = format!(
        "{{\n  \"generation\": \"{generation}\",\n  \"supervisorPid\": {supervisor_pid}\n}}\n"
    );
    file.write_all(marker.as_bytes()).map_err(|error| {
        SupervisorGenerationMarkerCreateError::Cli(supervisor_generation_io_error(
            "failed to write supervisor generation marker",
            error,
            path,
            command_line,
        ))
    })?;
    file.sync_all().map_err(|error| {
        SupervisorGenerationMarkerCreateError::Cli(supervisor_generation_io_error(
            "failed to sync supervisor generation marker",
            error,
            path,
            command_line,
        ))
    })
}

fn sync_supervisor_generation_ledger_dir(
    ledger_dir: &Path,
    command_line: &str,
) -> Result<(), CliError> {
    #[cfg(unix)]
    {
        let dir = std::fs::File::open(ledger_dir).map_err(|error| {
            supervisor_generation_io_error(
                "failed to sync supervisor generation ledger",
                error,
                ledger_dir,
                command_line,
            )
        })?;

        dir.sync_all().map_err(|error| {
            supervisor_generation_io_error(
                "failed to sync supervisor generation ledger",
                error,
                ledger_dir,
                command_line,
            )
        })?;
    }

    #[cfg(not(unix))]
    {
        let _ = ledger_dir;
        let _ = command_line;
    }

    Ok(())
}

fn supervisor_generation_io_error(
    message: &'static str,
    error: std::io::Error,
    path: &Path,
    command_line: &str,
) -> CliError {
    CliError::new(
        message,
        command_line,
        ErrorStage::Internal,
        format!("{error} ({})", path.display()),
        vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
    )
}

fn supervisor_generation_corrupt_marker_error(
    file_name: &str,
    ledger_dir: &Path,
    command_line: &str,
) -> CliError {
    CliError::new(
        "failed to parse supervisor generation marker",
        command_line,
        ErrorStage::Internal,
        format!("invalid marker {file_name} in {}", ledger_dir.display()),
        vec![
            format!("remove or fix {}", ledger_dir.join(file_name).display()),
            retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND),
        ],
    )
}

fn supervisor_generation_overflow_error(ledger_dir: &Path, command_line: &str) -> CliError {
    CliError::new(
        "failed to allocate supervisor generation",
        command_line,
        ErrorStage::Internal,
        format!(
            "supervisor generation ledger {} reached the maximum u64 generation",
            ledger_dir.display()
        ),
        vec![retry_command_hint(BACKGROUND_GATEWAY_RETRY_COMMAND)],
    )
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::thread;

    use pretty_assertions::assert_eq;
    use tempfile::tempdir;

    use super::*;

    const COMMAND_LINE: &str = "onequery gateway start";

    #[test]
    fn allocate_supervisor_generation_starts_at_one() {
        let (_temp_dir, paths) = test_paths();

        let generation = allocate_supervisor_generation(&paths, 123, COMMAND_LINE)
            .unwrap_or_else(|error| panic!("expected generation allocation: {error}"));

        assert_eq!(generation, 1);
    }

    #[test]
    fn allocate_supervisor_generation_advances_from_existing_markers() {
        let (_temp_dir, paths) = test_paths();
        let ledger_dir = supervisor_generation_ledger_dir(&paths);
        fs::create_dir_all(&ledger_dir)
            .unwrap_or_else(|error| panic!("expected ledger dir creation: {error}"));
        fs::write(
            ledger_dir.join(supervisor_generation_marker_filename(41)),
            "{}",
        )
        .unwrap_or_else(|error| panic!("expected marker write: {error}"));

        let generation = allocate_supervisor_generation(&paths, 123, COMMAND_LINE)
            .unwrap_or_else(|error| panic!("expected generation allocation: {error}"));

        assert_eq!(generation, 42);
    }

    #[test]
    fn allocate_supervisor_generation_is_unique_for_concurrent_allocators() {
        let (_temp_dir, paths) = test_paths();
        let mut generations = (0..8)
            .map(|supervisor_pid| {
                let paths = paths.clone();

                thread::spawn(move || {
                    allocate_supervisor_generation(&paths, supervisor_pid, COMMAND_LINE)
                        .unwrap_or_else(|error| panic!("expected generation allocation: {error}"))
                })
            })
            .map(|handle| {
                handle
                    .join()
                    .unwrap_or_else(|_| panic!("expected allocator thread to finish"))
            })
            .collect::<Vec<_>>();
        generations.sort_unstable();

        assert_eq!(generations, vec![1, 2, 3, 4, 5, 6, 7, 8]);
    }

    #[test]
    fn allocate_supervisor_generation_rejects_corrupt_ledger_marker() {
        let (_temp_dir, paths) = test_paths();
        let ledger_dir = supervisor_generation_ledger_dir(&paths);
        fs::create_dir_all(&ledger_dir)
            .unwrap_or_else(|error| panic!("expected ledger dir creation: {error}"));
        fs::write(
            ledger_dir.join(format!(
                "{SUPERVISOR_GENERATION_MARKER_PREFIX}not-a-generation{SUPERVISOR_GENERATION_MARKER_SUFFIX}"
            )),
            "{}",
        )
        .unwrap_or_else(|error| panic!("expected corrupt marker write: {error}"));

        let error = allocate_supervisor_generation(&paths, 123, COMMAND_LINE)
            .expect_err("expected corrupt marker to reject allocation");

        assert_eq!(
            error.why,
            format!(
                "invalid marker generation-not-a-generation.json in {}",
                ledger_dir.display()
            )
        );
    }

    #[test]
    fn allocate_supervisor_generation_reports_generation_overflow() {
        let (_temp_dir, paths) = test_paths();
        let ledger_dir = supervisor_generation_ledger_dir(&paths);
        fs::create_dir_all(&ledger_dir)
            .unwrap_or_else(|error| panic!("expected ledger dir creation: {error}"));
        fs::write(
            ledger_dir.join(supervisor_generation_marker_filename(u64::MAX)),
            "{}",
        )
        .unwrap_or_else(|error| panic!("expected max marker write: {error}"));

        let error = allocate_supervisor_generation(&paths, 123, COMMAND_LINE)
            .expect_err("expected generation overflow");

        assert_eq!(
            error.why,
            format!(
                "supervisor generation ledger {} reached the maximum u64 generation",
                ledger_dir.display()
            )
        );
    }

    fn test_paths() -> (tempfile::TempDir, SelfHostRuntimePaths) {
        let temp_dir = tempdir().unwrap_or_else(|error| panic!("expected temp dir: {error}"));
        let paths = SelfHostRuntimePaths::from_dirs(
            temp_dir.path().join("self-host"),
            temp_dir.path().to_path_buf(),
        );

        (temp_dir, paths)
    }
}
