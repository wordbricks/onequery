use serde_json::Map;
use serde_json::Number;
use serde_json::Value;

use onequery_cli_core::error::CliError;

use super::CommandContext;
use super::args::SourceApiInputReader;
use super::source_api_examples;
use super::source_api_parse_error;

#[derive(Debug, Clone, Eq, PartialEq)]
enum FieldPathSegment {
    Key(String),
    Append,
}

pub(super) async fn parse_field_patch(
    raw_fields: &[String],
    fields: &[String],
    reader: &mut SourceApiInputReader,
    context: &CommandContext,
    source_key: &str,
) -> Result<Option<Value>, CliError> {
    let mut root = Map::new();

    for raw_field in raw_fields {
        let (path, raw_value) = split_field_assignment(raw_field, context, source_key)?;
        let parsed_value = parse_raw_value(raw_value, reader, context, source_key).await?;
        insert_value(&mut root, &path, parsed_value, context, source_key)?;
    }

    for field in fields {
        let (path, raw_value) = split_field_assignment(field, context, source_key)?;
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

    Ok((path, raw_value))
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

    use super::FieldPathSegment;
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
}
