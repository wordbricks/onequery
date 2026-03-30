use onequery_wtl::error::WtlError;
use onequery_wtl::ralph::cli::OutputFormat;
use onequery_wtl::ralph::cli::RalphCommand;
use onequery_wtl::ralph::cli::current_dir_override;
use onequery_wtl::ralph::orchestrator::RalphCommandResult;
use onequery_wtl::ralph::orchestrator::init_output;
use onequery_wtl::ralph::orchestrator::render_json;

#[tokio::main]
async fn main() {
    let command = onequery_wtl::ralph::cli::parse();

    let exit_code = match run(command).await {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("Error: {error}");
            1
        }
    };

    std::process::exit(exit_code);
}

async fn run(command: RalphCommand) -> Result<(), WtlError> {
    match command {
        RalphCommand::Init(args) => {
            let cwd = current_dir_override(args.cwd.clone());
            let output = OutputFormat::resolve(args.output);
            let result = onequery_wtl::ralph::init::run_init(&args, &cwd)?;
            match output {
                OutputFormat::Text | OutputFormat::Json => {
                    println!("{}", render_json(&init_output(result))?);
                }
            }
        }
        RalphCommand::Run(args) => {
            let cwd = current_dir_override(args.cwd.clone());
            let output = OutputFormat::resolve(args.output);
            let result = onequery_wtl::ralph::orchestrator::run_main(&args, &cwd).await?;
            match (output, result) {
                (OutputFormat::Text | OutputFormat::Json, RalphCommandResult::DryRun(result)) => {
                    println!("{}", render_json(&result)?);
                }
                (
                    OutputFormat::Text | OutputFormat::Json,
                    RalphCommandResult::Completed(result),
                ) => {
                    println!("{}", render_json(&result)?);
                }
            }
        }
    }

    Ok(())
}
