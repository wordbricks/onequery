use buffa::MessageField;
use serde_json::Value;

use crate::cli::ApiArgs;
use crate::transport::source_api::SourceApiDescriptor;
use crate::transport::source_api::SourceApiDraft;
use crate::transport::source_api::SourceApiHeader;
use crate::transport::source_api::SourceApiInputMode;
use crate::transport::source_api::SourceApiOperation;
use crate::transport::source_api::SourceApiOperationKind;
use crate::transport::source_api::SourceApiPaginationPolicy;
use crate::transport::source_api::SourceApiRequestBody;
use crate::transport::source_api::SourceApiSelectorKind;
use crate::transport::source_api::proto_json_object_from_json;
use crate::transport::source_api::proto_json_value_from_json;
use crate::transport::source_api::source_api_input_mode_or_none;
use crate::transport::source_api::source_api_operation_kind_or_http_request;
use crate::transport::source_api::source_api_pagination_policy_or_none;
use crate::transport::source_api::source_api_selector_kind_or_none;
use onequery_cli_core::error::CliError;

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
    validate_pagination(args, operation, context, descriptor.source.key.as_str())?;
    validate_method(args, operation, context, descriptor.source.key.as_str())?;
    validate_field_flags(args, operation, context, descriptor.source.key.as_str())?;
    validate_input(args, operation, context, descriptor.source.key.as_str())?;

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
        FieldPathPolicy {
            supports_nested_paths: operation.field_policy.supports_nested_paths,
            supports_array_paths: operation.field_policy.supports_array_paths,
        },
        operation.name.as_str(),
        &mut reader,
        context,
        descriptor.source.key.as_str(),
    )
    .await?;
    let field_patch = field_patch
        .map(|value| {
            proto_json_object_from_json(value).map_err(|error| {
                source_api_parse_error(
                    context,
                    "invalid source API field patch",
                    format!("source API field patch must be valid JSON object data: {error}"),
                    descriptor.source.key.as_str(),
                )
            })
        })
        .transpose()?;
    let body = load_request_body(
        args,
        operation,
        &mut reader,
        context,
        descriptor.source.key.as_str(),
    )
    .await?;

    let draft = SourceApiDraft {
        org_slug: String::new(),
        source_key: String::new(),
        operation: operation.name.clone(),
        selector,
        method_override: normalized_method_override(args.method.as_deref()),
        headers,
        field_patch: field_patch
            .map(MessageField::some)
            .unwrap_or_else(MessageField::none),
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
                max_pages: args.max_pages,
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
    match (
        source_api_selector_kind_or_none(operation.selector_kind),
        selector,
    ) {
        (SourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_NONE, None) => Ok(()),
        (SourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_NONE, Some(_)) => {
            Err(source_api_parse_error(
                context,
                "source API selector is not allowed",
                format!("operation `{}` does not accept a selector", operation.name),
                source_key,
            ))
        }
        (
            SourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_PATH
            | SourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_IDENTIFIER,
            Some(_),
        ) => Ok(()),
        (
            SourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_PATH
            | SourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_IDENTIFIER,
            None,
        ) => Err(source_api_parse_error(
            context,
            "source API selector is required",
            format!("operation `{}` requires a selector", operation.name),
            source_key,
        )),
        (SourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_UNSPECIFIED, _) => unreachable!(),
    }
}

fn validate_pagination(
    args: &ApiArgs,
    operation: &SourceApiOperation,
    context: &CommandContext,
    source_key: &str,
) -> Result<(), CliError> {
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

    if let Some(max_pages) = args.max_pages
        && max_pages == 0
    {
        return Err(source_api_parse_error(
            context,
            "source API page limit is invalid",
            "`--max-pages` must be greater than 0",
            source_key,
        ));
    }

    if !args.paginate {
        return Ok(());
    }

    if source_api_pagination_policy_or_none(operation.pagination_policy)
        == SourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_CONTINUATION_TOKEN
    {
        return Ok(());
    }

    Err(source_api_parse_error(
        context,
        "source API pagination is not supported",
        format!("operation `{}` does not support pagination", operation.name),
        source_key,
    ))
}

