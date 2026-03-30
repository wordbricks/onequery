use std::path::PathBuf;

use crate::cli::Cli;
use crate::cli::Command;
use crate::cli::RunArgs;
use crate::engine::EngineConfig;
use crate::engine::RunTerminalState;
use crate::error::WtlError;
use crate::observer::CliObserver;
use crate::policy::SimpleLoopPolicy;
use crate::runtime::codex_app_server::CodexAppServerRuntime;
use crate::runtime::codex_app_server::CodexRuntimeConfig;

pub async fn run_cli(cli: Cli) -> Result<RunTerminalState, WtlError> {
    run_command(cli.command).await
}

pub async fn run_command(command: Command) -> Result<RunTerminalState, WtlError> {
    match command {
        Command::Run(args) => run_single_request(args).await,
    }
}

async fn run_single_request(args: RunArgs) -> Result<RunTerminalState, WtlError> {
    let request = crate::cli::read_initial_request().await?;
    let mut runtime = CodexAppServerRuntime::connect(resolve_runtime_config()).await?;
    let mut observer = CliObserver::new(std::io::stdout());

    crate::engine::run(
        EngineConfig {
            max_iter: args.max_iter,
            max_retry: args.max_retry,
        },
        SimpleLoopPolicy::new(request),
        &mut runtime,
        &mut observer,
    )
    .await
}

fn resolve_runtime_config() -> CodexRuntimeConfig {
    CodexRuntimeConfig::from_env(resolve_current_dir())
}

fn resolve_current_dir() -> PathBuf {
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from("."))
}
