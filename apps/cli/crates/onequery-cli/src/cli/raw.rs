use clap::ArgAction;
use clap::Parser;
use clap::Subcommand;

use crate::output::RequestedOutputMode;

use super::args::AuthSubcommand;
use super::args::BackupArgs;
use super::args::DebugSubcommand;
use super::args::OrgSubcommand;
use super::args::QuerySubcommand;
use super::args::RestoreArgs;
use super::args::SchemaSubcommand;
use super::args::SourceSubcommand;
use super::args::UseArgs;
use super::model::Command;
use super::model::ConfigCommand;
use super::model::ServeCommand;

#[derive(Debug, Clone, Parser)]
#[command(
    name = "onequery",
    version,
    about = "OneQuery CLI",
    propagate_version(true),
    help_expected(true)
)]
pub(super) struct RawCli {
    // Keep the parser field ID distinct from `org use <ORG_SLUG>` so clap keeps
    // both the global override and the positional visible in help output.
    /// Override the active org for this invocation.
    #[arg(
        long = "org",
        global = true,
        value_name = "ORG_SLUG",
        help_heading = "Global Options"
    )]
    pub(super) org_override: Option<String>,
    /// Apply a raw config override for this invocation using `key=value`.
    #[arg(
        short = 'c',
        long = "config",
        value_name = "KEY=VALUE",
        action = ArgAction::Append,
        global = true,
        help_heading = "Global Options"
    )]
    pub(super) config_overrides: Vec<String>,
    /// Attach a caller-supplied request ID to outbound API requests.
    #[arg(
        long = "request-id",
        global = true,
        value_name = "REQUEST_ID",
        help_heading = "Global Options"
    )]
    pub(super) request_id: Option<String>,
    /// Override the request timeout in seconds for this invocation.
    #[arg(
        long = "timeout",
        global = true,
        value_name = "SECONDS",
        help_heading = "Global Options"
    )]
    pub(super) timeout_sec: Option<u64>,
    /// Choose text or JSON output.
    #[arg(long, global = true, value_enum, help_heading = "Global Options")]
    pub(super) output: Option<RequestedOutputMode>,
    /// Emit workflow progress and retry tracing to stderr.
    #[arg(
        long,
        global = true,
        default_value_t = false,
        help_heading = "Global Options"
    )]
    pub(super) verbose: bool,
    #[command(subcommand)]
    pub(super) command: Option<RawCommand>,
}

#[derive(Debug, Clone, Subcommand)]
pub(super) enum RawCommand {
    /// Manage authentication and stored sessions.
    #[command(arg_required_else_help(true))]
    Auth {
        #[command(subcommand)]
        action: AuthSubcommand,
    },
    /// Create a self-host backup archive from the current runtime state.
    Backup(BackupArgs),
    /// Persist local CLI targeting defaults.
    #[command(arg_required_else_help(true))]
    Config {
        #[command(subcommand)]
        action: ConfigSubcommand,
    },
    /// Inspect org access and select the active org.
    #[command(arg_required_else_help(true))]
    Org {
        #[command(subcommand)]
        action: OrgSubcommand,
    },
    /// Inspect sources available to the active org.
    #[command(arg_required_else_help(true))]
    Source {
        #[command(subcommand)]
        action: SourceSubcommand,
    },
    /// Execute or validate source queries.
    #[command(arg_required_else_help(true))]
    Query {
        #[command(subcommand)]
        action: QuerySubcommand,
    },
    /// Restore a self-host backup archive into the runtime directories.
    Restore(RestoreArgs),
    /// Bootstrap or inspect the self-host runtime lifecycle surface.
    Serve {
        #[command(subcommand)]
        action: Option<ServeSubcommand>,
    },
    /// Load provider-specific skill content for non-SQL sources.
    Use(UseArgs),
    /// Inspect machine-readable CLI schemas and skills.
    #[command(arg_required_else_help(true))]
    Schema {
        #[command(subcommand)]
        action: SchemaSubcommand,
    },
    /// Inspect local CLI state and diagnostics.
    #[command(hide = true, arg_required_else_help(true))]
    Debug {
        #[command(subcommand)]
        action: DebugSubcommand,
    },
}

#[derive(Debug, Clone, Subcommand, Eq, PartialEq)]
pub(super) enum ConfigSubcommand {
    /// Persist local CLI config values.
    #[command(arg_required_else_help(true))]
    Set {
        #[command(subcommand)]
        action: ConfigSetSubcommand,
    },
}

#[derive(Debug, Clone, Subcommand, Eq, PartialEq)]
pub(super) enum ConfigSetSubcommand {
    /// Persist the default server URL used by CLI API commands.
    Server {
        /// Set this URL as the default CLI target server.
        #[arg(value_name = "URL")]
        url: String,
    },
}

#[derive(Debug, Clone, Subcommand, Copy, Eq, PartialEq)]
pub(super) enum ServeSubcommand {
    /// Bootstrap the self-host runtime foundation and prepare to launch.
    Start,
    /// Stop the self-host runtime if a managed process is present.
    Stop,
    /// Show the current self-host runtime state and derived paths.
    Status,
    /// Show the current self-host server log path and any available preview.
    Logs,
}

impl From<RawCommand> for Command {
    fn from(raw_command: RawCommand) -> Self {
        match raw_command {
            RawCommand::Auth { action } => Self::Auth(action),
            RawCommand::Backup(args) => Self::Backup(args),
            RawCommand::Config { action } => Self::Config(action.into()),
            RawCommand::Org { action } => Self::Org(action),
            RawCommand::Source { action } => Self::Source(action),
            RawCommand::Query { action } => Self::Query(action),
            RawCommand::Restore(args) => Self::Restore(args),
            RawCommand::Serve { action } => Self::Serve(action.into()),
            RawCommand::Use(args) => Self::Use(args),
            RawCommand::Schema { action } => Self::Schema(action),
            RawCommand::Debug { action } => Self::Debug(action),
        }
    }
}

impl From<ConfigSubcommand> for ConfigCommand {
    fn from(action: ConfigSubcommand) -> Self {
        match action {
            ConfigSubcommand::Set { action } => action.into(),
        }
    }
}

impl From<ConfigSetSubcommand> for ConfigCommand {
    fn from(action: ConfigSetSubcommand) -> Self {
        match action {
            ConfigSetSubcommand::Server { url } => Self::SetServer { url },
        }
    }
}

impl From<Option<ServeSubcommand>> for ServeCommand {
    fn from(action: Option<ServeSubcommand>) -> Self {
        match action {
            None => Self::Root,
            Some(ServeSubcommand::Start) => Self::Start,
            Some(ServeSubcommand::Stop) => Self::Stop,
            Some(ServeSubcommand::Status) => Self::Status,
            Some(ServeSubcommand::Logs) => Self::Logs,
        }
    }
}
