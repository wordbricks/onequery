use crate::output::CommandOutput;
use crate::output::pretty_json_lines;
use crate::output::serialize_command_data;
use crate::transport::source_api::ExecuteSourceApiResponse;
use crate::transport::source_api::NormalizedSourceApiPlan;
use crate::transport::source_api::SourceApiDescriptor;
use crate::transport::source_api::SourceApiFieldPolicy;
use crate::transport::source_api::SourceApiHeader;
use crate::transport::source_api::SourceApiInputMode;
use crate::transport::source_api::SourceApiOperation;
use crate::transport::source_api::SourceApiOperationKind;
use crate::transport::source_api::SourceApiResponseBody;
use crate::transport::source_api::SourceApiSelectorKind;
use base64::Engine;
use jaq_core::Compiler;
use jaq_core::Ctx;
use jaq_core::Vars;
use jaq_core::data;
use jaq_core::load::Arena;
use jaq_core::load::File;
use jaq_core::load::Loader;
use jaq_core::unwrap_valr;
use jaq_json::Val as JaqValue;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;

use super::format::push_section;
use super::format::status_line;
use super::plan::SourceApiRenderOptions;

pub(super) fn render_descriptor_output(
    descriptor: SourceApiDescriptor,
) -> Result<CommandOutput, CliError> {
    let data = serialize_command_data(&descriptor, "onequery use")?;

    let mut lines = vec![format!(
        "Source: {} ({})",
        descriptor.source.key, descriptor.source.provider
    )];
    if let Some(display_name) = descriptor.source.display_name.as_deref() {
        lines.push(format!("Display name: {display_name}"));
    }
    lines.push(format!(
        "Descriptor version: {}",
        descriptor.descriptor_version
    ));
    if let Some(default_path_operation) = descriptor.default_path_operation.as_deref() {
        lines.push(format!("Default path operation: {default_path_operation}"));
    }

    let operation_lines = descriptor
        .operations
        .iter()
        .flat_map(render_operation_lines)
        .collect::<Vec<_>>();
    push_section(&mut lines, "Operations:", &operation_lines);

    let example_lines = descriptor
        .examples
        .iter()
        .flat_map(render_example_lines)
        .collect::<Vec<_>>();
    push_section(&mut lines, "Examples:", &example_lines);
    push_section(&mut lines, "Notes:", &descriptor.notes);

    Ok(CommandOutput::raw_json(lines, data))
}

pub(super) fn render_dry_run_output(
    plan: NormalizedSourceApiPlan,
) -> Result<CommandOutput, CliError> {
    let data = serialize_command_data(&plan, "onequery use")?;
    Ok(CommandOutput::raw_json(pretty_json_lines(&data), data))
}

pub(super) fn render_execute_output(
    responses: Vec<ExecuteSourceApiResponse>,
    render: SourceApiRenderOptions,
) -> Result<CommandOutput, CliError> {
    let response = assemble_execute_response(responses, &render)?;
    let data = serialize_execute_response(&response, &render)?;
    let lines = render_response_lines(&response, &render)?;
    let text_stdout = render_response_text_stdout(&response, &render);
    let raw_stdout = render_response_stdout_bytes(&response, &render)?;
    let output = CommandOutput::raw_json(lines, data);
    let output = match text_stdout {
        Some(text_stdout) => output.with_text_stdout(text_stdout),
        None => output,
    };
    Ok(match raw_stdout {
        Some(raw_stdout) => output.with_raw_stdout(raw_stdout, binary_tty_render_error()),
        None => output,
    })
}

