use std::process::Command as ProcessCommand;
use std::process::Stdio;

use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;
use onequery_install_context::InstallContext;
use onequery_install_context::StandalonePlatform;
use serde_json::json;

use crate::output::CommandOutput;
use crate::platform::Terminal;

use super::CommandContext;
use super::Runtime;

const OUTPUT_PREVIEW_LINE_COUNT: usize = 12;

/// Upgrade action the CLI should perform.
#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum UpgradeAction {
    /// Upgrade via `curl -fsSL https://onequery.dev/install.sh | sh`.
    StandaloneUnix,
    /// Upgrade via `brew upgrade wordbricks/tap/onequery`.
    BrewUpgrade,
    /// Upgrade via `npm install -g @onequery/cli@latest`.
    NpmGlobalLatest,
    /// Upgrade via `bun install -g @onequery/cli@latest`.
    BunGlobalLatest,
}

impl UpgradeAction {
    fn from_install_context(context: &InstallContext) -> Option<Self> {
        match context {
            InstallContext::Brew { .. } => Some(Self::BrewUpgrade),
            InstallContext::InstallScript { .. }
            | InstallContext::Standalone {
                platform: StandalonePlatform::Unix,
                ..
            } => Some(Self::StandaloneUnix),
            InstallContext::Bun { .. } => Some(Self::BunGlobalLatest),
            InstallContext::Npm { .. } => Some(Self::NpmGlobalLatest),
            InstallContext::Standalone {
                platform: StandalonePlatform::Windows,
                ..
            }
            | InstallContext::Other => None,
        }
    }

    fn id(self) -> &'static str {
        match self {
            Self::StandaloneUnix => "install-script",
            Self::BrewUpgrade => "homebrew",
            Self::NpmGlobalLatest => "npm",
            Self::BunGlobalLatest => "bun",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::StandaloneUnix => "install.sh",
            Self::BrewUpgrade => "Homebrew",
            Self::NpmGlobalLatest => "npm",
            Self::BunGlobalLatest => "Bun",
        }
    }

    /// Returns the list of command-line arguments for invoking the upgrade.
    fn command_args(self) -> (&'static str, &'static [&'static str]) {
        match self {
            Self::StandaloneUnix => (
                "sh",
                &["-c", "curl -fsSL https://onequery.dev/install.sh | sh"],
            ),
            Self::BrewUpgrade => ("brew", &["upgrade", "wordbricks/tap/onequery"]),
            Self::NpmGlobalLatest => ("npm", &["install", "-g", "@onequery/cli@latest"]),
            Self::BunGlobalLatest => ("bun", &["install", "-g", "@onequery/cli@latest"]),
        }
    }

    /// Returns string representation of the command-line arguments for invoking the upgrade.
    fn command_str(self) -> String {
        let (command, args) = self.command_args();
        shlex::try_join(std::iter::once(command).chain(args.iter().copied()))
            .unwrap_or_else(|_| format!("{command} {}", args.join(" ")))
    }
}

/// Gateway action the CLI should suggest around an upgrade.
#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum GatewayAction {
    /// Stop the running managed gateway before upgrading.
    Stop,
    /// Start the managed gateway again after upgrading.
    Start,
}

