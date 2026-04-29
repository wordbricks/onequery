use std::path::Path;
use std::path::PathBuf;

use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;

use super::PACKAGED_SERVER_BUNDLE_FILENAME;
use super::REINSTALL_CLI_PACKAGE_COMMAND;
use onequery_core::packaged_runtime::CurrentExecutableLocation;
use onequery_core::packaged_runtime::classify_current_executable;
use onequery_core::packaged_runtime::packaged_cli_relative_path;
use onequery_core::packaged_runtime::packaged_migrations_relative_path;
use onequery_core::packaged_runtime::packaged_server_relative_path;
use onequery_core::packaged_runtime::packaged_web_dist_relative_path;
use onequery_core::packaged_runtime::packaged_web_required_file;
use onequery_core::packaged_runtime::runtime_root_env_var;
use onequery_core::process_context::ProcessContext;

#[derive(Debug, Clone, Eq, PartialEq)]
pub(super) struct GatewayLaunchPlan {
    pub(super) migrations_dir: PathBuf,
    pub(super) runtime_entry_path: PathBuf,
    pub(super) web_dist_dir: PathBuf,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(super) enum RuntimeBundleRootSource {
    EnvironmentOverride,
    PackagedExecutable,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(super) struct RuntimeBundleRoot {
    pub(super) path: PathBuf,
    pub(super) source: RuntimeBundleRootSource,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(super) enum RuntimeBundleRootLocator<'a> {
    EnvironmentOverride(&'a Path),
    CurrentExecutable(&'a Path),
}

pub(super) fn resolve_launch_plan(
    process: &ProcessContext,
    command_line: &str,
) -> Result<GatewayLaunchPlan, CliError> {
    let bundle_root = resolve_runtime_bundle_root(process, command_line)?;
    let runtime_entry_path = resolve_packaged_server_entry_path(&bundle_root, command_line)?;
    let migrations_dir = bundle_root.path.join(packaged_migrations_relative_path());
    let web_dist_dir = bundle_root.path.join(packaged_web_dist_relative_path());
    let web_index_path = web_dist_dir.join(packaged_web_required_file());

    if runtime_entry_path.is_file() && migrations_dir.is_dir() && web_index_path.is_file() {
        return Ok(GatewayLaunchPlan {
            migrations_dir,
            runtime_entry_path,
            web_dist_dir,
        });
    }

    Err(incomplete_runtime_bundle_error(
        &bundle_root,
        command_line,
        format!(
            "expected {}, {}, and {} inside {}",
            runtime_entry_path.display(),
            migrations_dir.display(),
            web_index_path.display(),
            bundle_root.path.display()
        ),
    ))
}

fn resolve_packaged_server_entry_path(
    bundle_root: &RuntimeBundleRoot,
    command_line: &str,
) -> Result<PathBuf, CliError> {
    let server_dir = bundle_root.path.join(packaged_server_relative_path());
    let runtime_entry_path = server_dir.join(PACKAGED_SERVER_BUNDLE_FILENAME);

    if !runtime_entry_path.is_file() {
        return Err(incomplete_runtime_bundle_error(
            bundle_root,
            command_line,
            format!(
                "expected {} inside {}",
                runtime_entry_path.display(),
                server_dir.display()
            ),
        ));
    }

    Ok(runtime_entry_path)
}

fn resolve_runtime_bundle_root(
    process: &ProcessContext,
    command_line: &str,
) -> Result<RuntimeBundleRoot, CliError> {
    let runtime_root_override = std::env::var_os(runtime_root_env_var()).map(PathBuf::from);
    let locator = if let Some(runtime_root_override) = runtime_root_override.as_deref() {
        RuntimeBundleRootLocator::EnvironmentOverride(runtime_root_override)
    } else {
        let current_executable = process.current_executable_or_error(
            "failed to resolve self-host runtime bundle",
            command_line,
            ErrorStage::LoadConfig,
            vec![retry_with_runtime_root(command_line)],
        )?;
        RuntimeBundleRootLocator::CurrentExecutable(current_executable)
    };

    resolve_runtime_bundle_root_from_locator(locator, command_line)
}

pub(super) fn resolve_runtime_bundle_root_from_locator(
    locator: RuntimeBundleRootLocator<'_>,
    command_line: &str,
) -> Result<RuntimeBundleRoot, CliError> {
    match locator {
        RuntimeBundleRootLocator::EnvironmentOverride(runtime_root_override) => {
            if runtime_root_override.as_os_str().is_empty() {
                return Err(CliError::new(
                    "failed to resolve self-host runtime bundle",
                    command_line,
                    ErrorStage::LoadConfig,
                    format!("{} was set but empty", runtime_root_env_var()),
                    vec![retry_with_runtime_root(command_line)],
                ));
            }

            // CONTEXT: local Cargo builds live under `target/<triple>/<profile>` as well as
            // `target/<profile>`, so development needs an explicit staged bundle root instead
            // of guessing from an unbundled executable path.
            Ok(RuntimeBundleRoot {
                path: runtime_root_override.to_path_buf(),
                source: RuntimeBundleRootSource::EnvironmentOverride,
            })
        }
        RuntimeBundleRootLocator::CurrentExecutable(current_executable) => {
            match classify_current_executable(current_executable) {
                CurrentExecutableLocation::Packaged(layout) => Ok(RuntimeBundleRoot {
                    path: layout.runtime_root,
                    source: RuntimeBundleRootSource::PackagedExecutable,
                }),
                CurrentExecutableLocation::CargoTargetOutput => Err(CliError::new(
                    "failed to resolve self-host runtime bundle",
                    command_line,
                    ErrorStage::LoadConfig,
                    format!(
                        "current executable {} was launched from Cargo output; set {} to a staged self-host runtime bundle root",
                        current_executable.display(),
                        runtime_root_env_var()
                    ),
                    vec![retry_with_runtime_root(command_line)],
                )),
                CurrentExecutableLocation::Other => Err(CliError::new(
                    "failed to resolve self-host runtime bundle",
                    command_line,
                    ErrorStage::LoadConfig,
                    format!(
                        "expected {} to live under vendor/<target>/{}, or set {}=<bundle-root>",
                        current_executable.display(),
                        packaged_cli_relative_path(),
                        runtime_root_env_var()
                    ),
                    vec![retry_with_runtime_root(command_line)],
                )),
            }
        }
    }
}

fn incomplete_runtime_bundle_error(
    bundle_root: &RuntimeBundleRoot,
    command_line: &str,
    detail: String,
) -> CliError {
    CliError::new(
        "self-host runtime bundle is incomplete",
        command_line,
        ErrorStage::LoadConfig,
        match bundle_root.source {
            RuntimeBundleRootSource::EnvironmentOverride => format!(
                "configured {} ({}) is incomplete: {detail}",
                runtime_root_env_var(),
                bundle_root.path.display()
            ),
            RuntimeBundleRootSource::PackagedExecutable => detail,
        },
        runtime_bundle_resolution_try_next(&bundle_root.source, command_line),
    )
}

fn runtime_bundle_resolution_try_next(
    source: &RuntimeBundleRootSource,
    command_line: &str,
) -> Vec<String> {
    match source {
        RuntimeBundleRootSource::EnvironmentOverride => vec![retry_with_runtime_root(command_line)],
        RuntimeBundleRootSource::PackagedExecutable => {
            vec![REINSTALL_CLI_PACKAGE_COMMAND.to_owned()]
        }
    }
}

fn retry_with_runtime_root(command_line: &str) -> String {
    format!(
        "set {}=<bundle-root> and retry {command_line}",
        runtime_root_env_var()
    )
}
