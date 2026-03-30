use std::collections::BTreeSet;

mod openapi;
mod registry;
mod skills;

#[cfg(test)]
mod tests;

use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;
use serde_json::json;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;

use crate::cli::SchemaSubcommand;
use crate::output::CommandOutput;

use self::openapi::derive_public_http_command_schemas;
use self::registry::local_command_registry;
use self::skills::embedded_skill_schemas;

const CLI_OPENAPI_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../../packages/cli-contract/openapi/generated/cli.openapi.json"
));
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

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
struct AuthRequirements {
    authenticated: bool,
    modes: Vec<String>,
    org_scoped: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
enum ReadControlSupport {
    Supported,
    Unsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
enum UnsupportedReadControlReason {
    #[serde(rename = "not_available")]
    Unavailable,
    #[serde(rename = "not_paginated")]
    Unpaginated,
    #[serde(rename = "not_sortable")]
    Unsortable,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ReadControl {
    support: ReadControlSupport,
    unsupported_reason: Option<UnsupportedReadControlReason>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ReadControls {
    fields: ReadControl,
    limit: ReadControl,
    cursor: ReadControl,
    sort: ReadControl,
}

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
struct HttpOperation {
    method: String,
    path: String,
    operation_id: String,
}

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
struct CommandSchema {
    command: String,
    kind: String,
    summary: String,
    selector_schema: Value,
    input_schema: Value,
    output_schema: Value,
    read_controls: ReadControls,
    supports_output_modes: Vec<String>,
    supports_fields: bool,
    supports_pagination: bool,
    supports_dry_run: bool,
    supports_raw_input: bool,
    supports_headless_auth: bool,
    auth_requirements: AuthRequirements,
    error_codes: Vec<String>,
    retryable_statuses: Vec<u16>,
    untrusted_response_paths: Vec<String>,
    sanitization_profile: Option<String>,
    required_org_role: Option<String>,
    schema_source: String,
    http: Option<HttpOperation>,
}

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

#[derive(Debug, Clone)]
struct LocalCommandRegistryEntry {
    command: &'static str,
    kind: &'static str,
    summary: &'static str,
    selector_schema: Value,
    input_schema: Value,
    output_schema: Value,
    read_controls: ReadControls,
    supports_output_modes: &'static [&'static str],
    supports_fields: bool,
    supports_pagination: bool,
    supports_dry_run: bool,
    supports_raw_input: bool,
    auth_requirements: AuthRequirements,
    error_codes: &'static [&'static str],
    required_org_role: Option<&'static str>,
}

#[derive(Debug, Clone, Copy)]
struct EmbeddedSkill {
    kind: &'static str,
    path: &'static str,
    root_skill: Option<&'static str>,
    content: &'static str,
}

impl ReadControl {
    fn unsupported(reason: UnsupportedReadControlReason) -> Self {
        Self {
            support: ReadControlSupport::Unsupported,
            unsupported_reason: Some(reason),
        }
    }
}

impl ReadControls {
    pub(super) fn unsupported() -> Self {
        Self {
            fields: ReadControl::unsupported(UnsupportedReadControlReason::Unavailable),
            limit: ReadControl::unsupported(UnsupportedReadControlReason::Unpaginated),
            cursor: ReadControl::unsupported(UnsupportedReadControlReason::Unpaginated),
            sort: ReadControl::unsupported(UnsupportedReadControlReason::Unsortable),
        }
    }

    pub(super) fn supports_fields(&self) -> bool {
        self.fields.support == ReadControlSupport::Supported
    }

