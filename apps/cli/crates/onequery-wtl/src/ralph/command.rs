use crate::error::WtlError;

use super::cli::OutputFormat;
use super::cli::RalphCommand;
use super::cli::current_dir_override;
use super::orchestrator::RalphCommandResult;
use super::orchestrator::init_output;
use super::orchestrator::render_json;

pub async fn run_command(command: RalphCommand) -> Result<String, WtlError> {
    match command {
        RalphCommand::Init(args) => {
            let cwd = current_dir_override(args.cwd.clone());
            render_output(
                OutputFormat::resolve(args.output),
                init_output(super::init::run_init(&args, &cwd)?),
            )
        }
        RalphCommand::Run(args) => {
            let cwd = current_dir_override(args.cwd.clone());
            let result = super::orchestrator::run_main(&args, &cwd).await?;
            render_output(OutputFormat::resolve(args.output), result)
        }
    }
}

fn render_output<T>(output: OutputFormat, value: T) -> Result<String, WtlError>
where
    T: serde::Serialize,
{
    match output {
        // Comment: Ralph still exposes one machine-readable summary shape for
        // both CLI output modes; keep rendering centralized here so the
        // binary entrypoint does not need to know that compatibility detail.
        OutputFormat::Text | OutputFormat::Json => render_json(&value),
    }
}

impl serde::Serialize for RalphCommandResult {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            Self::DryRun(result) => serde::Serialize::serialize(result, serializer),
            Self::Completed(result) => serde::Serialize::serialize(result, serializer),
        }
    }
}
