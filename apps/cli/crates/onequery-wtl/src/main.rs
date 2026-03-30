use clap::Parser;
use onequery_wtl::cli::Cli;
use onequery_wtl::engine::RunTerminalState;

#[tokio::main]
async fn main() {
    init_tracing();

    let cli = Cli::parse();

    let exit_code = match onequery_wtl::app::run_cli(cli).await {
        Ok(RunTerminalState::Completed) => 0,
        Ok(RunTerminalState::Exhausted { .. }) => 1,
        Ok(RunTerminalState::Interrupted) => 130,
        Err(error) => {
            eprintln!("Error: {error}");
            1
        }
    };

    std::process::exit(exit_code);
}

fn init_tracing() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_target(false)
        .try_init();
}
