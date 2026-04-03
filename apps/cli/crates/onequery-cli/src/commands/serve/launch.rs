use std::env;
use std::path::Path;
use std::path::PathBuf;

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;

use super::LINUX_ARM64_GLIBC_LOADER_PATHS;
use super::LINUX_ARM64_MUSL_LOADER_PATHS;
use super::LINUX_X64_GLIBC_LOADER_PATHS;
use super::LINUX_X64_MUSL_LOADER_PATHS;
use super::PACKAGED_RUNTIME_DIR;
use super::PACKAGED_SERVER_DIR;
use super::PACKAGED_SERVER_FILENAME;
use super::PACKAGED_SERVER_MUSL_FILENAME;
use super::PACKAGED_SERVER_WINDOWS_FILENAME;
use super::PACKAGED_VENDOR_CLI_DIR;
use super::REINSTALL_CLI_PACKAGE_COMMAND;
use super::WEB_INDEX_FILENAME;
use super::state::ServeRuntimeState;

#[derive(Debug, Clone, Eq, PartialEq)]
pub(super) struct ServeLaunchPlan {
    pub(super) launch_config_path: PathBuf,
    pub(super) migrations_dir: PathBuf,
    pub(super) runtime_entry_path: PathBuf,
    pub(super) web_dist_dir: PathBuf,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(super) struct PackagedServerCandidate {
    pub(super) path: PathBuf,
    pub(super) required_loader_paths: &'static [&'static str],
}

pub(super) fn resolve_launch_plan(
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
    bundle_root: &Path,
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

    if let Some(candidate) = select_packaged_server_candidate(&existing_candidates, Path::exists) {
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

pub(super) fn resolve_packaged_bundle_root_from_current_executable(
    current_executable: &Path,
) -> Option<PathBuf> {
    let cli_dir = current_executable.parent()?;
    if cli_dir.file_name()? != std::ffi::OsStr::new(PACKAGED_VENDOR_CLI_DIR) {
        return None;
    }

    cli_dir.parent().map(Path::to_path_buf)
}

pub(super) fn packaged_server_candidates(
    server_dir: &Path,
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

pub(super) fn select_packaged_server_candidate<'a, F>(
    candidates: &'a [&PackagedServerCandidate],
    loader_exists: F,
) -> Option<&'a PackagedServerCandidate>
where
    F: Fn(&Path) -> bool,
{
    candidates.iter().copied().find(|candidate| {
        candidate.required_loader_paths.is_empty()
            || candidate
                .required_loader_paths
                .iter()
                .map(Path::new)
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

fn join_path_segments(root: &Path, segments: &[&str]) -> PathBuf {
    segments
        .iter()
        .fold(root.to_path_buf(), |path, segment| path.join(segment))
}
