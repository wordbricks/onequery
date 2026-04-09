use crate::output::CommandOutput;
use crate::output::pretty_json_lines;
use crate::output::serialize_command_data;
use crate::transport::source_api::ExecuteSourceApiResponse;
use crate::transport::source_api::SourceApiDescriptor;
use crate::transport::source_api::SourceApiOperation;
use crate::transport::source_api::SourceApiOperationKind;
use crate::transport::source_api::SourceApiResponseBody;
use crate::transport::source_api::SourceApiSelectorKind;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;

use super::format::push_section;
use super::format::status_line;
use super::plan::DryRunPlan;
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

pub(super) fn render_dry_run_output(plan: DryRunPlan) -> Result<CommandOutput, CliError> {
    let data = serialize_command_data(&plan, "onequery use")?;
    Ok(CommandOutput::raw_json(pretty_json_lines(&data), data))
}

pub(super) fn render_execute_output(
    response: ExecuteSourceApiResponse,
    render: SourceApiRenderOptions,
) -> Result<CommandOutput, CliError> {
    let data = serialize_command_data(&response, "onequery use")?;
    let lines = render_response_lines(&response, render)?;
    Ok(CommandOutput::raw_json(lines, data))
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
    if !operation.field_policy.syntaxes.is_empty() {
        lines.push(format!(
            "  field syntax: {}",
            operation.field_policy.syntaxes.join(", ")
        ));
    }
    if !operation.field_policy.transport_rules.is_empty() {
        lines.push(format!(
            "  transport rules: {}",
            operation.field_policy.transport_rules.join(", ")
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
    render: SourceApiRenderOptions,
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
        SourceApiResponseBody::Binary { .. } => {
            // Comment: `CommandOutput` still models text-mode stdout as UTF-8 lines,
            // so keep binary responses explicit instead of silently lossy-decoding them.
            return Err(CliError::new(
                "failed to render source API response",
                "onequery use",
                ErrorStage::Render,
                "binary source API responses currently require `--output json`",
                vec!["retry onequery use --output json ...".to_owned()],
            ));
        }
    };

    if render.include && !body_lines.is_empty() {
        lines.push(String::new());
    }
    lines.extend(body_lines);
    Ok(lines)
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
