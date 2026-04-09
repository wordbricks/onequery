use std::fmt;

use clap::ValueEnum;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use serde::Serialize;
use serde_json::Map;
use serde_json::Value;
use serde_json::json;

use crate::output_metadata::SanitizationMetadata;

#[derive(Debug, Clone, Copy, Eq, PartialEq, ValueEnum)]
#[value(rename_all = "lower")]
pub(crate) enum RequestedOutputMode {
    Text,
    Json,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) enum EffectiveOutputMode {
    Text,
    Json,
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum RenderedOutput {
    Text(String),
    VerbatimText(String),
    Binary(Vec<u8>),
}

enum CommandData {
    Ready(Value),
    Deferred(Box<dyn FnOnce() -> Result<Value, CliError>>),
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Default)]
enum JsonRenderMode {
    #[default]
    Envelope,
    Raw,
}

impl CommandData {
    fn into_value(self) -> Result<Value, CliError> {
        match self {
            Self::Ready(data) => Ok(data),
            Self::Deferred(data) => data(),
        }
    }
}

impl Default for CommandData {
    fn default() -> Self {
        Self::Ready(Value::Null)
    }
}

struct RawStdout {
    bytes: Vec<u8>,
    tty_error: CliError,
}

impl fmt::Debug for RawStdout {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RawStdout")
            .field("bytes_len", &self.bytes.len())
            .field("tty_error", &self.tty_error)
            .finish()
    }
}

impl fmt::Debug for CommandData {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Ready(data) => formatter.debug_tuple("Ready").field(data).finish(),
            Self::Deferred(..) => formatter.write_str("Deferred(<json builder>)"),
        }
    }
}

#[derive(Default)]
pub(crate) struct CommandOutput {
    pub(crate) lines: Vec<String>,
    text_stdout: Option<String>,
    data: CommandData,
    json_render: JsonRenderMode,
    pub(crate) command: Option<String>,
    pub(crate) request_id: Option<String>,
    sanitization: Option<SanitizationMetadata>,
    raw_stdout: Option<RawStdout>,
}

#[derive(Debug)]
pub(crate) struct TerminalOutput(Box<CommandOutput>);

impl TerminalOutput {
    pub(crate) fn new(output: CommandOutput) -> Self {
        Self(Box::new(output))
    }

    pub(crate) fn into_inner(self) -> CommandOutput {
        *self.0
    }

    pub(crate) fn request_id(&self) -> Option<&str> {
        self.0.request_id.as_deref()
    }
}

impl fmt::Debug for CommandOutput {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CommandOutput")
            .field("lines", &self.lines)
            .field("text_stdout", &self.text_stdout)
            .field("data", &self.data)
            .field("json_render", &self.json_render)
            .field("command", &self.command)
            .field("request_id", &self.request_id)
            .field("sanitization", &self.sanitization)
            .field("raw_stdout", &self.raw_stdout)
            .finish()
    }
}

impl CommandOutput {
    pub(crate) fn structured(lines: Vec<String>, data: Value) -> Self {
        Self {
            lines,
            text_stdout: None,
            data: CommandData::Ready(data),
            json_render: JsonRenderMode::Envelope,
            command: None,
            request_id: None,
            sanitization: None,
            raw_stdout: None,
        }
    }

    pub(crate) fn raw_json(lines: Vec<String>, data: Value) -> Self {
        Self {
            lines,
            text_stdout: None,
            data: CommandData::Ready(data),
            json_render: JsonRenderMode::Raw,
            command: None,
            request_id: None,
            sanitization: None,
            raw_stdout: None,
        }
    }

    #[cfg(test)]
    pub(crate) fn deferred(lines: Vec<String>, data: impl FnOnce() -> Value + 'static) -> Self {
        Self {
            lines,
            text_stdout: None,
            data: CommandData::Deferred(Box::new(move || Ok(data()))),
            json_render: JsonRenderMode::Envelope,
            command: None,
            request_id: None,
            sanitization: None,
            raw_stdout: None,
        }
    }

