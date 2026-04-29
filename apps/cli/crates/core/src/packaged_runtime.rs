//! Packaged runtime bundle layout helpers.

use std::ffi::OsStr;
use std::path::Path;
use std::path::PathBuf;
use std::sync::OnceLock;

use serde::Deserialize;

const RUNTIME_BUNDLE_SPEC_RAW: &str =
    onequery_utils::include_repo_resource_str!("packages/base/src/runtime-bundle.json");
static RUNTIME_BUNDLE_SPEC: OnceLock<RuntimeBundleSpec> = OnceLock::new();

#[derive(Debug, Clone, Eq, PartialEq)]
/// Roots derived from a packaged executable path.
pub struct PackagedExecutableLayout {
    /// The installer-owned root that contains launchers and vendor artifacts.
    pub install_root: PathBuf,
    /// The target-specific runtime bundle root under `vendor`.
    pub runtime_root: PathBuf,
}

#[derive(Debug, Clone, Eq, PartialEq)]
/// Classification for the current executable path.
pub enum CurrentExecutableLocation {
    /// A published packaged executable layout was recognized.
    Packaged(PackagedExecutableLayout),
    /// A local Cargo target output was recognized.
    CargoTargetOutput,
    /// The path did not match a known layout.
    Other,
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

/// Returns the CLI binary directory relative to a packaged runtime root.
pub fn packaged_cli_relative_path() -> &'static str {
    runtime_bundle_spec().directories.cli.relative_path.as_str()
}

/// Returns the server bundle directory relative to a packaged runtime root.
pub fn packaged_server_relative_path() -> &'static str {
    runtime_bundle_spec()
        .directories
        .server
        .relative_path
        .as_str()
}

/// Returns the migrations directory relative to a packaged runtime root.
pub fn packaged_migrations_relative_path() -> &'static str {
    runtime_bundle_spec()
        .runtime_entries
        .migrations
        .relative_path
        .as_str()
}

/// Returns the web distribution directory relative to a packaged runtime root.
pub fn packaged_web_dist_relative_path() -> &'static str {
    runtime_bundle_spec()
        .runtime_entries
        .web_dist
        .relative_path
        .as_str()
}

/// Returns the required web distribution file used as a bundle completeness check.
pub fn packaged_web_required_file() -> &'static str {
    runtime_bundle_spec()
        .runtime_entries
        .web_dist
        .required_file
        .as_str()
}

/// Returns the environment variable that overrides the packaged runtime root.
pub fn runtime_root_env_var() -> &'static str {
    runtime_bundle_spec().runtime_root_env_var.as_str()
}

/// Classifies a current executable path against known OneQuery layouts.
pub fn classify_current_executable(current_executable: &Path) -> CurrentExecutableLocation {
    if let Some(layout) = packaged_executable_layout(current_executable) {
        return CurrentExecutableLocation::Packaged(layout);
    }

    if cargo_target_profile_dir(current_executable).is_some() {
        return CurrentExecutableLocation::CargoTargetOutput;
    }

    CurrentExecutableLocation::Other
}

fn packaged_executable_layout(current_executable: &Path) -> Option<PackagedExecutableLayout> {
    let cli_dir = current_executable.parent()?;
    let cli_relative_path = Path::new(packaged_cli_relative_path());
    let mut runtime_root = cli_dir;
    for _ in 0..cli_relative_path.components().count() {
        runtime_root = runtime_root.parent()?;
    }

    if runtime_root.join(cli_relative_path) != cli_dir {
        return None;
    }

    let vendor_dir = runtime_root.parent()?;
    if vendor_dir.file_name()? != OsStr::new("vendor") {
        return None;
    }

    Some(PackagedExecutableLayout {
        install_root: vendor_dir.parent()?.to_path_buf(),
        runtime_root: runtime_root.to_path_buf(),
    })
}

fn cargo_target_profile_dir(current_executable: &Path) -> Option<&Path> {
    let profile_dir = current_executable.parent()?;
    let profile_name = profile_dir.file_name()?;
    if is_non_profile_target_dir(profile_name) {
        return None;
    }

    let parent_dir = profile_dir.parent()?;
    if parent_dir.file_name() == Some(OsStr::new("target")) {
        return Some(profile_dir);
    }

    if parent_dir.parent()?.file_name() == Some(OsStr::new("target")) {
        return Some(profile_dir);
    }

    None
}

fn is_non_profile_target_dir(dir_name: &OsStr) -> bool {
    matches!(
        dir_name.to_str(),
        Some("build" | "deps" | "doc" | "examples" | "incremental" | ".fingerprint" | "tmp")
    )
}

fn runtime_bundle_spec() -> &'static RuntimeBundleSpec {
    RUNTIME_BUNDLE_SPEC.get_or_init(|| {
        serde_json::from_str::<RuntimeBundleSpec>(RUNTIME_BUNDLE_SPEC_RAW)
            .unwrap_or_else(|error| panic!("expected valid runtime bundle spec: {error}"))
    })
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::path::PathBuf;

    use pretty_assertions::assert_eq;

    use super::CurrentExecutableLocation;
    use super::PackagedExecutableLayout;
    use super::classify_current_executable;

    #[test]
    fn classify_current_executable_reads_packaged_install_and_runtime_roots() {
        assert_eq!(
            classify_current_executable(Path::new(
                "/tmp/install/vendor/x86_64-unknown-linux-musl/onequery/onequery",
            )),
            CurrentExecutableLocation::Packaged(PackagedExecutableLayout {
                install_root: PathBuf::from("/tmp/install"),
                runtime_root: PathBuf::from("/tmp/install/vendor/x86_64-unknown-linux-musl"),
            })
        );
    }

    #[test]
    fn classify_current_executable_rejects_non_vendor_layouts() {
        assert_eq!(
            classify_current_executable(Path::new(
                "/tmp/install/not-vendor/x86_64-unknown-linux-musl/onequery/onequery",
            )),
            CurrentExecutableLocation::Other
        );
    }

    #[test]
    fn classify_current_executable_recognizes_root_target_profiles() {
        assert_eq!(
            classify_current_executable(Path::new("/tmp/project/target/debug/onequery")),
            CurrentExecutableLocation::CargoTargetOutput
        );
        assert_eq!(
            classify_current_executable(Path::new("/tmp/project/target/ci-release/onequery")),
            CurrentExecutableLocation::CargoTargetOutput
        );
    }

    #[test]
    fn classify_current_executable_recognizes_target_triple_profiles() {
        assert_eq!(
            classify_current_executable(Path::new(
                "/tmp/project/target/aarch64-apple-darwin/debug/onequery"
            )),
            CurrentExecutableLocation::CargoTargetOutput
        );
        assert_eq!(
            classify_current_executable(Path::new(
                "/tmp/project/target/x86_64-unknown-linux-musl/ci-release/onequery"
            )),
            CurrentExecutableLocation::CargoTargetOutput
        );
    }

    #[test]
    fn classify_current_executable_rejects_non_profile_target_subdirectories() {
        assert_eq!(
            classify_current_executable(Path::new("/tmp/project/target/deps/onequery")),
            CurrentExecutableLocation::Other
        );
        assert_eq!(
            classify_current_executable(Path::new(
                "/tmp/project/target/x86_64-unknown-linux-musl/examples/onequery",
            )),
            CurrentExecutableLocation::Other
        );
    }

    #[test]
    fn classify_current_executable_rejects_unrecognized_paths() {
        assert_eq!(
            classify_current_executable(Path::new("/tmp/project/bin/onequery")),
            CurrentExecutableLocation::Other
        );
    }
}
