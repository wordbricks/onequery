mod skills;

#[cfg(test)]
mod tests;

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use serde::Serialize;
use serde_json::Value;
use serde_json::json;

use crate::cli::SchemaSubcommand;
use crate::output::CommandOutput;

use self::skills::embedded_skill_schemas;

const ROOT_SKILL_PATH: &str = "apps/cli/docs/skills/SKILL.md";
const ROOT_SKILL_CONTENT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../docs/skills/SKILL.md"
));
const DISCOVERY_SKILL_PATH: &str = "apps/cli/docs/skills/discovery.md";
const DISCOVERY_SKILL_CONTENT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../docs/skills/discovery.md"
));
const QUERY_SKILL_PATH: &str = "apps/cli/docs/skills/query.md";
const QUERY_SKILL_CONTENT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../docs/skills/query.md"
));
const MUTATION_SKILL_PATH: &str = "apps/cli/docs/skills/mutation.md";
const MUTATION_SKILL_CONTENT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../docs/skills/mutation.md"
));

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SkillSchema {
    name: String,
    description: String,
    kind: String,
    path: String,
    root_skill: Option<String>,
    guardrails: Vec<String>,
}

#[derive(Debug, Clone, Copy)]
struct EmbeddedSkill {
    kind: &'static str,
    path: &'static str,
    root_skill: Option<&'static str>,
    content: &'static str,
}

pub(super) async fn execute(command: &SchemaSubcommand) -> Result<CommandOutput, CliError> {
    match command {
        SchemaSubcommand::Skills => render_json_output(json!({
            "skills": embedded_skill_schemas()?,
        })),
    }
}

fn render_json_output(data: Value) -> Result<CommandOutput, CliError> {
    let rendered = serde_json::to_string_pretty(&data).map_err(|serialize_error| {
        CliError::new(
            "failed to render schema output",
            "onequery schema".to_owned(),
            ErrorStage::Render,
            serialize_error.to_string(),
            vec!["retry onequery schema with the same arguments".to_owned()],
        )
    })?;

    Ok(CommandOutput::structured(
        rendered.lines().map(ToOwned::to_owned).collect(),
        data,
    ))
}