    pub(crate) fn try_deferred(
        lines: Vec<String>,
        data: impl FnOnce() -> Result<Value, CliError> + 'static,
    ) -> Self {
        Self {
            lines,
            text_stdout: None,
            data: CommandData::Deferred(Box::new(data)),
            json_render: JsonRenderMode::Envelope,
            command: None,
            request_id: None,
            sanitization: None,
            raw_stdout: None,
        }
    }

    pub(crate) fn display(text: String) -> Self {
        Self {
            lines: text.lines().map(ToOwned::to_owned).collect(),
            text_stdout: None,
            data: CommandData::Ready(json!({
                "display": text,
            })),
            json_render: JsonRenderMode::Envelope,
            command: None,
            request_id: None,
            sanitization: None,
            raw_stdout: None,
        }
    }

    pub(crate) fn with_command(mut self, command: impl Into<String>) -> Self {
        let command = command.into();
        if !command.trim().is_empty() {
            self.command = Some(command);
        }
        self
    }

    pub(crate) fn with_request_id(mut self, request_id: Option<String>) -> Self {
        self.request_id = request_id.filter(|value| !value.trim().is_empty());
        self
    }

    pub(crate) fn with_text_stdout(mut self, text: String) -> Self {
        self.text_stdout = Some(text);
        self
    }

    pub(crate) fn with_raw_stdout(mut self, bytes: Vec<u8>, tty_error: CliError) -> Self {
        self.raw_stdout = Some(RawStdout { bytes, tty_error });
        self
    }

    // Comment: HTTP safety metadata belongs at the top-level CLI JSON envelope, not inside
    // command `data`, so keep it adjacent to the rendered output instead of polluting schemas.
    pub(crate) fn with_sanitization_metadata(
        mut self,
        metadata: Option<SanitizationMetadata>,
    ) -> Self {
        self.sanitization = metadata;
        self
    }

    #[cfg(test)]
    pub(crate) fn into_data(self) -> Value {
        self.data
            .into_value()
            .expect("expected command output data to materialize")
    }
}

pub(crate) fn serialize_command_data(
    value: &impl Serialize,
    command: &'static str,
) -> Result<Value, CliError> {
    serde_json::to_value(value).map_err(|serialize_error| {
        CliError::new(
            "failed to render command output",
            command,
            ErrorStage::Render,
            serialize_error.to_string(),
            vec![format!("retry {command}")],
        )
    })
}

pub(crate) fn pretty_json_lines(data: &Value) -> Vec<String> {
    match serde_json::to_string_pretty(data) {
        Ok(rendered) => rendered.lines().map(ToOwned::to_owned).collect(),
        Err(_) => vec![data.to_string()],
    }
}

pub(crate) fn append_padded_cell(line: &mut String, value: &str, width: usize) {
    line.push_str(value);
    for _ in value.len()..width {
        line.push(' ');
    }
}

pub(crate) fn render_separator_row(widths: &[usize]) -> String {
    let capacity = widths.iter().sum::<usize>() + widths.len().saturating_sub(1) * 2;
    let mut row = String::with_capacity(capacity);

    for (index, width) in widths.iter().enumerate() {
        if index > 0 {
            row.push_str("  ");
        }
        for _ in 0..*width {
            row.push('-');
        }
    }

    row
}

pub(crate) fn resolve_output_mode(
    requested: Option<RequestedOutputMode>,
    stdout_is_tty: bool,
) -> EffectiveOutputMode {
    match requested {
        Some(RequestedOutputMode::Text) => EffectiveOutputMode::Text,
        Some(RequestedOutputMode::Json) => EffectiveOutputMode::Json,
        None if stdout_is_tty => EffectiveOutputMode::Text,
        None => EffectiveOutputMode::Json,
    }
}