fn serialize_execute_response(
    response: &ExecuteSourceApiResponse,
    render: &SourceApiRenderOptions,
) -> Result<serde_json::Value, CliError> {
    let mut object = serde_json::Map::new();
    object.insert(
        "source".to_owned(),
        serialize_command_data(&response.source, "onequery use")?,
    );
    object.insert(
        "operation".to_owned(),
        serde_json::Value::String(response.operation.clone()),
    );
    if let Some(selector) = response.selector.as_ref() {
        object.insert(
            "selector".to_owned(),
            serde_json::Value::String(selector.clone()),
        );
    }
    object.insert(
        "status".to_owned(),
        serde_json::Value::from(response.status),
    );
    if !response.headers.is_empty() {
        object.insert("headers".to_owned(), json_headers(&response.headers));
    }
    object.insert(
        "contentType".to_owned(),
        serde_json::Value::String(response.content_type.clone()),
    );
    if !render.silent
        && let Some(body) = json_body_value(&response.body)
    {
        object.insert("body".to_owned(), body);
    }
    if let Some(request_id) = response.request_id.as_ref() {
        object.insert(
            "requestId".to_owned(),
            serde_json::Value::String(request_id.clone()),
        );
    }
    if let Some(next_page_token) = response.next_page_token.as_ref() {
        object.insert(
            "nextPageToken".to_owned(),
            serde_json::Value::String(next_page_token.clone()),
        );
    }

    Ok(serde_json::Value::Object(object))
}

fn json_headers(headers: &[SourceApiHeader]) -> serde_json::Value {
    let mut object = serde_json::Map::new();
    for header in headers {
        object.insert(
            header.name.clone(),
            serde_json::Value::String(header.value.clone()),
        );
    }
    serde_json::Value::Object(object)
}

fn json_body_value(body: &SourceApiResponseBody) -> Option<serde_json::Value> {
    match body {
        SourceApiResponseBody::None => None,
        SourceApiResponseBody::Json { value } => Some(value.clone()),
        SourceApiResponseBody::Text { value } => Some(serde_json::Value::String(value.clone())),
        SourceApiResponseBody::Binary { value_base64 } => {
            Some(serde_json::Value::String(value_base64.clone()))
        }
    }
}

fn assemble_execute_response(
    responses: Vec<ExecuteSourceApiResponse>,
    render: &SourceApiRenderOptions,
) -> Result<ExecuteSourceApiResponse, CliError> {
    let mut responses = responses.into_iter();
    let mut response = responses.next().ok_or_else(|| {
        source_api_render_error(
            "source API execution returned no response",
            vec!["retry onequery use".to_owned()],
        )
    })?;

    let remaining = responses.collect::<Vec<_>>();
    if !remaining.is_empty() {
        response = assemble_paginated_response(response, remaining, render.slurp)?;
    }

    if let Some(expression) = render.jq.as_deref() {
        response.body = apply_jq_to_response_body(response.body, expression)?;
    }

    Ok(response)
}

fn assemble_paginated_response(
    first: ExecuteSourceApiResponse,
    remaining: Vec<ExecuteSourceApiResponse>,
    slurp: bool,
) -> Result<ExecuteSourceApiResponse, CliError> {
    let last_page = remaining.last().unwrap_or(&first);
    let request_id = last_page.request_id.clone();
    let next_page_token = last_page.next_page_token.clone();
    let body = assemble_paginated_body(
        std::iter::once(&first)
            .chain(remaining.iter())
            .map(|response| &response.body)
            .collect::<Vec<_>>(),
        slurp,
    )?;
    let mut response = first;
    response.body = body;
    response.request_id = request_id;
    response.next_page_token = next_page_token;
    Ok(response)
}

fn assemble_paginated_body(
    bodies: Vec<&SourceApiResponseBody>,
    slurp: bool,
) -> Result<SourceApiResponseBody, CliError> {
    let Some(first_body) = bodies.first() else {
        return Err(source_api_render_error(
            "source API execution returned no response body",
            vec!["retry onequery use".to_owned()],
        ));
    };

    match first_body {
        SourceApiResponseBody::None => {
            if bodies
                .iter()
                .all(|body| matches!(body, SourceApiResponseBody::None))
            {
                Ok(SourceApiResponseBody::None)
            } else {
                Err(mixed_paginated_body_error())
            }
        }
        SourceApiResponseBody::Json { .. } => {
            let values = bodies
                .into_iter()
                .map(|body| match body {
                    SourceApiResponseBody::Json { value } => Ok(value.clone()),
                    _ => Err(mixed_paginated_body_error()),
                })
                .collect::<Result<Vec<_>, _>>()?;
            Ok(SourceApiResponseBody::Json {
                value: assemble_paginated_json(values, slurp),
            })
        }
        SourceApiResponseBody::Text { .. } => {
            let value = bodies
                .into_iter()
                .map(|body| match body {
                    SourceApiResponseBody::Text { value } => Ok(value.as_str()),
                    _ => Err(mixed_paginated_body_error()),
                })
                .collect::<Result<Vec<_>, _>>()?
                .join("");
            Ok(SourceApiResponseBody::Text { value })
        }
        SourceApiResponseBody::Binary { .. } => {
            let mut bytes = Vec::new();
            for body in bodies {
                let SourceApiResponseBody::Binary { value_base64 } = body else {
                    return Err(mixed_paginated_body_error());
                };

                let decoded = base64::engine::general_purpose::STANDARD
                    .decode(value_base64)
                    .map_err(|decode_error| {
                        source_api_render_error(
                            format!("failed to assemble paginated binary response: {decode_error}"),
                            vec!["retry onequery use --output json ...".to_owned()],
                        )
                    })?;
                bytes.extend(decoded);
            }
            Ok(SourceApiResponseBody::Binary {
                value_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
            })
        }
    }
}

