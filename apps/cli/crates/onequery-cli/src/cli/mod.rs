//! CLI surface types and parsing helpers for the `onequery` binary.

mod args;
mod model;
mod normalize;
mod parse;
mod raw;
#[cfg(test)]
#[path = "../cli_tests.rs"]
mod tests;

pub(crate) use args::ApiArgs;
pub(crate) use args::AuthImportArgs;
pub(crate) use args::AuthSessionSubcommand;
pub(crate) use args::AuthSubcommand;
pub(crate) use args::BackupArgs;
pub(crate) use args::DebugSubcommand;
pub(crate) use args::ListReadArgs;
pub(crate) use args::OrgSubcommand;
#[cfg(test)]
pub(crate) use args::PaginationArgs;
pub(crate) use args::QueryExecuteArgs;
pub(crate) use args::QueryInputArgs;
pub(crate) use args::QueryResultWindowArgs;
pub(crate) use args::QuerySubcommand;
pub(crate) use args::QueryValidateArgs;
pub(crate) use args::ReadArgs;
pub(crate) use args::RestoreArgs;
pub(crate) use args::SourceConnectArgs;
pub(crate) use args::SourceSubcommand;
pub(crate) use model::Command;
pub(crate) use model::ConfigCommand;
pub(crate) use model::GatewayCommand;
#[cfg(test)]
pub(crate) use model::GlobalOptions;
pub(crate) use model::Invocation;
pub(crate) use model::ParseOutcome;
pub(crate) use normalize::requested_output_from_args;
pub(crate) use parse::parse_invocation_from_with_stdout_tty;
