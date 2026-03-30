use insta::assert_snapshot;
use pretty_assertions::assert_eq;
use serde_json::json;
use onequery_cli_core::error::ErrorStage;

use crate::cli::SchemaCommandArgs;
use crate::cli::SchemaSubcommand;

use super::CLI_OPENAPI_JSON;
use super::DISCOVERY_SKILL_PATH;
use super::ROOT_SKILL_PATH;
use super::ReadControls;
use super::embedded_skill_schemas;
use super::execute;
use super::openapi::derive_public_http_command_schemas;
use super::openapi_document;
use super::public_command_schemas;
use super::registry::local_command_registry;
use super::render_json_output;

fn with_legacy_snapshot_path(test: impl FnOnce()) {
    let mut settings = insta::Settings::clone_current();
    settings.set_snapshot_path("../snapshots");
    settings.bind(test);
}

#[test]
fn schema_commands_snapshot() {
    let rendered = render_json_output(serde_json::json!({
        "commands": public_command_schemas().expect("expected command schemas"),
    }))
    .expect("expected schema command output")
    .lines
    .join("\n");

    with_legacy_snapshot_path(|| {
        assert_snapshot!(rendered);
    });
}

#[test]
fn schema_command_query_execute_snapshot() {
    let command = public_command_schemas()
        .expect("expected command schemas")
        .into_iter()
        .find(|command| command.command == "query execute")
        .expect("expected query execute command schema");

    let rendered = render_json_output(
        serde_json::to_value(command).expect("expected command schema serialization"),
    )
    .expect("expected schema command output")
    .lines
    .join("\n");

    with_legacy_snapshot_path(|| {
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

    with_legacy_snapshot_path(|| {
        assert_snapshot!(rendered);
    });
}

#[test]
fn local_command_registry_keeps_one_entry_per_local_command_path() {
    let commands = local_command_registry();
    let command_paths = commands
        .iter()
        .map(|entry| entry.command)
        .collect::<Vec<_>>();
    let unique_command_paths = command_paths
        .iter()
        .copied()
        .collect::<std::collections::BTreeSet<_>>();

    assert_eq!(command_paths.len(), unique_command_paths.len());
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
fn public_http_command_schemas_only_expose_flagged_operations() {
    let commands = derive_public_http_command_schemas(
        &openapi_document().expect("expected embedded OpenAPI document"),
    )
    .expect("expected HTTP command schemas");
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

#[test]
fn schema_openapi_matches_checked_in_document() {
    let parsed = openapi_document().expect("expected embedded OpenAPI document");
    let reparsed = serde_json::from_str::<serde_json::Value>(CLI_OPENAPI_JSON)
        .expect("expected checked-in OpenAPI document to parse");

    assert_eq!(parsed, reparsed);
}

#[test]
fn embedded_skill_output_includes_root_and_leaf_paths() {
    let paths = embedded_skill_schemas()
        .expect("expected embedded skills")
        .into_iter()
        .map(|skill| skill.path)
        .collect::<Vec<_>>();

    assert_eq!(
        (
            paths.contains(&ROOT_SKILL_PATH.to_owned()),
            paths.contains(&DISCOVERY_SKILL_PATH.to_owned()),
        ),
        (true, true)
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
                "oneq schema commands --output json".to_owned(),
                "use one of the listed command paths verbatim".to_owned(),
            ],
        )
    );
}

#[test]
fn http_backed_command_schemas_keep_expected_openapi_bindings() {
    let commands = public_command_schemas().expect("expected command schemas");
    let query_execute = commands
        .iter()
        .find(|command| command.command == "query execute")
        .expect("expected query execute command schema");

    assert_eq!(
        (
            query_execute.schema_source.as_str(),
            query_execute.http.as_ref().map(|http| http.path.as_str()),
        ),
        (
            "http-route",
            Some("/organizations/{orgSlug}/sources/{sourceKey}/queries:execute"),
        )
    );
}

#[test]
fn http_backed_command_schemas_expose_openapi_sanitization_profiles() {
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
fn http_backed_command_schemas_derive_capability_and_safety_metadata_from_openapi() {
    let mut spec = openapi_document().expect("expected embedded OpenAPI document");
    let operation = spec
        .get_mut("paths")
        .and_then(serde_json::Value::as_object_mut)
        .and_then(|paths| {
            paths.get_mut("/organizations/{orgSlug}/sources/{sourceKey}/queries:execute")
        })
        .and_then(serde_json::Value::as_object_mut)
        .and_then(|path_item| path_item.get_mut("post"))
        .and_then(serde_json::Value::as_object_mut)
        .expect("expected query execute operation");

    operation.insert(
        "x-onequery-command".to_owned(),
        serde_json::json!("query execute mutated"),
    );
    operation.insert("x-onequery-kind".to_owned(), serde_json::json!("mutate"));
    operation.insert(
        "x-onequery-read-controls".to_owned(),
        serde_json::json!({
            "fields": {
                "support": "unsupported",
                "unsupportedReason": "not_available",
            },
            "limit": {
                "support": "unsupported",
                "unsupportedReason": "not_paginated",
            },
            "cursor": {
                "support": "unsupported",
                "unsupportedReason": "not_paginated",
            },
            "sort": {
                "support": "unsupported",
                "unsupportedReason": "not_sortable",
            },
        }),
    );
    operation.insert(
        "x-onequery-supports-fields".to_owned(),
        serde_json::json!(false),
    );
    operation.insert(
        "x-onequery-supports-pagination".to_owned(),
        serde_json::json!(false),
    );
    operation.insert(
        "x-onequery-supports-dry-run".to_owned(),
        serde_json::json!(true),
    );
    operation.insert(
        "x-onequery-supports-raw-input".to_owned(),
        serde_json::json!(false),
    );
    operation.insert(
        "x-onequery-retryable-statuses".to_owned(),
        serde_json::json!([429, 503]),
    );
    operation.insert(
        "x-onequery-untrusted-response-paths".to_owned(),
        serde_json::json!(["$.data.items[*].body"]),
    );
    operation.insert(
        "x-onequery-sanitization-profile".to_owned(),
        serde_json::json!("default-v1"),
    );

    let schema = derive_public_http_command_schemas(&spec)
        .expect("expected command schema derivation")
        .into_iter()
        .find(|command| {
            command.http.as_ref().map(|http| http.path.as_str())
                == Some("/organizations/{orgSlug}/sources/{sourceKey}/queries:execute")
        })
        .expect("expected query execute HTTP command schema");

    assert_eq!(
        (
            schema.command,
            schema.kind,
            schema.read_controls,
            schema.supports_fields,
            schema.supports_pagination,
            schema.supports_dry_run,
            schema.supports_raw_input,
            schema.supports_headless_auth,
            schema.retryable_statuses,
            schema.untrusted_response_paths,
            schema.sanitization_profile,
        ),
        (
            "query execute mutated".to_owned(),
            "mutate".to_owned(),
            ReadControls::unsupported(),
            false,
            false,
            true,
            false,
            true,
            vec![429, 503],
            vec!["$.data.items[*].body".to_owned()],
            Some("default-v1".to_owned()),
        )
    );
}

#[test]
fn missing_http_command_exposure_metadata_fails_derivation() {
    let mut spec = openapi_document().expect("expected embedded OpenAPI document");
    let operation = spec
        .get_mut("paths")
        .and_then(serde_json::Value::as_object_mut)
        .and_then(|paths| paths.get_mut("/session"))
        .and_then(serde_json::Value::as_object_mut)
        .and_then(|path_item| path_item.get_mut("get"))
        .and_then(serde_json::Value::as_object_mut)
        .expect("expected session read operation");
    operation.remove("x-onequery-expose-command-schema");

    let error = derive_public_http_command_schemas(&spec)
        .expect_err("expected HTTP command derivation to fail without exposure metadata");

    assert_eq!(
        (error.title.clone(), error.stage),
        (
            "failed to derive HTTP command schema".to_owned(),
            ErrorStage::Render,
        )
    );
    assert_eq!(
        error.why,
        "x-onequery-expose-command-schema is missing from an embedded OpenAPI operation".to_owned()
    );
}