fn assemble_paginated_json(values: Vec<serde_json::Value>, slurp: bool) -> serde_json::Value {
    if !slurp {
        return match values.as_slice() {
            [value] => value.clone(),
            _ => serde_json::Value::Array(values),
        };
    }

    let mut combined = Vec::new();
    for value in values {
        match value {
            serde_json::Value::Array(items) => combined.extend(items),
            other => combined.push(other),
        }
    }
    serde_json::Value::Array(combined)
}

fn apply_jq_to_response_body(
    body: SourceApiResponseBody,
    expression: &str,
) -> Result<SourceApiResponseBody, CliError> {
    match body {
        SourceApiResponseBody::Json { value } => Ok(SourceApiResponseBody::Json {
            value: apply_jq_expression(value, expression)?,
        }),
        SourceApiResponseBody::None
        | SourceApiResponseBody::Text { .. }
        | SourceApiResponseBody::Binary { .. } => Err(source_api_render_error(
            "`--jq` requires a JSON source API response body",
            vec!["retry onequery use without --jq".to_owned()],
        )),
    }
}

fn apply_jq_expression(
    input: serde_json::Value,
    expression: &str,
) -> Result<serde_json::Value, CliError> {
    let input = serde_json::from_value::<JaqValue>(input).map_err(|deserialize_error| {
        source_api_render_error(
            format!("failed to prepare response body for `--jq`: {deserialize_error}"),
            vec!["retry onequery use without --jq".to_owned()],
        )
    })?;

    let defs = jaq_core::defs()
        .chain(jaq_std::defs())
        .chain(jaq_json::defs());
    let loader = Loader::new(defs);
    let arena = Arena::default();
    let modules = loader
        .load(
            &arena,
            File {
                code: expression,
                path: (),
            },
        )
        .map_err(|errors| {
            source_api_render_error(
                format!("invalid `--jq` expression: {errors:?}"),
                vec!["retry onequery use --jq '<expr>'".to_owned()],
            )
        })?;
    let funs = jaq_core::funs()
        .chain(jaq_std::funs())
        .chain(jaq_json::funs());
    let filter = Compiler::default()
        .with_funs(funs)
        .compile(modules)
        .map_err(|errors| {
            source_api_render_error(
                format!("invalid `--jq` expression: {errors:?}"),
                vec!["retry onequery use --jq '<expr>'".to_owned()],
            )
        })?;

    let ctx = Ctx::<data::JustLut<JaqValue>>::new(&filter.lut, Vars::new([]));
    let values = filter
        .id
        .run((ctx, input))
        .map(unwrap_valr)
        .map(|value| {
            value.map_err(|execute_error| {
                source_api_render_error(
                    format!("failed to execute `--jq` expression: {execute_error:?}"),
                    vec!["retry onequery use --jq '<expr>'".to_owned()],
                )
            })
        })
        .map(|value| value.and_then(jaq_value_to_json))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(match values.as_slice() {
        [] => serde_json::Value::Null,
        [value] => value.clone(),
        _ => serde_json::Value::Array(values),
    })
}

