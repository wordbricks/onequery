use std::ffi::OsString;

#[cfg(test)]
use std::io::IsTerminal;

use clap::Parser;
use clap::error::ErrorKind;

use crate::output::CommandOutput;
use crate::output::EffectiveOutputMode;
use crate::output::TerminalOutput;
use crate::output::resolve_output_mode;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;

use super::model::Cli;
use super::model::ParseOutcome;
use super::normalize::normalize_command_line;
use super::normalize::requested_output_from_args;

#[cfg(test)]
pub(super) fn parse_invocation_from(args: &[OsString]) -> Result<ParseOutcome, CliError> {
    parse_invocation_from_with_stdout_tty(args, std::io::stdout().is_terminal())
}

pub(crate) fn parse_invocation_from_with_stdout_tty(
    args: &[OsString],
    stdout_is_tty: bool,
) -> Result<ParseOutcome, CliError> {
    let raw_command = normalize_command_line(args);
    let requested_output = requested_output_from_args(args);

    match Cli::try_parse_from(args) {
        Ok(cli) => Ok(ParseOutcome::Invocation(Box::new(
            cli.into_invocation(raw_command, stdout_is_tty)?,
        ))),
        Err(parse_error) => match parse_error.kind() {
            ErrorKind::DisplayHelp | ErrorKind::DisplayHelpOnMissingArgumentOrSubcommand => {
                render_help_parse_outcome(
                    resolve_output_mode(requested_output, stdout_is_tty),
                    parse_error.to_string(),
                )
            }
            ErrorKind::DisplayVersion => Ok(ParseOutcome::Display(TerminalOutput::new(
                CommandOutput::display(parse_error.to_string()).with_command("version"),
            ))),
            _ => Err(CliError::new(
                "invalid command",
                raw_command,
                ErrorStage::ParseCommand,
                parse_error.to_string(),
                vec!["onequery help".to_owned()],
            )),
        },
    }
}

fn render_help_parse_outcome(
    output_mode: EffectiveOutputMode,
    help: String,
) -> Result<ParseOutcome, CliError> {
    Ok(ParseOutcome::Display(TerminalOutput::new(
        render_help_text_output(output_mode, help),
    )))
}

fn render_help_text_output(output_mode: EffectiveOutputMode, help: String) -> CommandOutput {
    CommandOutput::structured(
        help.lines().map(str::to_owned).collect(),
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
