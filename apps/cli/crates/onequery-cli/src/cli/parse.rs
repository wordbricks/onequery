use std::ffi::OsString;

#[cfg(test)]
use std::io::IsTerminal;

use clap::CommandFactory;
use clap::Parser;
use clap::error::ErrorKind;

use crate::output::CommandOutput;
use crate::output::EffectiveOutputMode;
use crate::output::resolve_output_mode;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use onequery_config::parse_cli_overrides;

use super::model::GlobalOptions;
use super::model::Invocation;
use super::model::ParseOutcome;
use super::normalize::normalize_command_line;
use super::normalize::requested_output_from_args;
use super::raw::RawCli;

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

    match RawCli::try_parse_from(args) {
        Ok(raw_cli) => parse_raw_cli(raw_cli, raw_command, stdout_is_tty),
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
                vec!["onequery help".to_owned()],
            )),
        },
    }
}

fn parse_raw_cli(
    raw_cli: RawCli,
    raw_command: String,
    stdout_is_tty: bool,
) -> Result<ParseOutcome, CliError> {
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
            request_id: trimmed_non_empty_owned(request_id),
            timeout_sec,
            output_mode,
            verbose,
        },
        command: command.into(),
    })))
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
                vec!["onequery help".to_owned()],
            )
        })?;
    Ok(String::from_utf8_lossy(&help_buffer).into_owned())
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

fn trimmed_non_empty_owned(value: Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}