pub(crate) fn render_output(output: CommandOutput, mode: EffectiveOutputMode) -> String {
    match mode {
        EffectiveOutputMode::Text => {
            let CommandOutput {
                lines, text_stdout, ..
            } = output;
            text_stdout.unwrap_or_else(|| lines.join("\n"))
        }
        EffectiveOutputMode::Json => {
            let CommandOutput {
                lines: _,
                text_stdout: _,
                data,
                json_render,
                command,
                request_id,
                sanitization,
                raw_stdout: _,
            } = output;
            let data = match data.into_value() {
                Ok(data) => data,
                Err(error) => return render_error(&error, EffectiveOutputMode::Json),
            };
            if matches!(json_render, JsonRenderMode::Raw) {
                return render_raw_json_output(data, request_id);
            }
            let warnings = extract_warnings(&data);
            let page = extract_page(&data);
            let sanitization = sanitization
                .as_ref()
                .and_then(|sanitization| serde_json::to_value(sanitization).ok())
                .or_else(|| extract_sanitization(&data));
            let mut envelope = Map::new();
            envelope.insert("ok".to_owned(), Value::Bool(true));
            if let Some(command) = command {
                envelope.insert("command".to_owned(), Value::String(command));
            }
            if let Some(request_id) = request_id {
                envelope.insert("requestId".to_owned(), Value::String(request_id));
            }
            envelope.insert("data".to_owned(), data);
            envelope.insert("warnings".to_owned(), Value::Array(warnings));
            if let Some(page) = page {
                envelope.insert("page".to_owned(), page);
            }
            if let Some(sanitization) = sanitization {
                envelope.insert("sanitization".to_owned(), sanitization);
            }
            Value::Object(envelope).to_string()
        }
    }
}

pub(crate) fn render_output_payload(
    output: CommandOutput,
    mode: EffectiveOutputMode,
    stdout_is_tty: bool,
) -> Result<RenderedOutput, CliError> {
    match mode {
        EffectiveOutputMode::Text => {
            let CommandOutput {
                lines,
                text_stdout,
                raw_stdout,
                ..
            } = output;
            match raw_stdout {
                Some(raw_stdout) => {
                    if stdout_is_tty {
                        Err(raw_stdout.tty_error)
                    } else {
                        Ok(RenderedOutput::Binary(raw_stdout.bytes))
                    }
                }
                None => Ok(match text_stdout {
                    Some(text_stdout) => RenderedOutput::VerbatimText(text_stdout),
                    None => RenderedOutput::Text(lines.join("\n")),
                }),
            }
        }
        EffectiveOutputMode::Json => Ok(RenderedOutput::Text(render_output(output, mode))),
    }
}

pub(crate) fn render_error(error: &CliError, mode: EffectiveOutputMode) -> String {
    match mode {
        EffectiveOutputMode::Text => render_text_error(error),
        EffectiveOutputMode::Json => {
            let mut error_body = Map::new();
            if let Some(code) = &error.code {
                error_body.insert("code".to_owned(), Value::String(code.clone()));
            }
            error_body.insert(
                "stage".to_owned(),
                Value::String(error.stage.as_str().to_owned()),
            );
            if let Some(status) = error.status {
                error_body.insert("status".to_owned(), json!(status));
            }
            error_body.insert("title".to_owned(), Value::String(error.title.clone()));
            error_body.insert("detail".to_owned(), Value::String(error.why.clone()));
            error_body.insert("retryable".to_owned(), Value::Bool(error.retryable));
            if let Some(hint) = &error.hint {
                error_body.insert("hint".to_owned(), Value::String(hint.clone()));
            }
            if !error.validation_issues.is_empty() {
                error_body.insert(
                    "errors".to_owned(),
                    Value::Array(
                        error
                            .validation_issues
                            .iter()
                            .map(|issue| {
                                json!({
                                    "field": issue.field,
                                    "message": issue.message,
                                    "code": issue.code,
                                })
                            })
                            .collect(),
                    ),
                );
            }
            if let Some(retry_after_ms) = error.retry_after_ms {
                error_body.insert("retryAfterMs".to_owned(), json!(retry_after_ms));
            }

            let mut envelope = Map::new();
            envelope.insert("ok".to_owned(), Value::Bool(false));
            if let Some(command) = &error.command_path {
                envelope.insert("command".to_owned(), Value::String(command.clone()));
            }
            if let Some(request_id) = &error.request_id {
                envelope.insert("requestId".to_owned(), Value::String(request_id.clone()));
            }
            envelope.insert("error".to_owned(), Value::Object(error_body));
            Value::Object(envelope).to_string()
        }
    }
}

