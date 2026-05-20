use serde_json::Map;
use serde_json::Value;
use thiserror::Error;

#[derive(Debug, Clone, Eq, PartialEq, Error)]
#[error("{why}")]
pub struct SourceConnectInputError {
    pub why: String,
}

pub fn parse_source_connect_input(
    raw_input: &str,
) -> Result<Map<String, Value>, SourceConnectInputError> {
    parse_org_scoped_json_input(raw_input, "source connect input")
}

pub fn parse_org_scoped_json_input(
    raw_input: &str,
    input_name: &'static str,
) -> Result<Map<String, Value>, SourceConnectInputError> {
    let payload = serde_json::from_str::<Value>(raw_input).map_err(|parse_error| {
        SourceConnectInputError {
            why: parse_error.to_string(),
        }
    })?;

    let Value::Object(map) = payload else {
        return Err(SourceConnectInputError {
            why: format!("{input_name} must be one JSON object"),
        });
    };

    if map.contains_key("organizationId") || map.contains_key("organizationSlug") {
        return Err(SourceConnectInputError {
            why: "do not include organizationId or organizationSlug in --input; the CLI injects org context automatically"
                .to_owned(),
        });
    }

    Ok(map)
}

pub fn source_connect_input_examples(binary_name: &str) -> Vec<String> {
    vec![
        format!("{binary_name} source connect --source <provider>"),
        format!(
            "{binary_name} --org <org_slug> source connect --source postgres --input '{{\"sourceKey\":\"warehouse\",\"credentials\":{{\"host\":\"db.example.com\",\"database\":\"app\",\"username\":\"{binary_name}\",\"password\":\"secret\"}}}}'"
        ),
    ]
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::parse_org_scoped_json_input;

    #[test]
    fn parse_org_scoped_json_input_rejects_non_object_payloads() {
        let error = parse_org_scoped_json_input(r#"["not","an","object"]"#, "api input")
            .expect_err("expected non-object input to be rejected");

        assert_eq!(error.why, "api input must be one JSON object");
    }

    #[test]
    fn parse_org_scoped_json_input_rejects_org_override_fields() {
        let error =
            parse_org_scoped_json_input(r#"{"organizationSlug":"acme"}"#, "source connect input")
                .expect_err("expected org override fields to be rejected");

        assert!(error.why.contains("organizationId"));
    }
}
