use serde::de::Error as SerdeError;
use toml::Value as TomlValue;

const SENTINEL_KEY: &str = "__onequery_override__";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CliOverrideParseError {
    message: String,
}

impl CliOverrideParseError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::error::Error for CliOverrideParseError {}

impl std::fmt::Display for CliOverrideParseError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

pub fn parse_cli_overrides(
    raw_overrides: &[String],
) -> Result<Vec<(String, TomlValue)>, CliOverrideParseError> {
    raw_overrides
        .iter()
        .map(|raw_override| parse_cli_override(raw_override))
        .collect()
}

pub fn parse_cli_override(
    raw_override: &str,
) -> Result<(String, TomlValue), CliOverrideParseError> {
    let Some((raw_key, raw_value)) = raw_override.split_once('=') else {
        return Err(CliOverrideParseError::new(
            "invalid -c/--config override: expected KEY=VALUE",
        ));
    };

    let key = raw_key.trim();
    if key.is_empty() {
        return Err(CliOverrideParseError::new(
            "invalid -c/--config override: key must not be empty",
        ));
    }

    let value_str = raw_value.trim();
    let value = parse_toml_override_value(value_str)
        .unwrap_or_else(|_| TomlValue::String(value_str.to_owned()));

    Ok((key.to_owned(), value))
}

fn parse_toml_override_value(raw: &str) -> Result<TomlValue, toml::de::Error> {
    let wrapped = format!("{SENTINEL_KEY} = {raw}");
    let table: toml::Table = toml::from_str(&wrapped)?;
    table
        .get(SENTINEL_KEY)
        .cloned()
        .ok_or_else(|| SerdeError::custom("missing sentinel key"))
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use toml::Value as TomlValue;

    use super::parse_cli_override;
    use super::parse_cli_overrides;
    use crate::build_cli_overrides_layer;

    #[test]
    fn parse_cli_overrides_expand_dotted_paths_when_built_into_a_layer() {
        let overrides = parse_cli_overrides(&[
            "query.output.format=json".to_owned(),
            "query.timeout=15".to_owned(),
        ])
        .expect("expected CLI overrides to parse");
        let layer = build_cli_overrides_layer(&overrides);

        let expected = toml::from_str::<TomlValue>(
            r#"
[query]
timeout = 15

[query.output]
format = "json"
"#,
        )
        .expect("expected TOML parse to succeed");

        assert_eq!(layer, expected);
    }

    #[test]
    fn parse_cli_override_parses_toml_scalar_values() {
        assert_eq!(
            parse_cli_override("api.request_timeout_sec=15")
                .expect("expected scalar override to parse"),
            ("api.request_timeout_sec".to_owned(), TomlValue::Integer(15)),
        );
    }

    #[test]
    fn parse_cli_override_parses_arrays_and_inline_tables() {
        let array_override =
            parse_cli_override("query.columns=[\"id\", \"slug\"]").expect("expected array");
        let inline_table_override =
            parse_cli_override("query.output={format = \"json\"}").expect("expected table");

        assert_eq!(
            array_override,
            (
                "query.columns".to_owned(),
                TomlValue::Array(vec![
                    TomlValue::String("id".to_owned()),
                    TomlValue::String("slug".to_owned()),
                ]),
            )
        );
        assert_eq!(
            inline_table_override,
            (
                "query.output".to_owned(),
                toml::from_str::<TomlValue>("value = { format = \"json\" }")
                    .expect("expected inline-table TOML parse")
                    .get("value")
                    .cloned()
                    .expect("expected sentinel value"),
            )
        );
    }

    #[test]
    fn parse_cli_override_falls_back_to_unquoted_strings() {
        assert_eq!(
            parse_cli_override("query.output.format=json")
                .expect("expected string fallback override to parse"),
            (
                "query.output.format".to_owned(),
                TomlValue::String("json".to_owned()),
            )
        );
    }

    #[test]
    fn parse_cli_override_rejects_missing_delimiter() {
        let error =
            parse_cli_override("query.output.format").expect_err("expected missing delimiter");

        assert_eq!(
            error.to_string(),
            "invalid -c/--config override: expected KEY=VALUE"
        );
    }
}
