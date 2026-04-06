use insta::assert_snapshot;
use onequery_cli_core::error::ErrorStage;
use pretty_assertions::assert_eq;
use serde_json::json;

use crate::cli::SchemaCommandArgs;
use crate::cli::SchemaSubcommand;
use crate::commands::with_command_snapshot_path;

use super::embedded_skill_schemas;
use super::execute;
use super::public_command_schemas;
use super::registry::local_command_registry;
use super::render_json_output;
use super::transport_command_schemas;

#[test]
fn schema_commands_snapshot() {
    let rendered = render_json_output(serde_json::json!({
        "commands": public_command_schemas().expect("expected command schemas"),
    }))
    .expect("expected schema command output")
    .lines
    .join("\n");

    with_command_snapshot_path(|| {
        assert_snapshot!(rendered);
    });
}

#[tokio::test(flavor = "current_thread")]
async fn schema_command_query_execute_snapshot() {
    let rendered = execute(&SchemaSubcommand::Command(SchemaCommandArgs {
        path: vec!["query".to_owned(), "execute".to_owned()],
    }))
    .await
    .expect("expected query execute schema command output")
    .lines
    .join("\n");

    with_command_snapshot_path(|| {
        assert_snapshot!(rendered);
    });
}

#[test]
fn schema_skills_snapshot() {
    let rendered = render_json_output(serde_json::json!({
        "skills": embedded_skill_schemas().expect("expected embedded skills"),
    }))
    .expect("expected schema skills output")
    .lines
    .join("\n");

    with_command_snapshot_path(|| {
        assert_snapshot!(rendered);
    });
}

#[test]
fn local_discovery_command_schemas_describe_nested_output_shapes() {
    let commands = local_command_registry();
    let schema_commands = commands
        .iter()
        .find(|entry| entry.command == "schema commands")
        .expect("expected schema commands registry entry");
    let schema_command = commands
        .iter()
        .find(|entry| entry.command == "schema command")
        .expect("expected schema command registry entry");
    let schema_skills = commands
        .iter()
        .find(|entry| entry.command == "schema skills")
        .expect("expected schema skills registry entry");

    assert_eq!(
        (
            schema_commands
                .output_schema
                .pointer("/properties/commands/items/additionalProperties")
                .cloned(),
            schema_commands
                .output_schema
                .pointer(
                    "/properties/commands/items/properties/authRequirements/properties/orgScoped"
                )
                .cloned(),
            schema_command
                .output_schema
                .pointer("/properties/http/properties/operationId")
                .cloned(),
            schema_command
                .output_schema
                .pointer("/properties/readControls/properties/fields/properties/support/enum")
                .cloned(),
            schema_command
                .output_schema
                .pointer(
                    "/properties/readControls/properties/sort/properties/unsupportedReason/type"
                )
                .cloned(),
            schema_command
                .output_schema
                .pointer("/properties/supportsHeadlessAuth")
                .cloned(),
            schema_skills
                .output_schema
                .pointer("/properties/skills/items/properties/guardrails/items")
                .cloned(),
            schema_skills
                .output_schema
                .pointer("/properties/skills/items/properties/rootSkill")
                .cloned(),
        ),
        (
            Some(json!(false)),
            Some(json!({ "type": "boolean" })),
            Some(json!({ "type": "string" })),
            Some(json!(["supported", "unsupported"])),
            Some(json!(["string", "null"])),
            Some(json!({ "type": "boolean" })),
            Some(json!({ "type": "string" })),
            Some(json!({ "type": ["string", "null"] })),
        )
    );
}

#[test]
fn transport_command_registry_lists_public_remote_commands_only() {
    let commands = transport_command_schemas().expect("expected transport command schemas");
    let command_paths = commands
        .iter()
        .map(|command| command.command.as_str())
        .collect::<Vec<_>>();

    assert_eq!(
        (
            command_paths.contains(&"auth session refresh"),
            command_paths.contains(&"query execute"),
            command_paths.contains(&"source connect"),
            command_paths.contains(&"auth login start"),
            command_paths.contains(&"auth login poll"),
        ),
        (true, true, true, false, false)
    );
}