fn jaq_value_to_json(value: JaqValue) -> Result<serde_json::Value, CliError> {
    let mut bytes = Vec::new();
    jaq_json::write::write(&mut bytes, &jaq_json::write::Pp::default(), 0, &value).map_err(
        |write_error| {
            source_api_render_error(
                format!("failed to serialize `--jq` output: {write_error}"),
                vec!["retry onequery use --jq '<expr>'".to_owned()],
            )
        },
    )?;

    serde_json::from_slice(&bytes).map_err(|parse_error| {
        source_api_render_error(
            format!("`--jq` output was not valid JSON: {parse_error}"),
            vec!["retry onequery use --jq '<expr>'".to_owned()],
        )
    })
}

fn mixed_paginated_body_error() -> CliError {
    source_api_render_error(
        "paginated source API responses changed body kind between pages",
        vec!["retry onequery use without --paginate".to_owned()],
    )
}

fn source_api_render_error(why: impl Into<String>, try_next: Vec<String>) -> CliError {
    CliError::new(
        "failed to render source API response",
        "onequery use",
        ErrorStage::Render,
        why,
        try_next,
    )
}

fn render_operation_lines(operation: &SourceApiOperation) -> Vec<String> {
    let mut lines = vec![operation.name.clone()];
    lines.push(format!("  kind: {}", operation_kind_label(&operation.kind)));
    lines.push(format!(
        "  selector: {}",
        selector_summary(operation).unwrap_or_else(|| "none".to_owned())
    ));

    if !operation.summary.trim().is_empty() {
        lines.push(format!("  summary: {}", operation.summary));
    }
    if !operation.description.trim().is_empty() {
        lines.push(format!("  description: {}", operation.description));
    }
    if !operation.method_policy.allowed_methods.is_empty() {
        lines.push(format!(
            "  methods: {}",
            operation.method_policy.allowed_methods.join(", ")
        ));
    } else if let Some(default_method) = operation.method_policy.default_method.as_deref() {
        lines.push(format!("  method: {default_method}"));
    }

    let field_modes = [
        operation.field_policy.supports_raw_fields.then_some("raw"),
        operation
            .field_policy
            .supports_typed_fields
            .then_some("typed"),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();
    if !field_modes.is_empty() {
        lines.push(format!("  fields: {}", field_modes.join(", ")));
    }
    if !operation.header_policy.allowed_names.is_empty() {
        lines.push(format!(
            "  headers: {}",
            operation.header_policy.allowed_names.join(", ")
        ));
    }
    let field_examples = field_format_examples(&operation.field_policy);
    if !field_examples.is_empty() {
        lines.push(format!("  field syntax: {}", field_examples.join(", ")));
    }
    lines.push(format!(
        "  input: {}",
        input_mode_label(operation.field_policy.input_mode)
    ));
    if operation.field_policy.accepts_input {
        lines.push(format!(
            "  field patch merge: {}",
            if operation.field_policy.merge_patches {
                "merge over input"
            } else {
                "stay separate from input"
            }
        ));
    }

    lines.extend(operation.notes.iter().map(|note| format!("  note: {note}")));
    lines.extend(
        operation
            .examples
            .iter()
            .flat_map(render_example_lines)
            .map(|line| format!("  {line}")),
    );

    lines
}

fn render_example_lines(example: &crate::transport::source_api::SourceApiExample) -> Vec<String> {
    let mut lines = vec![format!("$ {}", example.command)];
    if !example.label.trim().is_empty() {
        lines.push(format!("  label: {}", example.label));
    }
    if let Some(description) = example.description.as_deref()
        && !description.trim().is_empty()
    {
        lines.push(format!("  description: {description}"));
    }
    lines
}

fn render_response_lines(
    response: &ExecuteSourceApiResponse,
    render: &SourceApiRenderOptions,
) -> Result<Vec<String>, CliError> {
    let mut lines = Vec::new();
    if render.include {
        lines.push(status_line(response.status));
        for header in &response.headers {
            lines.push(format!("{}: {}", header.name, header.value));
        }
    }

    if render.silent {
        return Ok(lines);
    }

    let body_lines = match &response.body {
        SourceApiResponseBody::None => Vec::new(),
        SourceApiResponseBody::Json { value } => pretty_json_lines(value),
        SourceApiResponseBody::Text { value } => value.lines().map(ToOwned::to_owned).collect(),
        SourceApiResponseBody::Binary { .. } => Vec::new(),
    };

    if render.include && !body_lines.is_empty() {
        lines.push(String::new());
    }
    lines.extend(body_lines);
    Ok(lines)
}

fn render_response_text_stdout(
    response: &ExecuteSourceApiResponse,
    render: &SourceApiRenderOptions,
) -> Option<String> {
    if render.silent {
        return None;
    }

    let SourceApiResponseBody::Text { value } = &response.body else {
        return None;
    };

    // Comment: `CommandOutput.lines` is lossy for trailing newlines, so source-api
    // text bodies keep an exact stdout copy to satisfy the verbatim render contract.
    let mut rendered = String::new();
    if render.include {
        rendered.push_str(&status_line(response.status));
        rendered.push('\n');

        for header in &response.headers {
            rendered.push_str(&format!("{}: {}", header.name, header.value));
            rendered.push('\n');
        }

        rendered.push('\n');
    }
    rendered.push_str(value);
    Some(rendered)
}

fn render_response_stdout_bytes(
    response: &ExecuteSourceApiResponse,
    render: &SourceApiRenderOptions,
) -> Result<Option<Vec<u8>>, CliError> {
    if render.silent {
        return Ok(None);
    }

    let SourceApiResponseBody::Binary { value_base64 } = &response.body else {
        return Ok(None);
    };

    let body = base64::engine::general_purpose::STANDARD
        .decode(value_base64)
        .map_err(|decode_error| {
            source_api_render_error(
                format!("failed to decode binary source API response: {decode_error}"),
                vec!["retry onequery use --output json ...".to_owned()],
            )
        })?;

    let mut rendered = Vec::new();
    if render.include {
        rendered.extend_from_slice(status_line(response.status).as_bytes());
        rendered.push(b'\n');

        for header in &response.headers {
            rendered.extend_from_slice(format!("{}: {}", header.name, header.value).as_bytes());
            rendered.push(b'\n');
        }

        rendered.push(b'\n');
    }
    rendered.extend_from_slice(&body);

    Ok(Some(rendered))
}

fn binary_tty_render_error() -> CliError {
    source_api_render_error(
        "binary source API responses require non-TTY stdout; pipe the output or use `--output json`",
        vec![
            "retry onequery use --output json ...".to_owned(),
            "pipe stdout to a file or another command".to_owned(),
        ],
    )
}

fn operation_kind_label(kind: &SourceApiOperationKind) -> &'static str {
    match kind {
        SourceApiOperationKind::HttpRequest => "http_request",
        SourceApiOperationKind::StructuredRequest => "structured_request",
    }
}

