use std::fmt::Display;
use std::num::NonZeroU32;
use std::num::NonZeroU64;
use std::num::NonZeroUsize;
use std::path::PathBuf;

use clap::Args;
use clap::Subcommand;
use clap::ValueHint;

use crate::identifiers::OrgSlug;
use crate::identifiers::RequestId;
use crate::identifiers::SourceKey;
use crate::transport::source_connect_provider::SourceConnectProvider;

pub(super) fn parse_trimmed_non_empty(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("value must not be empty".to_owned());
    }

    Ok(trimmed.to_owned())
}

fn parse_non_zero<T>(raw: &str) -> Result<T, String>
where
    T: std::str::FromStr,
    T::Err: Display,
{
    raw.parse::<T>()
        .map_err(|error| format!("expected a positive integer: {error}"))
}

fn parse_identifier<T>(raw: &str) -> Result<T, String>
where
    T: for<'a> TryFrom<&'a str>,
    for<'a> <T as TryFrom<&'a str>>::Error: Display,
{
    T::try_from(raw).map_err(|error| error.to_string())
}

pub(super) fn parse_non_zero_usize(raw: &str) -> Result<NonZeroUsize, String> {
    parse_non_zero(raw)
}

pub(super) fn parse_non_zero_u64(raw: &str) -> Result<NonZeroU64, String> {
    parse_non_zero(raw)
}

pub(super) fn parse_non_zero_u32(raw: &str) -> Result<NonZeroU32, String> {
    parse_non_zero(raw)
}

pub(super) fn parse_org_slug(raw: &str) -> Result<OrgSlug, String> {
    parse_identifier(raw)
}

pub(super) fn parse_source_key(raw: &str) -> Result<SourceKey, String> {
    parse_identifier(raw)
}

pub(super) fn parse_request_id(raw: &str) -> Result<RequestId, String> {
    parse_identifier(raw)
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
        #[arg(long)]
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
    #[arg(long)]
    pub include_secrets: bool,
    /// Write the backup archive to this path instead of the default backups directory.
    #[arg(long = "archive-path", value_hint = ValueHint::FilePath, value_name = "PATH")]
    pub archive_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Args, Eq, PartialEq)]
pub(crate) struct RestoreArgs {
    /// Restore from this backup archive.
    #[arg(value_hint = ValueHint::FilePath, value_name = "ARCHIVE_PATH")]
    pub archive_path: PathBuf,
}

#[derive(Debug, Clone, Args, Eq, PartialEq)]
pub(crate) struct AuthImportArgs {
    /// Read one auth session payload from a file path or stdin (`-`).
    #[arg(long, value_hint = ValueHint::FilePath, value_name = "PATH|-")]
    pub input: PathBuf,
    /// Validate the import payload without persisting it.
    #[arg(long)]
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
        #[arg(value_name = "ORG_SLUG", value_parser = parse_org_slug)]
        org_slug: OrgSlug,
        /// Validate the selection without updating local config.
        #[arg(long)]
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
        #[arg(value_name = "SOURCE_KEY", value_parser = parse_source_key)]
        source_key: SourceKey,
        #[command(flatten, next_help_heading = "Read Controls")]
        read: ReadArgs,
    },
    /// Show instructions or create a new source connection.
    Connect(SourceConnectArgs),
}

#[derive(Debug, Clone, Args, Eq, PartialEq)]
pub(crate) struct SourceConnectArgs {
    /// Select the provider to connect.
    #[arg(long, value_name = "PROVIDER", value_enum)]
    pub source: SourceConnectProvider,
    /// Create one source from an inline JSON payload.
    #[arg(long, value_parser = parse_trimmed_non_empty, value_name = "JSON")]
    pub input: Option<String>,
}

#[derive(Debug, Clone, Args, Default, Eq, PartialEq)]
pub(crate) struct ReadArgs {
    /// Project only the requested response fields.
    #[arg(long, value_name = "FIELDS", value_parser = parse_trimmed_non_empty)]
    pub fields: Option<String>,
}

