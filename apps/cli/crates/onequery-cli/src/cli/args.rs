use std::path::PathBuf;

use clap::ArgAction;
use clap::Args;
use clap::Subcommand;

use crate::transport::source_connect_provider::SourceConnectProvider;

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

#[derive(Debug, Clone, Args, Eq, PartialEq)]
pub(crate) struct SourceConnectArgs {
    /// Select the provider to connect.
    #[arg(long, value_name = "PROVIDER", value_enum)]
    pub source: SourceConnectProvider,
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
    #[command(
        name = "exec",
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
pub(crate) struct UseArgs {
    /// Describe or execute this connected source API.
    #[arg(long, value_name = "SOURCE_KEY")]
    pub source: String,
    /// Override the inferred source API operation.
    #[arg(long, value_name = "OPERATION")]
    pub op: Option<String>,
    /// Provide the selector or inferred operation target.
    #[arg(value_name = "TARGET", allow_hyphen_values = true)]
    pub target: Option<String>,
    /// Override the HTTP method for `http_request` operations.
    #[arg(short = 'X', long, value_name = "METHOD")]
    pub method: Option<String>,
    /// Add one request header using `KEY:VALUE`.
    #[arg(short = 'H', long = "header", value_name = "KEY:VALUE", action = ArgAction::Append)]
    pub headers: Vec<String>,
    /// Add one string field patch using `KEY=VALUE`.
    #[arg(short = 'f', long = "raw-field", value_name = "KEY=VALUE", action = ArgAction::Append)]
    pub raw_fields: Vec<String>,
    /// Add one typed field patch using `KEY=VALUE`.
    #[arg(short = 'F', long = "field", value_name = "KEY=VALUE", action = ArgAction::Append)]
    pub fields: Vec<String>,
    /// Read the request body from a file path or stdin (`-`).
    #[arg(long, value_name = "PATH|-")]
    pub input: Option<String>,
    /// Follow opaque source API pagination tokens.
    #[arg(long, default_value_t = false)]
    pub paginate: bool,
    /// Combine paginated JSON bodies into one array before rendering.
    #[arg(long, default_value_t = false)]
    pub slurp: bool,
    /// Cap the number of paginated requests the client follows.
    #[arg(long, value_name = "N")]
    pub max_pages: Option<u32>,
    /// Include status and allowed response headers in text output.
    #[arg(short = 'i', long = "include", default_value_t = false)]
    pub include: bool,
    /// Suppress body output.
    #[arg(long, default_value_t = false)]
    pub silent: bool,
    /// Apply a JSON selection expression after response assembly.
    #[arg(short = 'q', long = "jq", value_name = "EXPR")]
    pub jq: Option<String>,
    /// Print the normalized request plan without executing it.
    #[arg(long, default_value_t = false)]
    pub dry_run: bool,
}

#[derive(Debug, Clone, Subcommand)]
pub(crate) enum DebugSubcommand {
    /// Inspect the merged local config state.
    Config,
    /// Inspect the stored auth session payload.
    AuthSession,
}
