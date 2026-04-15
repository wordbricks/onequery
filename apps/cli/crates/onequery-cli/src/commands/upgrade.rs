use std::ffi::OsStr;
use std::ffi::OsString;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command as ProcessCommand;
use std::process::Stdio;

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use serde::Deserialize;
use serde_json::json;

use crate::output::CommandOutput;
use crate::packaged_runtime::CurrentExecutableLocation;
use crate::packaged_runtime::classify_current_executable;
use crate::platform::Terminal;

use super::CommandContext;
use super::Runtime;

const INSTALL_SCRIPT_UPGRADE_COMMAND: &str = "curl -fsSL https://onequery.dev/install.sh | sh";
const HOMEBREW_UPGRADE_COMMAND: &str = "brew upgrade wordbricks/tap/onequery";
const BUN_UPGRADE_COMMAND: &str = "bun install -g @onequery/cli@latest";
const NPM_UPGRADE_COMMAND: &str = "npm install -g @onequery/cli@latest";
const OUTPUT_PREVIEW_LINE_COUNT: usize = 12;

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum UpgradeInstaller {
    InstallScript,
    Homebrew,
    Bun,
    Npm,
}

impl UpgradeInstaller {
    fn id(self) -> &'static str {
        match self {
            Self::InstallScript => "install-script",
            Self::Homebrew => "homebrew",
            Self::Bun => "bun",
            Self::Npm => "npm",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::InstallScript => "install.sh",
            Self::Homebrew => "Homebrew",
            Self::Bun => "Bun",
            Self::Npm => "npm",
        }
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
struct UpgradePlan {
    installer: UpgradeInstaller,
    display_command: &'static str,
    program: OsString,
    args: Vec<OsString>,
}

impl UpgradePlan {
    fn new(
        installer: UpgradeInstaller,
        display_command: &'static str,
        program: impl Into<OsString>,
        args: impl IntoIterator<Item = impl Into<OsString>>,
    ) -> Self {
        Self {
            installer,
            display_command,
            program: program.into(),
            args: args.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
enum NodePackageManager {
    Bun,
    Npm,
}

#[derive(Debug, Clone, Eq, PartialEq)]
enum InstallLayout {
    Homebrew {
        launcher_path: PathBuf,
    },
    InstallScript {
        launcher_path: PathBuf,
    },
    NodePackage {
        package_root: PathBuf,
        manager: NodePackageManager,
    },
}

impl InstallLayout {
    fn detect(current_exe: &Path) -> Option<Self> {
        let CurrentExecutableLocation::Packaged(packaged_layout) =
            classify_current_executable(current_exe)
        else {
            return None;
        };

        homebrew_install_layout(packaged_layout.install_root.as_path())
            .or_else(|| node_package_install_layout(packaged_layout.install_root.as_path()))
            .or_else(|| install_script_install_layout(packaged_layout.install_root.as_path()))
    }

    fn upgrade_plan(&self) -> UpgradePlan {
        match self {
            Self::Homebrew { .. } => UpgradePlan::new(
                UpgradeInstaller::Homebrew,
                HOMEBREW_UPGRADE_COMMAND,
                "brew",
                ["upgrade", "wordbricks/tap/onequery"],
            ),
            Self::InstallScript { .. } => UpgradePlan::new(
                UpgradeInstaller::InstallScript,
                INSTALL_SCRIPT_UPGRADE_COMMAND,
                "sh",
                ["-c", "curl -fsSL https://onequery.dev/install.sh | sh"],
            ),
            Self::NodePackage { manager, .. } => match manager {
                NodePackageManager::Bun => UpgradePlan::new(
                    UpgradeInstaller::Bun,
                    BUN_UPGRADE_COMMAND,
                    "bun",
                    ["install", "-g", "@onequery/cli@latest"],
                ),
                NodePackageManager::Npm => UpgradePlan::new(
                    UpgradeInstaller::Npm,
                    NPM_UPGRADE_COMMAND,
                    "npm",
                    ["install", "-g", "@onequery/cli@latest"],
                ),
            },
        }
    }

    fn resolve_installed_version(&self) -> Option<String> {
        match self {
            Self::Homebrew { launcher_path } | Self::InstallScript { launcher_path } => {
                probe_installed_version_from_launcher(launcher_path.as_path())
            }
            Self::NodePackage { package_root, .. } => {
                let package_json_path = package_root.join("package.json");
                read_package_version(package_json_path.as_path())
            }
        }
    }
}

#[derive(Debug, Deserialize)]
struct PackageVersion {
    version: String,
}

pub(crate) async fn execute<B, T>(
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError>
where
    T: Terminal,
{
    let current_exe = runtime.process.current_executable_or_error(
        "failed to resolve current executable",
        &context.command_line,
        ErrorStage::Internal,
        manual_upgrade_commands(),
    )?;

    let Some(layout) = InstallLayout::detect(current_exe) else {
        return Err(CliError::new(
            "unsupported upgrade installation",
            &context.command_line,
            ErrorStage::Internal,
            format!(
                "could not map {} to a supported published install layout",
                current_exe.display()
            ),
            manual_upgrade_commands(),
        ));
    };
    let plan = layout.upgrade_plan();

    runtime.terminal.stderr_line(&format!(
        "Running upgrade via {}...",
        plan.installer.label()
    ));

    let output = ProcessCommand::new(&plan.program)
        .args(&plan.args)
        .stdin(Stdio::inherit())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| {
            let why = match error.kind() {
                std::io::ErrorKind::NotFound => format!(
                    "required installer command {} was not found while running {}",
                    Path::new(&plan.program).display(),
                    plan.display_command
                ),
                _ => error.to_string(),
            };

            CliError::new(
                "failed to start upgrade",
                &context.command_line,
                ErrorStage::Internal,
                why,
                retry_upgrade_commands(&plan),
            )
        })?;

    if !output.status.success() {
        return Err(CliError::new(
            "upgrade failed",
            &context.command_line,
            ErrorStage::Internal,
            render_command_failure(&output.stdout, &output.stderr, output.status.code()),
            retry_upgrade_commands(&plan),
        ));
    }

    let installed_version = layout.resolve_installed_version();

    Ok(render_upgrade_output(plan, installed_version))
}

fn homebrew_install_layout(install_root: &Path) -> Option<InstallLayout> {
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

    Some(InstallLayout::Homebrew {
        launcher_path: cellar_dir.parent()?.join("bin").join("onequery"),
    })
}

fn node_package_install_layout(install_root: &Path) -> Option<InstallLayout> {
    let package_root = install_root;
    if package_root.file_name()? != OsStr::new("cli") {
        return None;
    }

    let scope_dir = package_root.parent()?;
    if scope_dir.file_name()? != OsStr::new("@onequery") {
        return None;
    }

    Some(InstallLayout::NodePackage {
        package_root: package_root.to_path_buf(),
        manager: node_package_manager(package_root),
    })
}

fn install_script_install_layout(install_root: &Path) -> Option<InstallLayout> {
    // Comment: install.sh and published package layouts both embed
    // vendor/<target>/onequery/onequery, so the install-root check below keeps
    // this heuristic anchored to the installer-owned shell launcher instead of
    // guessing from the binary path alone.
    let launcher_path = install_root.join("bin").join("onequery");
    if !launcher_path.is_file() || install_root.join("package.json").is_file() {
        return None;
    }

    Some(InstallLayout::InstallScript { launcher_path })
}

fn node_package_manager(package_root: &Path) -> NodePackageManager {
    if is_bun_global_package_root(package_root) {
        NodePackageManager::Bun
    } else {
        NodePackageManager::Npm
    }
}

fn is_bun_global_package_root(package_root: &Path) -> bool {
    let Some(scope_dir) = package_root.parent() else {
        return false;
    };
    let Some(node_modules_dir) = scope_dir.parent() else {
        return false;
    };
    let Some(global_dir) = node_modules_dir.parent() else {
        return false;
    };
    let Some(install_dir) = global_dir.parent() else {
        return false;
    };
    let Some(bun_dir) = install_dir.parent() else {
        return false;
    };

    // Comment: Bun global installs live under `.bun/install/global/node_modules`,
    // so match that directory structure directly instead of substring scanning.
    node_modules_dir.file_name() == Some(OsStr::new("node_modules"))
        && global_dir.file_name() == Some(OsStr::new("global"))
        && install_dir.file_name() == Some(OsStr::new("install"))
        && bun_dir.file_name() == Some(OsStr::new(".bun"))
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
    let contents = std::fs::read_to_string(package_json_path).ok()?;
    serde_json::from_str::<PackageVersion>(&contents)
        .ok()
        .map(|package| package.version)
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

fn render_command_failure(stdout: &[u8], stderr: &[u8], exit_code: Option<i32>) -> String {
    let stderr_text = String::from_utf8_lossy(stderr);
    let stdout_text = String::from_utf8_lossy(stdout);
    let detail = truncated_output(stderr_text.trim())
        .or_else(|| truncated_output(stdout_text.trim()))
        .unwrap_or_else(|| "the installer exited without error details".to_owned());

    match exit_code {
        Some(code) => format!("installer exited with code {code}: {detail}"),
        None => format!("installer terminated unexpectedly: {detail}"),
    }
}

fn truncated_output(output: &str) -> Option<String> {
    if output.is_empty() {
        return None;
    }

    let lines = output.lines().collect::<Vec<_>>();
    let keep_from = lines.len().saturating_sub(OUTPUT_PREVIEW_LINE_COUNT);
    Some(
        lines
            .into_iter()
            .skip(keep_from)
            .collect::<Vec<_>>()
            .join("\n"),
    )
}

fn retry_upgrade_commands(plan: &UpgradePlan) -> Vec<String> {
    vec![plan.display_command.to_owned()]
}

fn manual_upgrade_commands() -> Vec<String> {
    vec![
        INSTALL_SCRIPT_UPGRADE_COMMAND.to_owned(),
        HOMEBREW_UPGRADE_COMMAND.to_owned(),
        BUN_UPGRADE_COMMAND.to_owned(),
        NPM_UPGRADE_COMMAND.to_owned(),
    ]
}

fn render_upgrade_output(plan: UpgradePlan, installed_version: Option<String>) -> CommandOutput {
    let mut lines = vec!["Upgrade completed.".to_owned()];
    match installed_version.as_deref() {
        Some(version) => lines.push(format!("Version: {version}")),
        None => lines.push("Version: unavailable".to_owned()),
    }
    lines.push(format!("Installer: {}", plan.installer.label()));
    lines.push(format!("Command: {}", plan.display_command));

    CommandOutput::structured(
        lines,
        json!({
            "kind": "upgrade",
            "status": "completed",
            "version": installed_version,
            "installer": plan.installer.id(),
            "command": plan.display_command,
        }),
    )
    .with_command("upgrade")
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::path::PathBuf;

    use insta::assert_snapshot;
    use pretty_assertions::assert_eq;

    use super::BUN_UPGRADE_COMMAND;
    use super::HOMEBREW_UPGRADE_COMMAND;
    use super::INSTALL_SCRIPT_UPGRADE_COMMAND;
    use super::InstallLayout;
    use super::NPM_UPGRADE_COMMAND;
    use super::NodePackageManager;
    use super::OUTPUT_PREVIEW_LINE_COUNT;
    use super::UpgradeInstaller;
    use super::UpgradePlan;
    use super::parse_version_output;
    use super::read_package_version;
    use super::render_command_failure;
    use super::render_upgrade_output;

    #[test]
    fn detect_install_layout_prefers_homebrew_layouts() {
        let layout = InstallLayout::detect(Path::new(
            "/opt/homebrew/Cellar/onequery/1.2.3/libexec/vendor/aarch64-apple-darwin/onequery/onequery",
        ))
        .expect("expected homebrew install layout");

        assert_eq!(
            layout,
            InstallLayout::Homebrew {
                launcher_path: PathBuf::from("/opt/homebrew/bin/onequery"),
            }
        );
        assert_eq!(
            layout.upgrade_plan().display_command,
            HOMEBREW_UPGRADE_COMMAND
        );
    }

    #[test]
    fn detect_install_layout_supports_bun_global_installs() {
        let layout = InstallLayout::detect(Path::new(
            "/Users/dev/.bun/install/global/node_modules/@onequery/cli/vendor/aarch64-apple-darwin/onequery/onequery",
        ))
        .expect("expected bun install layout");

        assert_eq!(
            layout,
            InstallLayout::NodePackage {
                package_root: PathBuf::from(
                    "/Users/dev/.bun/install/global/node_modules/@onequery/cli"
                ),
                manager: NodePackageManager::Bun,
            }
        );
        assert_eq!(layout.upgrade_plan().display_command, BUN_UPGRADE_COMMAND);
    }

    #[test]
    fn detect_install_layout_supports_npm_global_installs() {
        let layout = InstallLayout::detect(Path::new(
            "/usr/local/lib/node_modules/@onequery/cli/vendor/x86_64-apple-darwin/onequery/onequery",
        ))
        .expect("expected npm install layout");

        assert_eq!(
            layout,
            InstallLayout::NodePackage {
                package_root: PathBuf::from("/usr/local/lib/node_modules/@onequery/cli"),
                manager: NodePackageManager::Npm,
            }
        );
        assert_eq!(layout.upgrade_plan().display_command, NPM_UPGRADE_COMMAND);
    }

    #[test]
    fn detect_install_layout_supports_install_script_layouts() {
        let temp_dir = tempfile::tempdir().expect("failed to create tempdir");
        let install_root = temp_dir.path();
        let binary_path = install_root.join("vendor/linux-x64/onequery/onequery");
        fs::create_dir_all(binary_path.parent().expect("missing binary parent"))
            .expect("failed to create vendor layout");
        fs::create_dir_all(install_root.join("bin")).expect("failed to create bin dir");
        fs::write(&binary_path, []).expect("failed to create binary");
        fs::write(install_root.join("bin/onequery"), "#!/bin/sh\n")
            .expect("failed to create launcher");

        let layout =
            InstallLayout::detect(binary_path.as_path()).expect("expected install.sh layout");

        assert_eq!(
            layout,
            InstallLayout::InstallScript {
                launcher_path: install_root.join("bin/onequery"),
            }
        );
        assert_eq!(
            layout.upgrade_plan().display_command,
            INSTALL_SCRIPT_UPGRADE_COMMAND
        );
    }

    #[test]
    fn render_upgrade_output_snapshot() {
        let output = render_upgrade_output(
            UpgradePlan::new(
                UpgradeInstaller::Bun,
                BUN_UPGRADE_COMMAND,
                "bun",
                ["install", "-g", "@onequery/cli@latest"],
            ),
            Some("1.2.3".to_owned()),
        );

        assert_snapshot!(output.lines.join("\n"));
    }

    #[test]
    fn read_package_version_from_package_json() {
        let temp_dir = tempfile::tempdir().expect("failed to create tempdir");
        let package_json = temp_dir.path().join("package.json");
        fs::write(
            &package_json,
            r#"{"name":"@onequery/cli","version":"1.2.3"}"#,
        )
        .expect("failed to write package.json");

        assert_eq!(
            read_package_version(package_json.as_path()),
            Some("1.2.3".to_owned())
        );
    }

    #[test]
    fn parse_version_output_extracts_cli_version() {
        assert_eq!(
            parse_version_output("onequery 1.2.3\n"),
            Some("1.2.3".to_owned())
        );
    }

    #[test]
    fn render_command_failure_keeps_last_lines_of_installer_output() {
        let stdout = b"";
        let stderr = (1..=OUTPUT_PREVIEW_LINE_COUNT + 2)
            .map(|line| format!("line {line}"))
            .collect::<Vec<_>>()
            .join("\n");

        assert_eq!(
            render_command_failure(stdout, stderr.as_bytes(), Some(1)),
            format!(
                "installer exited with code 1: {}",
                (3..=OUTPUT_PREVIEW_LINE_COUNT + 2)
                    .map(|line| format!("line {line}"))
                    .collect::<Vec<_>>()
                    .join("\n")
            )
        );
    }
}
