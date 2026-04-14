use clap::Args;
use clap::Parser;
use clap::Subcommand;
use clap::ValueEnum;
use clap::ValueHint;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use onequery_config::parse_cli_overrides;

use crate::config::RawCliConfigOverrides;
use crate::output::EffectiveOutputMode;
use crate::output::RequestedOutputMode;
use crate::output::TerminalOutput;
use crate::output::resolve_output_mode;

use super::args::ApiArgs;
use super::args::AuthSubcommand;
use super::args::BackupArgs;
use super::args::DebugSubcommand;
use super::args::OrgSubcommand;
use super::args::QuerySubcommand;
use super::args::RestoreArgs;
use super::args::SourceSubcommand;
use super::args::parse_positive_u64;
use super::args::parse_trimmed_non_empty;

const GATEWAY_AFTER_HELP: &str = "Without a subcommand, `onequery gateway` runs in foreground.\nUse `onequery gateway start` to run the managed gateway in background.";

#[derive(Debug)]
pub(crate) enum ParseOutcome {
    Invocation(Box<Invocation>),
    Display(TerminalOutput),
}

#[derive(Debug, Clone, Parser)]
#[command(
    name = "onequery",
    version,
    about = "OneQuery CLI",
    propagate_version = true,
    help_expected = true
)]
pub(super) struct Cli {
    #[command(flatten, next_help_heading = "Global Options")]
    global: GlobalArgs,
    #[command(subcommand)]
    command: Command,
}

impl Cli {
    pub(super) fn into_invocation(
        self,
        raw_command: String,
        stdout_is_tty: bool,
    ) -> Result<Invocation, CliError> {
        let Cli { global, command } = self;
        let global = global.into_global_options(&raw_command, stdout_is_tty)?;

        Ok(Invocation {
            raw_command,
            global,
            command,
        })
    }
}

#[derive(Debug, Clone, Args)]
struct GlobalArgs {
    // Keep the parser field ID distinct from `org use <ORG_SLUG>` so clap keeps
    // both the global override and the positional visible in help output.
    /// Override the active org for this invocation.
    #[arg(
        global = true,
        long = "org",
        value_name = "ORG_SLUG",
        value_parser = parse_trimmed_non_empty
    )]
    org_override: Option<String>,
    /// Apply a raw config override for this invocation using `key=value`.
    #[arg(global = true, long = "config", short = 'c', value_name = "KEY=VALUE")]
    config_overrides: Vec<String>,
    /// Attach a caller-supplied request ID to outbound API requests.
    #[arg(
        global = true,
        long = "request-id",
        value_name = "REQUEST_ID",
        value_parser = parse_trimmed_non_empty
    )]
    request_id: Option<String>,
    /// Override the request timeout in seconds for this invocation.
    #[arg(
        global = true,
        long = "timeout",
        value_name = "SECONDS",
        value_parser = parse_positive_u64
    )]
    timeout_sec: Option<u64>,
    /// Choose text or JSON output.
    #[arg(global = true, long, value_enum)]
    output: Option<RequestedOutputMode>,
    /// Emit workflow progress and retry tracing to stderr.
    #[arg(global = true, long)]
    verbose: bool,
}

impl GlobalArgs {
    fn into_global_options(
        self,
        raw_command: &str,
        stdout_is_tty: bool,
    ) -> Result<GlobalOptions, CliError> {
        let raw_config_overrides =
            parse_cli_overrides(&self.config_overrides).map_err(|error| {
                CliError::new(
                    "invalid config override",
                    raw_command.to_owned(),
                    ErrorStage::ParseCommand,
                    error.to_string(),
                    vec![
                        "use -c KEY=VALUE".to_owned(),
                        "quote TOML strings when needed".to_owned(),
                    ],
                )
            })?;

        Ok(GlobalOptions {
            org: self.org_override,
            raw_config_overrides,
            request_id: self.request_id,
            timeout_sec: self.timeout_sec,
            output_mode: resolve_output_mode(self.output, stdout_is_tty),
            verbose: self.verbose,
        })
    }
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

#[derive(Debug, Clone, Subcommand)]
pub(crate) enum Command {
    /// Manage authentication and stored sessions.
    #[command(subcommand)]
    Auth(AuthSubcommand),
    /// Create a self-host backup archive from the current runtime state.
    Backup(BackupArgs),
    /// Persist local CLI targeting defaults.
    #[command(subcommand)]
    Config(ConfigCommand),
    /// Inspect org access and select the active org.
    #[command(subcommand)]
    Org(OrgSubcommand),
    /// Inspect sources available to the active org.
    #[command(subcommand)]
    Source(SourceSubcommand),
    /// Execute or validate source queries.
    #[command(subcommand)]
    Query(QuerySubcommand),
    /// Restore a self-host backup archive into the runtime directories.
    Restore(RestoreArgs),
    /// Run the self-host gateway in foreground by default or manage the background lifecycle.
    #[command(after_help = GATEWAY_AFTER_HELP)]
    Gateway(GatewayArgs),
    /// Upgrade this published CLI installation in place.
    Upgrade,
    /// Describe or execute a connected source API.
    #[command(override_usage = "\
onequery api [OPTIONS] --source <SOURCE_KEY>
       onequery api [OPTIONS] --source <SOURCE_KEY> [<TARGET>]
       onequery api [OPTIONS] --source <SOURCE_KEY> --op <OPERATION> [<TARGET>]")]
    Api(ApiArgs),
    /// Inspect local CLI state and diagnostics.
    #[command(hide = true, subcommand)]
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
                action: super::args::AuthSessionSubcommand::Refresh,
            }) => "auth session refresh",
            Self::Backup(_) => "backup",
            Self::Config(ConfigCommand::Get { .. }) => "config get",
            Self::Config(ConfigCommand::Set {
                action: ConfigSetCommand::Server { .. },
            }) => "config set server",
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
            Self::Gateway(args) => args.command_path(),
            Self::Upgrade => "upgrade",
            Self::Api(_) => "api",
            Self::Debug(DebugSubcommand::Config) => "debug config",
            Self::Debug(DebugSubcommand::AuthSession) => "debug auth-session",
        }
    }
}

