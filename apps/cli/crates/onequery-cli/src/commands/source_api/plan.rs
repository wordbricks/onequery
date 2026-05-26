use std::num::NonZeroU32;

use serde_json::Value;

use crate::cli::ApiArgs;
use crate::transport::source_api::SourceApiDescriptor;
use crate::transport::source_api::SourceApiDraft;
use crate::transport::source_api::SourceApiFieldEncoding;
use crate::transport::source_api::SourceApiHeader;
use crate::transport::source_api::SourceApiInputMode;
use crate::transport::source_api::SourceApiOperation;
use crate::transport::source_api::SourceApiOperationKind;
use crate::transport::source_api::SourceApiPaginationPolicy;
use crate::transport::source_api::SourceApiPathCapability;
use crate::transport::source_api::SourceApiRequestBody;
use crate::transport::source_api::SourceApiSelectorKind;
use crate::transport::source_api::proto_json_object_from_json;
use crate::transport::source_api::proto_json_value_from_json;
use crate::transport::source_api::source_api_field_policy_has_encoding;
use crate::transport::source_api::source_api_field_policy_has_path_capability;
use onequery_core::error::CliError;

use super::CommandContext;
use super::args::SourceApiInputReader;
use super::field_patch::FieldPathPolicy;
use super::field_patch::parse_field_patch;
use super::intent::ResolvedIntent;
use super::intent::resolve_intent;
use super::source_api_examples;
use super::source_api_parse_error;
use super::source_api_read_input_error;