impl ReadArgs {
    pub(crate) fn fields(&self) -> Option<&str> {
        self.fields.as_deref()
    }

    pub(crate) fn has_field_selection(&self) -> bool {
        self.fields.is_some()
    }
}

#[derive(Debug, Clone, Args, Default, Eq, PartialEq)]
pub(crate) struct PaginationArgs {
    /// Limit the number of records returned in one page.
    #[arg(
        long = "page-size",
        value_name = "PAGE_SIZE",
        value_parser = parse_non_zero_usize
    )]
    pub page_size: Option<NonZeroUsize>,
    /// Resume listing from this pagination cursor.
    #[arg(long, value_parser = parse_trimmed_non_empty)]
    pub cursor: Option<String>,
    /// Continue loading pages until the server is exhausted.
    #[arg(long)]
    pub page_all: bool,
}

impl PaginationArgs {
    pub(crate) fn cursor(&self) -> Option<&str> {
        self.cursor.as_deref()
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
    #[arg(
        long = "max-rows",
        value_name = "MAX_ROWS",
        value_parser = parse_non_zero_usize
    )]
    #[arg(conflicts_with = "input")]
    pub max_rows: Option<NonZeroUsize>,
    /// Cap the total response payload size in bytes.
    #[arg(
        long = "max-bytes",
        value_name = "MAX_BYTES",
        value_parser = parse_non_zero_usize
    )]
    #[arg(conflicts_with = "input")]
    pub max_bytes: Option<NonZeroUsize>,
    /// Truncate individual cell values to this many characters.
    #[arg(
        long = "cell-max-chars",
        value_name = "CELL_MAX_CHARS",
        value_parser = parse_non_zero_usize
    )]
    #[arg(conflicts_with = "input")]
    pub cell_max_chars: Option<NonZeroUsize>,
    /// Override the query execution timeout in milliseconds.
    #[arg(
        long = "timeout-ms",
        value_name = "MILLISECONDS",
        value_parser = parse_non_zero_u64
    )]
    #[arg(conflicts_with = "input")]
    pub timeout_ms: Option<NonZeroU64>,
}

#[derive(Debug, Clone, Args, Default, Eq, PartialEq)]
#[group(id = "query_input_source", required = true, multiple = false)]
pub(crate) struct QueryInputArgs {
    /// Read a full query request payload from a JSON file or stdin (`-`).
    #[arg(
        long,
        value_hint = ValueHint::FilePath,
        value_name = "PATH|-",
        group = "query_input_source"
    )]
    pub input: Option<PathBuf>,
    /// Provide SQL directly on the command line.
    #[arg(long, value_parser = parse_trimmed_non_empty, group = "query_input_source")]
    pub sql: Option<String>,
    /// Read SQL from a UTF-8 file.
    #[arg(
        long,
        value_hint = ValueHint::FilePath,
        value_name = "PATH",
        group = "query_input_source"
    )]
    pub file: Option<PathBuf>,
    /// Read SQL from stdin.
    #[arg(long, group = "query_input_source")]
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
    #[arg(long, value_name = "SOURCE_KEY", value_parser = parse_source_key)]
    pub source: SourceKey,
    #[command(flatten)]
    pub read: ListReadArgs,
    #[command(flatten, next_help_heading = "Query Input")]
    pub input: QueryInputArgs,
}

#[derive(Debug, Clone, Args, Eq, PartialEq)]
pub(crate) struct QueryValidateArgs {
    /// Validate the query against this source key.
    #[arg(long, value_name = "SOURCE_KEY", value_parser = parse_source_key)]
    pub source: SourceKey,
    #[command(flatten, next_help_heading = "Read Controls")]
    pub read: ReadArgs,
    #[command(flatten, next_help_heading = "Query Input")]
    pub input: QueryInputArgs,
}

