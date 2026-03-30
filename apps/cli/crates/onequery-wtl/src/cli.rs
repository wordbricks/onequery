use std::io::IsTerminal;
use std::io::Write;

use clap::Args;
use clap::Parser;
use clap::Subcommand;

use crate::error::WtlError;

#[derive(Debug, Parser)]
#[command(
    name = "wtl",
    version,
    about = "WhatTheLoop minimal CLI",
    propagate_version(true),
    arg_required_else_help(true)
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand, Eq, PartialEq)]
pub enum Command {
    /// Run one WTL loop for a single request.
    Run(RunArgs),
}

#[derive(Debug, Clone, Args, Eq, PartialEq)]
pub struct RunArgs {
    /// Maximum number of iterations, including retries.
    #[arg(long, default_value_t = 20)]
    pub max_iter: usize,
    /// Maximum retries allowed for one logical turn.
    #[arg(long, default_value_t = 3)]
    pub max_retry: usize,
}

pub async fn read_initial_request() -> Result<String, WtlError> {
    if std::io::stdin().is_terminal() {
        print!("> Enter your request: ");
        std::io::stdout().flush().map_err(WtlError::ReadRequest)?;

        let mut reader = tokio::io::BufReader::new(tokio::io::stdin());
        let mut line = String::new();
        tokio::io::AsyncBufReadExt::read_line(&mut reader, &mut line)
            .await
            .map_err(WtlError::ReadRequest)?;
        return normalize_request(line);
    }

    let mut buffer = String::new();
    let mut stdin = tokio::io::stdin();
    tokio::io::AsyncReadExt::read_to_string(&mut stdin, &mut buffer)
        .await
        .map_err(WtlError::ReadRequest)?;
    normalize_request(buffer)
}

fn normalize_request(request: String) -> Result<String, WtlError> {
    let trimmed = request.trim().to_owned();
    if trimmed.is_empty() {
        return Err(WtlError::EmptyRequest);
    }

    Ok(trimmed)
}

#[cfg(test)]
mod tests {
    use clap::CommandFactory;
    use clap::Parser;
    use insta::assert_snapshot;
    use pretty_assertions::assert_eq;

    use super::Cli;
    use super::RunArgs;
    use super::normalize_request;

    #[test]
    fn help_snapshot_targets_run_surface() {
        let rendered = Cli::command().render_long_help().to_string();

        assert_snapshot!(rendered);
    }

    #[test]
    fn normalize_request_trims_outer_whitespace() {
        assert_eq!(
            normalize_request("\n  ship the spec  \n".to_owned()).expect("expected request"),
            "ship the spec"
        );
    }

    #[test]
    fn run_defaults_match_spec() {
        let parsed = Cli::try_parse_from(["wtl", "run", "--max-iter", "20", "--max-retry", "3"])
            .expect("expected CLI to parse");

        assert_eq!(
            parsed.command,
            super::Command::Run(RunArgs {
                max_iter: 20,
                max_retry: 3,
            })
        );
    }
}
