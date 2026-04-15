use std::ffi::OsStr;
use std::path::Path;
use std::path::PathBuf;
use std::sync::OnceLock;

use serde::Deserialize;

const RUNTIME_BUNDLE_SPEC_RAW: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../../packages/base/src/runtime-bundle.json"
));
static RUNTIME_BUNDLE_SPEC: OnceLock<RuntimeBundleSpec> = OnceLock::new();

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct PackagedExecutableLayout {
    pub(crate) install_root: PathBuf,
    pub(crate) runtime_root: PathBuf,
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

pub(crate) fn packaged_cli_relative_path() -> &'static str {
    runtime_bundle_spec().directories.cli.relative_path.as_str()
}

pub(crate) fn packaged_server_relative_path() -> &'static str {
    runtime_bundle_spec()
        .directories
        .server
        .relative_path
        .as_str()
}

pub(crate) fn packaged_migrations_relative_path() -> &'static str {
    runtime_bundle_spec()
        .runtime_entries
        .migrations
        .relative_path
        .as_str()
}

pub(crate) fn packaged_web_dist_relative_path() -> &'static str {
    runtime_bundle_spec()
        .runtime_entries
        .web_dist
        .relative_path
        .as_str()
}

pub(crate) fn packaged_web_required_file() -> &'static str {
    runtime_bundle_spec()
        .runtime_entries
        .web_dist
        .required_file
        .as_str()
}

pub(crate) fn runtime_root_env_var() -> &'static str {
    runtime_bundle_spec().runtime_root_env_var.as_str()
}

pub(crate) fn resolve_packaged_executable_layout(
    current_executable: &Path,
) -> Option<PackagedExecutableLayout> {
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

pub(crate) fn current_executable_is_cargo_build_output(current_executable: &Path) -> bool {
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

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::path::PathBuf;

    use pretty_assertions::assert_eq;

    use super::PackagedExecutableLayout;
    use super::current_executable_is_cargo_build_output;
    use super::resolve_packaged_executable_layout;

    #[test]
    fn resolve_packaged_executable_layout_reads_install_and_runtime_roots() {
        assert_eq!(
            resolve_packaged_executable_layout(Path::new(
                "/tmp/install/vendor/x86_64-unknown-linux-musl/onequery/onequery",
            )),
            Some(PackagedExecutableLayout {
                install_root: PathBuf::from("/tmp/install"),
                runtime_root: PathBuf::from("/tmp/install/vendor/x86_64-unknown-linux-musl"),
            })
        );
    }

    #[test]
    fn resolve_packaged_executable_layout_rejects_non_vendor_layouts() {
        assert_eq!(
            resolve_packaged_executable_layout(Path::new(
                "/tmp/install/not-vendor/x86_64-unknown-linux-musl/onequery/onequery",
            )),
            None
        );
    }

    #[test]
    fn current_executable_is_cargo_build_output_recognizes_target_profiles() {
        assert_eq!(
            current_executable_is_cargo_build_output(Path::new(
                "/tmp/project/target/debug/onequery"
            )),
            true
        );
        assert_eq!(
            current_executable_is_cargo_build_output(Path::new(
                "/tmp/project/vendor/x86_64-unknown-linux-musl/onequery/onequery",
            )),
            false
        );
    }
}
