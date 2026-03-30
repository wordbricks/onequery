use std::ffi::OsString;
use std::path::PathBuf;

#[cfg(test)]
use std::io::IsTerminal;

use clap::ArgAction;
use clap::Args;
use clap::CommandFactory;
use clap::Parser;
use clap::Subcommand;
use clap::ValueEnum;
use clap::error::ErrorKind;

use crate::config::RawCliConfigOverrides;
use crate::output::CommandOutput;
use crate::output::EffectiveOutputMode;
use crate::output::RequestedOutputMode;
use crate::output::resolve_output_mode;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use onequery_config::parse_cli_overrides;

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
    Serve(ServeCommand),
    Use(UseArgs),
    Schema(SchemaSubcommand),
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
            Self::Query(QuerySubcommand::Execute(_)) => "query execute",
            Self::Query(QuerySubcommand::Validate(_)) => "query validate",
            Self::Restore(_) => "restore",
            Self::Serve(ServeCommand::Root) => "serve",
            Self::Serve(ServeCommand::Start) => "serve start",
            Self::Serve(ServeCommand::Stop) => "serve stop",
            Self::Serve(ServeCommand::Status) => "serve status",
            Self::Serve(ServeCommand::Logs) => "serve logs",
            Self::Use(_) => "use",
            Self::Schema(SchemaSubcommand::Openapi) => "schema openapi",
            Self::Schema(SchemaSubcommand::Commands) => "schema commands",
            Self::Schema(SchemaSubcommand::Command(_)) => "schema command",
            Self::Schema(SchemaSubcommand::Skills) => "schema skills",
            Self::Debug(DebugSubcommand::Config) => "debug config",
            Self::Debug(DebugSubcommand::AuthSession) => "debug auth-session",
        }
    }
}

#[derive(Debug, Clone, Parser)]
#[command(
    name = "oneq",
    version,
    about = "OneQuery CLI",
    propagate_version(true),
    help_expected(true)
)]
struct RawCli {
    // Keep the parser field ID distinct from `org use <ORG_SLUG>` so clap keeps
    // both the global override and the positional visible in help output.
    /// Override the active org for this invocation.
    #[arg(
        long = "org",
        global = true,
        value_name = "ORG_SLUG",
        help_heading = "Global Options"
    )]
    org_override: Option<String>,
    /// Apply a raw config override for this invocation using `key=value`.
    #[arg(
        short = 'c',
        long = "config",
        value_name = "KEY=VALUE",
        action = ArgAction::Append,
        global = true,
        help_heading = "Global Options"
    )]
    config_overrides: Vec<String>,
    /// Attach a caller-supplied request ID to outbound API requests.
    #[arg(
        long = "request-id",
        global = true,
        value_name = "REQUEST_ID",
        help_heading = "Global Options"
    )]
    request_id: Option<String>,
    /// Override the request timeout in seconds for this invocation.
    #[arg(
        long = "timeout",
        global = true,
        value_name = "SECONDS",
        help_heading = "Global Options"
    )]
    timeout_sec: Option<u64>,
    /// Choose text or JSON output.
    #[arg(long, global = true, value_enum, help_heading = "Global Options")]
    output: Option<RequestedOutputMode>,
    /// Emit workflow progress and retry tracing to stderr.
    #[arg(
        long,
        global = true,
        default_value_t = false,
        help_heading = "Global Options"
    )]
    verbose: bool,
    #[command(subcommand)]
    command: Option<RawCommand>,
}

#[derive(Debug, Clone, Subcommand)]
enum RawCommand {
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

#[derive(Debug, Clone, Subcommand)]
pub(crate) enum AuthSubcommand {
    /// Start browser-based login and persist the resulting session.
    Login,
    /// Import one auth session payload from disk or stdin.
    Import(AuthImportArgs),
    /// Clear the stored auth session and active org selection.
    Logout {
        /// Validate the logout flow without deleting local state.
        #[arg(long, default_value_t = false)]
        dry_run: bool,
    },
    /// Show the authenticated user and effective org context.
    Whoami {
        #[command(flatten, next_help_heading = "Read Controls")]
        read: ReadArgs,
    },
    /// Inspect or manage the stored session lifecycle.
    #[command(arg_required_else_help(true))]
    Session {
        #[command(subcommand)]
        action: AuthSessionSubcommand,
    },
}

#[derive(Debug, Clone, Subcommand)]
pub(crate) enum AuthSessionSubcommand {
    /// Refresh the stored session before it expires.
    Refresh,
}

#[derive(Debug, Clone, Args, Eq, PartialEq)]
pub(crate) struct BackupArgs {
    /// Include self-host secrets.toml in the backup archive.
    #[arg(long, default_value_t = false)]
    pub include_secrets: bool,
    /// Write the backup archive to this path instead of the default backups directory.
    #[arg(long = "archive-path", value_name = "PATH")]
    pub archive_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) enum ConfigCommand {
    SetServer { url: String },
}

#[derive(Debug, Clone, Subcommand, Eq, PartialEq)]
pub(crate) enum ConfigSubcommand {
    /// Persist local CLI config values.
    #[command(arg_required_else_help(true))]
    Set {
        #[command(subcommand)]
        action: ConfigSetSubcommand,
    },
}

#[derive(Debug, Clone, Subcommand, Eq, PartialEq)]
pub(crate) enum ConfigSetSubcommand {
    /// Persist the default server URL used by CLI API commands.
    Server {
        /// Set this URL as the default CLI target server.
        #[arg(value_name = "URL")]
        url: String,
    },
}

#[derive(Debug, Clone, Args, Eq, PartialEq)]
pub(crate) struct RestoreArgs {
    /// Restore from this backup archive.
    #[arg(value_name = "ARCHIVE_PATH")]
    pub archive_path: PathBuf,
}

#[derive(Debug, Clone, Args, Eq, PartialEq)]
pub(crate) struct AuthImportArgs {
    /// Read one auth session payload from a file path or stdin (`-`).
    #[arg(long, value_name = "PATH|-")]
    pub input: PathBuf,
    /// Validate the import payload without persisting it.
    #[arg(long, default_value_t = false)]
    pub dry_run: bool,
}

#[derive(Debug, Clone, Subcommand)]
pub(crate) enum OrgSubcommand {
    /// List the orgs available to the authenticated user.
    List {
        #[command(flatten)]
        read: ListReadArgs,
    },
    /// Show the current org with optional field projection.
    Get {
        #[command(flatten, next_help_heading = "Read Controls")]
        read: ReadArgs,
    },
    /// Show which org this invocation will use.
    Current,
    /// Persist the selected org as the active default.
    Use {
        /// Persist this org slug as the active org.
        #[arg(value_name = "ORG_SLUG")]
        org_slug: String,
        /// Validate the selection without updating local config.
        #[arg(long, default_value_t = false)]
        dry_run: bool,
    },
}

#[derive(Debug, Clone, Subcommand)]
pub(crate) enum SourceSubcommand {
    /// List sources visible to the active org.
    List {
        #[command(flatten)]
        read: ListReadArgs,
    },
    /// Show one source by key.
    Show {
        /// Look up this source key.
        #[arg(value_name = "SOURCE_KEY")]
        source_key: String,
        #[command(flatten, next_help_heading = "Read Controls")]
        read: ReadArgs,
    },
    /// Show instructions or create a new source connection.
    Connect(SourceConnectArgs),
}

#[derive(Debug, Clone, Args, Eq, PartialEq, Default)]
pub(crate) struct SourceConnectArgs {
    /// Select the provider to connect, for example `postgres` or `github`.
    #[arg(long, value_name = "PROVIDER")]
    pub source: String,
    /// Create one source from an inline JSON payload.
    #[arg(long, value_name = "JSON")]
    pub input: Option<String>,
}

#[derive(Debug, Clone, Args, Default, Eq, PartialEq)]
pub(crate) struct ReadArgs {
    /// Project only the requested response fields.
    #[arg(long, value_name = "FIELDS")]
    pub fields: Option<String>,
}

impl ReadArgs {
    pub(crate) fn fields(&self) -> Option<&str> {
        self.fields
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
    }

