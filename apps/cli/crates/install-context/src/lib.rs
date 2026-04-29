use std::ffi::OsStr;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command as ProcessCommand;
use std::process::Stdio;
use std::sync::OnceLock;

use onequery_core::packaged_runtime::CurrentExecutableLocation;
use onequery_core::packaged_runtime::classify_current_executable;
use serde::Deserialize;

const CLI_PACKAGE_NAME: &str = "@onequery/cli";
const CLI_PACKAGE_SCOPE_DIR_NAME: &str = "@onequery";
const CLI_PACKAGE_DIR_NAME: &str = "cli";
const CLI_LAUNCHER_RELATIVE_PATH: &str = "bin/onequery.js";
const NODE_MODULES_DIR_NAME: &str = "node_modules";
const PLATFORM_ALIAS_PACKAGE_PREFIX: &str = "onequery-";
const RELEASES_DIRNAME: &str = "releases";
const RESOURCES_DIRNAME: &str = "onequery-resources";
const STANDALONE_PACKAGES_DIRNAME: &str = "standalone";
static INSTALL_CONTEXT: OnceLock<InstallContext> = OnceLock::new();

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StandalonePlatform {
    Unix,
    Windows,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InstallContext {
    Standalone {
        /// The managed standalone release directory, for example
        /// `~/.onequery/packages/standalone/releases/0.111.0-x86_64-unknown-linux-musl`.
        release_dir: PathBuf,
        /// The bundled resource directory that sits next to the executable when
        /// this install ships managed dependencies.
        resources_dir: Option<PathBuf>,
        /// The platform of the standalone release, either `Unix` or `Windows`.
        platform: StandalonePlatform,
    },
    /// A OneQuery binary launched through the npm-managed JavaScript shim.
    Npm { package_root: PathBuf },
    /// A OneQuery binary launched through the bun-managed JavaScript shim.
    Bun { package_root: PathBuf },
    /// A OneQuery binary that appears to come from a Homebrew install prefix.
    Brew { launcher_path: PathBuf },
    /// A OneQuery binary installed by the public install.sh script.
    InstallScript { launcher_path: PathBuf },
    /// Any other execution environment.
    ///
    /// This commonly covers `cargo run`, app-bundled OneQuery binaries, custom
    /// internal launchers, and tests that execute OneQuery from an arbitrary path.
    Other,
}

#[derive(Debug, Deserialize)]
struct PackageManifest {
    name: Option<String>,
    version: Option<String>,
}

impl InstallContext {
    pub fn from_exe(
        is_macos: bool,
        current_exe: Option<&Path>,
        managed_by_npm: bool,
        managed_by_bun: bool,
    ) -> Self {
        let onequery_home = onequery_utils_home_dir::find_onequery_home().ok();
        Self::from_exe_with_onequery_home(
            is_macos,
            current_exe,
            managed_by_npm,
            managed_by_bun,
            onequery_home.as_deref(),
        )
    }

    fn from_exe_with_onequery_home(
        is_macos: bool,
        current_exe: Option<&Path>,
        managed_by_npm: bool,
        managed_by_bun: bool,
        onequery_home: Option<&Path>,
    ) -> Self {
        if let Some(exe_path) = current_exe {
            if let Some(standalone_context) = standalone_install_context(exe_path, onequery_home) {
                return standalone_context;
            }

            if let Some(packaged_context) =
                packaged_install_context(exe_path, managed_by_npm, managed_by_bun)
            {
                return packaged_context;
            }

            if is_macos
                && (exe_path.starts_with("/opt/homebrew") || exe_path.starts_with("/usr/local"))
            {
                return Self::Brew {
                    launcher_path: exe_path.to_path_buf(),
                };
            }
        }

        Self::Other
    }

    pub fn current() -> &'static Self {
        INSTALL_CONTEXT.get_or_init(|| {
            let current_exe = std::env::current_exe().ok();
            let managed_by_npm = std::env::var_os("ONEQUERY_MANAGED_BY_NPM").is_some();
            let managed_by_bun = std::env::var_os("ONEQUERY_MANAGED_BY_BUN").is_some();
            Self::from_exe(
                cfg!(target_os = "macos"),
                current_exe.as_deref(),
                managed_by_npm,
                managed_by_bun,
            )
        })
    }

    pub fn installed_version(&self) -> Option<String> {
        match self {
            Self::Brew { launcher_path } | Self::InstallScript { launcher_path } => {
                probe_installed_version_from_launcher(launcher_path.as_path())
            }
            Self::Npm { package_root } | Self::Bun { package_root } => {
                read_package_version(package_root.join("package.json").as_path())
            }
            Self::Standalone { release_dir, .. } => release_dir
                .file_name()
                .and_then(OsStr::to_str)
                .map(ToOwned::to_owned),
            Self::Other => None,
        }
    }

    pub fn rg_command(&self) -> PathBuf {
        match self {
            Self::Standalone {
                resources_dir: Some(resources_dir),
                ..
            } => {
                let bundled_rg = resources_dir.join(default_rg_command());
                if bundled_rg.exists() {
                    bundled_rg
                } else {
                    default_rg_command()
                }
            }
            Self::Standalone {
                resources_dir: None,
                ..
            }
            | Self::Npm { .. }
            | Self::Bun { .. }
            | Self::Brew { .. }
            | Self::InstallScript { .. }
            | Self::Other => default_rg_command(),
        }
    }
}

