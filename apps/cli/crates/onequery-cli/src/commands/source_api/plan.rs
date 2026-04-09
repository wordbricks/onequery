use serde_json::Value;

use crate::cli::UseArgs;
use crate::transport::source_api::ExecuteSourceApiRequestPayload;
use crate::transport::source_api::SourceApiDescriptor;
use crate::transport::source_api::SourceApiHeader;
use crate::transport::source_api::SourceApiOperation;
use crate::transport::source_api::SourceApiOperationKind;
use crate::transport::source_api::SourceApiPaginationPolicy;
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
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(super) struct ExecutePlan {
    pub(super) request: ExecuteSourceApiRequestPayload,
    pub(super) execution: SourceApiExecutionOptions,
    pub(super) render: SourceApiRenderOptions,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(super) enum PlannedCommand {
    Describe,
    DryRun {
        request: ExecuteSourceApiRequestPayload,
    },
    Execute {
        plan: ExecutePlan,
    },
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
        return Ok(PlannedCommand::DryRun { request });
    }

    Ok(PlannedCommand::Execute {
        plan: ExecutePlan {
            request,
            execution: SourceApiExecutionOptions {
                paginate: args.paginate,
                max_pages: args.max_pages,
            },
            render: SourceApiRenderOptions {
                include: args.include,
                silent: args.silent,
                slurp: args.slurp,
                jq: args.jq.clone(),
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

fn validate_pagination(
    args: &UseArgs,
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

    if operation.pagination_policy == SourceApiPaginationPolicy::OpaqueToken {
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

fn validate_input(
    args: &UseArgs,
    operation: &SourceApiOperation,
    context: &CommandContext,
    source_key: &str,
) -> Result<(), CliError> {
    if args.input.is_none() || source_api_operation_supports_input(operation) {
        return Ok(());
    }

    Err(source_api_parse_error(
        context,
        "source API request input is not supported",
        format!("operation `{}` does not accept `--input`", operation.name),
        source_key,
    ))
}

fn source_api_operation_supports_input(operation: &SourceApiOperation) -> bool {
    // Comment: the descriptor transport currently exposes `--input` support as one
    // human-readable transport rule, so the planner infers the local parse check from
    // the stable rule string until the wire shape carries a dedicated input flag.
    !operation
        .field_policy
        .transport_rules
        .iter()
        .any(|rule| rule.trim() == "does not support --input")
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
        .map(str::to_ascii_uppercase)
}

#[cfg(test)]
mod tests {
    use onequery_cli_core::error::ErrorStage;

    use crate::cli::UseArgs;
    use crate::commands::ResolvedOrgSource;
    use crate::config::default_base_url;
    use crate::transport::source_api::SourceApiDescriptor;
    use crate::transport::source_api::SourceApiFieldPolicy;
    use crate::transport::source_api::SourceApiHeader;
    use crate::transport::source_api::SourceApiHeaderPolicy;
    use crate::transport::source_api::SourceApiMethodPolicy;
    use crate::transport::source_api::SourceApiOperation;
    use crate::transport::source_api::SourceApiOperationKind;
    use crate::transport::source_api::SourceApiPaginationPolicy;
    use crate::transport::source_api::SourceApiSelectorKind;

    use super::CommandContext;
    use super::build_plan;
    use super::parse_headers;
    use super::validate_pagination;

    #[test]
    fn validate_pagination_rejects_slurp_without_paginate() {
        let error = validate_pagination(
            &UseArgs {
                slurp: true,
                ..use_args()
            },
            &operation(SourceApiPaginationPolicy::OpaqueToken),
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
            &UseArgs {
                max_pages: Some(2),
                ..use_args()
            },
            &operation(SourceApiPaginationPolicy::OpaqueToken),
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
            &UseArgs {
                paginate: true,
                max_pages: Some(0),
                ..use_args()
            },
            &operation(SourceApiPaginationPolicy::OpaqueToken),
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
            &UseArgs {
                paginate: true,
                ..use_args()
            },
            &operation(SourceApiPaginationPolicy::None),
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
            &UseArgs {
                paginate: true,
                max_pages: Some(3),
                ..use_args()
            },
            &operation(SourceApiPaginationPolicy::OpaqueToken),
            &context(),
            "github-prod",
        )
        .expect("expected opaque-token pagination to validate");
    }

    #[test]
    fn parse_headers_rejects_headers_when_operation_disallows_them() {
        let error = parse_headers(
            &["Accept: application/json".to_owned()],
            &operation(SourceApiPaginationPolicy::None),
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
                header_policy: SourceApiHeaderPolicy {
                    allowed_names: vec!["Accept".to_owned()],
                },
                ..operation(SourceApiPaginationPolicy::None)
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
            }]
        );
    }

    #[tokio::test]
    async fn build_plan_rejects_input_when_operation_disallows_it() {
        let error = build_plan(
            &UseArgs {
                input: Some("request.json".to_owned()),
                ..use_args()
            },
            &descriptor_with_operation(SourceApiOperation {
                field_policy: SourceApiFieldPolicy {
                    transport_rules: vec!["does not support --input".to_owned()],
                    ..SourceApiFieldPolicy::default()
                },
                ..operation(SourceApiPaginationPolicy::None)
            }),
            &context(),
        )
        .await
        .expect_err("expected unsupported `--input` to fail before reading input");

        assert_eq!(error.stage, ErrorStage::ParseCommand);
        assert_eq!(error.why, "operation `fetch` does not accept `--input`");
    }

    fn context() -> CommandContext {
        CommandContext {
            command_line: "onequery use --source github-prod".to_owned(),
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
            kind: SourceApiOperationKind::HttpRequest,
            summary: String::new(),
            description: String::new(),
            selector_kind: SourceApiSelectorKind::Path,
            selector_label: None,
            method_policy: SourceApiMethodPolicy::default(),
            field_policy: SourceApiFieldPolicy::default(),
            header_policy: SourceApiHeaderPolicy::default(),
            pagination_policy,
            examples: Vec::new(),
            notes: Vec::new(),
        }
    }

    fn use_args() -> UseArgs {
        UseArgs {
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
            source: crate::transport::source_api::SourceApiSource {
                key: "github-prod".to_owned(),
                provider: "github".to_owned(),
                display_name: Some("GitHub".to_owned()),
            },
            descriptor_version: "2026-04-09".to_owned(),
            default_path_operation: Some("fetch".to_owned()),
            operations: vec![operation],
            examples: Vec::new(),
            notes: Vec::new(),
        }
    }
}