    pub(crate) fn has_field_selection(&self) -> bool {
        self.fields().is_some()
    }
}

#[derive(Debug, Clone, Args, Default, Eq, PartialEq)]
pub(crate) struct PaginationArgs {
    /// Limit the number of records returned in one page.
    #[arg(long = "page-size", value_name = "PAGE_SIZE")]
    pub page_size: Option<usize>,
    /// Resume listing from this pagination cursor.
    #[arg(long)]
    pub cursor: Option<String>,
    /// Continue loading pages until the server is exhausted.
    #[arg(long, default_value_t = false)]
    pub page_all: bool,
}

impl PaginationArgs {
    pub(crate) fn cursor(&self) -> Option<&str> {
        self.cursor
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
    }
}

#[derive(Debug, Clone, Args, Default, Eq, PartialEq)]
pub(crate) struct ListReadArgs {
    #[command(flatten, next_help_heading = "Read Controls")]
    pub read: ReadArgs,
    #[command(flatten, next_help_heading = "Pagination")]
    pub pagination: PaginationArgs,
}

impl ListReadArgs {
    pub(crate) fn has_field_selection(&self) -> bool {
        self.read.has_field_selection()
    }
}

#[derive(Debug, Clone, Args, Default, Eq, PartialEq)]
pub(crate) struct QueryResultWindowArgs {
    /// Cap the number of rows returned by the query.
    #[arg(long = "max-rows", value_name = "MAX_ROWS")]
    #[arg(conflicts_with = "input")]
    pub max_rows: Option<usize>,
    /// Cap the total response payload size in bytes.
    #[arg(long = "max-bytes", value_name = "MAX_BYTES")]
    #[arg(conflicts_with = "input")]
    pub max_bytes: Option<usize>,
    /// Truncate individual cell values to this many characters.
    #[arg(long = "cell-max-chars", value_name = "CELL_MAX_CHARS")]
    #[arg(conflicts_with = "input")]
    pub cell_max_chars: Option<usize>,
    /// Override the query execution timeout in milliseconds.
    #[arg(long = "timeout-ms", value_name = "MILLISECONDS")]
    #[arg(conflicts_with = "input")]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Args, Default, Eq, PartialEq)]
#[group(id = "query_input_source", required = true, multiple = false)]
pub(crate) struct QueryInputArgs {
    /// Read a full query request payload from a JSON file or stdin (`-`).
    #[arg(long, value_name = "PATH|-", group = "query_input_source")]
    pub input: Option<PathBuf>,
    /// Provide SQL directly on the command line.
    #[arg(long, group = "query_input_source")]
    pub sql: Option<String>,
    /// Read SQL from a UTF-8 file.
    #[arg(long, value_name = "PATH", group = "query_input_source")]
    pub file: Option<PathBuf>,
    /// Read SQL from stdin.
    #[arg(long, default_value_t = false, group = "query_input_source")]
    pub stdin: bool,
    #[command(flatten, next_help_heading = "Result Window")]
    pub result_window: QueryResultWindowArgs,
}

impl QueryInputArgs {
    pub(crate) fn uses_raw_input(&self) -> bool {
        self.input.is_some()
    }
}

#[derive(Debug, Clone, Args, Eq, PartialEq)]
pub(crate) struct QueryExecuteArgs {
    /// Execute the query against this source key.
    #[arg(long, value_name = "SOURCE_KEY")]
    pub source: String,
    #[command(flatten)]
    pub read: ListReadArgs,
    #[command(flatten, next_help_heading = "Query Input")]
    pub input: QueryInputArgs,
}

#[derive(Debug, Clone, Args, Eq, PartialEq)]
pub(crate) struct QueryValidateArgs {
    /// Validate the query against this source key.
    #[arg(long, value_name = "SOURCE_KEY")]
    pub source: String,
    #[command(flatten, next_help_heading = "Read Controls")]
    pub read: ReadArgs,
    #[command(flatten, next_help_heading = "Query Input")]
    pub input: QueryInputArgs,
}

#[derive(Debug, Clone, Subcommand, Eq, PartialEq)]
pub(crate) enum QuerySubcommand {
    /// Execute a query and return rows.
    #[command(override_usage = "\
oneq query execute [OPTIONS] --source <SOURCE_KEY> --input <PATH|->
       oneq query execute [OPTIONS] --source <SOURCE_KEY> --sql <SQL>
       oneq query execute [OPTIONS] --source <SOURCE_KEY> --file <PATH>
       oneq query execute [OPTIONS] --source <SOURCE_KEY> --stdin")]
    Execute(QueryExecuteArgs),
    /// Validate a query without executing it.
    #[command(override_usage = "\
oneq query validate [OPTIONS] --source <SOURCE_KEY> --input <PATH|->
       oneq query validate [OPTIONS] --source <SOURCE_KEY> --sql <SQL>
       oneq query validate [OPTIONS] --source <SOURCE_KEY> --file <PATH>
       oneq query validate [OPTIONS] --source <SOURCE_KEY> --stdin")]
    Validate(QueryValidateArgs),
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) enum ServeCommand {
    Root,
    Start,
    Stop,
    Status,
    Logs,
}

#[derive(Debug, Clone, Subcommand, Copy, Eq, PartialEq)]
pub(crate) enum ServeSubcommand {
    /// Bootstrap the self-host runtime foundation and prepare to launch.
    Start,
    /// Stop the self-host runtime if a managed process is present.
    Stop,
    /// Show the current self-host runtime state and derived paths.
    Status,
    /// Show the current self-host server log path and any available preview.
    Logs,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, ValueEnum)]
pub(crate) enum UseSource {
    Amplitude,
    Ga,
    Github,
    Mixpanel,
    Mongodb,
    Posthog,
    Sentry,
}

impl UseSource {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Amplitude => "amplitude",
            Self::Ga => "ga",
            Self::Github => "github",
            Self::Mixpanel => "mixpanel",
            Self::Mongodb => "mongodb",
            Self::Posthog => "posthog",
            Self::Sentry => "sentry",
        }
    }
}

