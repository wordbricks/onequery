use serde_json::Map;
use serde_json::Number;
use serde_json::Value;

use onequery_cli_core::error::CliError;

use super::CommandContext;
use super::args::SourceApiInputReader;
use super::source_api_examples;
use super::source_api_parse_error;

const NESTED_FIELD_PATH_SYNTAX: &str = "key[subkey]=value";
const ARRAY_FIELD_PATH_SYNTAX: &str = "key[]=value";

#[derive(Debug, Clone, Eq, PartialEq)]
enum FieldPathSegment {
    Key(String),
    Append,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(super) struct FieldPathPolicy {
    pub(super) supports_nested_paths: bool,
    pub(super) supports_array_paths: bool,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum UnsupportedFieldPathFeature {
    NestedPaths,
    ArrayPaths,
}

pub(super) async fn parse_field_patch(
    raw_fields: &[String],
    fields: &[String],
    policy: FieldPathPolicy,
    operation_name: &str,
    reader: &mut SourceApiInputReader,
    context: &CommandContext,
    source_key: &str,
) -> Result<Option<Value>, CliError> {
    let mut root = Map::new();

    for raw_field in raw_fields {
        let (path, raw_value) =
            split_field_assignment(raw_field, policy, operation_name, context, source_key)?;
        let parsed_value = parse_raw_value(raw_value, reader, context, source_key).await?;
        insert_value(&mut root, &path, parsed_value, context, source_key)?;
    }

    for field in fields {
        let (path, raw_value) =
            split_field_assignment(field, policy, operation_name, context, source_key)?;
        let parsed_value = parse_typed_value(raw_value, reader, context, source_key).await?;
        insert_value(&mut root, &path, parsed_value, context, source_key)?;
    }

    if root.is_empty() {
        Ok(None)
    } else {
        Ok(Some(Value::Object(root)))
    }
}

fn split_field_assignment<'a>(
    input: &'a str,
    policy: FieldPathPolicy,
    operation_name: &str,
    context: &CommandContext,
    source_key: &str,
) -> Result<(Vec<FieldPathSegment>, &'a str), CliError> {
    let Some((raw_path, raw_value)) = input.split_once('=') else {
        return Err(source_api_parse_error(
            context,
            "invalid source API field patch",
            "field patches must use KEY=VALUE syntax",
            source_key,
        ));
    };

    let path = parse_field_path(raw_path.trim()).map_err(|message| {
        source_api_parse_error(
            context,
            "invalid source API field patch",
            message,
            source_key,
        )
    })?;
    validate_field_path_policy(&path, policy).map_err(|feature| {
        unsupported_field_path_error(feature, operation_name, context, source_key)
    })?;

    Ok((path, raw_value))
}

fn validate_field_path_policy(
    path: &[FieldPathSegment],
    policy: FieldPathPolicy,
) -> Result<(), UnsupportedFieldPathFeature> {
    let uses_nested_paths = path[1..]
        .iter()
        .any(|segment| matches!(segment, FieldPathSegment::Key(_)));
    if uses_nested_paths && !policy.supports_nested_paths {
        return Err(UnsupportedFieldPathFeature::NestedPaths);
    }

    let uses_array_paths = path
        .iter()
        .any(|segment| matches!(segment, FieldPathSegment::Append));
    if uses_array_paths && !policy.supports_array_paths {
        return Err(UnsupportedFieldPathFeature::ArrayPaths);
    }

    Ok(())
}

fn unsupported_field_path_error(
    feature: UnsupportedFieldPathFeature,
    operation_name: &str,
    context: &CommandContext,
    source_key: &str,
) -> CliError {
    match feature {
        UnsupportedFieldPathFeature::NestedPaths => source_api_parse_error(
            context,
            "nested field patches are not supported",
            format!(
                "operation `{operation_name}` does not support nested field paths like `{NESTED_FIELD_PATH_SYNTAX}`"
            ),
            source_key,
        ),
        UnsupportedFieldPathFeature::ArrayPaths => source_api_parse_error(
            context,
            "array field patches are not supported",
            format!(
                "operation `{operation_name}` does not support array field paths like `{ARRAY_FIELD_PATH_SYNTAX}`"
            ),
            source_key,
        ),
    }
}

fn parse_field_path(input: &str) -> Result<Vec<FieldPathSegment>, String> {
    let mut chars = input.chars().peekable();
    let mut root = String::new();

    while let Some(character) = chars.peek().copied() {
        if character == '[' {
            break;
        }
        root.push(character);
        chars.next();
    }

    if root.trim().is_empty() {
        return Err("field patch key must not be empty".to_owned());
    }

    let mut path = vec![FieldPathSegment::Key(root)];
    while let Some(character) = chars.next() {
        if character != '[' {
            return Err(format!("invalid field patch path syntax near `{input}`"));
        }

        let mut segment = String::new();
        let mut closed = false;
        for character in chars.by_ref() {
            if character == ']' {
                closed = true;
                break;
            }
            segment.push(character);
        }

        if !closed {
            return Err(format!("unclosed `[` in field patch path `{input}`"));
        }

        if segment.is_empty() {
            path.push(FieldPathSegment::Append);
        } else {
            path.push(FieldPathSegment::Key(segment));
        }
    }

    Ok(path)
}

async fn parse_raw_value(
    input: &str,
    reader: &mut SourceApiInputReader,
    context: &CommandContext,
    source_key: &str,
) -> Result<Value, CliError> {
    Ok(Value::String(
        maybe_read_field_text(input, reader, context, source_key).await?,
    ))
}

async fn parse_typed_value(
    input: &str,
    reader: &mut SourceApiInputReader,
    context: &CommandContext,
    source_key: &str,
) -> Result<Value, CliError> {
    let input = maybe_read_field_text(input, reader, context, source_key).await?;

    if let Ok(parsed_json) = serde_json::from_str::<Value>(&input) {
        return Ok(parsed_json);
    }

    if let Ok(parsed_integer) = input.parse::<i64>() {
        return Ok(Value::Number(Number::from(parsed_integer)));
    }
    if let Ok(parsed_integer) = input.parse::<u64>() {
        return Ok(Value::Number(Number::from(parsed_integer)));
    }
    if let Ok(parsed_float) = input.parse::<f64>()
        && let Some(number) = Number::from_f64(parsed_float)
    {
        return Ok(Value::Number(number));
    }

    Ok(Value::String(input))
}

async fn maybe_read_field_text(
    input: &str,
    reader: &mut SourceApiInputReader,
    context: &CommandContext,
    source_key: &str,
) -> Result<String, CliError> {
    let Some(input_path) = input.strip_prefix('@') else {
        return Ok(input.to_owned());
    };

    reader
        .read_text(
            input_path,
            context,
            "failed to read source API field input",
            source_api_examples(source_key),
        )
        .await
}

fn insert_value(
    root: &mut Map<String, Value>,
    path: &[FieldPathSegment],
    value: Value,
    context: &CommandContext,
    source_key: &str,
) -> Result<(), CliError> {
    insert_value_into_object(root, path, value).map_err(|message| {
        source_api_parse_error(
            context,
            "invalid source API field patch",
            message,
            source_key,
        )
    })
}

fn insert_value_into_object(
    target: &mut Map<String, Value>,
    path: &[FieldPathSegment],
    value: Value,
) -> Result<(), String> {
    let Some((first, rest)) = path.split_first() else {
        return Err("field patch path must not be empty".to_owned());
    };

    let FieldPathSegment::Key(key) = first else {
        return Err("field patch paths must start with an object key".to_owned());
    };

    if rest.is_empty() {
        if target.contains_key(key) {
            return Err(format!("duplicate write to field path `{key}`"));
        }
        target.insert(key.clone(), value);
        return Ok(());
    }

    if matches!(rest.first(), Some(FieldPathSegment::Append)) {
        if rest.len() != 1 {
            return Err("nested array field paths are not supported".to_owned());
        }

        let entry = target
            .entry(key.clone())
            .or_insert_with(|| Value::Array(Vec::new()));
        let Value::Array(values) = entry else {
            return Err(format!(
                "field path `{key}` already contains a non-array value"
            ));
        };
        values.push(value);
        return Ok(());
    }

    let entry = target
        .entry(key.clone())
        .or_insert_with(|| Value::Object(Map::new()));
    let Value::Object(child) = entry else {
        return Err(format!(
            "field path `{key}` already contains a non-object value"
        ));
    };

    insert_value_into_object(child, rest, value)
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use serde_json::json;
    use tempfile::tempdir;

    use crate::commands::CommandContext;
    use crate::commands::ResolvedOrgSource;
    use crate::config::default_base_url;

    use super::FieldPathPolicy;
    use super::FieldPathSegment;
    use super::SourceApiInputReader;
    use super::parse_field_patch;
    use super::parse_field_path;

    #[test]
    fn parse_field_path_supports_nested_keys_and_arrays() {
        assert_eq!(
            parse_field_path("params[filter][]").expect("expected valid path"),
            vec![
                FieldPathSegment::Key("params".to_owned()),
                FieldPathSegment::Key("filter".to_owned()),
                FieldPathSegment::Append,
            ]
        );
    }

    #[tokio::test]
    async fn parse_field_patch_supports_raw_and_typed_nested_values() {
        let mut reader = SourceApiInputReader::default();

        let value = parse_field_patch(
            &[
                "params[state]=open".to_owned(),
                "params[labels][]=bug".to_owned(),
                "params[labels][]=feature".to_owned(),
                "params[truthy]=true".to_owned(),
            ],
            &[
                "params[per_page]=20".to_owned(),
                "body={\"viewer\":true}".to_owned(),
                "body[ids][]=1".to_owned(),
                "body[ids][]=2".to_owned(),
                "body[metadata]=null".to_owned(),
            ],
            FieldPathPolicy {
                supports_nested_paths: true,
                supports_array_paths: true,
            },
            "fetch",
            &mut reader,
            &context(),
            "github-prod",
        )
        .await
        .expect("expected nested field patch to parse");

        assert_eq!(
            value,
            Some(json!({
                "params": {
                    "state": "open",
                    "labels": ["bug", "feature"],
                    "truthy": "true",
                    "per_page": 20
                },
                "body": {
                    "viewer": true,
                    "ids": [1, 2],
                    "metadata": null
                }
            }))
        );
    }

    #[tokio::test]
    async fn parse_field_patch_reads_file_inputs_before_parsing() {
        let temp_dir = tempdir().expect("expected temp dir");
        let raw_value_path = temp_dir.path().join("raw.txt");
        let typed_value_path = temp_dir.path().join("typed.json");
        std::fs::write(&raw_value_path, "api").expect("expected raw value file");
        std::fs::write(&typed_value_path, "{\"name\":\"country\"}")
            .expect("expected typed value file");

        let mut reader = SourceApiInputReader::default();
        let value = parse_field_patch(
            &[format!("params[source]=@{}", raw_value_path.display())],
            &[format!("body[dimension]=@{}", typed_value_path.display())],
            FieldPathPolicy {
                supports_nested_paths: true,
                supports_array_paths: true,
            },
            "fetch",
            &mut reader,
            &context(),
            "github-prod",
        )
        .await
        .expect("expected file-backed field patch to parse");

        assert_eq!(
            value,
            Some(json!({
                "params": {
                    "source": "api"
                },
                "body": {
                    "dimension": {
                        "name": "country"
                    }
                }
            }))
        );
    }

    #[tokio::test]
    async fn parse_field_patch_rejects_nested_paths_when_policy_disallows_them() {
        let mut reader = SourceApiInputReader::default();

        let error = parse_field_patch(
            &[],
            &["request[database]=analytics".to_owned()],
            FieldPathPolicy {
                supports_nested_paths: false,
                supports_array_paths: false,
            },
            "list_collections",
            &mut reader,
            &context(),
            "mongo-prod",
        )
        .await
        .expect_err("expected nested field path to be rejected locally");

        assert_eq!(
            error.why,
            "operation `list_collections` does not support nested field paths like `key[subkey]=value`"
        );
    }

    #[tokio::test]
    async fn parse_field_patch_rejects_array_paths_when_policy_disallows_them() {
        let mut reader = SourceApiInputReader::default();

        let error = parse_field_patch(
            &[],
            &["database[]=analytics".to_owned()],
            FieldPathPolicy {
                supports_nested_paths: true,
                supports_array_paths: false,
            },
            "list_collections",
            &mut reader,
            &context(),
            "mongo-prod",
        )
        .await
        .expect_err("expected array field path to be rejected locally");

        assert_eq!(
            error.why,
            "operation `list_collections` does not support array field paths like `key[]=value`"
        );
    }

    fn context() -> CommandContext {
        CommandContext {
            command_line: "onequery use --source github-prod".to_owned(),
            base_url: default_base_url(),
            request_id: None,
            resolved_org: Some("acme".to_owned()),
            resolved_org_source: ResolvedOrgSource::Config,
            verbose: false,
        }
    }
}
