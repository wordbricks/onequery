use std::collections::BTreeMap;

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;

use super::DISCOVERY_SKILL_CONTENT;
use super::DISCOVERY_SKILL_PATH;
use super::EmbeddedSkill;
use super::MUTATION_SKILL_CONTENT;
use super::MUTATION_SKILL_PATH;
use super::QUERY_SKILL_CONTENT;
use super::QUERY_SKILL_PATH;
use super::ROOT_SKILL_CONTENT;
use super::ROOT_SKILL_PATH;
use super::SkillSchema;

pub(super) fn embedded_skill_schemas() -> Result<Vec<SkillSchema>, CliError> {
    let mut skills = embedded_skills()
        .into_iter()
        .map(parse_skill_schema)
        .collect::<Result<Vec<_>, _>>()?;
    skills.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(skills)
}

fn embedded_skills() -> Vec<EmbeddedSkill> {
    vec![
        EmbeddedSkill {
            kind: "root",
            path: ROOT_SKILL_PATH,
            root_skill: None,
            content: ROOT_SKILL_CONTENT,
        },
        EmbeddedSkill {
            kind: "leaf",
            path: DISCOVERY_SKILL_PATH,
            root_skill: Some(ROOT_SKILL_PATH),
            content: DISCOVERY_SKILL_CONTENT,
        },
        EmbeddedSkill {
            kind: "leaf",
            path: QUERY_SKILL_PATH,
            root_skill: Some(ROOT_SKILL_PATH),
            content: QUERY_SKILL_CONTENT,
        },
        EmbeddedSkill {
            kind: "leaf",
            path: MUTATION_SKILL_PATH,
            root_skill: Some(ROOT_SKILL_PATH),
            content: MUTATION_SKILL_CONTENT,
        },
    ]
}

fn parse_skill_schema(skill: EmbeddedSkill) -> Result<SkillSchema, CliError> {
    let frontmatter = parse_frontmatter(skill.path, skill.content)?;
    let name = frontmatter
        .get("name")
        .cloned()
        .ok_or_else(|| missing_skill_frontmatter(skill.path, "name"))?;
    let description = frontmatter
        .get("description")
        .cloned()
        .ok_or_else(|| missing_skill_frontmatter(skill.path, "description"))?;

    Ok(SkillSchema {
        name,
        description,
        kind: skill.kind.to_owned(),
        path: skill.path.to_owned(),
        root_skill: skill.root_skill.map(ToOwned::to_owned),
        guardrails: extract_guardrails(skill.content),
    })
}

fn parse_frontmatter(path: &str, content: &str) -> Result<BTreeMap<String, String>, CliError> {
    let Some(rest) = content.strip_prefix("---\n") else {
        return Err(CliError::new(
            "failed to parse embedded skill",
            "oneq schema skills".to_owned(),
            ErrorStage::Render,
            format!("{path} is missing YAML frontmatter"),
            vec!["restore the embedded skill bundle".to_owned()],
        ));
    };
    let Some((frontmatter, _body)) = rest.split_once("\n---\n") else {
        return Err(CliError::new(
            "failed to parse embedded skill",
            "oneq schema skills".to_owned(),
            ErrorStage::Render,
            format!("{path} is missing a closing YAML frontmatter marker"),
            vec!["restore the embedded skill bundle".to_owned()],
        ));
    };

    let fields = frontmatter
        .lines()
        .filter_map(|line| {
            let (key, value) = line.split_once(':')?;
            Some((key.trim().to_owned(), value.trim().to_owned()))
        })
        .collect::<BTreeMap<_, _>>();
    Ok(fields)
}

fn extract_guardrails(content: &str) -> Vec<String> {
    let Some((_, after_header)) = content.split_once("## Guardrails\n") else {
        return Vec::new();
    };
    let section = after_header.split("\n## ").next().unwrap_or(after_header);
    section
        .lines()
        .filter_map(|line| line.strip_prefix("- "))
        .map(ToOwned::to_owned)
        .collect()
}

fn missing_skill_frontmatter(path: &str, field: &str) -> CliError {
    CliError::new(
        "failed to parse embedded skill",
        "oneq schema skills".to_owned(),
        ErrorStage::Render,
        format!("{path} is missing frontmatter field {field}"),
        vec!["restore the embedded skill bundle".to_owned()],
    )
}