#[derive(Debug, Clone, Eq, PartialEq)]
pub(super) struct SourceApiExecutionOptions {
    pub(super) paginate: bool,
    pub(super) max_pages: Option<u32>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(super) struct SourceApiRenderOptions {
    pub(super) include: bool,
    pub(super) silent: bool,
    pub(super) slurp: bool,
    pub(super) jq: Option<String>,
    pub(super) verbose: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub(super) struct ExecutePlan {
    pub(super) draft: SourceApiDraft,
    pub(super) execution: SourceApiExecutionOptions,
    pub(super) render: SourceApiRenderOptions,
}

#[derive(Debug, Clone, PartialEq)]
pub(super) enum PlannedCommand {
    Describe,
    DryRun { draft: SourceApiDraft },
    Execute { plan: ExecutePlan },
}

pub(super) async fn build_plan(
    args: &ApiArgs,
    descriptor: &SourceApiDescriptor,
    context: &CommandContext,
) -> Result<PlannedCommand, CliError> {
    let source_key = descriptor
        .source
        .as_option()
        .and_then(|source| source.source_key.as_deref())
        .unwrap_or(args.source.as_str());
    let intent = resolve_intent(args, descriptor, context)?;
    if matches!(intent, ResolvedIntent::Describe) {
        return Ok(PlannedCommand::Describe);
    }

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
        .find(|candidate| candidate.name.as_deref() == Some(operation_name.as_str()))
        .ok_or_else(|| {
            source_api_parse_error(
                context,
                "unsupported source API operation",
                format!("operation `{operation_name}` is not described for source `{source_key}`"),
                source_key,
            )
        })?;

    validate_selector(operation, selector.as_deref(), context, source_key)?;
    validate_pagination(args, operation, context, source_key)?;
    validate_method(args, operation, context, source_key)?;
    validate_field_flags(args, operation, context, source_key)?;
    validate_input(args, operation, context, source_key)?;

    let headers = parse_headers(&args.headers, operation, context, source_key)?;

    let field_policy = operation.field_policy.as_option();
    let mut reader = SourceApiInputReader::default();
    let field_patch = parse_field_patch(
        &args.raw_fields,
        &args.fields,
        FieldPathPolicy {
            supports_nested_paths: field_policy.is_some_and(|policy| {
                source_api_field_policy_has_path_capability(
                    policy,
                    SourceApiPathCapability::SOURCE_API_PATH_CAPABILITY_NESTED,
                )
            }),
            supports_array_paths: field_policy.is_some_and(|policy| {
                source_api_field_policy_has_path_capability(
                    policy,
                    SourceApiPathCapability::SOURCE_API_PATH_CAPABILITY_ARRAY,
                )
            }),
        },
        operation.name.as_deref().unwrap_or_default(),
        &mut reader,
        context,
        source_key,
    )
    .await?;
    let field_patch = field_patch
        .map(|value| {
            proto_json_object_from_json(value).map_err(|error| {
                source_api_parse_error(
                    context,
                    "invalid source API field patch",
                    format!("source API field patch must be valid JSON object data: {error}"),
                    source_key,
                )
            })
        })
        .transpose()?;
    let body = load_request_body(args, operation, &mut reader, context, source_key).await?;
    let body = match (field_patch, body) {
        (Some(field_patch), None) => Some(SourceApiRequestBody::FieldPatch(Box::new(field_patch))),
        (None, body) => body,
        (Some(_), Some(_)) => {
            return Err(source_api_parse_error(
                context,
                "source API input is ambiguous",
                format!(
                    "operation `{operation_name}` cannot combine `--input` with field patch flags"
                ),
                source_key,
            ));
        }
    };

    let draft = SourceApiDraft {
        operation_name: operation.name.clone(),
        descriptor_version: descriptor.descriptor_version.clone(),
        selector,
        method_override: normalized_method_override(args.method.as_deref()),
        headers,
        body,
        ..Default::default()
    };

    if args.dry_run {
        return Ok(PlannedCommand::DryRun { draft });
    }

    Ok(PlannedCommand::Execute {
        plan: ExecutePlan {
            draft,
            execution: SourceApiExecutionOptions {
                paginate: args.paginate,
                max_pages: args.max_pages.map(NonZeroU32::get),
            },
            render: SourceApiRenderOptions {
                include: args.include,
                silent: args.silent,
                slurp: args.slurp,
                jq: args.jq.clone(),
                verbose: context.verbose,
            },
        },
    })
}

fn validate_selector(
    operation: &SourceApiOperation,
    selector: Option<&str>,
    context: &CommandContext,
    source_key: &str,
) -> Result<(), CliError> {
    let operation_name = operation.name.as_deref().unwrap_or_default();
    match (
        operation.selector_kind.and_then(|value| value.as_known()),
        selector,
    ) {
        (Some(SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_NONE), None) => Ok(()),
        (Some(SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_NONE), Some(_)) => {
            Err(source_api_parse_error(
                context,
                "source API selector is not allowed",
                format!("operation `{operation_name}` does not accept a selector"),
                source_key,
            ))
        }
        (
            Some(
                SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_PATH
                | SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_IDENTIFIER,
            ),
            Some(_),
        ) => Ok(()),
        (
            Some(
                SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_PATH
                | SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_IDENTIFIER,
            ),
            None,
        ) => Err(source_api_parse_error(
            context,
            "source API selector is required",
            format!("operation `{operation_name}` requires a selector"),
            source_key,
        )),
        (Some(SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_UNSPECIFIED) | None, _) => {
            Err(source_api_parse_error(
                context,
                "source API descriptor is invalid",
                format!("operation `{operation_name}` has invalid selector metadata"),
                source_key,
            ))
        }
    }
}

fn validate_pagination(
    args: &ApiArgs,
    operation: &SourceApiOperation,
    context: &CommandContext,
    source_key: &str,
) -> Result<(), CliError> {
    let operation_name = operation.name.as_deref().unwrap_or_default();
    if args.slurp && !args.paginate {
        return Err(source_api_parse_error(
            context,
            "source API pagination flag requires `--paginate`",
            "`--slurp` only applies when `--paginate` is enabled",
            source_key,
        ));
    }

    if args.max_pages.is_some() && !args.paginate {
        return Err(source_api_parse_error(
            context,
            "source API pagination flag requires `--paginate`",
            "`--max-pages` only applies when `--paginate` is enabled",
            source_key,
        ));
    }

    if !args.paginate {
        return Ok(());
    }

    if operation
        .pagination_policy
        .and_then(|value| value.as_known())
        == Some(SourceApiPaginationPolicy::SOURCE_API_PAGINATION_POLICY_CONTINUATION_TOKEN)
    {
        return Ok(());
    }

    Err(source_api_parse_error(
        context,
        "source API pagination is not supported",
        format!("operation `{operation_name}` does not support pagination"),
        source_key,
    ))
}

fn validate_method(
    args: &ApiArgs,
    operation: &SourceApiOperation,
    context: &CommandContext,
    source_key: &str,
) -> Result<(), CliError> {
    let operation_name = operation.name.as_deref().unwrap_or_default();
    let Some(method) = normalized_method_override(args.method.as_deref()) else {
        return Ok(());
    };

    if operation.kind.and_then(|value| value.as_known())
        != Some(SourceApiOperationKind::SOURCE_API_OPERATION_KIND_HTTP_REQUEST)
    {
        return Err(source_api_parse_error(
            context,
            "source API method override is not allowed",
            format!("operation `{operation_name}` is not an HTTP request operation"),
            source_key,
        ));
    }

    let allowed_methods = operation
        .method_policy
        .as_option()
        .map(|policy| {
            policy
                .allowed_methods
                .iter()
                .filter_map(|candidate| normalized_method_override(Some(candidate.as_str())))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if !allowed_methods.is_empty() && !allowed_methods.iter().any(|candidate| candidate == &method)
    {
        return Err(source_api_parse_error(
            context,
            "source API method override is invalid",
            format!("method `{method}` is not allowed for operation `{operation_name}`"),
            source_key,
        ));
    }

    Ok(())
}

fn validate_field_flags(
    args: &ApiArgs,
    operation: &SourceApiOperation,
    context: &CommandContext,
    source_key: &str,
) -> Result<(), CliError> {
    let operation_name = operation.name.as_deref().unwrap_or_default();
    let field_policy = operation.field_policy.as_option();

    if !args.raw_fields.is_empty()
        && !field_policy.is_some_and(|policy| {
            source_api_field_policy_has_encoding(
                policy,
                SourceApiFieldEncoding::SOURCE_API_FIELD_ENCODING_RAW,
            )
        })
    {
        return Err(source_api_parse_error(
            context,
            "raw field patches are not supported",
            format!("operation `{operation_name}` does not accept `-f/--raw-field`"),
            source_key,
        ));
    }

    if !args.fields.is_empty()
        && !field_policy.is_some_and(|policy| {
            source_api_field_policy_has_encoding(
                policy,
                SourceApiFieldEncoding::SOURCE_API_FIELD_ENCODING_TYPED,
            )
        })
    {
        return Err(source_api_parse_error(
            context,
            "typed field patches are not supported",
            format!("operation `{operation_name}` does not accept `-F/--field`"),
            source_key,
        ));
    }

    Ok(())
}

fn validate_input(
    args: &ApiArgs,
    operation: &SourceApiOperation,
    context: &CommandContext,
    source_key: &str,
) -> Result<(), CliError> {
    let operation_name = operation.name.as_deref().unwrap_or_default();
    if args.input.is_none() {
        return Ok(());
    }

    if operation_input_mode(operation)
        .is_some_and(|mode| mode != SourceApiInputMode::SOURCE_API_INPUT_MODE_NONE)
    {
        return Ok(());
    }

    Err(source_api_parse_error(
        context,
        "source API request input is not supported",
        format!("operation `{operation_name}` does not accept `--input`"),
        source_key,
    ))
}

fn parse_headers(
    values: &[String],
    operation: &SourceApiOperation,
    context: &CommandContext,
    source_key: &str,
) -> Result<Vec<SourceApiHeader>, CliError> {
    let operation_name = operation.name.as_deref().unwrap_or_default();
    let allowed_header_names = operation
        .header_policy
        .as_option()
        .map(|policy| {
            policy
                .allowed_request_header_names
                .iter()
                .map(|value| value.to_ascii_lowercase())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

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

            if allowed_header_names.is_empty() {
                return Err(source_api_parse_error(
                    context,
                    "source API headers are not supported",
                    format!("operation `{operation_name}` does not accept `-H/--header`"),
                    source_key,
                ));
            }

            let normalized_name = name.to_ascii_lowercase();
            if !allowed_header_names
                .iter()
                .any(|candidate| candidate == &normalized_name)
            {
                return Err(source_api_parse_error(
                    context,
                    "source API header is not allowed",
                    format!("header `{name}` is not allowed for operation `{operation_name}`"),
                    source_key,
                ));
            }

            Ok(SourceApiHeader {
                name: Some(normalized_name),
                value: Some(header_value.trim().to_owned()),
                ..Default::default()
            })
        })
        .collect()
}

async fn load_request_body(
    args: &ApiArgs,
    operation: &SourceApiOperation,
    reader: &mut SourceApiInputReader,
    context: &CommandContext,
    source_key: &str,
) -> Result<Option<SourceApiRequestBody>, CliError> {
    let operation_name = operation.name.as_deref().unwrap_or_default();
    let Some(input_path) = args.input.as_deref() else {
        return Ok(None);
    };

    match operation_input_mode(operation) {
        Some(SourceApiInputMode::SOURCE_API_INPUT_MODE_NONE)
        | Some(SourceApiInputMode::SOURCE_API_INPUT_MODE_UNSPECIFIED)
        | None => Err(source_api_parse_error(
            context,
            "source API request input is not supported",
            format!("operation `{operation_name}` does not accept `--input`"),
            source_key,
        )),
        Some(SourceApiInputMode::SOURCE_API_INPUT_MODE_REQUEST_OBJECT) => {
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
            let value = proto_json_value_from_json(parsed_json).map_err(|parse_error| {
                source_api_read_input_error(
                    context,
                    "invalid source API request body",
                    parse_error.to_string(),
                    source_key,
                )
            })?;
            Ok(Some(SourceApiRequestBody::JsonBody(Box::new(value))))
        }
        Some(SourceApiInputMode::SOURCE_API_INPUT_MODE_REQUEST_BODY) => {
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
                        let value =
                            proto_json_value_from_json(parsed_json).map_err(|parse_error| {
                                source_api_read_input_error(
                                    context,
                                    "invalid source API request body",
                                    parse_error.to_string(),
                                    source_key,
                                )
                            })?;
                        Ok(Some(SourceApiRequestBody::JsonBody(Box::new(value))))
                    } else {
                        Ok(Some(SourceApiRequestBody::TextBody(text)))
                    }
                }
                Err(_) => Ok(Some(SourceApiRequestBody::BinaryBody(raw_input))),
            }
        }
    }
}

fn operation_input_mode(operation: &SourceApiOperation) -> Option<SourceApiInputMode> {
    operation
        .field_policy
        .as_option()
        .and_then(|policy| policy.input_mode)
        .and_then(|value| value.as_known())
}

fn normalized_method_override(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|candidate| !candidate.is_empty())
        .map(str::to_ascii_uppercase)
}