fn packaged_install_context(
    exe_path: &Path,
    managed_by_npm: bool,
    managed_by_bun: bool,
) -> Option<InstallContext> {
    let CurrentExecutableLocation::Packaged(packaged_layout) =
        classify_current_executable(exe_path)
    else {
        return None;
    };

    homebrew_install_context(packaged_layout.install_root.as_path())
        .or_else(|| {
            node_package_install_context(
                packaged_layout.install_root.as_path(),
                managed_by_npm,
                managed_by_bun,
            )
        })
        .or_else(|| install_script_install_context(packaged_layout.install_root.as_path()))
}

fn standalone_install_context(
    exe_path: &Path,
    onequery_home: Option<&Path>,
) -> Option<InstallContext> {
    let canonical_exe = std::fs::canonicalize(exe_path).ok()?;
    let canonical_onequery_home = std::fs::canonicalize(onequery_home?).ok()?;
    let release_dir = canonical_exe.parent()?.to_path_buf();
    let releases_root = canonical_onequery_home
        .join("packages")
        .join(STANDALONE_PACKAGES_DIRNAME)
        .join(RELEASES_DIRNAME);
    if !release_dir.starts_with(releases_root) {
        return None;
    }

    let resources_dir = release_dir.join(RESOURCES_DIRNAME);
    Some(InstallContext::Standalone {
        release_dir,
        resources_dir: resources_dir.is_dir().then_some(resources_dir),
        platform: standalone_platform(),
    })
}

fn homebrew_install_context(install_root: &Path) -> Option<InstallContext> {
    if install_root.file_name()? != OsStr::new("libexec") {
        return None;
    }

    let version_dir = install_root.parent()?;
    let package_dir = version_dir.parent()?;
    if package_dir.file_name()? != OsStr::new("onequery") {
        return None;
    }

    let cellar_dir = package_dir.parent()?;
    if cellar_dir.file_name()? != OsStr::new("Cellar") {
        return None;
    }

    Some(InstallContext::Brew {
        launcher_path: cellar_dir.parent()?.join("bin").join("onequery"),
    })
}

fn node_package_install_context(
    install_root: &Path,
    managed_by_npm: bool,
    managed_by_bun: bool,
) -> Option<InstallContext> {
    if !is_published_platform_alias_package_root(install_root) {
        return None;
    }

    if managed_by_bun && let Some(package_root) = bun_cli_package_root(install_root) {
        return Some(InstallContext::Bun { package_root });
    }

    if managed_by_npm && let Some(package_root) = npm_cli_package_root(install_root) {
        return Some(InstallContext::Npm { package_root });
    }

    bun_cli_package_root(install_root)
        .map(|package_root| InstallContext::Bun { package_root })
        .or_else(|| {
            npm_cli_package_root(install_root)
                .map(|package_root| InstallContext::Npm { package_root })
        })
}

fn install_script_install_context(install_root: &Path) -> Option<InstallContext> {
    let launcher_path = install_root.join("bin").join("onequery");
    if !launcher_path.is_file() || install_root.join("package.json").is_file() {
        return None;
    }

    Some(InstallContext::InstallScript { launcher_path })
}

