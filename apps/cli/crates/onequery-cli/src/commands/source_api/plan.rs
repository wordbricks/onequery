use serde_json::Value;

use crate::cli::UseArgs;
use crate::transport::source_api::ExecuteSourceApiRequestPayload;
use crate::transport::source_api::SourceApiDescriptor;
use crate::transport::source_api::SourceApiHeader;
use crate::transport::source_api::SourceApiOperation;
use crate::transport::source_api::SourceApiOperationKind;
use crate::transport::source_api::SourceApiRequestBody;
use crate::transport::source_api::SourceApiSelectorKind;
use onequery_cli_core::error::CliError;

use super::CommandContext;
use super::args::SourceApiInputReader;
use super::field_patch::parse_field_patch;
use super::intent::ResolvedIntent;
use super::intent::resolve_intent;
use super::source_api_examples;
use super::source_api_parse_error;
use super::source_api_read_input_error;

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(super) struct SourceApiRenderOptions {
    pub(super) include: bool,
    pub(super) silent: bool,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(super) struct ExecutePlan {
    pub(super) request: ExecuteSourceApiRequestPayload,
    pub(super) render: SourceApiRenderOptions,
}

#[derive(Debug, Clone, serde::Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(super) struct DryRunPlan {
    pub(super) source: String,
    pub(super) provider: String,
    pub(super) descriptor_version: String,
    pub(super) request: ExecuteSourceApiRequestPayload,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(super) enum PlannedCommand {
    Describe,
    DryRun { plan: DryRunPlan },
    Execute { plan: ExecutePlan },
}

pub(super) async fn build_plan(
    args: &UseArgs,
    descriptor: &SourceApiDescriptor,
    context: &CommandContext,
) -> Result<PlannedCommand, CliError> {
    let intent = resolve_intent(args, descriptor, context)?;
    if matches!(intent, ResolvedIntent::Describe) {
        return Ok(PlannedCommand::Describe);
    }

    reject_unimplemented_flags(args, context)?;

    let ResolvedIntent::Execute {
        operation: operation_name,
        selector,
    } = intent
    else {
        return Ok(PlannedCommand::Describe);
    };

    let operation = descriptor
        .operations
        .iter()
        .find(|candidate| candidate.name == operation_name)
        .ok_or_else(|| {
            source_api_parse_error(
                context,
                "unsupported source API operation",
                format!(
                    "operation `{operation_name}` is not described for source `{}`",
                    descriptor.source.key
                ),
                descriptor.source.key.as_str(),
            )
        })?;

    validate_selector(
        operation,
        selector.as_deref(),
        context,
        descriptor.source.key.as_str(),
    )?;
    validate_method(args, operation, context, descriptor.source.key.as_str())?;
    validate_field_flags(args, operation, context, descriptor.source.key.as_str())?;

    let headers = parse_headers(
        &args.headers,
        operation,
        context,
        descriptor.source.key.as_str(),
    )?;

    let mut reader = SourceApiInputReader::default();
    let field_patch = parse_field_patch(
        &args.raw_fields,
        &args.fields,
        &mut reader,
        context,
        descriptor.source.key.as_str(),
    )
    .await?;
    let body = load_request_body(
        args,
        operation,
        &mut reader,
        context,
        descriptor.source.key.as_str(),
    )
    .await?;

    let request = ExecuteSourceApiRequestPayload {
        descriptor_version: Some(descriptor.descriptor_version.clone()),
        operation: operation.name.clone(),
        selector,
        method_override: normalized_method_override(args.method.as_deref()),
        headers,
        field_patch,
        body,
        page_token: None,
    };

    if args.dry_run {
        return Ok(PlannedCommand::DryRun {
            plan: DryRunPlan {
                source: descriptor.source.key.clone(),
                provider: descriptor.source.provider.clone(),
                descriptor_version: descriptor.descriptor_version.clone(),
                request,
            },
        });
    }

    Ok(PlannedCommand::Execute {
        plan: ExecutePlan {
            request,
            render: SourceApiRenderOptions {
                include: args.include,
                silent: args.silent,
            },
        },
    })
}

fn reject_unimplemented_flags(args: &UseArgs, context: &CommandContext) -> Result<(), CliError> {
    let mut unsupported_flags = Vec::new();
    if args.paginate {
        unsupported_flags.push("--paginate");
    }
    if args.slurp {
        unsupported_flags.push("--slurp");
    }
    if args.max_pages.is_some() {
        unsupported_flags.push("--max-pages");
    }
    if args.jq.is_some() {
        unsupported_flags.push("--jq");
    }

    if unsupported_flags.is_empty() {
        return Ok(());
    }

    Err(source_api_parse_error(
        context,
        "source API flag is not implemented yet",
        format!(
            "{} not implemented in this CLI cutover step",
            unsupported_flags.join(", ")
        ),
        args.source.as_str(),
    ))
}

fn validate_selector(
    operation: &SourceApiOperation,
    selector: Option<&str>,
    context: &CommandContext,
    source_key: &str,
) -> Result<(), CliError> {
    match (&operation.selector_kind, selector) {
        (SourceApiSelectorKind::None, None) => Ok(()),
        (SourceApiSelectorKind::None, Some(_)) => Err(source_api_parse_error(
            context,
            "source API selector is not allowed",
            format!("operation `{}` does not accept a selector", operation.name),
            source_key,
        )),
        (SourceApiSelectorKind::Path | SourceApiSelectorKind::Identifier, Some(_)) => Ok(()),
        (SourceApiSelectorKind::Path | SourceApiSelectorKind::Identifier, None) => {
            Err(source_api_parse_error(
                context,
                "source API selector is required",
                format!("operation `{}` requires a selector", operation.name),
                source_key,
            ))
        }
    }
}

fn validate_method(
    args: &UseArgs,
    operation: &SourceApiOperation,
    context: &CommandContext,
    source_key: &str,
) -> Result<(), CliError> {
    let Some(method) = normalized_method_override(args.method.as_deref()) else {
        return Ok(());
    };

    if operation.kind != SourceApiOperationKind::HttpRequest {
        return Err(source_api_parse_error(
            context,
            "source API method override is not allowed",
            format!(
                "operation `{}` is not an HTTP request operation",
                operation.name
            ),
            source_key,
        ));
    }

    let allowed_methods = operation
        .method_policy
        .allowed_methods
        .iter()
        .filter_map(|candidate| normalized_method_override(Some(candidate.as_str())))
        .collect::<Vec<_>>();
    if !allowed_methods.is_empty() && !allowed_methods.iter().any(|candidate| candidate == &method)
    {
        return Err(source_api_parse_error(
            context,
            "source API method override is invalid",
            format!(
                "method `{method}` is not allowed for operation `{}`",
                operation.name
            ),
            source_key,
        ));
    }

    Ok(())
}

fn validate_field_flags(
    args: &UseArgs,
    operation: &SourceApiOperation,
    context: &CommandContext,
    source_key: &str,
) -> Result<(), CliError> {
    if !args.raw_fields.is_empty() && !operation.field_policy.supports_raw_fields {
        return Err(source_api_parse_error(
            context,
            "raw field patches are not supported",
            format!(
                "operation `{}` does not accept `-f/--raw-field`",
                operation.name
            ),
            source_key,
        ));
    }

    if !args.fields.is_empty() && !operation.field_policy.supports_typed_fields {
        return Err(source_api_parse_error(
            context,
            "typed field patches are not supported",
            format!(
                "operation `{}` does not accept `-F/--field`",
                operation.name
            ),
            source_key,
        ));
    }

    Ok(())
}

fn parse_headers(
    values: &[String],
    operation: &SourceApiOperation,
    context: &CommandContext,
    source_key: &str,
) -> Result<Vec<SourceApiHeader>, CliError> {
    let allowed_names = operation
        .header_policy
        .allowed_names
        .iter()
        .map(|value| value.to_ascii_lowercase())
        .collect::<Vec<_>>();

    values
        .iter()
        .map(|value| {
            let Some((name, header_value)) = value.split_once(':') else {
                return Err(source_api_parse_error(
                    context,
                    "invalid source API header",
                    "headers must use KEY:VALUE syntax",
                    source_key,
                ));
            };

            let name = name.trim();
            if name.is_empty() {
                return Err(source_api_parse_error(
                    context,
                    "invalid source API header",
                    "header name must not be empty",
                    source_key,
                ));
            }

            if !allowed_names.is_empty()
                && !allowed_names
                    .iter()
                    .any(|candidate| candidate == &name.to_ascii_lowercase())
            {
                return Err(source_api_parse_error(
                    context,
                    "source API header is not allowed",
                    format!(
                        "header `{name}` is not allowed for operation `{}`",
                        operation.name
                    ),
                    source_key,
                ));
            }

            Ok(SourceApiHeader {
                name: name.to_owned(),
                value: header_value.trim().to_owned(),
            })
        })
        .collect()
}

async fn load_request_body(
    args: &UseArgs,
    operation: &SourceApiOperation,
    reader: &mut SourceApiInputReader,
    context: &CommandContext,
    source_key: &str,
) -> Result<SourceApiRequestBody, CliError> {
    let Some(input_path) = args.input.as_deref() else {
        return Ok(SourceApiRequestBody::None);
    };

    match operation.kind {
        SourceApiOperationKind::StructuredRequest => {
            let raw_input = reader
                .read_text(
                    input_path,
                    context,
                    "failed to read source API request input",
                    source_api_examples(source_key),
                )
                .await?;
            let parsed_json = serde_json::from_str::<Value>(&raw_input).map_err(|parse_error| {
                source_api_read_input_error(
                    context,
                    "invalid source API request body",
                    parse_error.to_string(),
                    source_key,
                )
            })?;
            if !parsed_json.is_object() {
                return Err(source_api_read_input_error(
                    context,
                    "invalid source API request body",
                    "structured request input must be one JSON object".to_owned(),
                    source_key,
                ));
            }
            Ok(SourceApiRequestBody::Json { value: parsed_json })
        }
        SourceApiOperationKind::HttpRequest => {
            let raw_input = reader
                .read_bytes(
                    input_path,
                    context,
                    "failed to read source API request input",
                    source_api_examples(source_key),
                )
                .await?;

            match String::from_utf8(raw_input.clone()) {
                Ok(text) => {
                    if let Ok(parsed_json) = serde_json::from_str::<Value>(&text) {
                        Ok(SourceApiRequestBody::Json { value: parsed_json })
                    } else {
                        Ok(SourceApiRequestBody::Text { value: text })
                    }
                }
                Err(_) => Ok(SourceApiRequestBody::Binary {
                    value_base64: base64::Engine::encode(
                        &base64::engine::general_purpose::STANDARD,
                        raw_input,
                    ),
                }),
            }
        }
    }
}

fn normalized_method_override(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|candidate| !candidate.is_empty())
        .map(|method| method.to_ascii_uppercase())
}