#[cfg(test)]
mod tests {
    use std::num::NonZeroU32;

    use buffa::MessageField;
    use onequery_core::error::ErrorStage;
    use pretty_assertions::assert_eq;
    use serde_json::json;
    use tempfile::tempdir;

    use crate::cli::ApiArgs;
    use crate::commands::ResolvedOrgSource;
    use crate::config::default_base_url;
    use crate::transport::source_api::SourceApiDescriptor;
    use crate::transport::source_api::SourceApiFieldEncoding;
    use crate::transport::source_api::SourceApiFieldPolicy;
    use crate::transport::source_api::SourceApiHeader;
    use crate::transport::source_api::SourceApiHeaderPolicy;
    use crate::transport::source_api::SourceApiInputMode;
    use crate::transport::source_api::SourceApiMethodPolicy;
    use crate::transport::source_api::SourceApiOperation;
    use crate::transport::source_api::SourceApiOperationKind;
    use crate::transport::source_api::SourceApiPaginationPolicy;
    use crate::transport::source_api::SourceApiPathCapability;
    use crate::transport::source_api::SourceApiRequestBody;
    use crate::transport::source_api::SourceApiSelectorKind;
    use crate::transport::source_api::json_from_proto_json_value;

    use super::CommandContext;
    use super::PlannedCommand;
    use super::build_plan;
    use super::parse_headers;
    use super::validate_pagination;