fn bun_cli_package_root(install_root: &Path) -> Option<PathBuf> {
    let node_modules_dir = install_root.parent()?;
    let cli_package_root = node_modules_dir
        .join(CLI_PACKAGE_SCOPE_DIR_NAME)
        .join(CLI_PACKAGE_DIR_NAME);
    if is_bun_global_node_modules_dir(node_modules_dir)
        && is_published_cli_wrapper_root(cli_package_root.as_path())
    {
        Some(cli_package_root)
    } else {
        None
    }
}

fn npm_cli_package_root(install_root: &Path) -> Option<PathBuf> {
    let node_modules_dir = install_root.parent()?;
    let cli_package_root = node_modules_dir.parent()?;
    if is_published_cli_wrapper_root(cli_package_root) {
        Some(cli_package_root.to_path_buf())
    } else {
        None
    }
}

fn is_bun_global_node_modules_dir(node_modules_dir: &Path) -> bool {
    let Some(global_dir) = node_modules_dir.parent() else {
        return false;
    };
    let Some(install_dir) = global_dir.parent() else {
        return false;
    };
    let Some(bun_dir) = install_dir.parent() else {
        return false;
    };

    node_modules_dir.file_name() == Some(OsStr::new(NODE_MODULES_DIR_NAME))
        && global_dir.file_name() == Some(OsStr::new("global"))
        && install_dir.file_name() == Some(OsStr::new("install"))
        && bun_dir.file_name() == Some(OsStr::new(".bun"))
}

fn is_published_platform_alias_package_root(package_root: &Path) -> bool {
    let Some(node_modules_dir) = package_root.parent() else {
        return false;
    };
    let Some(package_dir_name) = package_root.file_name().and_then(OsStr::to_str) else {
        return false;
    };
    if node_modules_dir.file_name() != Some(OsStr::new(NODE_MODULES_DIR_NAME))
        || !package_dir_name.starts_with(PLATFORM_ALIAS_PACKAGE_PREFIX)
    {
        return false;
    }

    let package_json_path = package_root.join("package.json");
    let Some(manifest) = read_package_manifest(package_json_path.as_path()) else {
        return false;
    };

    manifest.name.as_deref() == Some(CLI_PACKAGE_NAME)
}

fn is_published_cli_wrapper_root(package_root: &Path) -> bool {
    let Some(parent_dir) = package_root.parent() else {
        return false;
    };
    let Some(scope_dir) = parent_dir.file_name() else {
        return false;
    };
    let Some(node_modules_dir) = parent_dir.parent() else {
        return false;
    };

    if package_root.file_name() != Some(OsStr::new(CLI_PACKAGE_DIR_NAME))
        || scope_dir != OsStr::new(CLI_PACKAGE_SCOPE_DIR_NAME)
        || node_modules_dir.file_name() != Some(OsStr::new(NODE_MODULES_DIR_NAME))
    {
        return false;
    }

    let package_json_path = package_root.join("package.json");
    let Some(manifest) = read_package_manifest(package_json_path.as_path()) else {
        return false;
    };

    manifest.name.as_deref() == Some(CLI_PACKAGE_NAME)
        && package_root.join(CLI_LAUNCHER_RELATIVE_PATH).is_file()
}

fn probe_installed_version_from_launcher(launcher_path: &Path) -> Option<String> {
    let output = ProcessCommand::new(launcher_path)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    parse_version_output(&String::from_utf8_lossy(&output.stdout))
}

fn read_package_version(package_json_path: &Path) -> Option<String> {
    read_package_manifest(package_json_path).and_then(|package| package.version)
}

fn read_package_manifest(package_json_path: &Path) -> Option<PackageManifest> {
    let contents = std::fs::read_to_string(package_json_path).ok()?;
    serde_json::from_str::<PackageManifest>(&contents).ok()
}

fn parse_version_output(version_output: &str) -> Option<String> {
    let trimmed = version_output.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut parts = trimmed.split_whitespace();
    match (parts.next(), parts.next(), parts.next()) {
        (Some(binary_name), Some(version), None) if binary_name.starts_with("onequery") => {
            Some(version.to_owned())
        }
        (Some(version), None, None) => Some(version.to_owned()),
        _ => None,
    }
}

