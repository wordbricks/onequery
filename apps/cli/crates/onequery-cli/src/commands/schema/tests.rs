use insta::assert_snapshot;
use pretty_assertions::assert_eq;

use crate::cli::SchemaSubcommand;
use crate::commands::with_command_snapshot_path;

use super::embedded_skill_schemas;
use super::execute;
use super::render_json_output;

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
fn embedded_skill_schemas_describe_root_and_leaf_skill_links() {
    let skills = embedded_skill_schemas().expect("expected embedded skills");

    assert_eq!(
        skills
            .iter()
            .map(|skill| {
                (
                    skill.name.as_str(),
                    skill.kind.as_str(),
                    skill.root_skill.as_deref(),
                )
            })
            .collect::<Vec<_>>(),
        vec![
            ("onequery-cli", "root", None),
            (
                "onequery-cli-discovery",
                "leaf",
                Some("apps/cli/docs/skills/SKILL.md")
            ),
            (
                "onequery-cli-mutation",
                "leaf",
                Some("apps/cli/docs/skills/SKILL.md")
            ),
            (
                "onequery-cli-query",
                "leaf",
                Some("apps/cli/docs/skills/SKILL.md")
            ),
        ]
    );
}

#[tokio::test(flavor = "current_thread")]
async fn execute_schema_skills_returns_skill_listing_payload() {
    let output = execute(&SchemaSubcommand::Skills)
        .await
        .expect("expected schema skills output");
    let data = output.into_data();

    let skills = data
        .get("skills")
        .and_then(serde_json::Value::as_array)
        .expect("expected skills array");

    assert_eq!(
        (
            skills.is_empty(),
            skills.iter().any(|skill| {
                skill.get("name").and_then(serde_json::Value::as_str) == Some("onequery-cli")
            }),
            skills.iter().any(|skill| {
                skill.get("name").and_then(serde_json::Value::as_str) == Some("onequery-cli-query")
            }),
        ),
        (false, true, true)
    );
}