#[derive(Debug, Clone, Subcommand, Eq, PartialEq)]
pub(crate) enum QuerySubcommand {
    /// Execute a query and return rows.
    #[command(
        name = "exec",
        visible_alias = "execute",
        override_usage = "\
onequery query exec [OPTIONS] --source <SOURCE_KEY> --input <PATH|->
       onequery query exec [OPTIONS] --source <SOURCE_KEY> --sql <SQL>
       onequery query exec [OPTIONS] --source <SOURCE_KEY> --file <PATH>
       onequery query exec [OPTIONS] --source <SOURCE_KEY> --stdin"
    )]
    Execute(QueryExecuteArgs),
    /// Validate a query without executing it.
    #[command(override_usage = "\
onequery query validate [OPTIONS] --source <SOURCE_KEY> --input <PATH|->
       onequery query validate [OPTIONS] --source <SOURCE_KEY> --sql <SQL>
       onequery query validate [OPTIONS] --source <SOURCE_KEY> --file <PATH>
       onequery query validate [OPTIONS] --source <SOURCE_KEY> --stdin")]
    Validate(QueryValidateArgs),
}

#[derive(Debug, Clone, Args, Eq, PartialEq)]
pub(crate) struct ApiArgs {
    /// Describe or execute this connected source API.
    #[arg(long, value_name = "SOURCE_KEY", value_parser = parse_source_key)]
    pub source: SourceKey,
    /// Override the inferred source API operation.
    #[arg(long, value_name = "OPERATION", value_parser = parse_trimmed_non_empty)]
    pub op: Option<String>,
    /// Provide the selector or inferred operation target.
    #[arg(
        allow_hyphen_values = true,
        value_name = "TARGET",
        value_parser = parse_trimmed_non_empty
    )]
    pub target: Option<String>,
    /// Override the HTTP method for `http_request` operations.
    #[arg(short = 'X', long, value_name = "METHOD", value_parser = parse_trimmed_non_empty)]
    pub method: Option<String>,
    /// Add one request header using `KEY:VALUE`.
    #[arg(short = 'H', long = "header", value_name = "KEY:VALUE")]
    pub headers: Vec<String>,
    /// Add one string field patch using `KEY=VALUE`.
    #[arg(short = 'f', long = "raw-field", value_name = "KEY=VALUE")]
    pub raw_fields: Vec<String>,
    /// Add one typed field patch using `KEY=VALUE`.
    #[arg(short = 'F', long = "field", value_name = "KEY=VALUE")]
    pub fields: Vec<String>,
    /// Read the request body from a file path or stdin (`-`).
    #[arg(long, value_hint = ValueHint::FilePath, value_name = "PATH|-")]
    pub input: Option<String>,
    /// Follow opaque source API pagination tokens.
    #[arg(long)]
    pub paginate: bool,
    /// Combine paginated JSON bodies into one array before rendering.
    #[arg(long)]
    pub slurp: bool,
    /// Cap the number of paginated requests the client follows.
    #[arg(
        long,
        value_name = "N",
        value_parser = parse_non_zero_u32
    )]
    pub max_pages: Option<NonZeroU32>,
    /// Include status and allowed response headers in text output.
    #[arg(short = 'i', long = "include")]
    pub include: bool,
    /// Suppress body output.
    #[arg(long)]
    pub silent: bool,
    /// Apply a JSON selection expression after response assembly.
    #[arg(short = 'q', long = "jq", value_name = "EXPR", value_parser = parse_trimmed_non_empty)]
    pub jq: Option<String>,
    /// Prepare the request and print its preview without executing it.
    #[arg(long)]
    pub dry_run: bool,
}

#[derive(Debug, Clone, Subcommand)]
pub(crate) enum DebugSubcommand {
    /// Inspect the merged local config state.
    Config,
    /// Inspect the stored auth session payload.
    AuthSession,
}