#[test]
fn public_command_schemas_expose_headless_auth_capabilities() {
    let commands = public_command_schemas().expect("expected command schemas");
    let auth_login = commands
        .iter()
        .find(|command| command.command == "auth login")
        .expect("expected auth login command schema");
    let query_execute = commands
        .iter()
        .find(|command| command.command == "query execute")
        .expect("expected query execute command schema");
    let schema_commands = commands
        .iter()
        .find(|command| command.command == "schema commands")
        .expect("expected schema commands command schema");
    let serve_status = commands
        .iter()
        .find(|command| command.command == "serve status")
        .expect("expected serve status command schema");

    assert_eq!(
        (
            auth_login.supports_headless_auth,
            query_execute.supports_headless_auth,
            schema_commands.supports_headless_auth,
            serve_status.supports_headless_auth,
        ),
        (false, true, true, true)
    );
}

#[tokio::test(flavor = "current_thread")]
async fn execute_schema_commands_returns_command_listing_payload() {
    let output = execute(&SchemaSubcommand::Commands)
        .await
        .expect("expected schema commands output");
    let data = output.into_data();

    let commands = data
        .get("commands")
        .and_then(serde_json::Value::as_array)
        .expect("expected commands array");

    assert_eq!(
        (
            commands.is_empty(),
            commands.iter().any(|command| {
                command.get("command").and_then(serde_json::Value::as_str) == Some("query execute")
            }),
            commands.iter().any(|command| {
                command.get("command").and_then(serde_json::Value::as_str)
                    == Some("auth session refresh")
            }),
            commands.iter().any(|command| {
                command.get("command").and_then(serde_json::Value::as_str) == Some("serve status")
            }),
        ),
        (false, true, true, true)
    );
}

#[tokio::test(flavor = "current_thread")]
async fn execute_schema_command_reports_unknown_public_paths() {
    let error = execute(&SchemaSubcommand::Command(SchemaCommandArgs {
        path: vec!["query".to_owned(), "missing".to_owned()],
    }))
    .await
    .expect_err("expected unknown schema command path to fail");

    assert_eq!(
        (error.title.clone(), error.stage, error.try_next.clone()),
        (
            "unknown command schema".to_owned(),
            ErrorStage::ParseCommand,
            vec![
                "onequery schema commands --output json".to_owned(),
                "use one of the listed command paths verbatim".to_owned(),
            ],
        )
    );
}

#[test]
fn transport_backed_command_schemas_use_the_local_registry_source() {
    let commands = public_command_schemas().expect("expected command schemas");
    let query_execute = commands
        .iter()
        .find(|command| command.command == "query execute")
        .expect("expected query execute command schema");

    assert_eq!(
        (
            query_execute.schema_source.as_str(),
            query_execute.http.is_none(),
        ),
        ("command-registry", true)
    );
}

#[test]
fn transport_command_schemas_expose_sanitization_profiles() {
    let commands = public_command_schemas().expect("expected command schemas");

    let mut sanitization_profiles = commands
        .iter()
        .filter_map(|command| {
            ["query execute", "query validate"]
                .contains(&command.command.as_str())
                .then_some({
                    (
                        command.command.as_str(),
                        command.sanitization_profile.as_deref(),
                    )
                })
        })
        .collect::<Vec<_>>();
    sanitization_profiles.sort_unstable_by_key(|(command, _)| *command);

    assert_eq!(
        sanitization_profiles,
        vec![
            ("query execute", Some("default-v1")),
            ("query validate", None),
        ]
    );
}

#[test]
fn transport_command_schemas_preserve_capability_and_safety_metadata() {
    let schema = transport_command_schemas()
        .expect("expected command schema registry")
        .into_iter()
        .find(|command| command.command == "query execute")
        .expect("expected query execute command schema");

    assert_eq!(
        (
            schema.kind,
            schema.read_controls.fields.support,
            schema.read_controls.limit.support,
            schema.retryable_statuses,
            schema.untrusted_response_paths,
            schema.sanitization_profile,
            schema.supports_raw_input,
            schema.supports_headless_auth,
            schema.http,
        ),
        (
            "read".to_owned(),
            super::ReadControlSupport::Supported,
            super::ReadControlSupport::Supported,
            vec![503, 504],
            vec![
                "$.data.columns[*].name".to_owned(),
                "$.data.rows[*][*]".to_owned(),
            ],
            Some("default-v1".to_owned()),
            true,
            true,
            None,
        )
    );
}