    fn nz_u32(value: u32) -> NonZeroU32 {
        NonZeroU32::new(value).unwrap_or_else(|| panic!("expected non-zero u32: {value}"))
    }

    #[test]
    fn validate_pagination_rejects_slurp_without_paginate() {
        let error = validate_pagination(
            &ApiArgs {
                slurp: true,
                ..api_args()
            },
            &operation(SourceApiPaginationPolicy::SOURCE_API_PAGINATION_POLICY_CONTINUATION_TOKEN),
            &context(),
            "github-prod",
        )
        .expect_err("expected `--slurp` without `--paginate` to fail");

        assert_eq!(error.stage, ErrorStage::ParseCommand);
        assert_eq!(
            error.why,
            "`--slurp` only applies when `--paginate` is enabled"
        );
    }

    #[test]
    fn validate_pagination_rejects_max_pages_without_paginate() {
        let error = validate_pagination(
            &ApiArgs {
                max_pages: Some(nz_u32(2)),
                ..api_args()
            },
            &operation(SourceApiPaginationPolicy::SOURCE_API_PAGINATION_POLICY_CONTINUATION_TOKEN),
            &context(),
            "github-prod",
        )
        .expect_err("expected `--max-pages` without `--paginate` to fail");

        assert_eq!(error.stage, ErrorStage::ParseCommand);
        assert_eq!(
            error.why,
            "`--max-pages` only applies when `--paginate` is enabled"
        );
    }