#[derive(Debug, Clone, Subcommand, Eq, PartialEq)]
pub(crate) enum ConfigCommand {
    /// Read one effective CLI config value.
    Get {
        /// Select which config key to inspect.
        #[arg(value_name = "KEY", value_enum)]
        key: ConfigGetKey,
    },
    /// Persist local CLI config values.
    Set {
        #[command(subcommand)]
        action: ConfigSetCommand,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum, Eq, PartialEq)]
pub(crate) enum ConfigGetKey {
    /// The active org slug used by default when `--org` is not supplied.
    #[value(name = "org.active", alias = "org", alias = "active-org")]
    OrgActive,
    /// The default app origin used by API-facing commands.
    #[value(name = "api.server_url", alias = "server", alias = "server-url")]
    ApiServerUrl,
    /// The default request timeout in seconds for outbound API calls.
    #[value(
        name = "api.request_timeout_sec",
        alias = "timeout",
        alias = "request-timeout",
        alias = "request-timeout-sec"
    )]
    ApiRequestTimeoutSec,
}

impl ConfigGetKey {
    pub(crate) const fn canonical_key(self) -> &'static str {
        match self {
            Self::OrgActive => "org.active",
            Self::ApiServerUrl => "api.server_url",
            Self::ApiRequestTimeoutSec => "api.request_timeout_sec",
        }
    }
}

#[derive(Debug, Clone, Subcommand, Eq, PartialEq)]
pub(crate) enum ConfigSetCommand {
    /// Persist the default app origin used by CLI API commands.
    Server {
        /// Set this origin as the default CLI target server, for example http://127.0.0.1:5656.
        #[arg(value_hint = ValueHint::Url, value_name = "URL")]
        url: String,
    },
}

#[derive(Debug, Clone, Args, Eq, PartialEq)]
pub(crate) struct GatewayArgs {
    #[command(subcommand)]
    action: Option<GatewaySubcommand>,
}

impl GatewayArgs {
    pub(crate) const fn command(&self) -> GatewayCommand {
        match self.action {
            None => GatewayCommand::Foreground,
            Some(GatewaySubcommand::Start) => GatewayCommand::Start,
            Some(GatewaySubcommand::Stop) => GatewayCommand::Stop,
            Some(GatewaySubcommand::Status) => GatewayCommand::Status,
            Some(GatewaySubcommand::Logs) => GatewayCommand::Logs,
        }
    }

    const fn command_path(&self) -> &'static str {
        match self.command() {
            GatewayCommand::Foreground => "gateway",
            GatewayCommand::Start => "gateway start",
            GatewayCommand::Stop => "gateway stop",
            GatewayCommand::Status => "gateway status",
            GatewayCommand::Logs => "gateway logs",
        }
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) enum GatewayCommand {
    Foreground,
    Start,
    Stop,
    Status,
    Logs,
}

#[derive(Debug, Clone, Copy, Subcommand, Eq, PartialEq)]
enum GatewaySubcommand {
    /// Start the self-host gateway in background.
    Start,
    /// Stop the self-host gateway if a managed process is present.
    Stop,
    /// Show the current self-host gateway state and derived paths.
    Status,
    /// Show the current self-host gateway log path and any available preview.
    Logs,
}
