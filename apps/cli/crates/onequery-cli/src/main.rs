mod cli;
mod commands;
mod config;
mod credentials;
mod diagnostics;
pub mod exit_status;
mod explain;
mod identifiers;
mod issue_report;
mod local_target;
mod output;
mod output_metadata;
mod platform;
mod presentation;
mod profile;
mod recovery;
mod startup;
#[cfg(test)]
mod test_support;
mod transport;
mod version;
mod workflows;
pub mod wsl_paths;

use std::io::IsTerminal;
use std::io::Write;

use chrono::Utc;
use commands::Runtime;

// Comment: the CLI does not need a work-stealing runtime; an explicit current-thread executor
// keeps the async model deliberate while still supporting spawned background tasks and
// `spawn_blocking` for isolated blocking work.
#[tokio::main(flavor = "current_thread")]
async fn main() {
    let argv: Vec<std::ffi::OsString> = std::env::args_os().collect();
    let stdout_is_tty = std::io::stdout().is_terminal();
    let fallback_output_mode = output::resolve_output_mode(
        cli::requested_output_mode_from_args(&argv),
        output::StdoutTarget::from_is_terminal(stdout_is_tty),
    );
    let fallback_verbose = cli::requested_verbose_from_args(&argv);
    let parse_outcome = cli::parse_invocation_from_with_stdout_tty(&argv, stdout_is_tty);

    let invocation = match parse_outcome {
        Ok(cli::ParseOutcome::Invocation(invocation)) => {
            init_tracing(invocation.global.verbose);
            *invocation
        }
        Ok(cli::ParseOutcome::Display(display_output)) => {
            match output::render_output_payload(
                display_output.into_inner(),
                fallback_output_mode,
                stdout_is_tty,
            ) {
                Ok(rendered) => {
                    if let Err(error) = emit_success(rendered) {
                        exit_for_output_error(error);
                    }
                }
                Err(error) => {
                    emit_failure_and_exit(
                        error,
                        fallback_output_mode,
                        None,
                        true,
                        fallback_verbose,
                    );
                }
            }
            std::process::exit(0);
        }
        Err(error) => {
            emit_failure_and_exit(error, fallback_output_mode, None, true, fallback_verbose)
        }
    };
    let output_mode = invocation.global.output_mode;
    let command_path = invocation.command.command_path();
    let persist_failures = invocation.command.should_persist_failures();
    let verbose_errors = invocation.global.verbose;
    let profile = match profile::SelectedProfile::resolve(
        invocation.global.profile.as_deref(),
        &invocation.raw_command,
    ) {
        Ok(profile) => profile,
        Err(error) => emit_failure_and_exit(
            error.with_command_path(Some(command_path.to_owned())),
            output_mode,
            Some(command_path),
            persist_failures,
            verbose_errors,
        ),
    };
    tracing::info!(
        profile = profile.name(),
        profile_source = profile.source().describe(),
        "profile resolved"
    );

    if !invocation.command.requires_runtime() {
        // Comment: `doctor report` must still work when config loading is broken, so
        // diagnostics commands bypass `Runtime::load` and read the saved snapshot directly.
        let command_output = match commands::execute_without_runtime(&invocation) {
            Ok(command_output) => command_output.with_command(command_path),
            Err(error) => emit_failure_and_exit(
                error.with_command_path(Some(command_path.to_owned())),
                output_mode,
                Some(command_path),
                persist_failures,
                verbose_errors,
            ),
        };

        match output::render_output_payload(command_output, output_mode, stdout_is_tty) {
            Ok(rendered) => {
                if let Err(error) = emit_success(rendered) {
                    exit_for_output_error(error);
                }
                std::process::exit(0);
            }
            Err(error) => emit_failure_and_exit(
                error.with_command_path(Some(command_path.to_owned())),
                output_mode,
                Some(command_path),
                persist_failures,
                verbose_errors,
            ),
        }
    }

    let mut runtime = match Runtime::load(
        invocation.global.raw_config_overrides.clone(),
        config::TypedConfigOverrides::from_request_timeout_sec(invocation.global.timeout_sec),
        &profile,
    ) {
        Ok(runtime) => runtime,
        Err(error) => emit_failure_and_exit(
            error.with_command_path(Some(command_path.to_owned())),
            output_mode,
            Some(command_path),
            persist_failures,
            verbose_errors,
        ),
    };
    let startup_effects = startup::start(startup::plan(runtime.config.path()));

    let exit_code = match workflows::app::run(invocation, &mut runtime).await {
        Ok(command_output) => {
            match output::render_output_payload(command_output, output_mode, stdout_is_tty) {
                Ok(rendered) => {
                    if let Err(error) = emit_success(rendered) {
                        exit_for_output_error(error);
                    }
                    0
                }
                Err(error) => emit_failure_exit_code(
                    error.with_command_path(Some(command_path.to_owned())),
                    output_mode,
                    Some(command_path),
                    persist_failures,
                    verbose_errors,
                ),
            }
        }
        Err(error) => emit_failure_exit_code(
            error.with_command_path(Some(command_path.to_owned())),
            output_mode,
            Some(command_path),
            persist_failures,
            verbose_errors,
        ),
    };
    startup_effects.finish().await.report();
    std::process::exit(exit_code);
}