#[derive(Debug, Clone, Args, Eq, PartialEq)]
pub(crate) struct UseArgs {
    /// Load skill content for this non-SQL source provider.
    #[arg(long, value_name = "SOURCE", value_enum)]
    pub source: UseSource,
    /// Execute one provider-specific relay request from an inline JSON payload.
    #[arg(long, value_name = "JSON")]
    pub input: Option<String>,
}

#[derive(Debug, Clone, Args, Eq, PartialEq)]
pub(crate) struct SchemaCommandArgs {
    /// Address one command path such as `query execute`.
    #[arg(required = true, num_args = 1.., value_name = "COMMAND_PATH")]
    pub path: Vec<String>,
}

#[derive(Debug, Clone, Subcommand, Eq, PartialEq)]
pub(crate) enum SchemaSubcommand {
    /// Print the canonical OpenAPI contract for the CLI surface.
    Openapi,
    /// List public commands with schema metadata.
    Commands,
    /// Show one command schema by path.
    Command(SchemaCommandArgs),
    /// List packaged skill files for agents.
    Skills,
}

#[derive(Debug, Clone, Subcommand)]
pub(crate) enum DebugSubcommand {
    /// Inspect the merged local config state.
    Config,
    /// Inspect the stored auth session payload.
    AuthSession,
}

#[cfg(test)]
pub(crate) fn parse_invocation_from(args: &[OsString]) -> Result<ParseOutcome, CliError> {
    parse_invocation_from_with_stdout_tty(args, std::io::stdout().is_terminal())
}

pub(crate) fn parse_invocation_from_with_stdout_tty(
    args: &[OsString],
    stdout_is_tty: bool,
) -> Result<ParseOutcome, CliError> {
    let raw_command = normalize_command_line(args);
    let requested_output = requested_output_from_args(args);

    match RawCli::try_parse_from(args) {
        Ok(raw_cli) => {
            let RawCli {
                org_override,
                config_overrides,
                request_id,
                timeout_sec,
                output,
                verbose,
                command,
            } = raw_cli;
            let raw_config_overrides = parse_cli_overrides(&config_overrides).map_err(|error| {
                CliError::new(
                    "invalid config override",
                    raw_command.clone(),
                    ErrorStage::ParseCommand,
                    error.to_string(),
                    vec![
                        "use -c KEY=VALUE".to_owned(),
                        "quote TOML strings when needed".to_owned(),
                    ],
                )
            })?;
            let output_mode = resolve_output_mode(output, stdout_is_tty);
            let Some(command) = command else {
                return render_help_parse_outcome(output_mode, render_root_help_text(raw_command)?);
            };

            Ok(ParseOutcome::Invocation(Box::new(Invocation {
                raw_command,
                global: GlobalOptions {
                    org: org_override,
                    raw_config_overrides,
                    request_id: request_id
                        .as_deref()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(ToOwned::to_owned),
                    timeout_sec,
                    output_mode,
                    verbose,
                },
                command: map_command(command),
            })))
        }
        Err(parse_error) => match parse_error.kind() {
            ErrorKind::DisplayHelp | ErrorKind::DisplayHelpOnMissingArgumentOrSubcommand => {
                render_help_parse_outcome(
                    resolve_output_mode(requested_output, stdout_is_tty),
                    parse_error.to_string(),
                )
            }
            ErrorKind::DisplayVersion => Ok(ParseOutcome::Display(
                CommandOutput::display(parse_error.to_string()).with_command("version"),
            )),
            _ => Err(CliError::new(
                "invalid command",
                raw_command,
                ErrorStage::ParseCommand,
                parse_error.to_string(),
                vec!["oneq help".to_owned()],
            )),
        },
    }
}

fn render_help_parse_outcome(
    output_mode: EffectiveOutputMode,
    help: String,
) -> Result<ParseOutcome, CliError> {
    Ok(ParseOutcome::Display(render_help_text_output(
        output_mode,
        help,
    )))
}

fn render_root_help_text(raw_command: String) -> Result<String, CliError> {
    let mut command = RawCli::command();
    let mut help_buffer = Vec::new();
    command
        .write_long_help(&mut help_buffer)
        .map_err(|write_error| {
            CliError::new(
                "failed to render help",
                raw_command,
                ErrorStage::ParseCommand,
                write_error.to_string(),
                vec!["oneq help".to_owned()],
            )
        })?;
    Ok(String::from_utf8_lossy(&help_buffer).to_string())
}