fn selector_summary(operation: &SourceApiOperation) -> Option<String> {
    let kind = match operation.selector_kind {
        SourceApiSelectorKind::None => return None,
        SourceApiSelectorKind::Path => "path",
        SourceApiSelectorKind::Identifier => "identifier",
    };

    Some(match operation.selector_label.as_deref() {
        Some(label) if !label.trim().is_empty() => format!("{kind} ({label})"),
        _ => kind.to_owned(),
    })
}

fn field_format_examples(policy: &SourceApiFieldPolicy) -> Vec<&'static str> {
    let mut examples = Vec::new();
    if policy.supports_raw_fields {
        examples.push("-f KEY=VALUE");
    }
    if policy.supports_typed_fields {
        examples.push("-F KEY=VALUE");
    }
    if policy.supports_nested_paths {
        examples.push("key[subkey]=value");
    }
    if policy.supports_array_paths {
        examples.push("key[]=value");
    }
    examples
}

fn input_mode_label(mode: SourceApiInputMode) -> &'static str {
    match mode {
        SourceApiInputMode::None => "none",
        SourceApiInputMode::RequestObject => "request object",
        SourceApiInputMode::RequestBody => "request body",
    }
}

#[cfg(test)]
mod tests {
    use base64::Engine;
    use insta::assert_snapshot;
    use serde_json::json;

    use crate::output::EffectiveOutputMode;
    use crate::output::RenderedOutput;
    use crate::output::render_output;
    use crate::output::render_output_payload;
    use crate::transport::source_api::NormalizedSourceApiPlan;
    use crate::transport::source_api::SourceApiBodyKind;
    use crate::transport::source_api::SourceApiHeader;
    use crate::transport::source_api::SourceApiOperationKind;
    use crate::transport::source_api::SourceApiSource;