fn emit_failure_and_exit(
    error: onequery_core::error::CliError,
    output_mode: output::EffectiveOutputMode,
    command_path: Option<&str>,
    persist_failure: bool,
    verbose_errors: bool,
) -> ! {
    std::process::exit(emit_failure_exit_code(
        error,
        output_mode,
        command_path,
        persist_failure,
        verbose_errors,
    ));
}

fn emit_failure_exit_code(
    error: onequery_core::error::CliError,
    output_mode: output::EffectiveOutputMode,
    command_path: Option<&str>,
    persist_failure: bool,
    verbose_errors: bool,
) -> i32 {
    persist_failure_if_needed(&error, command_path, persist_failure);
    if let Err(write_error) = emit_failure(
        &output::render_error_with_verbosity(&error, output_mode, verbose_errors),
        output_mode,
    ) {
        exit_for_output_error(write_error);
    }
    error.exit_code()
}

fn persist_failure_if_needed(
    error: &onequery_core::error::CliError,
    command_path: Option<&str>,
    persist_failure: bool,
) {
    if !persist_failure {
        return;
    }

    let command_line = error.command.as_str();
    let paths = match diagnostics::DiagnosticsPaths::resolve(command_line) {
        Ok(paths) => paths,
        Err(persist_error) => {
            tracing::info!(error = %persist_error, "diagnostic persistence path resolution failed");
            return;
        }
    };

    if let Err(persist_error) =
        diagnostics::persist_last_error(&paths, command_line, error, command_path, Utc::now())
    {
        tracing::info!(error = %persist_error, "diagnostic persistence failed");
    }
}

fn emit_success(rendered: output::RenderedOutput) -> std::io::Result<()> {
    match rendered {
        output::RenderedOutput::Text(rendered) => {
            if !rendered.is_empty() {
                let mut stdout = std::io::stdout().lock();
                writeln!(stdout, "{rendered}")?;
            }
            Ok(())
        }
        output::RenderedOutput::VerbatimText(rendered) => {
            if rendered.is_empty() {
                return Ok(());
            }

            let mut stdout = std::io::stdout().lock();
            stdout.write_all(rendered.as_bytes())?;
            stdout.flush()
        }
        output::RenderedOutput::Binary(rendered) => {
            if rendered.is_empty() {
                return Ok(());
            }

            let mut stdout = std::io::stdout().lock();
            stdout.write_all(&rendered)?;
            stdout.flush()
        }
    }
}

fn emit_failure(rendered: &str, output_mode: output::EffectiveOutputMode) -> std::io::Result<()> {
    if rendered.is_empty() {
        return Ok(());
    }

    match output_mode {
        output::EffectiveOutputMode::Json => {
            let mut stdout = std::io::stdout().lock();
            writeln!(stdout, "{rendered}")
        }
        output::EffectiveOutputMode::Text => {
            let mut stderr = std::io::stderr().lock();
            writeln!(stderr, "{rendered}")
        }
    }
}

fn exit_for_output_error(error: std::io::Error) -> ! {
    if error.kind() == std::io::ErrorKind::BrokenPipe {
        std::process::exit(0);
    }

    let _ = writeln!(
        std::io::stderr().lock(),
        "onequery: failed to write output: {error}"
    );
    std::process::exit(1);
}

fn init_tracing(verbose: bool) {
    // Comment: stdout belongs to command results, so shared tracing must stay on stderr.
    let subscriber = build_tracing_subscriber(verbose, std::io::stderr);
    let _ = tracing::subscriber::set_global_default(subscriber);
}

fn build_tracing_subscriber<W>(verbose: bool, writer: W) -> impl tracing::Subscriber + Send + Sync
where
    W: for<'writer> tracing_subscriber::fmt::MakeWriter<'writer> + Send + Sync + 'static,
{
    let default_level = if verbose { "info" } else { "warn" };
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(default_level));

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .with_writer(writer)
        .finish()
}

#[cfg(test)]
mod tests {
    use std::io;
    use std::sync::Arc;
    use std::sync::Mutex;

    use tracing_subscriber::fmt::MakeWriter;

    #[derive(Clone, Default)]
    struct SharedLogWriter {
        buffer: Arc<Mutex<Vec<u8>>>,
    }

    struct SharedLogHandle {
        buffer: Arc<Mutex<Vec<u8>>>,
    }

    impl SharedLogWriter {
        fn contents(&self) -> String {
            String::from_utf8(self.buffer.lock().expect("lock log buffer").clone())
                .expect("log output should be valid UTF-8")
        }
    }

    impl<'a> MakeWriter<'a> for SharedLogWriter {
        type Writer = SharedLogHandle;

        fn make_writer(&'a self) -> Self::Writer {
            SharedLogHandle {
                buffer: Arc::clone(&self.buffer),
            }
        }
    }

    impl io::Write for SharedLogHandle {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.buffer
                .lock()
                .expect("lock log buffer")
                .extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn tracing_subscriber_writes_logs_to_the_configured_writer() {
        let _subscriber_lock = crate::test_support::lock_tracing_subscriber();
        let log_writer = SharedLogWriter::default();
        let subscriber = super::build_tracing_subscriber(false, log_writer.clone());
        let _guard = tracing::subscriber::set_default(subscriber);
        tracing::callsite::rebuild_interest_cache();

        tracing::warn!("failed to refresh CLI version cache");

        assert!(
            log_writer
                .contents()
                .contains("failed to refresh CLI version cache")
        );
    }
}
