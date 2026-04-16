use crate::output::CommandOutput;
use crate::output::pretty_json_lines;
use crate::transport::labels::source_provider_to_str;
use crate::transport::source_api::ProtoJsonValue;
use crate::transport::source_api::SourceApiDescriptor;
use crate::transport::source_api::SourceApiFieldPolicy;
use crate::transport::source_api::SourceApiHeader;
use crate::transport::source_api::SourceApiOperation;
use crate::transport::source_api::SourceApiPreview;
use crate::transport::source_api::SourceApiResponseBody;
use crate::transport::source_api::SourceApiSelectorKind;
use crate::transport::source_api::json_from_proto_json_value;
use crate::transport::source_api::proto_json_value_from_json;
use crate::transport::source_api::source_api_body_kind_label;
use crate::transport::source_api::source_api_input_mode_label;
use crate::transport::source_api::source_api_operation_kind_label;
use crate::transport::source_api::source_api_pagination_policy_label;
use crate::transport::source_api::source_api_selector_kind_label;
use crate::transport::source_api::source_api_selector_kind_or_none;
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

use super::SourceApiExecutionPage;
use super::format::push_section;
use super::format::status_line;
use super::plan::SourceApiRenderOptions;

pub(super) fn render_descriptor_output(
    descriptor: SourceApiDescriptor,
) -> Result<CommandOutput, CliError> {
    let data = descriptor_json(&descriptor)?;

    let mut lines = vec![format!(
        "Source: {} ({})",
        descriptor.source.source_key,
        source_provider_to_str(descriptor.source.provider)
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
    preview: &SourceApiPreview,
    verbose: bool,
) -> Result<CommandOutput, CliError> {
    let data = serialize_dry_run_preview(preview, verbose)?;
    Ok(CommandOutput::raw_json(pretty_json_lines(&data), data))
}

pub(super) fn render_execute_output(
    responses: Vec<SourceApiExecutionPage>,
    preview: &SourceApiPreview,
    render: SourceApiRenderOptions,
) -> Result<CommandOutput, CliError> {
    let response = assemble_execute_response(responses, &render)?;
    let data = serialize_execute_response(&response, preview, &render)?;
    let lines = if render.verbose {
        pretty_json_lines(&data)
    } else {
        render_response_lines(&response, &render)?
    };
    let text_stdout = (!render.verbose).then(|| render_response_text_stdout(&response, &render));
    let raw_stdout = if render.verbose {
        None
    } else {
        render_response_stdout_bytes(&response, &render)?
    };
    let output = CommandOutput::raw_json(lines, data);
    let output = match text_stdout.flatten() {
        Some(text_stdout) => output.with_text_stdout(text_stdout),
        None => output,
    };
    Ok(match raw_stdout {
        Some(raw_stdout) => output.with_raw_stdout(raw_stdout, binary_tty_render_error()),
        None => output,
    })
}

fn serialize_execute_response(
    response: &SourceApiExecutionPage,
    preview: &SourceApiPreview,
    render: &SourceApiRenderOptions,
) -> Result<serde_json::Value, CliError> {
    if !render.verbose {
        let body = if render.silent {
            None
        } else {
            json_body_value(response.body.as_ref())?
        };

        return Ok(match (body, response.continuation_token.as_deref()) {
            (Some(body), None) => body,
            (Some(body), Some(continuation_token)) => serde_json::json!({
                "body": body,
                "continuationToken": continuation_token,
            }),
            (None, Some(continuation_token)) => serde_json::json!({
                "continuationToken": continuation_token,
            }),
            (None, None) => serde_json::Value::Null,
        });
    }

    serialize_verbose_execute_response(response, preview, render)
}

fn serialize_dry_run_preview(
    preview: &SourceApiPreview,
    verbose: bool,
) -> Result<serde_json::Value, CliError> {
    if verbose {
        return Ok(preview_json(preview, true));
    }

    let mut object = serde_json::Map::new();
    object.insert(
        "operation".to_owned(),
        serde_json::Value::String(preview.operation.clone()),
    );
    object.insert(
        "kind".to_owned(),
        serde_json::Value::String(source_api_operation_kind_label(preview.kind).to_owned()),
    );
    if let Some(method) = preview.method.as_ref() {
        object.insert(
            "method".to_owned(),
            serde_json::Value::String(method.clone()),
        );
    }
    if let Some(selector) = preview.selector.as_ref() {
        object.insert(
            "selector".to_owned(),
            serde_json::Value::String(selector.clone()),
        );
    }
    object.insert(
        "bodyKind".to_owned(),
        serde_json::Value::String(source_api_body_kind_label(preview.body_kind).to_owned()),
    );

    Ok(serde_json::Value::Object(object))
}

fn serialize_verbose_execute_response(
    response: &SourceApiExecutionPage,
    preview: &SourceApiPreview,
    render: &SourceApiRenderOptions,
) -> Result<serde_json::Value, CliError> {
    let mut object = serde_json::Map::new();
    object.insert("preview".to_owned(), preview_json(preview, true));
    object.insert("source".to_owned(), source_json(&response.source));
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
        && let Some(body) = json_body_value(response.body.as_ref())?
    {
        object.insert("body".to_owned(), body);
    }
    if let Some(continuation_token) = response.continuation_token.as_ref() {
        object.insert(
            "continuationToken".to_owned(),
            serde_json::Value::String(continuation_token.clone()),
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

fn json_body_value(
    body: Option<&SourceApiResponseBody>,
) -> Result<Option<serde_json::Value>, CliError> {
    match body {
        None => Ok(None),
        Some(SourceApiResponseBody::Json(value)) => renderable_json_value(value).map(Some),
        Some(SourceApiResponseBody::Text(value)) => {
            Ok(Some(serde_json::Value::String(value.clone())))
        }
        Some(SourceApiResponseBody::Binary(value)) => Ok(Some(serde_json::Value::String(
            base64::engine::general_purpose::STANDARD.encode(value),
        ))),
    }
}

fn assemble_execute_response(
    responses: Vec<SourceApiExecutionPage>,
    render: &SourceApiRenderOptions,
) -> Result<SourceApiExecutionPage, CliError> {
    let mut responses = responses.into_iter();
    let mut response = responses.next().ok_or_else(|| {
        source_api_render_error(
            "source API execution returned no response",
            vec!["retry onequery api".to_owned()],
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
    first: SourceApiExecutionPage,
    remaining: Vec<SourceApiExecutionPage>,
    slurp: bool,
) -> Result<SourceApiExecutionPage, CliError> {
    let last_page = remaining.last().unwrap_or(&first);
    let continuation_token = last_page.continuation_token.clone();
    let body = assemble_paginated_body(
        std::iter::once(&first)
            .chain(remaining.iter())
            .map(|response| response.body.as_ref())
            .collect::<Vec<_>>(),
        slurp,
    )?;
    let mut response = first;
    response.body = body;
    response.continuation_token = continuation_token;
    Ok(response)
}

fn assemble_paginated_body(
    bodies: Vec<Option<&SourceApiResponseBody>>,
    slurp: bool,
) -> Result<Option<SourceApiResponseBody>, CliError> {
    let Some(first_body) = bodies.first() else {
        return Err(source_api_render_error(
            "source API execution returned no response body",
            vec!["retry onequery api".to_owned()],
        ));
    };

    match first_body {
        None => {
            if bodies.iter().all(Option::is_none) {
                Ok(None)
            } else {
                Err(mixed_paginated_body_error())
            }
        }
        Some(SourceApiResponseBody::Json(..)) => {
            let values = bodies
                .into_iter()
                .map(|body| match body {
                    Some(SourceApiResponseBody::Json(value)) => renderable_json_value(value),
                    _ => Err(mixed_paginated_body_error()),
                })
                .collect::<Result<Vec<_>, _>>()?;
            Ok(Some(SourceApiResponseBody::Json(Box::new(
                transport_json_value(assemble_paginated_json(values, slurp))?,
            ))))
        }
        Some(SourceApiResponseBody::Text(..)) => {
            let value = bodies
                .into_iter()
                .map(|body| match body {
                    Some(SourceApiResponseBody::Text(value)) => Ok(value.as_str()),
                    _ => Err(mixed_paginated_body_error()),
                })
                .collect::<Result<Vec<_>, _>>()?
                .join("");
            Ok(Some(SourceApiResponseBody::Text(value)))
        }
        Some(SourceApiResponseBody::Binary(..)) => {
            let mut bytes = Vec::new();
            for body in bodies {
                let Some(SourceApiResponseBody::Binary(value)) = body else {
                    return Err(mixed_paginated_body_error());
                };
                bytes.extend_from_slice(value);
            }
            Ok(Some(SourceApiResponseBody::Binary(bytes)))
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
    body: Option<SourceApiResponseBody>,
    expression: &str,
) -> Result<Option<SourceApiResponseBody>, CliError> {
    match body {
        Some(SourceApiResponseBody::Json(value)) => Ok(Some(SourceApiResponseBody::Json(
            Box::new(transport_json_value(apply_jq_expression(
                renderable_json_value(&value)?,
                expression,
            )?)?),
        ))),
        None | Some(SourceApiResponseBody::Text(..)) | Some(SourceApiResponseBody::Binary(..)) => {
            Err(source_api_render_error(
                "`--jq` requires a JSON source API response body",
                vec!["retry onequery api without --jq".to_owned()],
            ))
        }
    }
}

fn apply_jq_expression(
    input: serde_json::Value,
    expression: &str,
) -> Result<serde_json::Value, CliError> {
    let input = serde_json::from_value::<JaqValue>(input).map_err(|deserialize_error| {
        source_api_render_error(
            format!("failed to prepare response body for `--jq`: {deserialize_error}"),
            vec!["retry onequery api without --jq".to_owned()],
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
                vec!["retry onequery api --jq '<expr>'".to_owned()],
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
                vec!["retry onequery api --jq '<expr>'".to_owned()],
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
                    vec!["retry onequery api --jq '<expr>'".to_owned()],
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
                vec!["retry onequery api --jq '<expr>'".to_owned()],
            )
        },
    )?;

    serde_json::from_slice(&bytes).map_err(|parse_error| {
        source_api_render_error(
            format!("`--jq` output was not valid JSON: {parse_error}"),
            vec!["retry onequery api --jq '<expr>'".to_owned()],
        )
    })
}

fn mixed_paginated_body_error() -> CliError {
    source_api_render_error(
        "paginated source API responses changed body kind between pages",
        vec!["retry onequery api without --paginate".to_owned()],
    )
}

fn renderable_json_value(value: &ProtoJsonValue) -> Result<serde_json::Value, CliError> {
    json_from_proto_json_value(value).map_err(|error| {
        source_api_render_error(
            format!("failed to decode source API JSON body: {error}"),
            vec!["retry onequery api".to_owned()],
        )
    })
}

fn transport_json_value(value: serde_json::Value) -> Result<ProtoJsonValue, CliError> {
    proto_json_value_from_json(value).map_err(|error| {
        source_api_render_error(
            format!("failed to encode source API JSON body: {error}"),
            vec!["retry onequery api".to_owned()],
        )
    })
}

fn descriptor_json(descriptor: &SourceApiDescriptor) -> Result<serde_json::Value, CliError> {
    let mut object = serde_json::Map::new();
    object.insert("source".to_owned(), source_json(&descriptor.source));
    object.insert(
        "descriptorVersion".to_owned(),
        serde_json::Value::String(descriptor.descriptor_version.clone()),
    );
    if let Some(default_path_operation) = descriptor.default_path_operation.as_ref() {
        object.insert(
            "defaultPathOperation".to_owned(),
            serde_json::Value::String(default_path_operation.clone()),
        );
    }
    if !descriptor.operations.is_empty() {
        object.insert(
            "operations".to_owned(),
            serde_json::Value::Array(
                descriptor
                    .operations
                    .iter()
                    .map(operation_json)
                    .collect::<Result<Vec<_>, _>>()?,
            ),
        );
    }
    if !descriptor.examples.is_empty() {
        object.insert(
            "examples".to_owned(),
            serde_json::Value::Array(descriptor.examples.iter().map(example_json).collect()),
        );
    }
    if !descriptor.notes.is_empty() {
        object.insert(
            "notes".to_owned(),
            serde_json::Value::Array(
                descriptor
                    .notes
                    .iter()
                    .cloned()
                    .map(serde_json::Value::String)
                    .collect(),
            ),
        );
    }
    Ok(serde_json::Value::Object(object))
}

fn preview_json(preview: &SourceApiPreview, include_business_metadata: bool) -> serde_json::Value {
    let mut object = serde_json::Map::new();
    if include_business_metadata {
        object.insert(
            "sourceKey".to_owned(),
            serde_json::Value::String(preview.source_key.clone()),
        );
        object.insert(
            "provider".to_owned(),
            serde_json::Value::String(source_provider_to_str(preview.provider)),
        );
    }
    object.insert(
        "operation".to_owned(),
        serde_json::Value::String(preview.operation.clone()),
    );
    object.insert(
        "kind".to_owned(),
        serde_json::Value::String(source_api_operation_kind_label(preview.kind).to_owned()),
    );
    if let Some(method) = preview.method.as_ref() {
        object.insert(
            "method".to_owned(),
            serde_json::Value::String(method.clone()),
        );
    }
    if let Some(selector) = preview.selector.as_ref() {
        object.insert(
            "selector".to_owned(),
            serde_json::Value::String(selector.clone()),
        );
    }
    if include_business_metadata {
        if let Some(url) = preview.url.as_ref() {
            object.insert("url".to_owned(), serde_json::Value::String(url.clone()));
        }
        if let Some(host) = preview.host.as_ref() {
            object.insert("host".to_owned(), serde_json::Value::String(host.clone()));
        }
        if !preview.header_names.is_empty() {
            object.insert(
                "headerNames".to_owned(),
                serde_json::Value::Array(
                    preview
                        .header_names
                        .iter()
                        .cloned()
                        .map(serde_json::Value::String)
                        .collect(),
                ),
            );
        }
    }
    object.insert(
        "bodyKind".to_owned(),
        serde_json::Value::String(source_api_body_kind_label(preview.body_kind).to_owned()),
    );
    if include_business_metadata && !preview.body_paths.is_empty() {
        object.insert(
            "bodyPaths".to_owned(),
            serde_json::Value::Array(
                preview
                    .body_paths
                    .iter()
                    .cloned()
                    .map(serde_json::Value::String)
                    .collect(),
            ),
        );
    }
    if include_business_metadata {
        object.insert(
            "paginationPolicy".to_owned(),
            serde_json::Value::String(
                source_api_pagination_policy_label(preview.pagination_policy).to_owned(),
            ),
        );
    }
    serde_json::Value::Object(object)
}

fn operation_json(operation: &SourceApiOperation) -> Result<serde_json::Value, CliError> {
    let mut object = serde_json::Map::new();
    object.insert(
        "name".to_owned(),
        serde_json::Value::String(operation.name.clone()),
    );
    object.insert(
        "kind".to_owned(),
        serde_json::Value::String(source_api_operation_kind_label(operation.kind).to_owned()),
    );
    object.insert(
        "summary".to_owned(),
        serde_json::Value::String(operation.summary.clone()),
    );
    object.insert(
        "description".to_owned(),
        serde_json::Value::String(operation.description.clone()),
    );
    object.insert(
        "selectorKind".to_owned(),
        serde_json::Value::String(
            source_api_selector_kind_label(operation.selector_kind).to_owned(),
        ),
    );
    if let Some(selector_label) = operation.selector_label.as_ref() {
        object.insert(
            "selectorLabel".to_owned(),
            serde_json::Value::String(selector_label.clone()),
        );
    }
    object.insert(
        "methodPolicy".to_owned(),
        method_policy_json(&operation.method_policy),
    );
    object.insert(
        "fieldPolicy".to_owned(),
        field_policy_json(&operation.field_policy),
    );
    object.insert(
        "headerPolicy".to_owned(),
        header_policy_json(&operation.header_policy),
    );
    object.insert(
        "paginationPolicy".to_owned(),
        serde_json::Value::String(
            source_api_pagination_policy_label(operation.pagination_policy).to_owned(),
        ),
    );
    if !operation.examples.is_empty() {
        object.insert(
            "examples".to_owned(),
            serde_json::Value::Array(operation.examples.iter().map(example_json).collect()),
        );
    }
    if !operation.notes.is_empty() {
        object.insert(
            "notes".to_owned(),
            serde_json::Value::Array(
                operation
                    .notes
                    .iter()
                    .cloned()
                    .map(serde_json::Value::String)
                    .collect(),
            ),
        );
    }
    Ok(serde_json::Value::Object(object))
}

fn source_json(source: &crate::transport::source_api::SourceApiSource) -> serde_json::Value {
    let mut object = serde_json::Map::new();
    object.insert(
        "key".to_owned(),
        serde_json::Value::String(source.source_key.clone()),
    );
    object.insert(
        "provider".to_owned(),
        serde_json::Value::String(source_provider_to_str(source.provider)),
    );
    if let Some(display_name) = source.display_name.as_ref() {
        object.insert(
            "displayName".to_owned(),
            serde_json::Value::String(display_name.clone()),
        );
    }
    serde_json::Value::Object(object)
}

fn method_policy_json(
    policy: &crate::transport::source_api::SourceApiMethodPolicy,
) -> serde_json::Value {
    let mut object = serde_json::Map::new();
    if let Some(default_method) = policy.default_method.as_ref() {
        object.insert(
            "defaultMethod".to_owned(),
            serde_json::Value::String(default_method.clone()),
        );
    }
    if !policy.allowed_methods.is_empty() {
        object.insert(
            "allowedMethods".to_owned(),
            serde_json::Value::Array(
                policy
                    .allowed_methods
                    .iter()
                    .cloned()
                    .map(serde_json::Value::String)
                    .collect(),
            ),
        );
    }
    serde_json::Value::Object(object)
}

fn field_policy_json(policy: &SourceApiFieldPolicy) -> serde_json::Value {
    serde_json::json!({
        "supportsRawFields": policy.supports_raw_fields,
        "supportsTypedFields": policy.supports_typed_fields,
        "supportsNestedPaths": policy.supports_nested_paths,
        "supportsArrayPaths": policy.supports_array_paths,
        "acceptsInput": policy.accepts_input,
        "inputMode": source_api_input_mode_label(policy.input_mode),
        "mergePatches": policy.merge_patches,
    })
}

fn header_policy_json(
    policy: &crate::transport::source_api::SourceApiHeaderPolicy,
) -> serde_json::Value {
    let mut object = serde_json::Map::new();
    if !policy.allowed_names.is_empty() {
        object.insert(
            "allowedNames".to_owned(),
            serde_json::Value::Array(
                policy
                    .allowed_names
                    .iter()
                    .cloned()
                    .map(serde_json::Value::String)
                    .collect(),
            ),
        );
    }
    serde_json::Value::Object(object)
}

fn example_json(example: &crate::transport::source_api::SourceApiExample) -> serde_json::Value {
    let mut object = serde_json::Map::new();
    object.insert(
        "label".to_owned(),
        serde_json::Value::String(example.label.clone()),
    );
    if let Some(description) = example.description.as_ref() {
        object.insert(
            "description".to_owned(),
            serde_json::Value::String(description.clone()),
        );
    }
    object.insert(
        "command".to_owned(),
        serde_json::Value::String(example.command.clone()),
    );
    serde_json::Value::Object(object)
}

fn source_api_render_error(why: impl Into<String>, try_next: Vec<String>) -> CliError {
    CliError::new(
        "failed to render source API response",
        "onequery api",
        ErrorStage::Render,
        why,
        try_next,
    )
}

fn render_operation_lines(operation: &SourceApiOperation) -> Vec<String> {
    let mut lines = vec![operation.name.clone()];
    lines.push(format!(
        "  kind: {}",
        source_api_operation_kind_label(operation.kind)
    ));
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
        source_api_input_mode_label(operation.field_policy.input_mode)
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
    response: &SourceApiExecutionPage,
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
        None => Vec::new(),
        Some(SourceApiResponseBody::Json(value)) => {
            pretty_json_lines(&renderable_json_value(value)?)
        }
        Some(SourceApiResponseBody::Text(value)) => value.lines().map(ToOwned::to_owned).collect(),
        Some(SourceApiResponseBody::Binary(..)) => Vec::new(),
    };

    if render.include && !body_lines.is_empty() {
        lines.push(String::new());
    }
    lines.extend(body_lines);
    Ok(lines)
}

fn render_response_text_stdout(
    response: &SourceApiExecutionPage,
    render: &SourceApiRenderOptions,
) -> Option<String> {
    if render.silent {
        return None;
    }

    let Some(SourceApiResponseBody::Text(value)) = response.body.as_ref() else {
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
    response: &SourceApiExecutionPage,
    render: &SourceApiRenderOptions,
) -> Result<Option<Vec<u8>>, CliError> {
    if render.silent {
        return Ok(None);
    }

    let Some(SourceApiResponseBody::Binary(value)) = response.body.as_ref() else {
        return Ok(None);
    };

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
    rendered.extend_from_slice(value);

    Ok(Some(rendered))
}

fn binary_tty_render_error() -> CliError {
    source_api_render_error(
        "binary source API responses require non-TTY stdout; pipe the output or use `--output json`",
        vec![
            "retry onequery api --output json ...".to_owned(),
            "pipe stdout to a file or another command".to_owned(),
        ],
    )
}

fn selector_summary(operation: &SourceApiOperation) -> Option<String> {
    let kind = match source_api_selector_kind_or_none(operation.selector_kind) {
        SourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_NONE => return None,
        SourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_PATH
        | SourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_IDENTIFIER => {
            source_api_selector_kind_label(operation.selector_kind)
        }
        SourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_UNSPECIFIED => unreachable!(),
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

#[cfg(test)]
mod tests {
    use buffa::MessageField;
    use insta::assert_snapshot;
    use serde_json::json;

    use crate::output::EffectiveOutputMode;
    use crate::output::RenderedOutput;
    use crate::output::render_output;
    use crate::output::render_output_payload;
    use crate::transport::source_api::ProtoJsonValue;
    use crate::transport::source_api::SourceApiBodyKind;
    use crate::transport::source_api::SourceApiHeader;
    use crate::transport::source_api::SourceApiOperationKind;
    use crate::transport::source_api::SourceApiPaginationPolicy;
    use crate::transport::source_api::SourceApiPreview;
    use crate::transport::source_api::SourceApiSource;
    use crate::transport::source_api::proto_json_value_from_json;

    use super::SourceApiExecutionPage;
    use super::SourceApiRenderOptions;
    use super::SourceApiResponseBody;
    use super::render_dry_run_output;
    use super::render_execute_output;

    #[test]
    fn render_dry_run_output_serializes_preview_shape() {
        let output = render_dry_run_output(
            &source_api_preview(SourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_NONE),
            false,
        )
        .expect("expected dry-run preview to render");

        let rendered = render_output(output, EffectiveOutputMode::Text);
        assert_snapshot!(
            rendered,
            @r#"
            {
              "bodyKind": "json",
              "kind": "http_request",
              "method": "GET",
              "operation": "fetch",
              "selector": "/pulls"
            }
            "#
        );

        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&rendered).expect("expected raw JSON output"),
            json!({
                "operation": "fetch",
                "kind": "http_request",
                "method": "GET",
                "selector": "/pulls",
                "bodyKind": "json",
            })
        );
    }

    #[test]
    fn render_dry_run_output_serializes_verbose_preview_shape() {
        let output = render_dry_run_output(
            &source_api_preview(
                SourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_CONTINUATION_TOKEN,
            ),
            true,
        )
        .expect("expected verbose dry-run preview to render");

        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&render_output(
                output,
                EffectiveOutputMode::Json
            ))
            .expect("expected raw JSON output"),
            json!({
                "sourceKey": "github-prod",
                "provider": "github",
                "operation": "fetch",
                "kind": "http_request",
                "method": "GET",
                "selector": "/pulls",
                "url": "https://api.github.com/pulls",
                "host": "api.github.com",
                "headerNames": ["accept"],
                "bodyKind": "json",
                "bodyPaths": ["params"],
                "paginationPolicy": "continuation_token"
            })
        );
    }

    #[test]
    fn render_execute_output_keeps_single_page_json_shape_without_slurp() {
        let output = render_execute_output(
            vec![json_response(json_body(json!({"items": [1, 2]})))],
            &execute_preview(),
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
                "items": [1, 2]
            })
        );
    }

    #[test]
    fn render_execute_output_serializes_text_body_as_plain_string_in_json_mode() {
        let output = render_execute_output(
            vec![json_response(text_body("plain text\nnext line"))],
            &execute_preview(),
            render_options(),
        )
        .expect("expected source API response to render");

        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&render_output(
                output,
                EffectiveOutputMode::Json
            ))
            .expect("expected raw JSON output"),
            json!("plain text\nnext line")
        );
    }

    #[test]
    fn render_execute_output_pretty_prints_json_body_in_text_mode() {
        let output = render_execute_output(
            vec![json_response(json_body(json!({"items": [1, 2]})))],
            &execute_preview(),
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
            vec![json_response(text_body("plain text\r\nnext line\n"))],
            &execute_preview(),
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
                json_response(json_body(json!([{"id": 1}]))),
                json_response(json_body(json!([{"id": 2}]))),
            ],
            &execute_preview(),
            render_options(),
        )
        .expect("expected source API response to render");

        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&render_output(
                output,
                EffectiveOutputMode::Json
            ))
            .expect("expected raw JSON output"),
            json!([
                [{"id": 1}],
                [{"id": 2}]
            ])
        );
    }

    #[test]
    fn render_execute_output_slurps_paginated_json_arrays() {
        let output = render_execute_output(
            vec![
                json_response(json_body(json!([{"id": 1}]))),
                json_response(json_body(json!([{"id": 2}]))),
            ],
            &execute_preview(),
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
            json!([
                {"id": 1},
                {"id": 2}
            ])
        );
    }

    #[test]
    fn render_execute_output_applies_jq_to_assembled_body() {
        let output = render_execute_output(
            vec![json_response(json_body(
                json!({"items": [{"id": 1}, {"id": 2}]}),
            ))],
            &execute_preview(),
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
            json!([1, 2])
        );
    }

    #[test]
    fn render_execute_output_rejects_jq_for_text_bodies() {
        let error = render_execute_output(
            vec![json_response(text_body("plain text"))],
            &execute_preview(),
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
        let mut response = json_response(text_body("plain text\nnext line"));
        response.headers = vec![
            SourceApiHeader {
                name: "content-type".to_owned(),
                value: "text/plain".to_owned(),
                ..Default::default()
            },
            SourceApiHeader {
                name: "x-request-id".to_owned(),
                value: "rq_upstream_123".to_owned(),
                ..Default::default()
            },
        ];

        let output = render_execute_output(
            vec![response],
            &execute_preview(),
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
        let mut response = json_response(json_body(json!({"items": [1, 2]})));
        response.headers = vec![SourceApiHeader {
            name: "content-type".to_owned(),
            value: "application/json".to_owned(),
            ..Default::default()
        }];

        let output = render_execute_output(
            vec![response],
            &execute_preview(),
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
        let mut response = json_response(json_body(json!({"items": [1, 2]})));
        response.headers = vec![SourceApiHeader {
            name: "content-type".to_owned(),
            value: "application/json".to_owned(),
            ..Default::default()
        }];

        let output = render_execute_output(
            vec![response],
            &execute_preview(),
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
            serde_json::Value::Null
        );
    }

    #[test]
    fn render_execute_output_includes_preview_when_verbose() {
        let output = render_execute_output(
            vec![json_response(json_body(json!({"items": [1, 2]})))],
            &execute_preview(),
            SourceApiRenderOptions {
                verbose: true,
                ..render_options()
            },
        )
        .expect("expected verbose source API response to render");

        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&render_output(
                output,
                EffectiveOutputMode::Json
            ))
            .expect("expected raw JSON output"),
            json!({
                "preview": {
                    "sourceKey": "github-prod",
                    "provider": "github",
                    "operation": "fetch",
                    "kind": "http_request",
                    "method": "GET",
                    "selector": "/pulls",
                    "url": "https://api.github.com/pulls",
                    "host": "api.github.com",
                    "headerNames": ["accept"],
                    "bodyKind": "json",
                    "bodyPaths": ["params"],
                    "paginationPolicy": "none"
                },
                "source": {
                    "key": "github-prod",
                    "provider": "github",
                },
                "operation": "fetch",
                "status": 200,
                "contentType": "application/json",
                "body": {
                    "items": [1, 2]
                }
            })
        );
    }

    #[test]
    fn render_execute_output_renders_verbose_preview_and_response_in_text_mode() {
        let output = render_execute_output(
            vec![json_response(json_body(json!({"items": [1, 2]})))],
            &execute_preview(),
            SourceApiRenderOptions {
                verbose: true,
                ..render_options()
            },
        )
        .expect("expected verbose source API response to render");

        assert_snapshot!(
            render_output(output, EffectiveOutputMode::Text),
            @r#"
            {
              "body": {
                "items": [
                  1,
                  2
                ]
              },
              "contentType": "application/json",
              "operation": "fetch",
              "preview": {
                "bodyKind": "json",
                "bodyPaths": [
                  "params"
                ],
                "headerNames": [
                  "accept"
                ],
                "host": "api.github.com",
                "kind": "http_request",
                "method": "GET",
                "operation": "fetch",
                "paginationPolicy": "none",
                "provider": "github",
                "selector": "/pulls",
                "sourceKey": "github-prod",
                "url": "https://api.github.com/pulls"
              },
              "source": {
                "key": "github-prod",
                "provider": "github"
              },
              "status": 200
            }
            "#
        );
    }

    #[test]
    fn render_execute_output_emits_binary_stdout_when_stdout_is_not_a_tty() {
        let output = render_execute_output(
            vec![json_response(binary_body(b"hello"))],
            &execute_preview(),
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
            vec![json_response(binary_body(b"hello"))],
            &execute_preview(),
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

    fn json_response(body: SourceApiResponseBody) -> SourceApiExecutionPage {
        SourceApiExecutionPage {
            source: MessageField::some(SourceApiSource {
                source_key: "github-prod".to_owned(),
                provider:
                    crate::transport::source_api::SourceApiProvider::CLI_SOURCE_PROVIDER_GITHUB
                        .into(),
                display_name: None,
                ..Default::default()
            }),
            operation: "fetch".to_owned(),
            selector: None,
            status: 200,
            headers: Vec::new(),
            content_type: "application/json".to_owned(),
            body: Some(body),
            continuation_token: None,
        }
    }

    fn source_api_preview(pagination_policy: SourceApiPaginationPolicy) -> SourceApiPreview {
        SourceApiPreview {
            source_key: "github-prod".to_owned(),
            provider: crate::transport::source_api::SourceApiProvider::CLI_SOURCE_PROVIDER_GITHUB
                .into(),
            operation: "fetch".to_owned(),
            kind: SourceApiOperationKind::CLI_SOURCE_API_OPERATION_KIND_HTTP_REQUEST.into(),
            method: Some("GET".to_owned()),
            selector: Some("/pulls".to_owned()),
            url: Some("https://api.github.com/pulls".to_owned()),
            host: Some("api.github.com".to_owned()),
            header_names: vec!["accept".to_owned()],
            body_kind: SourceApiBodyKind::CLI_SOURCE_API_BODY_KIND_JSON.into(),
            body_paths: vec!["params".to_owned()],
            pagination_policy: pagination_policy.into(),
            ..Default::default()
        }
    }

    fn json_body(value: serde_json::Value) -> SourceApiResponseBody {
        SourceApiResponseBody::Json(Box::new(proto_json(value)))
    }

    fn text_body(value: &str) -> SourceApiResponseBody {
        SourceApiResponseBody::Text(value.to_owned())
    }

    fn binary_body(value: &[u8]) -> SourceApiResponseBody {
        SourceApiResponseBody::Binary(value.to_vec())
    }

    fn proto_json(value: serde_json::Value) -> ProtoJsonValue {
        proto_json_value_from_json(value).expect("expected test JSON value to convert to WKT")
    }

    fn execute_preview() -> SourceApiPreview {
        source_api_preview(SourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_NONE)
    }

    fn render_options() -> SourceApiRenderOptions {
        SourceApiRenderOptions {
            include: false,
            silent: false,
            slurp: false,
            jq: None,
            verbose: false,
        }
    }
}
