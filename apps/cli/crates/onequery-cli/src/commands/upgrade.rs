use std::ffi::OsStr;
use std::ffi::OsString;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command as ProcessCommand;
use std::process::Stdio;

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use serde_json::json;

use crate::output::CommandOutput;
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

pub(crate) async fn execute<B, T>(
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError>
where
    T: Terminal,
{
    let current_exe = std::env::current_exe().map_err(|error| {
        CliError::new(
            "failed to resolve current executable",
            &context.command_line,
            ErrorStage::Internal,
            error.to_string(),
            manual_upgrade_commands(),
        )
    })?;

    let Some(plan) = detect_upgrade_plan(current_exe.as_path()) else {
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

    Ok(render_upgrade_output(plan))
}

fn detect_upgrade_plan(current_exe: &Path) -> Option<UpgradePlan> {
    if is_homebrew_install(current_exe) {
        return Some(UpgradePlan::new(
            UpgradeInstaller::Homebrew,
            HOMEBREW_UPGRADE_COMMAND,
            "brew",
            ["upgrade", "wordbricks/tap/onequery"],
        ));
    }

    if is_bun_install(current_exe) {
        return Some(UpgradePlan::new(
            UpgradeInstaller::Bun,
            BUN_UPGRADE_COMMAND,
            "bun",
            ["install", "-g", "@onequery/cli@latest"],
        ));
    }

    if is_npm_install(current_exe) {
        return Some(UpgradePlan::new(
            UpgradeInstaller::Npm,
            NPM_UPGRADE_COMMAND,
            "npm",
            ["install", "-g", "@onequery/cli@latest"],
        ));
    }

    if is_install_script_install(current_exe) {
        return Some(UpgradePlan::new(
            UpgradeInstaller::InstallScript,
            INSTALL_SCRIPT_UPGRADE_COMMAND,
            "sh",
            ["-c", "curl -fsSL https://onequery.dev/install.sh | sh"],
        ));
    }

    None
}

fn is_homebrew_install(current_exe: &Path) -> bool {
    let path = current_exe.to_string_lossy();
    path.contains("/Cellar/onequery/") || path.contains("\\Cellar\\onequery\\")
}

fn is_bun_install(current_exe: &Path) -> bool {
    let path = current_exe.to_string_lossy();
    path.contains(".bun/install/")
        || path.contains(".bun\\install\\")
        || path.contains("\\bun\\install\\")
}

fn is_npm_install(current_exe: &Path) -> bool {
    let path = current_exe.to_string_lossy();
    (path.contains("/node_modules/") || path.contains("\\node_modules\\"))
        && (path.contains("@onequery/cli") || path.contains("@onequery\\cli"))
}

fn is_install_script_install(current_exe: &Path) -> bool {
    let Some(install_root) = install_script_root(current_exe) else {
        return false;
    };

    install_root.join("bin").join("onequery").is_file()
        && !install_root.join("package.json").is_file()
}

fn install_script_root(current_exe: &Path) -> Option<PathBuf> {
    let cli_dir = current_exe.parent()?;
    if cli_dir.file_name()? != OsStr::new("onequery") {
        return None;
    }

    let target_dir = cli_dir.parent()?;
    let vendor_dir = target_dir.parent()?;
    if vendor_dir.file_name()? != OsStr::new("vendor") {
        return None;
    }

    // Comment: install.sh and published package layouts both embed
    // vendor/<target>/onequery/onequery, so the install-root check below keeps
    // this heuristic anchored to the installer-owned shell launcher instead of
    // guessing from the binary path alone.
    vendor_dir.parent().map(Path::to_path_buf)
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

fn render_upgrade_output(plan: UpgradePlan) -> CommandOutput {
    CommandOutput::structured(
        vec![
            "Upgrade completed.".to_owned(),
            format!("Installer: {}", plan.installer.label()),
            format!("Command: {}", plan.display_command),
        ],
        json!({
            "kind": "upgrade",
            "status": "completed",
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

    use insta::assert_snapshot;
    use pretty_assertions::assert_eq;

    use super::BUN_UPGRADE_COMMAND;
    use super::HOMEBREW_UPGRADE_COMMAND;
    use super::INSTALL_SCRIPT_UPGRADE_COMMAND;
    use super::NPM_UPGRADE_COMMAND;
    use super::OUTPUT_PREVIEW_LINE_COUNT;
    use super::UpgradeInstaller;
    use super::UpgradePlan;
    use super::detect_upgrade_plan;
    use super::render_command_failure;
    use super::render_upgrade_output;

    #[test]
    fn detect_upgrade_plan_prefers_homebrew_layouts() {
        let plan = detect_upgrade_plan(Path::new(
            "/opt/homebrew/Cellar/onequery/1.2.3/libexec/vendor/aarch64-apple-darwin/onequery/onequery",
        ))
        .expect("expected homebrew upgrade plan");

        assert_eq!(plan.installer, UpgradeInstaller::Homebrew);
        assert_eq!(plan.display_command, HOMEBREW_UPGRADE_COMMAND);
    }

    #[test]
    fn detect_upgrade_plan_supports_bun_global_installs() {
        let plan = detect_upgrade_plan(Path::new(
            "/Users/dev/.bun/install/global/node_modules/@onequery/cli/vendor/aarch64-apple-darwin/onequery/onequery",
        ))
        .expect("expected bun upgrade plan");

        assert_eq!(plan.installer, UpgradeInstaller::Bun);
        assert_eq!(plan.display_command, BUN_UPGRADE_COMMAND);
    }

    #[test]
    fn detect_upgrade_plan_supports_npm_global_installs() {
        let plan = detect_upgrade_plan(Path::new(
            "/usr/local/lib/node_modules/@onequery/cli/vendor/x86_64-apple-darwin/onequery/onequery",
        ))
        .expect("expected npm upgrade plan");

        assert_eq!(plan.installer, UpgradeInstaller::Npm);
        assert_eq!(plan.display_command, NPM_UPGRADE_COMMAND);
    }

    #[test]
    fn detect_upgrade_plan_supports_install_script_layouts() {
        let temp_dir = tempfile::tempdir().expect("failed to create tempdir");
        let install_root = temp_dir.path();
        let binary_path = install_root.join("vendor/linux-x64/onequery/onequery");
        fs::create_dir_all(binary_path.parent().expect("missing binary parent"))
            .expect("failed to create vendor layout");
        fs::create_dir_all(install_root.join("bin")).expect("failed to create bin dir");
        fs::write(&binary_path, []).expect("failed to create binary");
        fs::write(install_root.join("bin/onequery"), "#!/bin/sh\n")
            .expect("failed to create launcher");

        let plan =
            detect_upgrade_plan(binary_path.as_path()).expect("expected install.sh upgrade plan");

        assert_eq!(plan.installer, UpgradeInstaller::InstallScript);
        assert_eq!(plan.display_command, INSTALL_SCRIPT_UPGRADE_COMMAND);
    }

    #[test]
    fn render_upgrade_output_snapshot() {
        let output = render_upgrade_output(UpgradePlan::new(
            UpgradeInstaller::Bun,
            BUN_UPGRADE_COMMAND,
            "bun",
            ["install", "-g", "@onequery/cli@latest"],
        ));

        assert_snapshot!(output.lines.join("\n"));
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
