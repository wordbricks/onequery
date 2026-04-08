use crate::config::RawCliConfigOverrides;
use crate::output::CommandOutput;
use crate::output::EffectiveOutputMode;

use super::args::AuthSessionSubcommand;
use super::args::AuthSubcommand;
use super::args::BackupArgs;
use super::args::DebugSubcommand;
use super::args::OrgSubcommand;
use super::args::QuerySubcommand;
use super::args::RestoreArgs;
use super::args::SourceSubcommand;
use super::args::UseArgs;

#[derive(Debug)]
pub(crate) enum ParseOutcome {
    Invocation(Box<Invocation>),
    Display(CommandOutput),
}

#[derive(Debug, Clone)]
pub(crate) struct Invocation {
    pub raw_command: String,
    pub global: GlobalOptions,
    pub command: Command,
}

#[derive(Debug, Clone)]
pub(crate) struct GlobalOptions {
    pub org: Option<String>,
    pub raw_config_overrides: RawCliConfigOverrides,
    pub request_id: Option<String>,
    pub timeout_sec: Option<u64>,
    pub output_mode: EffectiveOutputMode,
    pub verbose: bool,
}

#[derive(Debug, Clone)]
pub(crate) enum Command {
    Auth(AuthSubcommand),
    Backup(BackupArgs),
    Config(ConfigCommand),
    Org(OrgSubcommand),
    Source(SourceSubcommand),
    Query(QuerySubcommand),
    Restore(RestoreArgs),
    Gateway(GatewayCommand),
    Use(UseArgs),
    Debug(DebugSubcommand),
}

impl Command {
    pub(crate) fn command_path(&self) -> &'static str {
        match self {
            Self::Auth(AuthSubcommand::Login) => "auth login",
            Self::Auth(AuthSubcommand::Import(_)) => "auth import",
            Self::Auth(AuthSubcommand::Logout { .. }) => "auth logout",
            Self::Auth(AuthSubcommand::Whoami { .. }) => "auth whoami",
            Self::Auth(AuthSubcommand::Session {
                action: AuthSessionSubcommand::Refresh,
            }) => "auth session refresh",
            Self::Backup(_) => "backup",
            Self::Config(ConfigCommand::SetServer { .. }) => "config set server",
            Self::Org(OrgSubcommand::List { .. }) => "org list",
            Self::Org(OrgSubcommand::Get { .. }) => "org get",
            Self::Org(OrgSubcommand::Current) => "org current",
            Self::Org(OrgSubcommand::Use { .. }) => "org use",
            Self::Source(SourceSubcommand::List { .. }) => "source list",
            Self::Source(SourceSubcommand::Show { .. }) => "source show",
            Self::Source(SourceSubcommand::Connect(_)) => "source connect",
            Self::Query(QuerySubcommand::Execute(_)) => "query exec",
            Self::Query(QuerySubcommand::Validate(_)) => "query validate",
            Self::Restore(_) => "restore",
            Self::Gateway(GatewayCommand::Root) => "gateway",
            Self::Gateway(GatewayCommand::Start) => "gateway start",
            Self::Gateway(GatewayCommand::Stop) => "gateway stop",
            Self::Gateway(GatewayCommand::Status) => "gateway status",
            Self::Gateway(GatewayCommand::Logs) => "gateway logs",
            Self::Use(_) => "use",
            Self::Debug(DebugSubcommand::Config) => "debug config",
            Self::Debug(DebugSubcommand::AuthSession) => "debug auth-session",
        }
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) enum ConfigCommand {
    SetServer { url: String },
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) enum GatewayCommand {
    Root,
    Start,
    Stop,
    Status,
    Logs,
}