    #[test]
    fn validate_pagination_rejects_operations_without_pagination_support() {
        let error = validate_pagination(
            &ApiArgs {
                paginate: true,
                ..api_args()
            },
            &operation(SourceApiPaginationPolicy::SOURCE_API_PAGINATION_POLICY_NONE),
            &context(),
            "github-prod",
        )
        .expect_err("expected unsupported pagination to fail");

        assert_eq!(error.stage, ErrorStage::ParseCommand);
        assert_eq!(error.why, "operation `fetch` does not support pagination");
    }

    #[test]
    fn validate_pagination_accepts_supported_paginate_flags() {
        validate_pagination(
            &ApiArgs {
                paginate: true,
                max_pages: Some(nz_u32(3)),
                ..api_args()
            },
            &operation(SourceApiPaginationPolicy::SOURCE_API_PAGINATION_POLICY_CONTINUATION_TOKEN),
            &context(),
            "github-prod",
        )
        .expect("expected opaque-token pagination to validate");
    }

    #[test]
    fn parse_headers_rejects_headers_when_operation_disallows_them() {
        let error = parse_headers(
            &["Accept: application/json".to_owned()],
            &operation(SourceApiPaginationPolicy::SOURCE_API_PAGINATION_POLICY_NONE),
            &context(),
            "github-prod",
        )
        .expect_err("expected headers to be rejected when no allowlist is present");

        assert_eq!(error.stage, ErrorStage::ParseCommand);
        assert_eq!(error.why, "operation `fetch` does not accept `-H/--header`");
    }

    #[test]
    fn parse_headers_accepts_allowlisted_headers_case_insensitively() {
        let headers = parse_headers(
            &["accept: application/json".to_owned()],
            &SourceApiOperation {
                header_policy: MessageField::some(SourceApiHeaderPolicy {
                    allowed_request_header_names: vec!["Accept".to_owned()],
                    ..Default::default()
                }),
                ..operation(SourceApiPaginationPolicy::SOURCE_API_PAGINATION_POLICY_NONE)
            },
            &context(),
            "github-prod",
        )
        .expect("expected allowlisted header to validate");

        assert_eq!(
            headers,
            vec![SourceApiHeader {
                name: Some("accept".to_owned()),
                value: Some("application/json".to_owned()),
                ..Default::default()
            }]
        );
    }

    #[tokio::test]
    async fn build_plan_rejects_input_when_operation_disallows_it() {
        let error = build_plan(
            &ApiArgs {
                input: Some("request.json".to_owned()),
                ..api_args()
            },
            &descriptor_with_operation(SourceApiOperation {
                field_policy: MessageField::some(SourceApiFieldPolicy {
                    input_mode: Some(SourceApiInputMode::SOURCE_API_INPUT_MODE_NONE.into()),
                    ..SourceApiFieldPolicy::default()
                }),
                ..operation(SourceApiPaginationPolicy::SOURCE_API_PAGINATION_POLICY_NONE)
            }),
            &context(),
        )
        .await
        .expect_err("expected unsupported `--input` to fail before reading input");

        assert_eq!(error.stage, ErrorStage::ParseCommand);
        assert_eq!(error.why, "operation `fetch` does not accept `--input`");
    }