fn standalone_platform() -> StandalonePlatform {
    if cfg!(windows) {
        StandalonePlatform::Windows
    } else {
        StandalonePlatform::Unix
    }
}

fn default_rg_command() -> PathBuf {
    if cfg!(windows) {
        PathBuf::from("rg.exe")
    } else {
        PathBuf::from("rg")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;
    use std::fs;

    fn write_package_manifest(package_root: &Path, version: &str) {
        fs::create_dir_all(package_root).expect("failed to create package root");
        fs::write(
            package_root.join("package.json"),
            format!(r#"{{"name":"{CLI_PACKAGE_NAME}","version":"{version}"}}"#),
        )
        .expect("failed to write package.json");
    }

    fn write_cli_wrapper_package(package_root: &Path, version: &str) {
        write_package_manifest(package_root, version);
        fs::create_dir_all(package_root.join("bin")).expect("failed to create bin dir");
        fs::write(
            package_root.join("bin/onequery.js"),
            "#!/usr/bin/env node\n",
        )
        .expect("failed to write launcher");
    }

    fn write_packaged_binary(binary_path: &Path) {
        fs::create_dir_all(binary_path.parent().expect("missing binary parent"))
            .expect("failed to create vendor layout");
        fs::write(binary_path, []).expect("failed to create binary");
    }

    #[test]
    fn detects_standalone_install_from_release_layout() -> std::io::Result<()> {
        let onequery_home = tempfile::tempdir()?;
        let release_dir = onequery_home
            .path()
            .join("packages/standalone/releases/1.2.3-x86_64-unknown-linux-musl");
        let resources_dir = release_dir.join(RESOURCES_DIRNAME);
        fs::create_dir_all(&resources_dir)?;
        let exe_path = release_dir.join(if cfg!(windows) {
            "onequery.exe"
        } else {
            "onequery"
        });
        fs::write(&exe_path, "")?;
        fs::write(resources_dir.join(default_rg_command()), "")?;
        let canonical_release_dir = release_dir.canonicalize()?;
        let canonical_resources_dir = resources_dir.canonicalize()?;

        let context = InstallContext::from_exe_with_onequery_home(
            /*is_macos*/ false,
            /*current_exe*/ Some(&exe_path),
            /*managed_by_npm*/ false,
            /*managed_by_bun*/ false,
            /*onequery_home*/ Some(onequery_home.path()),
        );
        assert_eq!(
            context,
            InstallContext::Standalone {
                release_dir: canonical_release_dir,
                resources_dir: Some(canonical_resources_dir),
                platform: standalone_platform(),
            }
        );
        Ok(())
    }

    #[test]
    fn standalone_rg_falls_back_when_resources_are_missing() -> std::io::Result<()> {
        let onequery_home = tempfile::tempdir()?;
        let release_dir = onequery_home
            .path()
            .join("packages/standalone/releases/1.2.3-x86_64-unknown-linux-musl");
        fs::create_dir_all(&release_dir)?;
        let exe_path = release_dir.join(if cfg!(windows) {
            "onequery.exe"
        } else {
            "onequery"
        });
        fs::write(&exe_path, "")?;

        let context = InstallContext::from_exe_with_onequery_home(
            /*is_macos*/ false,
            /*current_exe*/ Some(&exe_path),
            /*managed_by_npm*/ false,
            /*managed_by_bun*/ false,
            /*onequery_home*/ Some(onequery_home.path()),
        );
        assert_eq!(context.rg_command(), default_rg_command());
        Ok(())
    }

    #[test]
    fn detects_homebrew_layouts() {
        let context = InstallContext::from_exe_with_onequery_home(
            /*is_macos*/ true,
            /*current_exe*/
            Some(Path::new(
                "/opt/homebrew/Cellar/onequery/1.2.3/libexec/vendor/aarch64-apple-darwin/onequery/onequery",
            )),
            /*managed_by_npm*/ false,
            /*managed_by_bun*/ false,
            /*onequery_home*/ None,
        );

        assert_eq!(
            context,
            InstallContext::Brew {
                launcher_path: PathBuf::from("/opt/homebrew/bin/onequery"),
            }
        );
    }

    #[test]
    fn detects_bun_global_installs() {
        let temp_dir = tempfile::tempdir().expect("failed to create tempdir");
        let node_modules_dir = temp_dir.path().join(".bun/install/global/node_modules");
        let cli_package_root = node_modules_dir.join("@onequery/cli");
        let platform_package_root = node_modules_dir.join("onequery-darwin-arm64");
        let binary_path =
            platform_package_root.join("vendor/aarch64-apple-darwin/onequery/onequery");

        write_cli_wrapper_package(cli_package_root.as_path(), "1.2.3");
        write_package_manifest(platform_package_root.as_path(), "1.2.3-darwin-arm64");
        write_packaged_binary(binary_path.as_path());

        let context = InstallContext::from_exe_with_onequery_home(
            /*is_macos*/ false,
            /*current_exe*/ Some(binary_path.as_path()),
            /*managed_by_npm*/ false,
            /*managed_by_bun*/ false,
            /*onequery_home*/ None,
        );

        assert_eq!(
            context,
            InstallContext::Bun {
                package_root: cli_package_root,
            }
        );
        assert_eq!(context.installed_version(), Some("1.2.3".to_owned()));
    }

    #[test]
    fn detects_npm_global_installs() {
        let temp_dir = tempfile::tempdir().expect("failed to create tempdir");
        let cli_package_root = temp_dir.path().join("lib/node_modules/@onequery/cli");
        let platform_package_root = cli_package_root.join("node_modules/onequery-darwin-arm64");
        let binary_path =
            platform_package_root.join("vendor/x86_64-apple-darwin/onequery/onequery");

        write_cli_wrapper_package(cli_package_root.as_path(), "1.2.3");
        write_package_manifest(platform_package_root.as_path(), "1.2.3-darwin-arm64");
        write_packaged_binary(binary_path.as_path());

        let context = InstallContext::from_exe_with_onequery_home(
            /*is_macos*/ false,
            /*current_exe*/ Some(binary_path.as_path()),
            /*managed_by_npm*/ false,
            /*managed_by_bun*/ false,
            /*onequery_home*/ None,
        );

        assert_eq!(
            context,
            InstallContext::Npm {
                package_root: cli_package_root,
            }
        );
        assert_eq!(context.installed_version(), Some("1.2.3".to_owned()));
    }

    #[test]
    fn rejects_wrapper_vendor_layouts() {
        let temp_dir = tempfile::tempdir().expect("failed to create tempdir");
        let cli_package_root = temp_dir.path().join("lib/node_modules/@onequery/cli");
        let binary_path = cli_package_root.join("vendor/x86_64-apple-darwin/onequery/onequery");

        write_cli_wrapper_package(cli_package_root.as_path(), "1.2.3");
        write_packaged_binary(binary_path.as_path());

        assert_eq!(
            InstallContext::from_exe_with_onequery_home(
                /*is_macos*/ false,
                /*current_exe*/ Some(binary_path.as_path()),
                /*managed_by_npm*/ false,
                /*managed_by_bun*/ false,
                /*onequery_home*/ None,
            ),
            InstallContext::Other
        );
    }

    #[test]
    fn detects_install_script_layouts() {
        let temp_dir = tempfile::tempdir().expect("failed to create tempdir");
        let install_root = temp_dir.path();
        let binary_path = install_root.join("vendor/linux-x64/onequery/onequery");
        write_packaged_binary(binary_path.as_path());
        fs::create_dir_all(install_root.join("bin")).expect("failed to create bin dir");
        fs::write(install_root.join("bin/onequery"), "#!/bin/sh\n")
            .expect("failed to create launcher");

        let context = InstallContext::from_exe_with_onequery_home(
            /*is_macos*/ false,
            /*current_exe*/ Some(binary_path.as_path()),
            /*managed_by_npm*/ false,
            /*managed_by_bun*/ false,
            /*onequery_home*/ None,
        );

        assert_eq!(
            context,
            InstallContext::InstallScript {
                launcher_path: install_root.join("bin/onequery"),
            }
        );
    }

    #[test]
    fn parse_version_output_extracts_cli_version() {
        assert_eq!(
            parse_version_output("onequery 1.2.3\n"),
            Some("1.2.3".to_owned())
        );
    }
}
