//! Helpers for mapping config parse and validation failures to text ranges.

use std::fmt::Write;
use std::path::Path;
use std::path::PathBuf;

use serde::de::DeserializeOwned;
use serde_path_to_error::Path as SerdePath;
use serde_path_to_error::Segment as SerdeSegment;
use toml_edit::Document;
use toml_edit::Item;
use toml_edit::Table;
use toml_edit::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TextPosition {
    pub line: usize,
    pub column: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TextRange {
    pub start: TextPosition,
    pub end: TextPosition,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigError {
    pub path: PathBuf,
    pub range: TextRange,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypedTomlDeserializationError {
    pub path: Option<String>,
    pub message: String,
}

impl ConfigError {
    pub fn new(path: PathBuf, range: TextRange, message: impl Into<String>) -> Self {
        Self {
            path,
            range,
            message: message.into(),
        }
    }
}

pub fn config_error_from_toml(
    path: impl AsRef<Path>,
    contents: &str,
    error: toml::de::Error,
) -> ConfigError {
    let range = error
        .span()
        .map(|span| text_range_from_span(contents, span))
        .unwrap_or_else(default_range);
    ConfigError::new(path.as_ref().to_path_buf(), range, error.message())
}

pub fn config_error_from_typed_toml<T: DeserializeOwned>(
    path: impl AsRef<Path>,
    contents: &str,
) -> Option<ConfigError> {
    let deserializer = match toml::de::Deserializer::parse(contents) {
        Ok(deserializer) => deserializer,
        Err(error) => return Some(config_error_from_toml(path, contents, error)),
    };

    let result: Result<T, _> = serde_path_to_error::deserialize(deserializer);
    match result {
        Ok(_) => None,
        Err(error) => {
            let path_hint = error.path().clone();
            let toml_error = error.into_inner();
            let range = span_for_config_path(contents, &path_hint)
                .or_else(|| toml_error.span())
                .map(|span| text_range_from_span(contents, span))
                .unwrap_or_else(default_range);
            Some(ConfigError::new(
                path.as_ref().to_path_buf(),
                range,
                toml_error.message(),
            ))
        }
    }
}

pub fn deserialize_typed_toml<T: DeserializeOwned>(
    contents: &str,
) -> Result<T, TypedTomlDeserializationError> {
    let deserializer =
        toml::de::Deserializer::parse(contents).map_err(|error| TypedTomlDeserializationError {
            path: None,
            message: error.message().to_owned(),
        })?;

    let result: Result<T, _> = serde_path_to_error::deserialize(deserializer);
    result.map_err(|error| {
        let path = error.path().to_string();
        let toml_error = error.into_inner();

        TypedTomlDeserializationError {
            path: (!path.is_empty()).then_some(path),
            message: toml_error.message().to_owned(),
        }
    })
}

pub fn format_config_error(error: &ConfigError, contents: &str) -> String {
    let mut output = String::new();
    let start = error.range.start;
    let _ = writeln!(
        output,
        "{}:{}:{}: {}",
        error.path.display(),
        start.line,
        start.column,
        error.message
    );

    let line_index = start.line.saturating_sub(1);
    let line = match contents.lines().nth(line_index) {
        Some(line) => line.trim_end_matches('\r'),
        None => return output.trim_end().to_string(),
    };

    let line_number = start.line;
    let gutter = line_number.to_string().len();
    let _ = writeln!(output, "{:width$} |", "", width = gutter);
    let _ = writeln!(output, "{line_number:>gutter$} | {line}");

    let highlight_len = if error.range.end.line == error.range.start.line
        && error.range.end.column >= error.range.start.column
    {
        error.range.end.column - error.range.start.column + 1
    } else {
        1
    };
    let spaces = " ".repeat(start.column.saturating_sub(1));
    let carets = "^".repeat(highlight_len.max(1));
    let _ = writeln!(output, "{:width$} | {spaces}{carets}", "", width = gutter);
    output.trim_end().to_string()
}

pub fn format_config_error_with_source(error: &ConfigError) -> String {
    match std::fs::read_to_string(&error.path) {
        Ok(contents) => format_config_error(error, &contents),
        Err(_) => format_config_error(error, ""),
    }
}

fn text_range_from_span(contents: &str, span: std::ops::Range<usize>) -> TextRange {
    let start = position_for_offset(contents, span.start);
    let end_index = if span.end > span.start {
        span.end - 1
    } else {
        span.end
    };
    let end = position_for_offset(contents, end_index);
    TextRange { start, end }
}

fn position_for_offset(contents: &str, index: usize) -> TextPosition {
    let bytes = contents.as_bytes();
    if bytes.is_empty() {
        return TextPosition { line: 1, column: 1 };
    }

    let safe_index = index.min(bytes.len().saturating_sub(1));
    let column_offset = index.saturating_sub(safe_index);
    let line_start = bytes[..safe_index]
        .iter()
        .rposition(|byte| *byte == b'\n')
        .map(|position| position + 1)
        .unwrap_or(0);
    let line = bytes[..line_start]
        .iter()
        .filter(|byte| **byte == b'\n')
        .count();
    let column = std::str::from_utf8(&bytes[line_start..=safe_index])
        .map(|slice| slice.chars().count().saturating_sub(1))
        .unwrap_or_else(|_| safe_index - line_start)
        + column_offset;

    TextPosition {
        line: line + 1,
        column: column + 1,
    }
}

fn default_range() -> TextRange {
    let position = TextPosition { line: 1, column: 1 };
    TextRange {
        start: position,
        end: position,
    }
}

enum TomlNode<'a> {
    Item(&'a Item),
    Table(&'a Table),
    Value(&'a Value),
}

fn span_for_path(contents: &str, path: &SerdePath) -> Option<std::ops::Range<usize>> {
    let document = contents.parse::<Document<String>>().ok()?;
    let node = node_for_path(document.as_item(), path)?;
    match node {
        TomlNode::Item(item) => item.span(),
        TomlNode::Table(table) => table.span(),
        TomlNode::Value(value) => value.span(),
    }
}

fn span_for_config_path(contents: &str, path: &SerdePath) -> Option<std::ops::Range<usize>> {
    if is_features_table_path(path)
        && let Some(span) = span_for_features_value(contents)
    {
        return Some(span);
    }
    span_for_path(contents, path)
}

fn is_features_table_path(path: &SerdePath) -> bool {
    let mut segments = path.iter();
    matches!(segments.next(), Some(SerdeSegment::Map { key }) if key == "features")
        && segments.next().is_none()
}

fn span_for_features_value(contents: &str) -> Option<std::ops::Range<usize>> {
    let document = contents.parse::<Document<String>>().ok()?;
    let root = document.as_item().as_table_like()?;
    let features_item = root.get("features")?;
    let features_table = features_item.as_table_like()?;

    for (_, item) in features_table.iter() {
        match item {
            Item::Value(Value::Boolean(_)) => continue,
            Item::Value(value) => return value.span(),
            Item::Table(table) => return table.span(),
            Item::ArrayOfTables(array) => return array.span(),
            Item::None => continue,
        }
    }

    None
}

fn node_for_path<'a>(item: &'a Item, path: &SerdePath) -> Option<TomlNode<'a>> {
    let segments = path.iter().cloned().collect::<Vec<_>>();
    let mut node = TomlNode::Item(item);
    let mut index = 0;

    while index < segments.len() {
        match &segments[index] {
            SerdeSegment::Map { key } | SerdeSegment::Enum { variant: key } => {
                if let Some(next) = map_child(&node, key) {
                    node = next;
                    index += 1;
                    continue;
                }

                if index + 1 < segments.len() {
                    index += 1;
                    continue;
                }

                return None;
            }
            SerdeSegment::Seq {
                index: sequence_index,
            } => {
                node = seq_child(&node, *sequence_index)?;
                index += 1;
            }
            SerdeSegment::Unknown => return None,
        }
    }

    Some(node)
}

fn map_child<'a>(node: &TomlNode<'a>, key: &str) -> Option<TomlNode<'a>> {
    match node {
        TomlNode::Item(item) => {
            let table = item.as_table_like()?;
            table.get(key).map(TomlNode::Item)
        }
        TomlNode::Table(table) => table.get(key).map(TomlNode::Item),
        TomlNode::Value(Value::InlineTable(table)) => table.get(key).map(TomlNode::Value),
        TomlNode::Value(_) => None,
    }
}

fn seq_child<'a>(node: &TomlNode<'a>, index: usize) -> Option<TomlNode<'a>> {
    match node {
        TomlNode::Item(Item::Value(Value::Array(array))) => array.get(index).map(TomlNode::Value),
        TomlNode::Item(Item::ArrayOfTables(array)) => array.get(index).map(TomlNode::Table),
        TomlNode::Value(Value::Array(array)) => array.get(index).map(TomlNode::Value),
        TomlNode::Item(_) | TomlNode::Table(_) | TomlNode::Value(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use serde::Deserialize;

    use super::TextPosition;
    use super::TextRange;
    use super::TypedTomlDeserializationError;
    use super::config_error_from_toml;
    use super::config_error_from_typed_toml;
    use super::deserialize_typed_toml;
    use super::format_config_error;

    #[allow(dead_code)]
    #[derive(Debug, Deserialize)]
    struct TypedConfig {
        api: ApiSection,
    }

    #[allow(dead_code)]
    #[derive(Debug, Deserialize)]
    struct ApiSection {
        request_timeout_sec: u64,
    }

    #[test]
    fn config_error_from_toml_maps_parse_span() {
        let contents = "[api]\nrequest_timeout_sec = \"bad\n";
        let error = toml::from_str::<toml::Value>(contents).expect_err("expected parse error");
        let config_error = config_error_from_toml("/tmp/onequery/config.toml", contents, error);

        assert_eq!(config_error.range.start.line, 2);
        assert!(config_error.range.start.column > 1);
    }

    #[test]
    fn config_error_from_typed_toml_maps_schema_path() {
        let contents = "[api]\nrequest_timeout_sec = \"bad\"\n";
        let config_error =
            config_error_from_typed_toml::<TypedConfig>("/tmp/onequery/config.toml", contents)
                .expect("expected typed error");

        assert_eq!(
            config_error.range,
            TextRange {
                start: TextPosition {
                    line: 2,
                    column: 23
                },
                end: TextPosition {
                    line: 2,
                    column: 27
                },
            }
        );
        assert_eq!(
            format_config_error(&config_error, contents),
            concat!(
                "/tmp/onequery/config.toml:2:23: invalid type: string \"bad\", expected u64\n",
                "  |\n",
                "2 | request_timeout_sec = \"bad\"\n",
                "  |                       ^^^^^",
            )
        );
    }

    #[test]
    fn deserialize_typed_toml_reports_schema_path() {
        let contents = "[api]\nrequest_timeout_sec = \"bad\"\n";
        let error = deserialize_typed_toml::<TypedConfig>(contents)
            .expect_err("expected typed TOML deserialization failure");

        assert_eq!(
            error,
            TypedTomlDeserializationError {
                path: Some("api.request_timeout_sec".to_owned()),
                message: "invalid type: string \"bad\", expected u64".to_owned(),
            }
        );
    }
}
