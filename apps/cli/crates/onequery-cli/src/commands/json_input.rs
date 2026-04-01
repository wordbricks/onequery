use serde_json::Map;
use serde_json::Value;

use super::CommandContext;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;

pub(super) fn parse_org_scoped_json_input(
    raw_input: &str,
    context: &CommandContext,
    invalid_title: &'static str,
    input_name: &'static str,
    examples: impl Fn() -> Vec<String>,
) -> Result<Map<String, Value>, CliError> {
    let payload = serde_json::from_str::<Value>(raw_input).map_err(|parse_error| {
        invalid_json_input_error(context, invalid_title, parse_error.to_string(), examples())
    })?;

    let Value::Object(map) = payload else {
        return Err(invalid_json_input_error(
            context,
            invalid_title,
            format!("{input_name} must be one JSON object"),
            examples(),
        ));
    };

    if map.contains_key("organizationId") || map.contains_key("organizationSlug") {
        return Err(invalid_json_input_error(
            context,
            invalid_title,
            "do not include organizationId or organizationSlug in --input; the CLI injects org context automatically"
                .to_owned(),
            examples(),
        ));
    }

    Ok(map)
}

fn invalid_json_input_error(
    context: &CommandContext,
    title: &'static str,
    why: String,
    try_next: Vec<String>,
) -> CliError {
    CliError::new(
        title,
        context.command_line.clone(),
        ErrorStage::ReadQueryInput,
        why,
        try_next,
    )
}

#[cfg(test)]
mod tests {
    use super::parse_org_scoped_json_input;
    use crate::commands::CommandContext;
    use crate::commands::ResolvedOrgSource;
    use crate::config::default_base_url;

    fn test_context(command_line: &str) -> CommandContext {
        CommandContext {
            command_line: command_line.to_owned(),
            base_url: default_base_url(),
            request_id: None,
            resolved_org: Some("acme".to_owned()),
            resolved_org_source: ResolvedOrgSource::Config,
            verbose: false,
        }
    }

    #[test]
    fn parse_org_scoped_json_input_rejects_non_object_payloads() {
        let error = parse_org_scoped_json_input(
            r#"["not","an","object"]"#,
            &test_context("onequery use --source github --input <excerpt>"),
            "invalid use input",
            "use input",
            || vec!["onequery use --source github".to_owned()],
        )
        .expect_err("expected non-object input to be rejected");

        assert_eq!(error.title, "invalid use input");
        assert_eq!(error.why, "use input must be one JSON object");
    }

    #[test]
    fn parse_org_scoped_json_input_rejects_org_override_fields() {
        let error = parse_org_scoped_json_input(
            r#"{"organizationSlug":"acme"}"#,
            &test_context("onequery source connect --source postgres --input <excerpt>"),
            "invalid source connect input",
            "source connect input",
            || vec!["onequery source connect --source postgres".to_owned()],
        )
        .expect_err("expected org override fields to be rejected");

        assert_eq!(error.title, "invalid source connect input");
        assert!(error.why.contains("organizationId"));
    }
}