impl GatewayAction {
    /// Returns the list of command-line arguments for invoking the gateway action.
    fn command_args(self) -> (&'static str, &'static [&'static str]) {
        match self {
            Self::Stop => ("onequery", &["gateway", "stop"]),
            Self::Start => ("onequery", &["gateway", "start"]),
        }
    }

    /// Returns string representation of the command-line arguments for invoking the gateway action.
    fn command_str(self) -> String {
        let (command, args) = self.command_args();
        shlex::try_join(std::iter::once(command).chain(args.iter().copied()))
            .unwrap_or_else(|_| format!("{command} {}", args.join(" ")))
    }
}

pub(crate) async fn execute<B, T>(
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError>
where
    T: Terminal,
{
    let install_context = InstallContext::current();
    let Some(action) = UpgradeAction::from_install_context(install_context) else {
        return Err(CliError::new(
            "unsupported upgrade installation",
            &context.command_line,
            ErrorStage::Internal,
            unsupported_install_context_message(install_context),
            manual_upgrade_commands(),
        ));
    };

    ensure_gateway_stopped_for_upgrade(&context.command_line)?;

    runtime
        .terminal
        .stderr_line(&format!("Running upgrade via {}...", action.label()));

    let (program, args) = action.command_args();
    let output = ProcessCommand::new(program)
        .args(args)
        .stdin(Stdio::inherit())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| {
            let why = match error.kind() {
                std::io::ErrorKind::NotFound => format!(
                    "required installer command {program} was not found while running {}",
                    action.command_str()
                ),
                _ => error.to_string(),
            };

            CliError::new(
                "failed to start upgrade",
                &context.command_line,
                ErrorStage::Internal,
                why,
                retry_upgrade_commands(action),
            )
        })?;

    if !output.status.success() {
        return Err(CliError::new(
            "upgrade failed",
            &context.command_line,
            ErrorStage::Internal,
            render_command_failure(&output.stdout, &output.stderr, output.status.code()),
            retry_upgrade_commands(action),
        ));
    }

    let installed_version = install_context.installed_version();

    Ok(render_upgrade_output(action, installed_version))
}

fn unsupported_install_context_message(context: &InstallContext) -> String {
    match context {
        InstallContext::Standalone {
            platform: StandalonePlatform::Windows,
            ..
        } => "standalone Windows installs are not supported by `onequery upgrade`".to_owned(),
        InstallContext::Other => {
            "the current install layout is not supported by `onequery upgrade`".to_owned()
        }
        InstallContext::Standalone { .. }
        | InstallContext::Npm { .. }
        | InstallContext::Bun { .. }
        | InstallContext::Brew { .. }
        | InstallContext::InstallScript { .. } => {
            "the current install layout is not supported by `onequery upgrade`".to_owned()
        }
    }
}

fn ensure_gateway_stopped_for_upgrade(command_line: &str) -> Result<(), CliError> {
    reject_running_gateway_for_upgrade(
        onequery_gateway::read_running_gateway_pid(command_line)?,
        command_line,
    )
}

fn reject_running_gateway_for_upgrade(
    running_pid: Option<u32>,
    command_line: &str,
) -> Result<(), CliError> {
    if let Some(pid) = running_pid {
        return Err(CliError::new(
            "gateway is running during upgrade",
            command_line,
            ErrorStage::LoadConfig,
            format!(
                "pid {pid} is active; stop the gateway before upgrading so app data is checkpointed cleanly and preserved for the next version"
            ),
            vec![
                GatewayAction::Stop.command_str(),
                "onequery upgrade".to_owned(),
                GatewayAction::Start.command_str(),
            ],
        ));
    }

    Ok(())
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

fn retry_upgrade_commands(action: UpgradeAction) -> Vec<String> {
    vec![action.command_str()]
}

fn manual_upgrade_commands() -> Vec<String> {
    [
        UpgradeAction::StandaloneUnix,
        UpgradeAction::BrewUpgrade,
        UpgradeAction::NpmGlobalLatest,
        UpgradeAction::BunGlobalLatest,
    ]
    .into_iter()
    .map(UpgradeAction::command_str)
    .collect()
}

fn render_upgrade_output(
    action: UpgradeAction,
    installed_version: Option<String>,
) -> CommandOutput {
    let mut lines = vec!["Upgrade completed.".to_owned()];
    match installed_version.as_deref() {
        Some(version) => lines.push(format!("Version: {version}")),
        None => lines.push("Version: unavailable".to_owned()),
    }
    let command = action.command_str();
    lines.push(format!("Installer: {}", action.label()));
    lines.push(format!("Command: {command}"));

    CommandOutput::structured(
        lines,
        json!({
            "kind": "upgrade",
            "status": "completed",
            "version": installed_version,
            "installer": action.id(),
            "command": command,
        }),
    )
    .with_command("upgrade")
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use insta::assert_snapshot;
    use onequery_install_context::InstallContext;
    use onequery_install_context::StandalonePlatform;
    use pretty_assertions::assert_eq;

    use super::GatewayAction;
    use super::OUTPUT_PREVIEW_LINE_COUNT;
    use super::UpgradeAction;
    use super::reject_running_gateway_for_upgrade;
    use super::render_command_failure;
    use super::render_upgrade_output;
    use super::unsupported_install_context_message;

    type CommandArgs = (&'static str, &'static [&'static str]);
    type UpgradeActionCommandCase = (UpgradeAction, CommandArgs, String);
    type GatewayActionCommandCase = (GatewayAction, CommandArgs, String);

    #[test]
    fn upgrade_action_maps_install_contexts_to_upgrade_actions() {
        let cases = [
            (
                InstallContext::Brew {
                    launcher_path: PathBuf::from("/opt/homebrew/bin/onequery"),
                },
                UpgradeAction::BrewUpgrade,
            ),
            (
                InstallContext::InstallScript {
                    launcher_path: PathBuf::from("/Users/alice/.local/bin/onequery"),
                },
                UpgradeAction::StandaloneUnix,
            ),
            (
                InstallContext::Standalone {
                    release_dir: PathBuf::from(
                        "/Users/alice/.onequery/packages/standalone/releases/1",
                    ),
                    platform: StandalonePlatform::Unix,
                },
                UpgradeAction::StandaloneUnix,
            ),
            (
                InstallContext::Bun {
                    package_root: PathBuf::from(
                        "/Users/alice/.bun/install/global/node_modules/@onequery/cli",
                    ),
                },
                UpgradeAction::BunGlobalLatest,
            ),
            (
                InstallContext::Npm {
                    package_root: PathBuf::from("/usr/local/lib/node_modules/@onequery/cli"),
                },
                UpgradeAction::NpmGlobalLatest,
            ),
        ];

        for (context, expected_action) in cases {
            assert_eq!(
                UpgradeAction::from_install_context(&context),
                Some(expected_action)
            );
        }
    }

    #[test]
    fn upgrade_action_commands_rerun_latest_installer() {
        let cases: [UpgradeActionCommandCase; 4] = [
            (
                UpgradeAction::StandaloneUnix,
                (
                    "sh",
                    &["-c", "curl -fsSL https://onequery.dev/install.sh | sh"],
                ),
                "sh -c 'curl -fsSL https://onequery.dev/install.sh | sh'".to_owned(),
            ),
            (
                UpgradeAction::BrewUpgrade,
                ("brew", &["upgrade", "wordbricks/tap/onequery"]),
                "brew upgrade wordbricks/tap/onequery".to_owned(),
            ),
            (
                UpgradeAction::NpmGlobalLatest,
                ("npm", &["install", "-g", "@onequery/cli@latest"]),
                "npm install -g @onequery/cli@latest".to_owned(),
            ),
            (
                UpgradeAction::BunGlobalLatest,
                ("bun", &["install", "-g", "@onequery/cli@latest"]),
                "bun install -g @onequery/cli@latest".to_owned(),
            ),
        ];

        for (action, expected_args, expected_command) in cases {
            assert_eq!(
                (action.command_args(), action.command_str()),
                (expected_args, expected_command)
            );
        }
    }

    #[test]
    fn gateway_action_commands_match_upgrade_recovery_guidance() {
        let cases: [GatewayActionCommandCase; 2] = [
            (
                GatewayAction::Stop,
                ("onequery", &["gateway", "stop"]),
                "onequery gateway stop".to_owned(),
            ),
            (
                GatewayAction::Start,
                ("onequery", &["gateway", "start"]),
                "onequery gateway start".to_owned(),
            ),
        ];

        for (action, expected_args, expected_command) in cases {
            assert_eq!(
                (action.command_args(), action.command_str()),
                (expected_args, expected_command)
            );
        }
    }

    #[test]
    fn upgrade_action_rejects_unsupported_install_contexts() {
        assert_eq!(
            UpgradeAction::from_install_context(&InstallContext::Standalone {
                release_dir: PathBuf::from(
                    r"C:\Users\alice\.onequery\packages\standalone\releases\1"
                ),
                platform: StandalonePlatform::Windows,
            }),
            None
        );
        assert_eq!(
            UpgradeAction::from_install_context(&InstallContext::Other),
            None
        );
    }

    #[test]
    fn unsupported_install_context_message_mentions_windows_standalone_layout() {
        assert_eq!(
            unsupported_install_context_message(&InstallContext::Standalone {
                release_dir: PathBuf::from(
                    r"C:\Users\alice\.onequery\packages\standalone\releases\1"
                ),
                platform: StandalonePlatform::Windows,
            }),
            "standalone Windows installs are not supported by `onequery upgrade`"
        );
    }

    #[test]
    fn render_upgrade_output_snapshot() {
        let output = render_upgrade_output(UpgradeAction::StandaloneUnix, Some("1.2.3".to_owned()));

        assert_snapshot!(output.lines.join("\n"));
    }

    #[test]
    fn reject_running_gateway_for_upgrade_blocks_mutating_install_while_runtime_is_active() {
        let error = reject_running_gateway_for_upgrade(Some(4242), "onequery upgrade")
            .expect_err("expected running gateway to block upgrade");

        assert_eq!(error.title.as_str(), "gateway is running during upgrade");
        assert_eq!(
            error.try_next,
            vec![
                "onequery gateway stop".to_owned(),
                "onequery upgrade".to_owned(),
                "onequery gateway start".to_owned(),
            ]
        );
        assert!(error.why.contains("app data is checkpointed cleanly"));
    }

    #[test]
    fn reject_running_gateway_for_upgrade_allows_upgrade_when_runtime_is_stopped() {
        reject_running_gateway_for_upgrade(None, "onequery upgrade")
            .expect("expected stopped gateway to allow upgrade");
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