fn validate_method(
    args: &ApiArgs,
    operation: &SourceApiOperation,
    context: &CommandContext,
    source_key: &str,
) -> Result<(), CliError> {
    let Some(method) = normalized_method_override(args.method.as_deref()) else {
        return Ok(());
    };

    if source_api_operation_kind_or_http_request(operation.kind)
        != SourceApiOperationKind::CLI_SOURCE_API_OPERATION_KIND_HTTP_REQUEST
    {
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
    args: &ApiArgs,
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

fn validate_input(
    args: &ApiArgs,
    operation: &SourceApiOperation,
    context: &CommandContext,
    source_key: &str,
) -> Result<(), CliError> {
    if args.input.is_none() {
        return Ok(());
    }

    if operation.field_policy.accepts_input
        && source_api_input_mode_or_none(operation.field_policy.input_mode)
            != SourceApiInputMode::CLI_SOURCE_API_INPUT_MODE_NONE
    {
        return Ok(());
    }

    Err(source_api_parse_error(
        context,
        "source API request input is not supported",
        format!("operation `{}` does not accept `--input`", operation.name),
        source_key,
    ))
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

            if allowed_names.is_empty() {
                return Err(source_api_parse_error(
                    context,
                    "source API headers are not supported",
                    format!(
                        "operation `{}` does not accept `-H/--header`",
                        operation.name
                    ),
                    source_key,
                ));
            }

            if !allowed_names
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
    let Some(input_path) = args.input.as_deref() else {
        return Ok(None);
    };

    match source_api_input_mode_or_none(operation.field_policy.input_mode) {
        SourceApiInputMode::CLI_SOURCE_API_INPUT_MODE_NONE => Err(source_api_parse_error(
            context,
            "source API request input is not supported",
            format!("operation `{}` does not accept `--input`", operation.name),
            source_key,
        )),
        SourceApiInputMode::CLI_SOURCE_API_INPUT_MODE_REQUEST_OBJECT => {
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
        SourceApiInputMode::CLI_SOURCE_API_INPUT_MODE_REQUEST_BODY => {
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
        SourceApiInputMode::CLI_SOURCE_API_INPUT_MODE_UNSPECIFIED => unreachable!(),
    }
}

fn normalized_method_override(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|candidate| !candidate.is_empty())
        .map(str::to_ascii_uppercase)
}

#[cfg(test)]
mod tests {
    use buffa::MessageField;
    use onequery_cli_core::error::ErrorStage;
    use pretty_assertions::assert_eq;
    use serde_json::json;
    use tempfile::tempdir;

    use crate::cli::ApiArgs;
    use crate::commands::ResolvedOrgSource;
    use crate::config::default_base_url;
    use crate::transport::source_api::SourceApiDescriptor;
    use crate::transport::source_api::SourceApiFieldPolicy;
    use crate::transport::source_api::SourceApiHeader;
    use crate::transport::source_api::SourceApiHeaderPolicy;
    use crate::transport::source_api::SourceApiInputMode;
    use crate::transport::source_api::SourceApiMethodPolicy;
    use crate::transport::source_api::SourceApiOperation;
    use crate::transport::source_api::SourceApiOperationKind;
    use crate::transport::source_api::SourceApiPaginationPolicy;
    use crate::transport::source_api::SourceApiRequestBody;
    use crate::transport::source_api::SourceApiSelectorKind;
    use crate::transport::source_api::json_from_proto_json_value;

    use super::CommandContext;
    use super::PlannedCommand;
    use super::build_plan;
    use super::parse_headers;
    use super::validate_pagination;

    #[test]
    fn validate_pagination_rejects_slurp_without_paginate() {
        let error = validate_pagination(
            &ApiArgs {
                slurp: true,
                ..api_args()
            },
            &operation(
                SourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_CONTINUATION_TOKEN,
            ),
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
                max_pages: Some(2),
                ..api_args()
            },
            &operation(
                SourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_CONTINUATION_TOKEN,
            ),
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
    fn validate_pagination_rejects_zero_max_pages() {
        let error = validate_pagination(
            &ApiArgs {
                paginate: true,
                max_pages: Some(0),
                ..api_args()
            },
            &operation(
                SourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_CONTINUATION_TOKEN,
            ),
            &context(),
            "github-prod",
        )
        .expect_err("expected zero `--max-pages` to fail");

        assert_eq!(error.stage, ErrorStage::ParseCommand);
        assert_eq!(error.why, "`--max-pages` must be greater than 0");
    }

    #[test]
    fn validate_pagination_rejects_operations_without_pagination_support() {
        let error = validate_pagination(
            &ApiArgs {
                paginate: true,
                ..api_args()
            },
            &operation(SourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_NONE),
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
                max_pages: Some(3),
                ..api_args()
            },
            &operation(
                SourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_CONTINUATION_TOKEN,
            ),
            &context(),
            "github-prod",
        )
        .expect("expected opaque-token pagination to validate");
    }

    #[test]
    fn parse_headers_rejects_headers_when_operation_disallows_them() {
        let error = parse_headers(
            &["Accept: application/json".to_owned()],
            &operation(SourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_NONE),
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
                    allowed_names: vec!["Accept".to_owned()],
                    ..Default::default()
                }),
                ..operation(SourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_NONE)
            },
            &context(),
            "github-prod",
        )
        .expect("expected allowlisted header to validate");

        assert_eq!(
            headers,
            vec![SourceApiHeader {
                name: "accept".to_owned(),
                value: "application/json".to_owned(),
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
                    accepts_input: false,
                    input_mode: SourceApiInputMode::CLI_SOURCE_API_INPUT_MODE_NONE.into(),
                    ..SourceApiFieldPolicy::default()
                }),
                ..operation(SourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_NONE)
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
                selector_kind: SourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_NONE.into(),
                field_policy: MessageField::some(SourceApiFieldPolicy {
                    supports_typed_fields: true,
                    supports_nested_paths: false,
                    supports_array_paths: false,
                    ..SourceApiFieldPolicy::default()
                }),
                ..operation(SourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_NONE)
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
                selector_kind: SourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_NONE.into(),
                field_policy: MessageField::some(SourceApiFieldPolicy {
                    supports_typed_fields: true,
                    supports_nested_paths: true,
                    supports_array_paths: false,
                    ..SourceApiFieldPolicy::default()
                }),
                ..operation(SourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_NONE)
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
                    selector_kind: SourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_NONE.into(),
                    field_policy: MessageField::some(SourceApiFieldPolicy {
                        accepts_input: true,
                        input_mode: SourceApiInputMode::CLI_SOURCE_API_INPUT_MODE_REQUEST_OBJECT
                            .into(),
                        ..SourceApiFieldPolicy::default()
                    }),
                    ..operation(SourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_NONE)
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
                    selector_kind: SourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_NONE.into(),
                    field_policy: MessageField::some(SourceApiFieldPolicy {
                        supports_typed_fields: true,
                        supports_nested_paths: true,
                        supports_array_paths: true,
                        ..SourceApiFieldPolicy::default()
                    }),
                    ..operation(SourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_NONE)
                }),
                &context(),
            )
            .await
            .expect("expected typed field patch to build a draft"),
        );

        assert_eq!(
            serde_json::to_value(
                draft
                    .field_patch
                    .as_option()
                    .expect("expected field patch to be present")
            )
            .expect("expected generated protobuf Struct to serialize"),
            json!({
                "params": {
                    "limit": 25.0,
                    "labels": ["bug", "feature"],
                }
            })
        );
    }

    fn context() -> CommandContext {
        CommandContext {
            command_line: "onequery api --source github-prod".to_owned(),
            base_url: default_base_url(),
            request_id: None,
            resolved_org: Some("demo-org".to_owned()),
            resolved_org_source: ResolvedOrgSource::Flag,
            verbose: false,
        }
    }

    fn operation(pagination_policy: SourceApiPaginationPolicy) -> SourceApiOperation {
        SourceApiOperation {
            name: "fetch".to_owned(),
            kind: SourceApiOperationKind::CLI_SOURCE_API_OPERATION_KIND_HTTP_REQUEST.into(),
            summary: String::new(),
            description: String::new(),
            selector_kind: SourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_PATH.into(),
            selector_label: None,
            method_policy: MessageField::some(SourceApiMethodPolicy::default()),
            field_policy: MessageField::some(SourceApiFieldPolicy::default()),
            header_policy: MessageField::some(SourceApiHeaderPolicy::default()),
            pagination_policy: pagination_policy.into(),
            examples: Vec::new(),
            notes: Vec::new(),
            ..Default::default()
        }
    }

    fn api_args() -> ApiArgs {
        ApiArgs {
            source: "github-prod".to_owned(),
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
                key: "github-prod".to_owned(),
                provider:
                    crate::transport::source_api::SourceApiProvider::CLI_SOURCE_PROVIDER_GITHUB
                        .into(),
                display_name: Some("GitHub".to_owned()),
                ..Default::default()
            }),
            descriptor_version: "2026-04-09".to_owned(),
            default_path_operation: Some("fetch".to_owned()),
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