    #[tokio::test]
    async fn build_plan_rejects_nested_field_paths_when_operation_disallows_them() {
        let error = build_plan(
            &ApiArgs {
                fields: vec!["request[database]=analytics".to_owned()],
                target: None,
                ..api_args()
            },
            &descriptor_with_operation(SourceApiOperation {
                selector_kind: Some(SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_NONE.into()),
                field_policy: MessageField::some(SourceApiFieldPolicy {
                    field_encodings: vec![
                        SourceApiFieldEncoding::SOURCE_API_FIELD_ENCODING_TYPED.into(),
                    ],
                    ..SourceApiFieldPolicy::default()
                }),
                ..operation(SourceApiPaginationPolicy::SOURCE_API_PAGINATION_POLICY_NONE)
            }),
            &context(),
        )
        .await
        .expect_err("expected unsupported nested field path to fail locally");

        assert_eq!(error.stage, ErrorStage::ParseCommand);
        assert_eq!(
            error.why,
            "operation `fetch` does not support nested field paths like `key[subkey]=value`"
        );
    }

    #[tokio::test]
    async fn build_plan_rejects_array_field_paths_when_operation_disallows_them() {
        let error = build_plan(
            &ApiArgs {
                fields: vec!["database[]=analytics".to_owned()],
                target: None,
                ..api_args()
            },
            &descriptor_with_operation(SourceApiOperation {
                selector_kind: Some(SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_NONE.into()),
                field_policy: MessageField::some(SourceApiFieldPolicy {
                    field_encodings: vec![
                        SourceApiFieldEncoding::SOURCE_API_FIELD_ENCODING_TYPED.into(),
                    ],
                    path_capabilities: vec![
                        SourceApiPathCapability::SOURCE_API_PATH_CAPABILITY_NESTED.into(),
                    ],
                    ..SourceApiFieldPolicy::default()
                }),
                ..operation(SourceApiPaginationPolicy::SOURCE_API_PAGINATION_POLICY_NONE)
            }),
            &context(),
        )
        .await
        .expect_err("expected unsupported array field path to fail locally");

        assert_eq!(error.stage, ErrorStage::ParseCommand);
        assert_eq!(
            error.why,
            "operation `fetch` does not support array field paths like `key[]=value`"
        );
    }