fn render_help_text_output(output_mode: EffectiveOutputMode, help: String) -> CommandOutput {
    CommandOutput::structured(
        help.lines().map(ToOwned::to_owned).collect(),
        serde_json::json!({
            "kind": "help",
            "outputMode": match output_mode {
                EffectiveOutputMode::Text => "text",
                EffectiveOutputMode::Json => "json",
            },
            "text": help,
        }),
    )
    .with_command("help")
}

fn map_command(raw_command: RawCommand) -> Command {
    match raw_command {
        RawCommand::Auth { action } => Command::Auth(action),
        RawCommand::Backup(args) => Command::Backup(args),
        RawCommand::Config { action } => Command::Config(match action {
            ConfigSubcommand::Set { action } => match action {
                ConfigSetSubcommand::Server { url } => ConfigCommand::SetServer { url },
            },
        }),
        RawCommand::Org { action } => Command::Org(action),
        RawCommand::Source { action } => Command::Source(action),
        RawCommand::Query { action } => Command::Query(action),
        RawCommand::Restore(args) => Command::Restore(args),
        RawCommand::Serve { action } => Command::Serve(match action {
            None => ServeCommand::Root,
            Some(ServeSubcommand::Start) => ServeCommand::Start,
            Some(ServeSubcommand::Stop) => ServeCommand::Stop,
            Some(ServeSubcommand::Status) => ServeCommand::Status,
            Some(ServeSubcommand::Logs) => ServeCommand::Logs,
        }),
        RawCommand::Use(args) => Command::Use(args),
        RawCommand::Schema { action } => Command::Schema(action),
        RawCommand::Debug { action } => Command::Debug(action),
    }
}

fn normalize_command_line(args: &[OsString]) -> String {
    let mut normalized = vec!["oneq".to_owned()];
    if args.is_empty() {
        return normalized.join(" ");
    }

    let mut index = 1;
    while index < args.len() {
        let token = args[index].to_string_lossy().into_owned();
        if token == "--sql" {
            normalized.push(token);
            if let Some(next_value) = args.get(index + 1) {
                normalized.push(abbreviate_sql_arg(next_value.to_string_lossy().as_ref()));
                index += 2;
                continue;
            }
            index += 1;
            continue;
        }
        if token == "--input" {
            normalized.push(token);
            if let Some(next_value) = args.get(index + 1) {
                normalized.push(abbreviate_input_arg(next_value.to_string_lossy().as_ref()));
                index += 2;
                continue;
            }
            index += 1;
            continue;
        }
        if token == "-c" || token == "--config" {
            normalized.push(token);
            if let Some(next_value) = args.get(index + 1) {
                normalized.push(abbreviate_config_override_arg(
                    next_value.to_string_lossy().as_ref(),
                ));
                index += 2;
                continue;
            }
            index += 1;
            continue;
        }
        if let Some(raw_sql) = token.strip_prefix("--sql=") {
            normalized.push(format!("--sql={}", abbreviate_sql_arg(raw_sql)));
            index += 1;
            continue;
        }
        if let Some(raw_input) = token.strip_prefix("--input=") {
            normalized.push(format!("--input={}", abbreviate_input_arg(raw_input)));
            index += 1;
            continue;
        }
        if let Some(raw_override) = token.strip_prefix("--config=") {
            normalized.push(format!(
                "--config={}",
                abbreviate_config_override_arg(raw_override)
            ));
            index += 1;
            continue;
        }

        normalized.push(token);
        index += 1;
    }

    normalized.join(" ")
}

fn abbreviate_sql_arg(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "\"<empty>\"".to_owned();
    }

    let excerpt_len = 48usize;
    let mut excerpt = String::new();
    for character in trimmed.chars().take(excerpt_len) {
        excerpt.push(character);
    }

    let truncated = trimmed.chars().count() > excerpt_len;
    if truncated {
        format!("\"<excerpt: {excerpt}...>\"")
    } else {
        format!("\"<excerpt: {excerpt}>\"")
    }
}

fn abbreviate_input_arg(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "\"<empty>\"".to_owned();
    }

    if !(trimmed.starts_with('{') || trimmed.starts_with('[')) && trimmed.len() <= 64 {
        return trimmed.to_owned();
    }

    let excerpt_len = 48usize;
    let mut excerpt = String::new();
    for character in trimmed.chars().take(excerpt_len) {
        excerpt.push(character);
    }

    let truncated = trimmed.chars().count() > excerpt_len;
    if truncated {
        format!("\"{excerpt}…\"")
    } else {
        format!("\"{excerpt}\"")
    }
}

fn abbreviate_config_override_arg(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "<invalid>".to_owned();
    }

    let Some((raw_key, _)) = trimmed.split_once('=') else {
        return "<invalid>".to_owned();
    };
    let key = raw_key.trim();
    if key.is_empty() {
        return "<invalid>".to_owned();
    }

    format!("{key}=<redacted>")
}

pub(crate) fn requested_output_from_args(args: &[OsString]) -> Option<RequestedOutputMode> {
    let mut index = 1;
    while index < args.len() {
        let token = args[index].to_string_lossy();
        if token == "--output" {
            let value = args.get(index + 1)?;
            return parse_requested_output_token(value.to_string_lossy().as_ref());
        }
        if let Some(value) = token.strip_prefix("--output=") {
            return parse_requested_output_token(value);
        }
        index += 1;
    }

    None
}