fn extract_page(data: &Value) -> Option<Value> {
    match data.get("page") {
        Some(Value::Object(page)) => Some(Value::Object(page.clone())),
        _ => None,
    }
}

fn render_raw_json_output(mut data: Value, request_id: Option<String>) -> String {
    // Comment: source-api JSON mode owns its top-level schema, so bypass the generic
    // `{ ok, data }` envelope instead of double-wrapping command-specific API objects.
    if let Some(request_id) = request_id
        && let Value::Object(object) = &mut data
        && !object.contains_key("requestId")
    {
        object.insert("requestId".to_owned(), Value::String(request_id));
    }

    data.to_string()
}

fn extract_warnings(data: &Value) -> Vec<Value> {
    match data.get("warnings") {
        Some(Value::Array(values)) => values
            .iter()
            .filter_map(|value| {
                value
                    .as_str()
                    .map(|warning| Value::String(warning.to_owned()))
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn extract_sanitization(data: &Value) -> Option<Value> {
    match data.get("sanitization") {
        Some(Value::Object(value)) => Some(Value::Object(value.clone())),
        _ => None,
    }
}

fn render_text_error(error: &CliError) -> String {
    let mut lines = vec![
        format!("Error: {}", error.title),
        format!("Command: {}", error.command),
        format!("Stage: {}", error.stage.as_str()),
        format!("Why: {}", error.why),
    ];

    if let Some(request_id) = &error.request_id {
        lines.push(format!("Request ID: {request_id}"));
    }

    if let Some(hint) = &error.hint {
        lines.push(format!("Hint: {hint}"));
    }

    if !error.validation_issues.is_empty() {
        lines.push("Validation:".to_owned());
        for issue in &error.validation_issues {
            if issue.field.trim().is_empty() {
                lines.push(format!("  - {} ({})", issue.message, issue.code));
                continue;
            }

            lines.push(format!(
                "  - {}: {} ({})",
                issue.field, issue.message, issue.code
            ));
        }
    }

    if !error.try_next.is_empty() {
        lines.push("Try:".to_owned());
        for suggestion in &error.try_next {
            lines.push(format!("  - {suggestion}"));
        }
    }

    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::AtomicBool;
    use std::sync::atomic::Ordering;

    use insta::assert_snapshot;
    use pretty_assertions::assert_eq;
    use serde_json::json;

    use onequery_cli_core::error::CliError;
    use onequery_cli_core::error::ErrorStage;

    use super::CommandOutput;
    use super::EffectiveOutputMode;
    use super::RenderedOutput;
    use super::RequestedOutputMode;
    use super::render_error;
    use super::render_output;
    use super::render_output_payload;
    use super::resolve_output_mode;

    #[test]
    fn render_error_snapshot() {
        let rendered = render_error(
            &CliError::new(
                "query failed",
                "onequery query exec --source warehouse --sql \"<excerpt: select ...>\"",
                ErrorStage::ExecuteQuery,
                "server rejected write query",
                vec![
                    "retry with a read-only SELECT".to_owned(),
                    "run onequery source show warehouse".to_owned(),
                ],
            )
            .with_request_id(Some("req_123".to_owned()))
            .with_hint(Some("queries must be read-only".to_owned())),
            EffectiveOutputMode::Text,
        );

        assert_snapshot!(rendered);
    }

    #[test]
    fn render_load_config_error_snapshot() {
        let rendered = render_error(
            &CliError::new(
                "failed to parse config file",
                "onequery auth whoami",
                ErrorStage::LoadConfig,
                "expected newline, found a string at line 2 column 14 (/Users/alice/.config/onequery/config.toml)",
                vec!["remove or fix /Users/alice/.config/onequery/config.toml".to_owned()],
            ),
            EffectiveOutputMode::Text,
        );

        assert_snapshot!(rendered);
    }

    #[test]
    fn render_missing_env_directory_error_snapshot() {
        let rendered = render_error(
            &CliError::new(
                "failed to resolve config directory",
                "onequery auth whoami",
                ErrorStage::LoadConfig,
                "XDG_CONFIG_HOME points to /Users/alice/.config-missing, but that path does not exist",
                vec!["set XDG_CONFIG_HOME or HOME to a valid directory".to_owned()],
            ),
            EffectiveOutputMode::Text,
        );

        assert_snapshot!(rendered);
    }

    #[test]
    fn resolve_output_mode_uses_explicit_text_when_stdout_is_not_a_tty() {
        assert_eq!(
            resolve_output_mode(Some(RequestedOutputMode::Text), false),
            EffectiveOutputMode::Text
        );
    }

    #[test]
    fn resolve_output_mode_uses_explicit_json_when_stdout_is_a_tty() {
        assert_eq!(
            resolve_output_mode(Some(RequestedOutputMode::Json), true),
            EffectiveOutputMode::Json
        );
    }

    #[test]
    fn resolve_output_mode_defaults_to_text_when_stdout_is_a_tty() {
        assert_eq!(resolve_output_mode(None, true), EffectiveOutputMode::Text);
    }

    #[test]
    fn resolve_output_mode_defaults_to_json_when_stdout_is_not_a_tty() {
        assert_eq!(resolve_output_mode(None, false), EffectiveOutputMode::Json);
    }

    #[test]
    fn render_output_json_wraps_success_data_in_a_stable_envelope() {
        let rendered = render_output(
            CommandOutput::structured(
                vec!["User: Alice".to_owned()],
                json!({
                    "user": {
                        "id": "user_123",
                    }
                }),
            ),
            EffectiveOutputMode::Json,
        );

        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&rendered)
                .expect("expected JSON success envelope"),
            json!({
                "ok": true,
                "warnings": [],
                "data": {
                    "user": {
                        "id": "user_123",
                    }
                }
            })
        );
    }

    #[test]
    fn render_output_json_can_bypass_the_generic_envelope() {
        let rendered = render_output(
            CommandOutput::raw_json(
                vec!["ok".to_owned()],
                json!({
                    "source": {
                        "key": "github-prod",
                    },
                    "status": 200,
                }),
            )
            .with_command("use")
            .with_request_id(Some("req_raw".to_owned())),
            EffectiveOutputMode::Json,
        );

        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&rendered).expect("expected raw JSON output"),
            json!({
                "source": {
                    "key": "github-prod",
                },
                "status": 200,
                "requestId": "req_raw",
            })
        );
    }

    #[test]
    fn render_output_payload_preserves_explicit_verbatim_text_stdout() {
        let rendered = render_output_payload(
            CommandOutput::structured(vec!["normalized".to_owned()], json!({}))
                .with_text_stdout("first line\r\nsecond line\n".to_owned()),
            EffectiveOutputMode::Text,
            true,
        )
        .expect("expected text payload");

        assert_eq!(
            rendered,
            RenderedOutput::VerbatimText("first line\r\nsecond line\n".to_owned())
        );
    }

    #[test]
    fn render_error_json_wraps_failure_details_in_a_stable_envelope() {
        let rendered = render_error(
            &CliError::new(
                "query failed",
                "onequery query exec --source warehouse --sql \"<excerpt: select ...>\"",
                ErrorStage::ExecuteQuery,
                "server rejected write query",
                vec!["retry with a read-only SELECT".to_owned()],
            )
            .with_command_path(Some("query exec".to_owned()))
            .with_code(Some("query_rejected".to_owned()))
            .with_status(Some(400))
            .with_request_id(Some("req_123".to_owned()))
            .with_hint(Some("queries must be read-only".to_owned())),
            EffectiveOutputMode::Json,
        );

        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&rendered)
                .expect("expected JSON error envelope"),
            json!({
                "ok": false,
                "command": "query exec",
                "requestId": "req_123",
                "error": {
                    "code": "query_rejected",
                    "status": 400,
                    "title": "query failed",
                    "stage": "execute_query",
                    "detail": "server rejected write query",
                    "retryable": false,
                    "hint": "queries must be read-only",
                }
            })
        );
    }

    #[test]
    fn render_output_json_promotes_page_and_warnings_metadata() {
        let rendered = render_output(
            CommandOutput::structured(
                vec!["ok".to_owned()],
                json!({
                    "sources": [],
                    "warnings": ["server returned advisory metadata"],
                    "page": {
                        "nextCursor": "cursor_123",
                        "returned": 50,
                        "hasMore": true
                    }
                }),
            )
            .with_command("source list")
            .with_request_id(Some("req_page".to_owned())),
            EffectiveOutputMode::Json,
        );

        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&rendered)
                .expect("expected JSON success envelope"),
            json!({
                "ok": true,
                "command": "source list",
                "requestId": "req_page",
                "data": {
                    "sources": [],
                    "warnings": ["server returned advisory metadata"],
                    "page": {
                        "nextCursor": "cursor_123",
                        "returned": 50,
                        "hasMore": true
                    }
                },
                "warnings": ["server returned advisory metadata"],
                "page": {
                    "nextCursor": "cursor_123",
                    "returned": 50,
                    "hasMore": true
                }
            })
        );
    }

    #[test]
    fn render_output_json_promotes_sanitization_metadata() {
        let rendered = render_output(
            CommandOutput::structured(
                vec!["ok".to_owned()],
                json!({
                    "rows": [["[sanitized]"]],
                    "sanitization": {
                        "profile": "default-v1",
                        "sanitizedPaths": ["$.rows[*][*]"],
                        "rawAvailable": false
                    }
                }),
            )
            .with_command("query exec")
            .with_request_id(Some("req_sanitized".to_owned())),
            EffectiveOutputMode::Json,
        );

        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&rendered)
                .expect("expected JSON success envelope"),
            json!({
                "ok": true,
                "command": "query exec",
                "requestId": "req_sanitized",
                "data": {
                    "rows": [["[sanitized]"]],
                    "sanitization": {
                        "profile": "default-v1",
                        "sanitizedPaths": ["$.rows[*][*]"],
                        "rawAvailable": false
                    }
                },
                "warnings": [],
                "sanitization": {
                    "profile": "default-v1",
                    "sanitizedPaths": ["$.rows[*][*]"],
                    "rawAvailable": false
                }
            })
        );
    }

    #[test]
    fn render_output_json_includes_explicit_sanitization_metadata() {
        let rendered = render_output(
            CommandOutput::structured(
                vec!["ok".to_owned()],
                json!({
                    "rows": [["[sanitized]"]]
                }),
            )
            .with_command("query exec")
            .with_request_id(Some("req_sanitized".to_owned()))
            .with_sanitization_metadata(Some(
                crate::output_metadata::SanitizationMetadata {
                    profile: "default-v1".to_owned(),
                    sanitized_paths: vec!["$.rows[*][*]".to_owned()],
                    raw_available: false,
                },
            )),
            EffectiveOutputMode::Json,
        );

        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&rendered)
                .expect("expected JSON success envelope"),
            json!({
                "ok": true,
                "command": "query exec",
                "requestId": "req_sanitized",
                "data": {
                    "rows": [["[sanitized]"]]
                },
                "warnings": [],
                "sanitization": {
                    "profile": "default-v1",
                    "sanitizedPaths": ["$.rows[*][*]"],
                    "rawAvailable": false
                }
            })
        );
    }

    #[test]
    fn render_output_text_does_not_materialize_deferred_json_data() {
        let materialized = Arc::new(AtomicBool::new(false));
        let rendered = render_output(
            CommandOutput::deferred(vec!["ok".to_owned()], {
                let materialized = Arc::clone(&materialized);
                move || {
                    materialized.store(true, Ordering::Relaxed);
                    json!({
                        "display": "ok",
                    })
                }
            }),
            EffectiveOutputMode::Text,
        );

        assert_eq!(
            (rendered, materialized.load(Ordering::Relaxed)),
            ("ok".to_owned(), false)
        );
    }

    #[test]
    fn render_output_json_reports_deferred_data_failures() {
        let rendered = render_output(
            CommandOutput::try_deferred(vec!["ok".to_owned()], move || {
                Err(CliError::new(
                    "failed to render command output",
                    "onequery query",
                    ErrorStage::Render,
                    "boom",
                    vec!["retry onequery query".to_owned()],
                ))
            }),
            EffectiveOutputMode::Json,
        );

        assert_snapshot!(
            rendered,
            @r#"{"error":{"detail":"boom","retryable":false,"stage":"render","title":"failed to render command output"},"ok":false}"#
        );
    }
}