    #[tokio::test]
    async fn build_plan_converts_json_object_input_into_generated_wkt_value() {
        let temp_dir = tempdir().expect("expected temp dir");
        let input_path = temp_dir.path().join("request.json");
        std::fs::write(&input_path, "{\"viewer\":true,\"ids\":[1,2],\"limit\":25}")
            .expect("expected request input file");

        let draft = extract_draft(
            build_plan(
                &ApiArgs {
                    dry_run: true,
                    input: Some(input_path.display().to_string()),
                    target: None,
                    ..api_args()
                },
                &descriptor_with_operation(SourceApiOperation {
                    selector_kind: Some(
                        SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_NONE.into(),
                    ),
                    field_policy: MessageField::some(SourceApiFieldPolicy {
                        input_mode: Some(
                            SourceApiInputMode::SOURCE_API_INPUT_MODE_REQUEST_OBJECT.into(),
                        ),
                        ..SourceApiFieldPolicy::default()
                    }),
                    ..operation(SourceApiPaginationPolicy::SOURCE_API_PAGINATION_POLICY_NONE)
                }),
                &context(),
            )
            .await
            .expect("expected request object input to build a draft"),
        );

        match draft.body {
            Some(SourceApiRequestBody::JsonBody(value)) => {
                assert_eq!(
                    json_from_proto_json_value(value.as_ref())
                        .expect("expected generated protobuf WKT JSON"),
                    json!({
                        "viewer": true,
                        "ids": [1, 2],
                        "limit": 25,
                    })
                );
            }
            other => panic!("expected JSON body, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn build_plan_converts_field_patches_into_generated_wkt_structs() {
        let draft = extract_draft(
            build_plan(
                &ApiArgs {
                    fields: vec![
                        "params[limit]=25".to_owned(),
                        "params[labels][]=bug".to_owned(),
                        "params[labels][]=feature".to_owned(),
                    ],
                    target: None,
                    ..api_args()
                },
                &descriptor_with_operation(SourceApiOperation {
                    selector_kind: Some(
                        SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_NONE.into(),
                    ),
                    field_policy: MessageField::some(SourceApiFieldPolicy {
                        field_encodings: vec![
                            SourceApiFieldEncoding::SOURCE_API_FIELD_ENCODING_TYPED.into(),
                        ],
                        path_capabilities: vec![
                            SourceApiPathCapability::SOURCE_API_PATH_CAPABILITY_NESTED.into(),
                            SourceApiPathCapability::SOURCE_API_PATH_CAPABILITY_ARRAY.into(),
                        ],
                        ..SourceApiFieldPolicy::default()
                    }),
                    ..operation(SourceApiPaginationPolicy::SOURCE_API_PAGINATION_POLICY_NONE)
                }),
                &context(),
            )
            .await
            .expect("expected typed field patch to build a draft"),
        );

        match draft.body {
            Some(SourceApiRequestBody::FieldPatch(value)) => {
                assert_eq!(
                    serde_json::to_value(value.as_ref())
                        .expect("expected generated protobuf Struct to serialize"),
                    json!({
                        "params": {
                            "limit": 25.0,
                            "labels": ["bug", "feature"],
                        }
                    })
                );
            }
            other => panic!("expected field patch body, got {other:?}"),
        }
    }

    fn context() -> CommandContext {
        CommandContext {
            command_line: "onequery api --source github://github-prod".to_owned(),
            base_url: default_base_url(),
            request_id: None,
            resolved_org: Some("demo-org".to_owned()),
            resolved_org_source: ResolvedOrgSource::Flag,
            verbose: false,
        }
    }

    fn operation(pagination_policy: SourceApiPaginationPolicy) -> SourceApiOperation {
        SourceApiOperation {
            name: Some("fetch".to_owned()),
            kind: Some(SourceApiOperationKind::SOURCE_API_OPERATION_KIND_HTTP_REQUEST.into()),
            summary: None,
            description: None,
            selector_kind: Some(SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_PATH.into()),
            selector_label: None,
            method_policy: MessageField::some(SourceApiMethodPolicy::default()),
            field_policy: MessageField::some(SourceApiFieldPolicy::default()),
            header_policy: MessageField::some(SourceApiHeaderPolicy::default()),
            pagination_policy: Some(pagination_policy.into()),
            examples: Vec::new(),
            notes: Vec::new(),
            ..Default::default()
        }
    }

    fn api_args() -> ApiArgs {
        ApiArgs {
            source: crate::identifiers::test_source_reference("github://github-prod"),
            op: Some("fetch".to_owned()),
            target: Some("/pulls".to_owned()),
            method: None,
            headers: Vec::new(),
            raw_fields: Vec::new(),
            fields: Vec::new(),
            input: None,
            paginate: false,
            slurp: false,
            max_pages: None,
            include: false,
            silent: false,
            jq: None,
            dry_run: false,
        }
    }

    fn descriptor_with_operation(operation: SourceApiOperation) -> SourceApiDescriptor {
        SourceApiDescriptor {
            source: MessageField::some(crate::transport::source_api::SourceApiSource {
                source_key: Some("github-prod".to_owned()),
                provider: Some("github".to_owned()),
                display_name: Some("GitHub".to_owned()),
                ..Default::default()
            }),
            descriptor_version: Some("2026-04-09".to_owned()),
            default_path_operation_name: Some("fetch".to_owned()),
            operations: vec![operation],
            examples: Vec::new(),
            notes: Vec::new(),
            ..Default::default()
        }
    }

    fn extract_draft(plan: PlannedCommand) -> crate::transport::source_api::SourceApiDraft {
        match plan {
            PlannedCommand::DryRun { draft } => draft,
            PlannedCommand::Execute { plan } => plan.draft,
            PlannedCommand::Describe => panic!("expected a source API draft"),
        }
    }
}
