use std::ffi::OsString;
use std::io::IsTerminal;
use std::path::PathBuf;

use clap::Args;
use clap::Parser;
use clap::Subcommand;
use clap::ValueEnum;
use serde::Serialize;

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, ValueEnum)]
#[serde(rename_all = "snake_case")]
pub enum OutputFormat {
    Text,
    Json,
}

impl OutputFormat {
    pub fn resolve(explicit: Option<Self>) -> Self {
        explicit.unwrap_or_else(|| {
            if std::io::stdout().is_terminal() {
                Self::Text
            } else {
                Self::Json
            }
        })
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum RalphCommand {
    Run(RalphRunArgs),
    Init(RalphInitArgs),
}

pub fn parse() -> RalphCommand {
    RalphCli::parse().into_command()
}

#[derive(Debug, Clone, Parser)]
#[command(
    name = "ralph-loop",
    version,
    about = "Ralph Loop CLI",
    propagate_version(true),
    arg_required_else_help(true),
    args_conflicts_with_subcommands(true),
    subcommand_negates_reqs(true)
)]
struct RalphCli {
    #[command(subcommand)]
    command: Option<RalphCliSubcommand>,
    #[command(flatten)]
    run: Option<RalphRunArgs>,
}

impl RalphCli {
    fn into_command(self) -> RalphCommand {
        match (self.command, self.run) {
            (Some(RalphCliSubcommand::Init(args)), None) => RalphCommand::Init(args),
            (None, Some(args)) => RalphCommand::Run(args),
            (Some(RalphCliSubcommand::Init(_)), Some(_)) | (None, None) => {
                unreachable!("clap validated the Ralph command shape")
            }
        }
    }
}

#[derive(Debug, Clone, Eq, PartialEq, Subcommand)]
enum RalphCliSubcommand {
    Init(RalphInitArgs),
}

#[derive(Debug, Clone, Parser)]
#[command(
    name = "ralph-loop",
    version,
    about = "Ralph Loop CLI",
    propagate_version(true),
    arg_required_else_help(true)
)]
struct RalphRunCli {
    #[command(flatten)]
    args: RalphRunArgs,
}

#[derive(Debug, Clone, Args, Eq, PartialEq)]
pub struct RalphRunArgs {
    /// The user task prompt for the Ralph loop run.
    pub prompt: String,
    /// Output format.
    #[arg(long, value_enum)]
    pub output: Option<OutputFormat>,
    /// Codex model to use.
    #[arg(long, default_value = "gpt-5.4")]
    pub model: String,
    /// Base branch to branch from.
    #[arg(long, default_value = "main")]
    pub base_branch: String,
    /// Maximum coding-loop iterations.
    #[arg(long, default_value_t = 20)]
    pub max_iterations: usize,
    /// Working branch name.
    #[arg(long)]
    pub work_branch: Option<String>,
    /// Max wall-clock seconds per turn.
    #[arg(long, default_value_t = 7200)]
    pub timeout: u64,
    /// Codex approval policy.
    #[arg(long, default_value = "never")]
    pub approval_policy: String,
    /// Codex sandbox policy.
    #[arg(long, default_value = "workspace-write")]
    pub sandbox: String,
    /// Keep the generated worktree after the run.
    #[arg(long, default_value_t = false)]
    pub preserve_worktree: bool,
    /// Validate and describe the run without side effects.
    #[arg(long, default_value_t = false)]
    pub dry_run: bool,
    /// Override the current working directory used for repo resolution.
    #[arg(long, hide = true)]
    pub cwd: Option<PathBuf>,
}

#[derive(Debug, Clone, Parser)]
#[command(
    name = "ralph-loop init",
    bin_name = "ralph-loop init",
    version,
    about = "Ralph Loop init",
    propagate_version(true),
    arg_required_else_help(false)
)]
struct RalphInitCli {
    #[command(flatten)]
    args: RalphInitArgs,
}

#[derive(Debug, Clone, Args, Eq, PartialEq)]
pub struct RalphInitArgs {
    /// Output format.
    #[arg(long, value_enum)]
    pub output: Option<OutputFormat>,
    /// Base branch to branch from.
    #[arg(long, default_value = "main")]
    pub base_branch: String,
    /// Working branch name.
    #[arg(long)]
    pub work_branch: Option<String>,
    /// Validate and describe the init without side effects.
    #[arg(long, default_value_t = false)]
    pub dry_run: bool,
    /// Override the current working directory used for repo resolution.
    #[arg(long, hide = true)]
    pub cwd: Option<PathBuf>,
}

pub fn current_dir_override(path: Option<PathBuf>) -> PathBuf {
    path.unwrap_or_else(|| {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from(OsString::from(".")))
    })
}

#[cfg(test)]
mod tests {
    use clap::CommandFactory;
    use clap::Parser;
    use insta::assert_snapshot;
    use pretty_assertions::assert_eq;

    use super::super::init::default_work_branch_for_prompt;
    use super::OutputFormat;
    use super::RalphCli;
    use super::RalphCommand;
    use super::RalphInitCli;
    use super::RalphRunCli;

    #[test]
    fn run_help_snapshot() {
        let rendered = RalphRunCli::command().render_long_help().to_string();

        assert_snapshot!("ralph_run_help", rendered);
    }

    #[test]
    fn init_help_snapshot() {
        let rendered = RalphInitCli::command().render_long_help().to_string();

        assert_snapshot!("ralph_init_help", rendered);
    }

    #[test]
    fn run_cli_parses_prompt_and_defaults() {
        let parsed =
            RalphRunCli::try_parse_from(["ralph-loop", "ship it"]).expect("expected CLI to parse");

        assert_eq!(parsed.args.prompt, "ship it");
        assert_eq!(parsed.args.output, None);
        assert_eq!(parsed.args.model, "gpt-5.4");
        assert_eq!(
            default_work_branch_for_prompt(&parsed.args.prompt),
            "ralph-ship-it"
        );
    }

    #[test]
    fn init_cli_parses_dry_run_json() {
        let parsed =
            RalphInitCli::try_parse_from(["ralph-loop init", "--dry-run", "--output", "json"])
                .expect("expected init CLI to parse");

        assert_eq!(parsed.args.dry_run, true);
        assert_eq!(parsed.args.output, Some(OutputFormat::Json));
    }

    #[test]
    fn top_level_cli_defaults_to_run_command() {
        let parsed =
            RalphCli::try_parse_from(["ralph-loop", "ship it"]).expect("expected CLI to parse");

        assert_eq!(
            parsed.into_command(),
            RalphCommand::Run(super::RalphRunArgs {
                prompt: "ship it".to_owned(),
                output: None,
                model: "gpt-5.4".to_owned(),
                base_branch: "main".to_owned(),
                max_iterations: 20,
                work_branch: None,
                timeout: 7200,
                approval_policy: "never".to_owned(),
                sandbox: "workspace-write".to_owned(),
                preserve_worktree: false,
                dry_run: false,
                cwd: None,
            })
        );
    }

    #[test]
    fn top_level_cli_parses_init_subcommand() {
        let parsed = RalphCli::try_parse_from(["ralph-loop", "init", "--dry-run"])
            .expect("expected CLI to parse");

        assert_eq!(
            parsed.into_command(),
            RalphCommand::Init(super::RalphInitArgs {
                output: None,
                base_branch: "main".to_owned(),
                work_branch: None,
                dry_run: true,
                cwd: None,
            })
        );
    }
}