fn parse_requested_output_token(raw: &str) -> Option<RequestedOutputMode> {
    match raw.trim() {
        "text" => Some(RequestedOutputMode::Text),
        "json" => Some(RequestedOutputMode::Json),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;
    use std::path::PathBuf;

    use insta::assert_snapshot;
    use pretty_assertions::assert_eq;
    use toml::Value as TomlValue;

    use crate::config::DEFAULT_BASE_URL;

    use super::AuthImportArgs;
    use super::AuthSessionSubcommand;
    use super::ConfigCommand;
    use super::ListReadArgs;
    use super::PaginationArgs;
    use super::ParseOutcome;
    use super::QueryInputArgs;
    use super::QueryResultWindowArgs;
    use super::QuerySubcommand;
    use super::ReadArgs;
    use super::RequestedOutputMode;
    use super::ServeCommand;
    use super::parse_invocation_from;
    use super::parse_invocation_from_with_stdout_tty;
    use super::requested_output_from_args;
    #[test]
    fn help_output_snapshot_keeps_config_commands_out_of_public_surface() {
        let outcome = parse_invocation_from(&[OsString::from("oneq")]).expect("expected help");

        let ParseOutcome::Display(display) = outcome else {
            panic!("expected bare oneq to render display output");
        };

        let rendered = display.lines.join("\n");

        assert_snapshot!(rendered);
    }

    #[test]
    fn auth_help_output_snapshot_targets_auth_surface() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("auth"),
            OsString::from("--help"),
        ])
        .expect("expected auth help output");

        let ParseOutcome::Display(display) = outcome else {
            panic!("expected auth --help to render display output");
        };

        let rendered = display.lines.join("\n");
        assert_snapshot!(rendered);
    }

    #[test]
    fn query_help_output_snapshot_targets_query_surface() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("query"),
            OsString::from("--help"),
        ])
        .expect("expected query help output");

        let ParseOutcome::Display(display) = outcome else {
            panic!("expected query --help to render display output");
        };

        let rendered = display.lines.join("\n");
        assert_snapshot!(rendered);
    }

    #[test]
    fn use_help_output_snapshot_targets_use_surface() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("use"),
            OsString::from("--help"),
        ])
        .expect("expected use help output");

        let ParseOutcome::Display(display) = outcome else {
            panic!("expected use --help to render display output");
        };

        let rendered = display.lines.join("\n");
        assert_snapshot!(rendered);
    }

    #[test]
    fn serve_help_output_snapshot_targets_serve_surface() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("serve"),
            OsString::from("--help"),
        ])
        .expect("expected serve help output");

        let ParseOutcome::Display(display) = outcome else {
            panic!("expected serve --help to render display output");
        };

        let rendered = display.lines.join("\n");
        assert_snapshot!(rendered);
    }

    #[test]
    fn org_use_help_output_keeps_global_org_override_visible() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("org"),
            OsString::from("use"),
            OsString::from("--help"),
        ])
        .expect("expected org use help output");

        let ParseOutcome::Display(display) = outcome else {
            panic!("expected org use --help to render display output");
        };

        let rendered = display.lines.join("\n");
        assert_snapshot!(rendered);
    }

    #[test]
    fn query_execute_help_output_uses_explicit_multiline_usage() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("query"),
            OsString::from("execute"),
            OsString::from("--help"),
        ])
        .expect("expected query execute help output");

        let ParseOutcome::Display(display) = outcome else {
            panic!("expected query execute --help to render display output");
        };

        let rendered = display.lines.join("\n");
        assert_snapshot!(rendered);
    }

    #[test]
    fn query_validate_help_output_uses_explicit_multiline_usage() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("query"),
            OsString::from("validate"),
            OsString::from("--help"),
        ])
        .expect("expected query validate help output");

        let ParseOutcome::Display(display) = outcome else {
            panic!("expected query validate --help to render display output");
        };

        let rendered = display.lines.join("\n");
        assert_snapshot!(rendered);
    }

    #[test]
    fn parse_invocation_renders_bare_config_as_help() {
        let outcome = parse_invocation_from(&[OsString::from("oneq"), OsString::from("config")])
            .expect("expected bare config command to render help");

        let ParseOutcome::Display(display) = outcome else {
            panic!("expected bare config command to render display output");
        };

        assert!(display.lines.join("\n").contains("Usage: oneq config"));
    }

    #[test]
    fn parse_invocation_accepts_config_set_server() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("config"),
            OsString::from("set"),
            OsString::from("server"),
            OsString::from(DEFAULT_BASE_URL),
        ])
        .expect("expected config set server invocation");

        let ParseOutcome::Invocation(invocation) = outcome else {
            panic!("expected config set server to parse as an invocation");
        };

        match invocation.command {
            super::Command::Config(ConfigCommand::SetServer { url }) => {
                assert_eq!(url, DEFAULT_BASE_URL.to_owned());
            }
            other => panic!("expected config set server command, got {other:?}"),
        }
    }

    #[test]
    fn parse_invocation_accepts_backup_archive_path_without_conflicting_with_global_output_mode() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("backup"),
            OsString::from("--archive-path"),
            OsString::from("/tmp/onequery-backup.tar.gz"),
            OsString::from("--output"),
            OsString::from("json"),
        ])
        .expect("expected backup invocation");

        let ParseOutcome::Invocation(invocation) = outcome else {
            panic!("expected backup command to parse as an invocation");
        };

        match invocation.command {
            super::Command::Backup(super::BackupArgs {
                include_secrets,
                archive_path,
            }) => {
                assert_eq!(include_secrets, false);
                assert_eq!(
                    archive_path,
                    Some(PathBuf::from("/tmp/onequery-backup.tar.gz"))
                );
                assert_eq!(
                    invocation.global.output_mode,
                    super::EffectiveOutputMode::Json
                );
            }
            other => panic!("expected backup command, got {other:?}"),
        }
    }

    #[test]
    fn version_output_matches_current_package_version() {
        let outcome = parse_invocation_from(&[OsString::from("oneq"), OsString::from("--version")]);

        match outcome {
            // Version output is derived from release metadata, so snapshotting it creates
            // avoidable churn whenever the tag changes.
            Ok(ParseOutcome::Display(display)) => {
                assert_eq!(
                    display.lines.join("\n").trim(),
                    format!("oneq {}", env!("CARGO_PKG_VERSION"))
                );
            }
            Ok(ParseOutcome::Invocation(_)) => {
                panic!("expected --version to render display output")
            }
            Err(error) => panic!("expected version output, received error: {error}"),
        }
    }

    #[test]
    fn subcommand_version_output_matches_current_package_version() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("auth"),
            OsString::from("--version"),
        ]);

        match outcome {
            Ok(ParseOutcome::Display(display)) => {
                assert_eq!(
                    display.lines.join("\n").trim(),
                    format!("oneq-auth {}", env!("CARGO_PKG_VERSION"))
                );
            }
            Ok(ParseOutcome::Invocation(_)) => {
                panic!("expected auth --version to render display output")
            }
            Err(error) => panic!("expected auth --version output, received error: {error}"),
        }
    }

    #[test]
    fn parse_invocation_accepts_hidden_debug_subcommand() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("debug"),
            OsString::from("config"),
        ]);

        let Ok(ParseOutcome::Invocation(invocation)) = outcome else {
            panic!("expected hidden debug subcommand to parse");
        };

        assert!(matches!(
            invocation.command,
            super::Command::Debug(super::DebugSubcommand::Config)
        ));
    }

    #[test]
    fn parse_invocation_accepts_serve_without_subcommand() {
        let outcome = parse_invocation_from(&[OsString::from("oneq"), OsString::from("serve")]);

        let Ok(ParseOutcome::Invocation(invocation)) = outcome else {
            panic!("expected serve command to parse");
        };

        assert!(matches!(
            invocation.command,
            super::Command::Serve(ServeCommand::Root)
        ));
    }

    #[test]
    fn parse_invocation_accepts_serve_status_subcommand() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("serve"),
            OsString::from("status"),
        ]);

        let Ok(ParseOutcome::Invocation(invocation)) = outcome else {
            panic!("expected serve status subcommand to parse");
        };

        assert!(matches!(
            invocation.command,
            super::Command::Serve(ServeCommand::Status)
        ));
    }

    #[test]
    fn parse_invocation_accepts_org_get_read_controls() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("--org"),
            OsString::from("acme"),
            OsString::from("org"),
            OsString::from("get"),
            OsString::from("--fields"),
            OsString::from("slug,capabilities"),
        ]);

        let Ok(ParseOutcome::Invocation(invocation)) = outcome else {
            panic!("expected org get subcommand to parse");
        };

        assert_eq!(
            match invocation.command {
                super::Command::Org(super::OrgSubcommand::Get { read }) => {
                    (invocation.global.org, read)
                }
                other => panic!("expected org get subcommand, got {other:?}"),
            },
            (
                Some("acme".to_owned()),
                super::ReadArgs {
                    fields: Some("slug,capabilities".to_owned()),
                }
            )
        );
    }

    #[test]
    fn parse_invocation_accepts_auth_whoami_read_controls() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("auth"),
            OsString::from("whoami"),
            OsString::from("--fields"),
            OsString::from("user.email,effectiveOrg"),
        ]);

        let Ok(ParseOutcome::Invocation(invocation)) = outcome else {
            panic!("expected auth whoami subcommand to parse");
        };

        assert_eq!(
            match invocation.command {
                super::Command::Auth(super::AuthSubcommand::Whoami { read }) => read,
                other => panic!("expected auth whoami subcommand, got {other:?}"),
            },
            super::ReadArgs {
                fields: Some("user.email,effectiveOrg".to_owned()),
            }
        );
    }

    #[test]
    fn parse_invocation_accepts_request_id_and_timeout_transport_controls() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("--request-id"),
            OsString::from("req_cli_123"),
            OsString::from("--timeout"),
            OsString::from("45"),
            OsString::from("org"),
            OsString::from("list"),
        ]);

        let Ok(ParseOutcome::Invocation(invocation)) = outcome else {
            panic!("expected invocation with transport controls to parse");
        };

        assert_eq!(
            (
                invocation.global.request_id,
                invocation.global.timeout_sec,
                invocation.command.command_path(),
            ),
            (Some("req_cli_123".to_owned()), Some(45), "org list",)
        );
    }

    #[test]
    fn parse_invocation_accepts_raw_config_overrides() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("-c"),
            OsString::from("api.request_timeout_sec=30"),
            OsString::from("--config"),
            OsString::from("query.output.format=json"),
            OsString::from("org"),
            OsString::from("list"),
        ]);

        let Ok(ParseOutcome::Invocation(invocation)) = outcome else {
            panic!("expected invocation with raw config overrides to parse");
        };

        assert_eq!(
            invocation.global.raw_config_overrides,
            vec![
                ("api.request_timeout_sec".to_owned(), TomlValue::Integer(30)),
                (
                    "query.output.format".to_owned(),
                    TomlValue::String("json".to_owned()),
                ),
            ]
        );
    }

    #[test]
    fn parse_invocation_rejects_invalid_raw_config_overrides() {
        let error = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("--config"),
            OsString::from("api.request_timeout_sec"),
            OsString::from("org"),
            OsString::from("list"),
        ])
        .expect_err("expected invalid raw config override to fail");

        assert_eq!(
            (error.title.as_str(), error.why.as_str()),
            (
                "invalid config override",
                "invalid -c/--config override: expected KEY=VALUE",
            )
        );
    }

    #[test]
    fn normalize_command_line_redacts_raw_config_override_values() {
        assert_eq!(
            super::normalize_command_line(&[
                OsString::from("oneq"),
                OsString::from("--config"),
                OsString::from("api.access_token=secret-token"),
                OsString::from("--config=query.output.format=json"),
                OsString::from("org"),
                OsString::from("list"),
            ]),
            "oneq --config api.access_token=<redacted> --config=query.output.format=<redacted> org list"
                .to_owned()
        );
    }

    #[test]
    fn parse_invocation_accepts_use_source_flag() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("use"),
            OsString::from("--source"),
            OsString::from("sentry"),
        ]);

        let Ok(ParseOutcome::Invocation(invocation)) = outcome else {
            panic!("expected use invocation to parse");
        };

        assert!(matches!(
            invocation.command,
            super::Command::Use(super::UseArgs {
                source: super::UseSource::Sentry,
                input: None,
            })
        ));
    }

    #[test]
    fn parse_invocation_accepts_use_input_json() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("use"),
            OsString::from("--source"),
            OsString::from("github"),
            OsString::from("--input"),
            OsString::from("{\"method\":\"fetch_api\",\"request\":{\"endpoint\":\"/user\"}}"),
        ]);

        let Ok(ParseOutcome::Invocation(invocation)) = outcome else {
            panic!("expected use invocation with input to parse");
        };

        assert!(matches!(
            invocation.command,
            super::Command::Use(super::UseArgs {
                source: super::UseSource::Github,
                input: Some(input),
            }) if input == "{\"method\":\"fetch_api\",\"request\":{\"endpoint\":\"/user\"}}"
        ));
    }

    #[test]
    fn parse_invocation_accepts_auth_import_raw_input() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("auth"),
            OsString::from("import"),
            OsString::from("--input"),
            OsString::from("auth.json"),
        ]);

        let Ok(ParseOutcome::Invocation(invocation)) = outcome else {
            panic!("expected auth import invocation to parse");
        };

        assert!(matches!(
            invocation.command,
            super::Command::Auth(super::AuthSubcommand::Import(AuthImportArgs { input, dry_run }))
                if input == std::path::Path::new("auth.json") && !dry_run
        ));
    }

    #[test]
    fn parse_invocation_accepts_auth_import_dry_run() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("auth"),
            OsString::from("import"),
            OsString::from("--input"),
            OsString::from("auth.json"),
            OsString::from("--dry-run"),
        ]);

        let Ok(ParseOutcome::Invocation(invocation)) = outcome else {
            panic!("expected auth import dry-run invocation to parse");
        };

        assert!(matches!(
            invocation.command,
            super::Command::Auth(super::AuthSubcommand::Import(AuthImportArgs { input, dry_run }))
                if input == std::path::Path::new("auth.json") && dry_run
        ));
    }

    #[test]
    fn parse_invocation_accepts_auth_logout_dry_run() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("auth"),
            OsString::from("logout"),
            OsString::from("--dry-run"),
        ]);

        let Ok(ParseOutcome::Invocation(invocation)) = outcome else {
            panic!("expected auth logout dry-run invocation to parse");
        };

        assert!(matches!(
            invocation.command,
            super::Command::Auth(super::AuthSubcommand::Logout { dry_run }) if dry_run
        ));
    }

    #[test]
    fn parse_invocation_accepts_auth_session_refresh() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("auth"),
            OsString::from("session"),
            OsString::from("refresh"),
        ]);

        let Ok(ParseOutcome::Invocation(invocation)) = outcome else {
            panic!("expected auth session refresh invocation to parse");
        };

        assert_eq!(invocation.command.command_path(), "auth session refresh");
        assert!(matches!(
            invocation.command,
            super::Command::Auth(super::AuthSubcommand::Session {
                action: AuthSessionSubcommand::Refresh,
            })
        ));
    }

    #[test]
    fn parse_invocation_accepts_schema_command_path_tokens() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("schema"),
            OsString::from("command"),
            OsString::from("query"),
            OsString::from("execute"),
        ]);

        let Ok(ParseOutcome::Invocation(invocation)) = outcome else {
            panic!("expected schema command subcommand to parse");
        };

        assert!(matches!(
            invocation.command,
            super::Command::Schema(super::SchemaSubcommand::Command(
                super::SchemaCommandArgs { path }
            )) if path == vec!["query".to_owned(), "execute".to_owned()]
        ));
    }

    #[test]
    fn requested_output_from_args_reads_space_separated_long_flag() {
        assert_eq!(
            requested_output_from_args(&[
                OsString::from("oneq"),
                OsString::from("--output"),
                OsString::from("json"),
            ]),
            Some(RequestedOutputMode::Json)
        );
    }

    #[test]
    fn requested_output_from_args_reads_equals_delimited_long_flag() {
        assert_eq!(
            requested_output_from_args(&[OsString::from("oneq"), OsString::from("--output=text")]),
            Some(RequestedOutputMode::Text)
        );
    }

    #[test]
    fn parse_invocation_resolves_effective_output_mode_before_execution() {
        let outcome = parse_invocation_from_with_stdout_tty(
            &[
                OsString::from("oneq"),
                OsString::from("org"),
                OsString::from("list"),
            ],
            false,
        );

        let Ok(ParseOutcome::Invocation(invocation)) = outcome else {
            panic!("expected invocation to parse");
        };

        assert_eq!(
            invocation.global.output_mode,
            crate::output::EffectiveOutputMode::Json
        );
    }

    #[test]
    fn parse_invocation_accepts_list_read_controls() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("source"),
            OsString::from("list"),
            OsString::from("--fields"),
            OsString::from("sources.name,sources.status"),
            OsString::from("--page-size"),
            OsString::from("25"),
            OsString::from("--cursor"),
            OsString::from("cursor_123"),
            OsString::from("--page-all"),
        ]);

        let Ok(ParseOutcome::Invocation(invocation)) = outcome else {
            panic!("expected source list invocation to parse");
        };

        assert!(matches!(
            invocation.command,
            super::Command::Source(super::SourceSubcommand::List { read: ListReadArgs {
                read: ReadArgs {
                    fields: Some(fields),
                },
                pagination: PaginationArgs {
                    page_size: Some(25),
                    cursor: Some(cursor),
                    page_all: true,
                },
            } }) if fields == "sources.name,sources.status" && cursor == "cursor_123"
        ));
    }

    #[test]
    fn parse_invocation_accepts_source_connect_input() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("source"),
            OsString::from("connect"),
            OsString::from("--source"),
            OsString::from("postgres"),
            OsString::from("--input"),
            OsString::from("{\"name\":\"warehouse\"}"),
        ]);

        let Ok(ParseOutcome::Invocation(invocation)) = outcome else {
            panic!("expected source connect invocation to parse");
        };

        assert!(matches!(
            invocation.command,
            super::Command::Source(super::SourceSubcommand::Connect(
                super::SourceConnectArgs {
                    source,
                    input: Some(input),
                }
            )) if source == "postgres" && input == "{\"name\":\"warehouse\"}"
        ));
    }

    #[test]
    fn parse_invocation_accepts_query_result_window_args() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("query"),
            OsString::from("execute"),
            OsString::from("--source"),
            OsString::from("warehouse"),
            OsString::from("--sql"),
            OsString::from("select 1"),
            OsString::from("--fields"),
            OsString::from("rows"),
            OsString::from("--page-size"),
            OsString::from("10"),
            OsString::from("--max-rows"),
            OsString::from("500"),
            OsString::from("--max-bytes"),
            OsString::from("4096"),
            OsString::from("--cell-max-chars"),
            OsString::from("256"),
        ]);

        let Ok(ParseOutcome::Invocation(invocation)) = outcome else {
            panic!("expected query invocation to parse");
        };

        assert!(matches!(
            invocation.command,
            super::Command::Query(QuerySubcommand::Execute(super::QueryExecuteArgs {
                source,
                read: ListReadArgs {
                    read: ReadArgs {
                        fields: Some(fields),
                    },
                    pagination: PaginationArgs {
                        page_size: Some(10),
                        cursor: None,
                        page_all: false,
                    },
                },
                input: QueryInputArgs {
                    input: None,
                    sql: Some(sql),
                    file: None,
                    stdin: false,
                    result_window: QueryResultWindowArgs {
                        max_rows: Some(500),
                        max_bytes: Some(4096),
                        cell_max_chars: Some(256),
                        timeout_ms: None,
                    },
                },
            })) if source == "warehouse"
                && fields == "rows"
                && sql == "select 1"
        ));
    }

    #[test]
    fn parse_invocation_accepts_explicit_query_validate_subcommand() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("query"),
            OsString::from("validate"),
            OsString::from("--source"),
            OsString::from("warehouse"),
            OsString::from("--input"),
            OsString::from("query.json"),
            OsString::from("--fields"),
            OsString::from("request,source"),
        ]);

        let Ok(ParseOutcome::Invocation(invocation)) = outcome else {
            panic!("expected query validate invocation to parse");
        };

        assert!(matches!(
            invocation.command,
            super::Command::Query(QuerySubcommand::Validate(super::QueryValidateArgs {
                source,
                read: ReadArgs {
                    fields: Some(fields),
                },
                input: QueryInputArgs {
                    input: Some(ref input),
                    sql: None,
                    file: None,
                    stdin: false,
                    result_window: QueryResultWindowArgs {
                        max_rows: None,
                        max_bytes: None,
                        cell_max_chars: None,
                        timeout_ms: None,
                    },
                },
            })) if source == "warehouse"
                && fields == "request,source"
                && input == &PathBuf::from("query.json")
        ));
    }

    #[test]
    fn parse_invocation_renders_bare_auth_as_help() {
        let outcome = parse_invocation_from(&[OsString::from("oneq"), OsString::from("auth")])
            .expect("expected bare auth to render help");

        let ParseOutcome::Display(display) = outcome else {
            panic!("expected bare auth to render display output");
        };

        assert!(
            display
                .lines
                .join("\n")
                .contains("Usage: oneq auth [OPTIONS] <COMMAND>")
        );
    }

    #[test]
    fn parse_invocation_renders_bare_query_as_help() {
        let outcome = parse_invocation_from(&[OsString::from("oneq"), OsString::from("query")])
            .expect("expected bare query to render help");

        let ParseOutcome::Display(display) = outcome else {
            panic!("expected bare query to render display output");
        };

        assert!(
            display
                .lines
                .join("\n")
                .contains("Usage: oneq query [OPTIONS] <COMMAND>")
        );
    }

    #[test]
    fn parse_invocation_preserves_query_as_org_use_argument() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("org"),
            OsString::from("use"),
            OsString::from("query"),
        ]);

        let Ok(ParseOutcome::Invocation(invocation)) = outcome else {
            panic!("expected org use invocation to parse");
        };

        assert!(matches!(
            invocation.command,
            super::Command::Org(super::OrgSubcommand::Use { org_slug, dry_run })
                if org_slug == "query" && !dry_run
        ));
    }

    #[test]
    fn parse_invocation_accepts_org_use_dry_run() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("org"),
            OsString::from("use"),
            OsString::from("acme"),
            OsString::from("--dry-run"),
        ]);

        let Ok(ParseOutcome::Invocation(invocation)) = outcome else {
            panic!("expected org use dry-run invocation to parse");
        };

        assert!(matches!(
            invocation.command,
            super::Command::Org(super::OrgSubcommand::Use { org_slug, dry_run })
                if org_slug == "acme" && dry_run
        ));
    }

    #[test]
    fn parse_invocation_preserves_query_as_schema_command_path_segment() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("schema"),
            OsString::from("command"),
            OsString::from("query"),
        ]);

        let Ok(ParseOutcome::Invocation(invocation)) = outcome else {
            panic!("expected schema command invocation to parse");
        };

        assert!(matches!(
            invocation.command,
            super::Command::Schema(super::SchemaSubcommand::Command(super::SchemaCommandArgs {
                path
            })) if path == vec!["query".to_owned()]
        ));
    }

    #[test]
    fn parse_invocation_preserves_query_as_source_flag_value() {
        let outcome = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("query"),
            OsString::from("execute"),
            OsString::from("--source"),
            OsString::from("query"),
            OsString::from("--sql"),
            OsString::from("select 1"),
        ]);

        let Ok(ParseOutcome::Invocation(invocation)) = outcome else {
            panic!("expected query invocation to parse");
        };

        assert!(matches!(
            invocation.command,
            super::Command::Query(QuerySubcommand::Execute(super::QueryExecuteArgs {
                source,
                ..
            })) if source == "query"
        ));
    }

    #[test]
    fn parse_invocation_rejects_raw_query_input_with_result_window_controls() {
        let error = parse_invocation_from(&[
            OsString::from("oneq"),
            OsString::from("query"),
            OsString::from("execute"),
            OsString::from("--source"),
            OsString::from("warehouse"),
            OsString::from("--input"),
            OsString::from("query.json"),
            OsString::from("--max-rows"),
            OsString::from("10"),
        ])
        .expect_err("expected conflicting query input to fail");

        assert_eq!(error.title, "invalid command".to_owned());
        assert!(error.why.contains("--input"));
        assert!(error.why.contains("--max-rows"));
    }
}