    pub(super) fn supports_pagination(&self) -> bool {
        self.limit.support == ReadControlSupport::Supported
            || self.cursor.support == ReadControlSupport::Supported
    }
}

fn supports_headless_auth(command: &str, auth_requirements: &AuthRequirements) -> bool {
    // Comment: `auth login` is the only current public command that requires an
    // interactive browser hop, so it must stay false even though it does not
    // require a pre-existing authenticated session.
    if command == "auth login" {
        return false;
    }

    !auth_requirements.authenticated
        || auth_requirements
            .modes
            .iter()
            .any(|mode| mode == "bearer_token")
}

pub(super) async fn execute(command: &SchemaSubcommand) -> Result<CommandOutput, CliError> {
    match command {
        SchemaSubcommand::Openapi => render_json_output(openapi_document()?),
        SchemaSubcommand::Commands => render_json_output(json!({
            "commands": public_command_schemas()?,
        })),
        SchemaSubcommand::Command(args) => {
            let requested_command = normalize_command_path(args.path.join(" ").as_str());
            let command_schema = public_command_schemas()?
                .into_iter()
                .find(|schema| schema.command == requested_command)
                .ok_or_else(|| {
                    CliError::new(
                        "unknown command schema",
                        format!("oneq schema command {}", args.path.join(" ")),
                        ErrorStage::ParseCommand,
                        format!("no public command schema exists for \"{requested_command}\""),
                        vec![
                            "oneq schema commands --output json".to_owned(),
                            "use one of the listed command paths verbatim".to_owned(),
                        ],
                    )
                })?;
            render_json_output(
                serde_json::to_value(command_schema).map_err(|serialize_error| {
                    CliError::new(
                        "failed to render schema command output",
                        format!("oneq schema command {}", args.path.join(" ")),
                        ErrorStage::Render,
                        serialize_error.to_string(),
                        vec!["retry oneq schema command with the same path".to_owned()],
                    )
                })?,
            )
        }
        SchemaSubcommand::Skills => render_json_output(json!({
            "skills": embedded_skill_schemas()?,
        })),
    }
}

fn render_json_output(data: Value) -> Result<CommandOutput, CliError> {
    let rendered = serde_json::to_string_pretty(&data).map_err(|serialize_error| {
        CliError::new(
            "failed to render schema output",
            "oneq schema".to_owned(),
            ErrorStage::Render,
            serialize_error.to_string(),
            vec!["retry oneq schema with the same arguments".to_owned()],
        )
    })?;

    Ok(CommandOutput::structured(
        rendered.lines().map(ToOwned::to_owned).collect(),
        data,
    ))
}

fn openapi_document() -> Result<Value, CliError> {
    serde_json::from_str(CLI_OPENAPI_JSON).map_err(|parse_error| {
        CliError::new(
            "failed to load embedded OpenAPI document",
            "oneq schema openapi".to_owned(),
            ErrorStage::Render,
            parse_error.to_string(),
            vec!["rebuild oneq with a valid checked-in OpenAPI document".to_owned()],
        )
    })
}

fn public_command_schemas() -> Result<Vec<CommandSchema>, CliError> {
    let spec = openapi_document()?;
    let mut commands = local_command_registry()
        .into_iter()
        .map(|entry| {
            let supports_headless_auth =
                supports_headless_auth(entry.command, &entry.auth_requirements);

            CommandSchema {
                command: entry.command.to_owned(),
                kind: entry.kind.to_owned(),
                summary: entry.summary.to_owned(),
                selector_schema: entry.selector_schema,
                input_schema: entry.input_schema,
                output_schema: entry.output_schema,
                read_controls: entry.read_controls,
                supports_output_modes: entry
                    .supports_output_modes
                    .iter()
                    .map(|mode| (*mode).to_owned())
                    .collect(),
                supports_fields: entry.supports_fields,
                supports_pagination: entry.supports_pagination,
                supports_dry_run: entry.supports_dry_run,
                supports_raw_input: entry.supports_raw_input,
                supports_headless_auth,
                auth_requirements: entry.auth_requirements,
                error_codes: entry
                    .error_codes
                    .iter()
                    .map(|code| (*code).to_owned())
                    .collect(),
                retryable_statuses: Vec::new(),
                untrusted_response_paths: Vec::new(),
                sanitization_profile: None,
                required_org_role: entry.required_org_role.map(ToOwned::to_owned),
                schema_source: "local-registry".to_owned(),
                http: None,
            }
        })
        .collect::<Vec<_>>();
    commands.extend(derive_public_http_command_schemas(&spec)?);
    ensure_unique_public_command_paths(&commands)?;
    commands.sort_by(|left, right| left.command.cmp(&right.command));
    Ok(commands)
}

fn ensure_unique_public_command_paths(commands: &[CommandSchema]) -> Result<(), CliError> {
    let mut seen = BTreeSet::new();

    for command in commands {
        if !seen.insert(command.command.as_str()) {
            return Err(CliError::new(
                "failed to derive command schemas",
                "oneq schema commands".to_owned(),
                ErrorStage::Render,
                format!("duplicate public command schema for {}", command.command),
                vec!["rebuild oneq with a consistent command contract".to_owned()],
            ));
        }
    }

    Ok(())
}

fn normalize_command_path(raw: &str) -> String {
    raw.split_whitespace().collect::<Vec<_>>().join(" ")
}
