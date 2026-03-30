mod cli;
mod commands;
mod config;
mod credentials;
mod identifiers;
mod output;
mod output_metadata;
mod path_utils;
mod platform;
mod presentation;
#[cfg(test)]
mod test_support;
mod transport;
mod version;
mod workflows;

use std::io::IsTerminal;

use commands::Runtime;

#[tokio::main]
async fn main() {
    let argv: Vec<std::ffi::OsString> = std::env::args_os().collect();
    let stdout_is_tty = std::io::stdout().is_terminal();
    let fallback_output_mode =
        output::resolve_output_mode(cli::requested_output_from_args(&argv), stdout_is_tty);
    let parse_outcome = cli::parse_invocation_from_with_stdout_tty(&argv, stdout_is_tty);

    let invocation = match parse_outcome {
        Ok(cli::ParseOutcome::Invocation(invocation)) => {
            init_tracing(invocation.global.verbose);
            *invocation
        }
        Ok(cli::ParseOutcome::Display(display_output)) => {
            let rendered = output::render_output(display_output, fallback_output_mode);
            if !rendered.is_empty() {
                println!("{rendered}");
            }
            std::process::exit(0);
        }
        Err(error) => {
            emit_failure(
                &output::render_error(&error, fallback_output_mode),
                fallback_output_mode,
            );
            std::process::exit(error.exit_code());
        }
    };
    let output_mode = invocation.global.output_mode;

    let mut runtime = match Runtime::load(
        invocation.global.raw_config_overrides.clone(),
        config::TypedConfigOverrides::from_request_timeout_sec(invocation.global.timeout_sec),
    ) {
        Ok(runtime) => runtime,
        Err(error) => {
            emit_failure(&output::render_error(&error, output_mode), output_mode);
            std::process::exit(error.exit_code());
        }
    };

    match workflows::app::run(invocation, &mut runtime).await {
        Ok(command_output) => {
            let rendered = output::render_output(command_output, output_mode);
            if !rendered.is_empty() {
                println!("{rendered}");
            }
            std::process::exit(0);
        }
        Err(error) => {
            emit_failure(&output::render_error(&error, output_mode), output_mode);
            std::process::exit(error.exit_code());
        }
    }
}

fn emit_failure(rendered: &str, output_mode: output::EffectiveOutputMode) {
    if rendered.is_empty() {
        return;
    }

    match output_mode {
        output::EffectiveOutputMode::Json => println!("{rendered}"),
        output::EffectiveOutputMode::Text => eprintln!("{rendered}"),
    }
}

fn init_tracing(verbose: bool) {
    let default_level = if verbose { "info" } else { "warn" };
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(default_level));

    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}