    use super::ExecuteSourceApiResponse;
    use super::SourceApiRenderOptions;
    use super::SourceApiResponseBody;
    use super::render_dry_run_output;
    use super::render_execute_output;

    #[test]
    fn render_dry_run_output_serializes_normalized_plan_shape() {
        let output = render_dry_run_output(NormalizedSourceApiPlan {
            source_id: "source-1".to_owned(),
            source_key: "github-prod".to_owned(),
            provider: "github".to_owned(),
            operation: "fetch".to_owned(),
            kind: SourceApiOperationKind::HttpRequest,
            method: Some("GET".to_owned()),
            selector: Some("/pulls".to_owned()),
            selector_template: Some("/{path}".to_owned()),
            host: Some("api.github.com".to_owned()),
            header_names: vec!["accept".to_owned()],
            body_kind: SourceApiBodyKind::Json,
            body_paths: vec!["params".to_owned()],
            request_fingerprint: "fp_123".to_owned(),
            descriptor_version: Some("github.v1".to_owned()),
        })
        .expect("expected normalized dry-run plan to render");

        let rendered = render_output(output, EffectiveOutputMode::Text);
        assert_snapshot!(
            rendered,
            @r#"
            {
              "bodyKind": "json",
              "bodyPaths": [
                "params"
              ],
              "descriptorVersion": "github.v1",
              "headerNames": [
                "accept"
              ],
              "host": "api.github.com",
              "kind": "http_request",
              "method": "GET",
              "operation": "fetch",
              "provider": "github",
              "requestFingerprint": "fp_123",
              "selector": "/pulls",
              "selectorTemplate": "/{path}",
              "sourceId": "source-1",
              "sourceKey": "github-prod"
            }
            "#
        );

        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&rendered).expect("expected raw JSON output"),
            json!({
                "sourceId": "source-1",
                "sourceKey": "github-prod",
                "provider": "github",
                "operation": "fetch",
                "kind": "http_request",
                "method": "GET",
                "selector": "/pulls",
                "selectorTemplate": "/{path}",
                "host": "api.github.com",
                "headerNames": ["accept"],
                "bodyKind": "json",
                "bodyPaths": ["params"],
                "requestFingerprint": "fp_123",
                "descriptorVersion": "github.v1"
            })
        );
    }

    #[test]
    fn render_execute_output_keeps_single_page_json_shape_without_slurp() {
        let output = render_execute_output(
            vec![json_response(SourceApiResponseBody::Json {
                value: json!({"items": [1, 2]}),
            })],
            render_options(),
        )
        .expect("expected source API response to render");

        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&render_output(
                output,
                EffectiveOutputMode::Json
            ))
            .expect("expected raw JSON output"),
            json!({
                "source": {
                    "key": "github-prod",
                    "provider": "github",
                },
                "operation": "fetch",
                "status": 200,
                "contentType": "application/json",
                "body": {
                    "items": [1, 2]
                },
                "requestId": "req_1"
            })
        );
    }

    #[test]
    fn render_execute_output_serializes_text_body_as_plain_string_in_json_mode() {
        let output = render_execute_output(
            vec![json_response(SourceApiResponseBody::Text {
                value: "plain text\nnext line".to_owned(),
            })],
            render_options(),
        )
        .expect("expected source API response to render");

        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&render_output(
                output,
                EffectiveOutputMode::Json
            ))
            .expect("expected raw JSON output"),
            json!({
                "source": {
                    "key": "github-prod",
                    "provider": "github",
                },
                "operation": "fetch",
                "status": 200,
                "contentType": "application/json",
                "body": "plain text\nnext line",
                "requestId": "req_1"
            })
        );
    }

    #[test]
    fn render_execute_output_pretty_prints_json_body_in_text_mode() {
        let output = render_execute_output(
            vec![json_response(SourceApiResponseBody::Json {
                value: json!({"items": [1, 2]}),
            })],
            render_options(),
        )
        .expect("expected source API response to render");

        assert_eq!(
            render_output_payload(output, EffectiveOutputMode::Text, true)
                .expect("expected text payload"),
            RenderedOutput::Text("{\n  \"items\": [\n    1,\n    2\n  ]\n}".to_owned())
        );
    }

    #[test]
    fn render_execute_output_renders_text_body_verbatim_in_text_mode() {
        let output = render_execute_output(
            vec![json_response(SourceApiResponseBody::Text {
                value: "plain text\r\nnext line\n".to_owned(),
            })],
            render_options(),
        )
        .expect("expected source API response to render");

        assert_eq!(
            render_output_payload(output, EffectiveOutputMode::Text, true)
                .expect("expected text payload"),
            RenderedOutput::VerbatimText("plain text\r\nnext line\n".to_owned())
        );
    }

    #[test]
    fn render_execute_output_collects_paginated_json_pages_without_slurp() {
        let output = render_execute_output(
            vec![
                json_response(SourceApiResponseBody::Json {
                    value: json!([{"id": 1}]),
                }),
                json_response(SourceApiResponseBody::Json {
                    value: json!([{"id": 2}]),
                }),
            ],
            render_options(),
        )
        .expect("expected source API response to render");

        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&render_output(
                output,
                EffectiveOutputMode::Json
            ))
            .expect("expected raw JSON output"),
            json!({
                "source": {
                    "key": "github-prod",
                    "provider": "github",
                },
                "operation": "fetch",
                "status": 200,
                "contentType": "application/json",
                "body": [
                    [{"id": 1}],
                    [{"id": 2}]
                ],
                "requestId": "req_1"
            })
        );
    }

    #[test]
    fn render_execute_output_slurps_paginated_json_arrays() {
        let output = render_execute_output(
            vec![
                json_response(SourceApiResponseBody::Json {
                    value: json!([{"id": 1}]),
                }),
                json_response(SourceApiResponseBody::Json {
                    value: json!([{"id": 2}]),
                }),
            ],
            SourceApiRenderOptions {
                slurp: true,
                ..render_options()
            },
        )
        .expect("expected source API response to render");

        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&render_output(
                output,
                EffectiveOutputMode::Json
            ))
            .expect("expected raw JSON output"),
            json!({
                "source": {
                    "key": "github-prod",
                    "provider": "github",
                },
                "operation": "fetch",
                "status": 200,
                "contentType": "application/json",
                "body": [
                    {"id": 1},
                    {"id": 2}
                ],
                "requestId": "req_1"
            })
        );
    }

    #[test]
    fn render_execute_output_applies_jq_to_assembled_body() {
        let output = render_execute_output(
            vec![json_response(SourceApiResponseBody::Json {
                value: json!({"items": [{"id": 1}, {"id": 2}]}),
            })],
            SourceApiRenderOptions {
                jq: Some(".items[].id".to_owned()),
                ..render_options()
            },
        )
        .expect("expected source API response to render");

        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&render_output(
                output,
                EffectiveOutputMode::Json
            ))
            .expect("expected raw JSON output"),
            json!({
                "source": {
                    "key": "github-prod",
                    "provider": "github",
                },
                "operation": "fetch",
                "status": 200,
                "contentType": "application/json",
                "body": [1, 2],
                "requestId": "req_1"
            })
        );
    }

    #[test]
    fn render_execute_output_rejects_jq_for_text_bodies() {
        let error = render_execute_output(
            vec![json_response(SourceApiResponseBody::Text {
                value: "plain text".to_owned(),
            })],
            SourceApiRenderOptions {
                jq: Some(".items".to_owned()),
                ..render_options()
            },
        )
        .expect_err("expected non-JSON `--jq` to fail");

        assert_eq!(error.why, "`--jq` requires a JSON source API response body");
    }

    #[test]
    fn render_execute_output_includes_status_headers_and_body_in_text_mode() {
        let mut response = json_response(SourceApiResponseBody::Text {
            value: "plain text\nnext line".to_owned(),
        });
        response.headers = vec![
            SourceApiHeader {
                name: "content-type".to_owned(),
                value: "text/plain".to_owned(),
            },
            SourceApiHeader {
                name: "x-request-id".to_owned(),
                value: "rq_upstream_123".to_owned(),
            },
        ];

        let output = render_execute_output(
            vec![response],
            SourceApiRenderOptions {
                include: true,
                ..render_options()
            },
        )
        .expect("expected included source API response to render");

        assert_eq!(
            render_output_payload(output, EffectiveOutputMode::Text, true)
                .expect("expected included text payload"),
            RenderedOutput::VerbatimText(
                "HTTP 200\ncontent-type: text/plain\nx-request-id: rq_upstream_123\n\nplain text\nnext line"
                    .to_owned(),
            )
        );
    }

    #[test]
    fn render_execute_output_suppresses_body_when_silent_but_keeps_included_metadata() {
        let mut response = json_response(SourceApiResponseBody::Json {
            value: json!({"items": [1, 2]}),
        });
        response.headers = vec![SourceApiHeader {
            name: "content-type".to_owned(),
            value: "application/json".to_owned(),
        }];

        let output = render_execute_output(
            vec![response],
            SourceApiRenderOptions {
                include: true,
                silent: true,
                ..render_options()
            },
        )
        .expect("expected silent source API response to render");

        assert_eq!(
            render_output_payload(output, EffectiveOutputMode::Text, true)
                .expect("expected silent text payload"),
            RenderedOutput::Text("HTTP 200\ncontent-type: application/json".to_owned())
        );
    }

    #[test]
    fn render_execute_output_omits_body_in_json_mode_when_silent() {
        let mut response = json_response(SourceApiResponseBody::Json {
            value: json!({"items": [1, 2]}),
        });
        response.headers = vec![SourceApiHeader {
            name: "content-type".to_owned(),
            value: "application/json".to_owned(),
        }];

        let output = render_execute_output(
            vec![response],
            SourceApiRenderOptions {
                silent: true,
                ..render_options()
            },
        )
        .expect("expected silent source API response to render");

        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&render_output(
                output,
                EffectiveOutputMode::Json
            ))
            .expect("expected raw JSON output"),
            json!({
                "source": {
                    "key": "github-prod",
                    "provider": "github",
                },
                "operation": "fetch",
                "status": 200,
                "headers": {
                    "content-type": "application/json"
                },
                "contentType": "application/json",
                "requestId": "req_1"
            })
        );
    }

    #[test]
    fn render_execute_output_emits_binary_stdout_when_stdout_is_not_a_tty() {
        let output = render_execute_output(
            vec![json_response(SourceApiResponseBody::Binary {
                value_base64: base64::engine::general_purpose::STANDARD.encode(b"hello"),
            })],
            SourceApiRenderOptions {
                include: true,
                ..render_options()
            },
        )
        .expect("expected binary source API response to render");

        assert_eq!(
            render_output_payload(output, EffectiveOutputMode::Text, false)
                .expect("expected binary stdout payload"),
            RenderedOutput::Binary(b"HTTP 200\n\nhello".to_vec())
        );
    }

    #[test]
    fn render_execute_output_rejects_binary_stdout_when_stdout_is_a_tty() {
        let output = render_execute_output(
            vec![json_response(SourceApiResponseBody::Binary {
                value_base64: base64::engine::general_purpose::STANDARD.encode(b"hello"),
            })],
            render_options(),
        )
        .expect("expected binary source API response to render");

        let error = render_output_payload(output, EffectiveOutputMode::Text, true)
            .expect_err("expected TTY binary output to fail");

        assert_eq!(
            error.why,
            "binary source API responses require non-TTY stdout; pipe the output or use `--output json`"
        );
    }

    fn json_response(body: SourceApiResponseBody) -> ExecuteSourceApiResponse {
        ExecuteSourceApiResponse {
            source: SourceApiSource {
                key: "github-prod".to_owned(),
                provider: "github".to_owned(),
                display_name: None,
            },
            operation: "fetch".to_owned(),
            selector: None,
            status: 200,
            headers: Vec::new(),
            content_type: "application/json".to_owned(),
            body,
            request_id: Some("req_1".to_owned()),
            next_page_token: None,
        }
    }

    fn render_options() -> SourceApiRenderOptions {
        SourceApiRenderOptions {
            include: false,
            silent: false,
            slurp: false,
            jq: None,
        }
    }
}
