use std::env;
use std::ffi::OsStr;
use std::path::Path;
use std::path::PathBuf;
use std::sync::OnceLock;

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use serde::Deserialize;

use super::PACKAGED_SERVER_BUNDLE_FILENAME;
use super::REINSTALL_CLI_PACKAGE_COMMAND;
use super::state::GatewayRuntimeState;

const RUNTIME_BUNDLE_SPEC_RAW: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../../packages/base/src/runtime-bundle.json"
));
static RUNTIME_BUNDLE_SPEC: OnceLock<RuntimeBundleSpec> = OnceLock::new();

#[derive(Debug, Clone, Eq, PartialEq)]
pub(super) struct GatewayLaunchPlan {
    pub(super) launch_config_path: PathBuf,
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

#[derive(Debug, Clone, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
struct RuntimeBundleSpec {
    directories: RuntimeBundleDirectories,
    runtime_entries: RuntimeBundleEntries,
    runtime_root_env_var: String,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq)]
struct RuntimeBundleDirectories {
    cli: RuntimeBundlePathConfig,
    server: RuntimeBundlePathConfig,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
struct RuntimeBundleEntries {
    migrations: RuntimeBundlePathConfig,
    web_dist: RuntimeBundleWebEntry,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
struct RuntimeBundlePathConfig {
    relative_path: String,
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
struct RuntimeBundleWebEntry {
    relative_path: String,
    required_file: String,
}

pub(super) fn resolve_launch_plan(
    state: &GatewayRuntimeState,
    command_line: &str,
) -> Result<GatewayLaunchPlan, CliError> {
    let bundle_root = resolve_runtime_bundle_root(command_line)?;
    let bundle_spec = runtime_bundle_spec();
    let runtime_entry_path = resolve_packaged_server_entry_path(&bundle_root, command_line)?;
    let migrations_dir = bundle_root
        .path
        .join(&bundle_spec.runtime_entries.migrations.relative_path);
    let web_dist_dir = bundle_root
        .path
        .join(&bundle_spec.runtime_entries.web_dist.relative_path);
    let web_index_path = web_dist_dir.join(&bundle_spec.runtime_entries.web_dist.required_file);

    if runtime_entry_path.is_file() && migrations_dir.is_dir() && web_index_path.is_file() {
        return Ok(GatewayLaunchPlan {
            launch_config_path: state.paths.launch_config_path.clone(),
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

fn resolve_runtime_bundle_root(command_line: &str) -> Result<RuntimeBundleRoot, CliError> {
    let runtime_root_override = env::var_os(runtime_root_env_var()).map(PathBuf::from);
    let current_executable = env::current_exe().map_err(|error| {
        CliError::new(
            "failed to resolve self-host runtime bundle",
            command_line,
            ErrorStage::LoadConfig,
            format!("failed to read current executable path: {error}"),
            vec![retry_with_runtime_root(command_line)],
        )
    })?;
    resolve_runtime_bundle_root_from_components(
        runtime_root_override.as_deref(),
        current_executable.as_path(),
        command_line,
    )
}

pub(super) fn resolve_runtime_bundle_root_from_components(
    runtime_root_override: Option<&Path>,
    current_executable: &Path,
    command_line: &str,
) -> Result<RuntimeBundleRoot, CliError> {
    if let Some(runtime_root_override) = runtime_root_override {
        if runtime_root_override.as_os_str().is_empty() {
            return Err(CliError::new(
                "failed to resolve self-host runtime bundle",
                command_line,
                ErrorStage::LoadConfig,
                format!("{} was set but empty", runtime_root_env_var()),
                vec![retry_with_runtime_root(command_line)],
            ));
        }

        // Comment: local Cargo builds live under `target/{debug,release}`, so
        // local development must be able to point the launcher at a staged
        // runtime bundle explicitly instead of assuming packaged layout.
        return Ok(RuntimeBundleRoot {
            path: runtime_root_override.to_path_buf(),
            source: RuntimeBundleRootSource::EnvironmentOverride,
        });
    }

    if let Some(bundle_root) =
        resolve_packaged_bundle_root_from_current_executable(current_executable)
    {
        return Ok(RuntimeBundleRoot {
            path: bundle_root,
            source: RuntimeBundleRootSource::PackagedExecutable,
        });
    }

    if current_executable_is_cargo_build_output(current_executable) {
        return Err(CliError::new(
            "failed to resolve self-host runtime bundle",
            command_line,
            ErrorStage::LoadConfig,
            format!(
                "current executable {} was launched from Cargo output; set {} to a staged self-host runtime bundle root",
                current_executable.display(),
                runtime_root_env_var()
            ),
            vec![retry_with_runtime_root(command_line)],
        ));
    }

    Err(CliError::new(
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
    ))
}

pub(super) fn resolve_packaged_bundle_root_from_current_executable(
    current_executable: &Path,
) -> Option<PathBuf> {
    let cli_dir = current_executable.parent()?;
    let cli_relative_path = Path::new(packaged_cli_relative_path());
    let depth = cli_relative_path.components().count();
    let mut bundle_root = cli_dir;
    for _ in 0..depth {
        bundle_root = bundle_root.parent()?;
    }

    if bundle_root.join(cli_relative_path) != cli_dir {
        return None;
    }

    Some(bundle_root.to_path_buf())
}

pub(super) fn current_executable_is_cargo_build_output(current_executable: &Path) -> bool {
    let Some(build_profile_dir) = current_executable.parent() else {
        return false;
    };
    let Some(target_dir) = build_profile_dir.parent() else {
        return false;
    };

    matches!(
        build_profile_dir.file_name(),
        Some(name) if name == OsStr::new("debug") || name == OsStr::new("release")
    ) && target_dir.file_name() == Some(OsStr::new("target"))
}

fn runtime_bundle_spec() -> &'static RuntimeBundleSpec {
    RUNTIME_BUNDLE_SPEC.get_or_init(|| {
        serde_json::from_str::<RuntimeBundleSpec>(RUNTIME_BUNDLE_SPEC_RAW)
            .unwrap_or_else(|error| panic!("expected valid runtime bundle spec: {error}"))
    })
}

pub(super) fn packaged_cli_relative_path() -> &'static str {
    runtime_bundle_spec().directories.cli.relative_path.as_str()
}

pub(super) fn packaged_server_relative_path() -> &'static str {
    runtime_bundle_spec()
        .directories
        .server
        .relative_path
        .as_str()
}

pub(super) fn runtime_root_env_var() -> &'static str {
    runtime_bundle_spec().runtime_root_env_var.as_str()
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
