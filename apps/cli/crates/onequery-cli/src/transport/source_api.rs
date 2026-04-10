use buffa::MessageField;
use connectrpc::ErrorCode;
use onequery_cli_core::error::ErrorStage;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;

use crate::transport::client::AuthenticatedApiClient;
use crate::transport::generated::types;
use crate::transport::http::ApiFailure;
use crate::transport::http::ApiSuccess;
use crate::transport::http::ResponseFailureStages;
use crate::transport::http::conversion_failure;
use crate::transport::http::decode_failure;
use crate::transport::http::failure_from_connect;
use crate::transport::http::response_request_id;
use crate::transport::http::try_into_option;
use crate::transport::http::try_into_value;

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SourceApiOperationKind {
    #[default]
    HttpRequest,
    StructuredRequest,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SourceApiSelectorKind {
    #[default]
    None,
    Path,
    Identifier,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SourceApiPaginationPolicy {
    #[default]
    None,
    OpaqueToken,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SourceApiBodyKind {
    #[default]
    None,
    Json,
    Text,
    Binary,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SourceApiInputMode {
    #[default]
    None,
    RequestObject,
    RequestBody,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceApiSource {
    pub(crate) key: String,
    pub(crate) provider: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) display_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
pub(crate) struct SourceApiHeader {
    pub(crate) name: String,
    pub(crate) value: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
pub(crate) struct SourceApiExample {
    pub(crate) label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) description: Option<String>,
    pub(crate) command: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceApiMethodPolicy {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) default_method: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) allowed_methods: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceApiFieldPolicy {
    pub(crate) supports_raw_fields: bool,
    pub(crate) supports_typed_fields: bool,
    pub(crate) supports_nested_paths: bool,
    pub(crate) supports_array_paths: bool,
    pub(crate) accepts_input: bool,
    pub(crate) input_mode: SourceApiInputMode,
    pub(crate) merge_patches: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceApiHeaderPolicy {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) allowed_names: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceApiOperation {
    pub(crate) name: String,
    pub(crate) kind: SourceApiOperationKind,
    pub(crate) summary: String,
    pub(crate) description: String,
    pub(crate) selector_kind: SourceApiSelectorKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) selector_label: Option<String>,
    pub(crate) method_policy: SourceApiMethodPolicy,
    pub(crate) field_policy: SourceApiFieldPolicy,
    pub(crate) header_policy: SourceApiHeaderPolicy,
    pub(crate) pagination_policy: SourceApiPaginationPolicy,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) examples: Vec<SourceApiExample>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) notes: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceApiDescriptor {
    pub(crate) source: SourceApiSource,
    pub(crate) descriptor_version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) default_path_operation: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) operations: Vec<SourceApiOperation>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) examples: Vec<SourceApiExample>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecuteSourceApiRequestPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) descriptor_version: Option<String>,
    pub(crate) operation: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) selector: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) method_override: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) headers: Vec<SourceApiHeader>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) field_patch: Option<Value>,
    #[serde(flatten)]
    pub(crate) body: SourceApiRequestBody,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) page_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[derive(Default)]
pub(crate) enum SourceApiRequestBody {
    #[default]
    None,
    Json {
        value: Value,
    },
    Text {
        value: String,
    },
    Binary {
        value_base64: String,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[derive(Default)]
pub(crate) enum SourceApiResponseBody {
    #[default]
    None,
    Json {
        value: Value,
    },
    Text {
        value: String,
    },
    Binary {
        value_base64: String,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecuteSourceApiResponse {
    pub(crate) source: SourceApiSource,
    pub(crate) operation: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) selector: Option<String>,
    pub(crate) status: u32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) headers: Vec<SourceApiHeader>,
    pub(crate) content_type: String,
    pub(crate) body: SourceApiResponseBody,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) next_page_token: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NormalizedSourceApiPlan {
    pub(crate) source_id: String,
    pub(crate) source_key: String,
    pub(crate) provider: String,
    pub(crate) operation: String,
    pub(crate) kind: SourceApiOperationKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) method: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) selector: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) selector_template: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) host: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) header_names: Vec<String>,
    pub(crate) body_kind: SourceApiBodyKind,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) body_paths: Vec<String>,
    pub(crate) request_fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) descriptor_version: Option<String>,
}

pub(crate) async fn describe_source_api(
    client: &AuthenticatedApiClient,
    org: &str,
    source_key: &str,
) -> Result<ApiSuccess<SourceApiDescriptor>, ApiFailure> {
    let org_slug: String = try_into_value(org, ErrorStage::ResolveSource)?;
    let source_key: String = try_into_value(source_key, ErrorStage::ResolveSource)?;
    let response = match client
        .cli()
        .describe_source_api(types::DescribeSourceApiRequest {
            org_slug,
            source_key,
            ..Default::default()
        })
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(
                error,
                ResponseFailureStages::from_connect_code(
                    describe_source_api_problem_stage_for_code,
                ),
            ));
        }
    };
    let request_id = response_request_id(response.headers());
    let payload = response.into_owned();

    Ok(ApiSuccess {
        payload: source_api_descriptor_from_generated(payload, request_id.clone())?,
        request_id,
    })
}

pub(crate) async fn normalize_source_api(
    client: &AuthenticatedApiClient,
    org: &str,
    source_key: &str,
    payload: &ExecuteSourceApiRequestPayload,
) -> Result<ApiSuccess<NormalizedSourceApiPlan>, ApiFailure> {
    let org_slug: String = try_into_value(org, ErrorStage::ExecuteQuery)?;
    let source_key: String = try_into_value(source_key, ErrorStage::ExecuteQuery)?;
    let response = match client
        .cli()
        .normalize_source_api(types::NormalizeSourceApiRequest {
            invocation: MessageField::some(source_api_invocation_to_generated(
                org_slug.as_str(),
                source_key.as_str(),
                payload,
            )?),
            ..Default::default()
        })
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(
                error,
                ResponseFailureStages::from_connect_code(execute_source_api_problem_stage_for_code),
            ));
        }
    };
    let request_id = response_request_id(response.headers());
    let payload = response.into_owned();

    Ok(ApiSuccess {
        payload: normalized_source_api_plan_from_generated(payload, request_id.clone())?,
        request_id,
    })
}

pub(crate) async fn execute_source_api(
    client: &AuthenticatedApiClient,
    org: &str,
    source_key: &str,
    payload: &ExecuteSourceApiRequestPayload,
) -> Result<ApiSuccess<ExecuteSourceApiResponse>, ApiFailure> {
    let org_slug: String = try_into_value(org, ErrorStage::ExecuteQuery)?;
    let source_key: String = try_into_value(source_key, ErrorStage::ExecuteQuery)?;
    let response = match client
        .cli()
        .execute_source_api(types::ExecuteSourceApiRequest {
            invocation: MessageField::some(source_api_invocation_to_generated(
                org_slug.as_str(),
                source_key.as_str(),
                payload,
            )?),
            ..Default::default()
        })
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(
                error,
                ResponseFailureStages::from_connect_code(execute_source_api_problem_stage_for_code),
            ));
        }
    };
    let request_id = response_request_id(response.headers());
    let payload = response.into_owned();

    Ok(ApiSuccess {
        payload: source_api_response_from_generated(payload, request_id.clone())?,
        request_id,
    })
}

fn source_api_descriptor_from_generated(
    value: types::DescribeSourceApiResponse,
    request_id: Option<String>,
) -> Result<SourceApiDescriptor, ApiFailure> {
    let source = value.source.into_option().ok_or_else(|| {
        decode_failure(
            ErrorStage::ResolveSource,
            "source API descriptor response missing source metadata",
            request_id.clone(),
        )
    })?;

    Ok(SourceApiDescriptor {
        source: source_api_source_from_generated(source),
        descriptor_version: value.descriptor_version,
        default_path_operation: value.default_path_operation,
        operations: value
            .operations
            .into_iter()
            .map(|operation| source_api_operation_from_generated(operation, request_id.clone()))
            .collect::<Result<Vec<_>, _>>()?,
        examples: value
            .examples
            .into_iter()
            .map(source_api_example_from_generated)
            .collect(),
        notes: value.notes,
    })
}

fn source_api_operation_from_generated(
    value: types::CliSourceApiOperation,
    request_id: Option<String>,
) -> Result<SourceApiOperation, ApiFailure> {
    let operation_name = value.name.clone();
    let method_policy = required_source_api_operation_message(
        value.method_policy,
        &operation_name,
        "method policy",
        request_id.clone(),
    )?;
    let field_policy = required_source_api_operation_message(
        value.field_policy,
        &operation_name,
        "field policy",
        request_id.clone(),
    )?;
    let header_policy = required_source_api_operation_message(
        value.header_policy,
        &operation_name,
        "header policy",
        request_id,
    )?;

    Ok(SourceApiOperation {
        name: value.name,
        kind: source_api_operation_kind_from_generated(value.kind),
        summary: value.summary,
        description: value.description,
        selector_kind: source_api_selector_kind_from_generated(value.selector_kind),
        selector_label: value.selector_label,
        method_policy: source_api_method_policy_from_generated(method_policy),
        field_policy: source_api_field_policy_from_generated(field_policy),
        header_policy: source_api_header_policy_from_generated(header_policy),
        pagination_policy: source_api_pagination_policy_from_generated(value.pagination_policy),
        examples: value
            .examples
            .into_iter()
            .map(source_api_example_from_generated)
            .collect(),
        notes: value.notes,
    })
}

fn required_source_api_operation_message<T: Default>(
    value: buffa::MessageField<T>,
    operation_name: &str,
    field_name: &str,
    request_id: Option<String>,
) -> Result<T, ApiFailure> {
    value.into_option().ok_or_else(|| {
        decode_failure(
            ErrorStage::ResolveSource,
            format!("source API operation `{operation_name}` missing {field_name}"),
            request_id,
        )
    })
}

fn source_api_method_policy_from_generated(
    value: types::CliSourceApiMethodPolicy,
) -> SourceApiMethodPolicy {
    SourceApiMethodPolicy {
        default_method: value.default_method,
        allowed_methods: value.allowed_methods,
    }
}

fn source_api_field_policy_from_generated(
    value: types::CliSourceApiFieldPolicy,
) -> SourceApiFieldPolicy {
    SourceApiFieldPolicy {
        supports_raw_fields: value.supports_raw_fields,
        supports_typed_fields: value.supports_typed_fields,
        supports_nested_paths: value.supports_nested_paths,
        supports_array_paths: value.supports_array_paths,
        accepts_input: value.accepts_input,
        input_mode: source_api_input_mode_from_generated(value.input_mode),
        merge_patches: value.merge_patches,
    }
}

fn source_api_input_mode_from_generated(
    value: buffa::EnumValue<types::CliSourceApiInputMode>,
) -> SourceApiInputMode {
    match value.as_known() {
        Some(types::CliSourceApiInputMode::CLI_SOURCE_API_INPUT_MODE_REQUEST_OBJECT) => {
            SourceApiInputMode::RequestObject
        }
        Some(types::CliSourceApiInputMode::CLI_SOURCE_API_INPUT_MODE_REQUEST_BODY) => {
            SourceApiInputMode::RequestBody
        }
        Some(types::CliSourceApiInputMode::CLI_SOURCE_API_INPUT_MODE_NONE)
        | Some(types::CliSourceApiInputMode::CLI_SOURCE_API_INPUT_MODE_UNSPECIFIED)
        | None => SourceApiInputMode::None,
    }
}

fn source_api_header_policy_from_generated(
    value: types::CliSourceApiHeaderPolicy,
) -> SourceApiHeaderPolicy {
    SourceApiHeaderPolicy {
        allowed_names: value.allowed_names,
    }
}

fn source_api_source_from_generated(value: types::CliSourceApiSource) -> SourceApiSource {
    SourceApiSource {
        key: value.key,
        provider: value.provider,
        display_name: value.display_name,
    }
}

fn source_api_example_from_generated(value: types::CliSourceApiExample) -> SourceApiExample {
    SourceApiExample {
        label: value.label,
        description: value.description,
        command: value.command,
    }
}

fn source_api_operation_kind_from_generated(
    value: buffa::EnumValue<types::CliSourceApiOperationKind>,
) -> SourceApiOperationKind {
    match value.as_known() {
        Some(
            types::CliSourceApiOperationKind::CLI_SOURCE_API_OPERATION_KIND_STRUCTURED_REQUEST,
        ) => SourceApiOperationKind::StructuredRequest,
        Some(types::CliSourceApiOperationKind::CLI_SOURCE_API_OPERATION_KIND_HTTP_REQUEST)
        | Some(types::CliSourceApiOperationKind::CLI_SOURCE_API_OPERATION_KIND_UNSPECIFIED)
        | None => SourceApiOperationKind::HttpRequest,
    }
}

fn source_api_selector_kind_from_generated(
    value: buffa::EnumValue<types::CliSourceApiSelectorKind>,
) -> SourceApiSelectorKind {
    match value.as_known() {
        Some(types::CliSourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_PATH) => {
            SourceApiSelectorKind::Path
        }
        Some(types::CliSourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_IDENTIFIER) => {
            SourceApiSelectorKind::Identifier
        }
        Some(types::CliSourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_NONE)
        | Some(types::CliSourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_UNSPECIFIED)
        | None => SourceApiSelectorKind::None,
    }
}

fn source_api_pagination_policy_from_generated(
    value: buffa::EnumValue<types::CliSourceApiPaginationPolicy>,
) -> SourceApiPaginationPolicy {
    match value.as_known() {
        Some(
            types::CliSourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_OPAQUE_TOKEN,
        ) => SourceApiPaginationPolicy::OpaqueToken,
        Some(types::CliSourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_NONE)
        | Some(types::CliSourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_UNSPECIFIED)
        | None => SourceApiPaginationPolicy::None,
    }
}

fn source_api_body_kind_from_generated(
    value: buffa::EnumValue<types::CliSourceApiBodyKind>,
) -> SourceApiBodyKind {
    match value.as_known() {
        Some(types::CliSourceApiBodyKind::CLI_SOURCE_API_BODY_KIND_JSON) => SourceApiBodyKind::Json,
        Some(types::CliSourceApiBodyKind::CLI_SOURCE_API_BODY_KIND_TEXT) => SourceApiBodyKind::Text,
        Some(types::CliSourceApiBodyKind::CLI_SOURCE_API_BODY_KIND_BINARY) => {
            SourceApiBodyKind::Binary
        }
        Some(types::CliSourceApiBodyKind::CLI_SOURCE_API_BODY_KIND_NONE)
        | Some(types::CliSourceApiBodyKind::CLI_SOURCE_API_BODY_KIND_UNSPECIFIED)
        | None => SourceApiBodyKind::None,
    }
}

fn source_api_header_to_generated(value: &SourceApiHeader) -> types::CliSourceApiHeader {
    types::CliSourceApiHeader {
        name: value.name.clone(),
        value: value.value.clone(),
        ..Default::default()
    }
}

fn source_api_invocation_to_generated(
    org: &str,
    source_key: &str,
    payload: &ExecuteSourceApiRequestPayload,
) -> Result<types::CliSourceApiInvocation, ApiFailure> {
    Ok(types::CliSourceApiInvocation {
        org_slug: try_into_value(org, ErrorStage::ExecuteQuery)?,
        source_key: try_into_value(source_key, ErrorStage::ExecuteQuery)?,
        descriptor_version: try_into_option(
            payload.descriptor_version.as_deref(),
            ErrorStage::ExecuteQuery,
        )?,
        operation: try_into_value(payload.operation.as_str(), ErrorStage::ExecuteQuery)?,
        selector: try_into_option(payload.selector.as_deref(), ErrorStage::ExecuteQuery)?,
        method_override: try_into_option(
            payload.method_override.as_deref(),
            ErrorStage::ExecuteQuery,
        )?,
        headers: payload
            .headers
            .iter()
            .map(source_api_header_to_generated)
            .collect(),
        field_patch: field_patch_to_generated(payload.field_patch.as_ref())?,
        body: source_api_request_body_to_generated(&payload.body)?,
        page_token: try_into_option(payload.page_token.as_deref(), ErrorStage::ExecuteQuery)?,
        ..Default::default()
    })
}

fn source_api_request_body_to_generated(
    value: &SourceApiRequestBody,
) -> Result<Option<types::cli_source_api_invocation::Body>, ApiFailure> {
    match value {
        SourceApiRequestBody::None => Ok(None),
        SourceApiRequestBody::Json { value } => Ok(Some(
            types::cli_source_api_invocation::Body::JsonBody(Box::new(
                serde_json::from_value::<buffa_types::google::protobuf::Value>(value.clone())
                    .map_err(|error| {
                        conversion_failure(
                            ErrorStage::ExecuteQuery,
                            format!("invalid JSON source API request body: {error}"),
                        )
                    })?,
            )),
        )),
        SourceApiRequestBody::Text { value } => Ok(Some(
            types::cli_source_api_invocation::Body::TextBody(value.clone()),
        )),
        SourceApiRequestBody::Binary { value_base64 } => {
            let bytes =
                base64::Engine::decode(&base64::engine::general_purpose::STANDARD, value_base64)
                    .map_err(|error| {
                        conversion_failure(
                            ErrorStage::ExecuteQuery,
                            format!("invalid source API binary request body: {error}"),
                        )
                    })?;
            Ok(Some(types::cli_source_api_invocation::Body::BinaryBody(
                bytes,
            )))
        }
    }
}

fn field_patch_to_generated(
    value: Option<&Value>,
) -> Result<MessageField<buffa_types::google::protobuf::Struct>, ApiFailure> {
    let Some(value) = value else {
        return Ok(MessageField::none());
    };

    if !value.is_object() {
        return Err(conversion_failure(
            ErrorStage::ExecuteQuery,
            "source API field patch must be one JSON object",
        ));
    }

    let struct_value = serde_json::from_value::<buffa_types::google::protobuf::Struct>(
        value.clone(),
    )
    .map_err(|error| {
        conversion_failure(
            ErrorStage::ExecuteQuery,
            format!("invalid source API field patch: {error}"),
        )
    })?;

    Ok(MessageField::some(struct_value))
}

fn normalized_source_api_plan_from_generated(
    value: types::NormalizeSourceApiResponse,
    request_id: Option<String>,
) -> Result<NormalizedSourceApiPlan, ApiFailure> {
    let plan = value.plan.into_option().ok_or_else(|| {
        decode_failure(
            ErrorStage::ExecuteQuery,
            "source API normalize response missing plan",
            request_id.clone(),
        )
    })?;

    Ok(NormalizedSourceApiPlan {
        source_id: plan.source_id,
        source_key: plan.source_key,
        provider: plan.provider,
        operation: plan.operation,
        kind: source_api_operation_kind_from_generated(plan.kind),
        method: plan.method,
        selector: plan.selector,
        selector_template: plan.selector_template,
        host: plan.host,
        header_names: plan.header_names,
        body_kind: source_api_body_kind_from_generated(plan.body_kind),
        body_paths: plan.body_paths,
        request_fingerprint: plan.request_fingerprint,
        descriptor_version: plan.descriptor_version,
    })
}

fn source_api_response_from_generated(
    value: types::ExecuteSourceApiResponse,
    request_id: Option<String>,
) -> Result<ExecuteSourceApiResponse, ApiFailure> {
    let source = value.source.into_option().ok_or_else(|| {
        decode_failure(
            ErrorStage::ExecuteQuery,
            "source API execution response missing source metadata",
            request_id,
        )
    })?;

    Ok(ExecuteSourceApiResponse {
        source: source_api_source_from_generated(source),
        operation: value.operation,
        selector: value.selector,
        status: value.status,
        headers: value
            .headers
            .into_iter()
            .map(|header| SourceApiHeader {
                name: header.name,
                value: header.value,
            })
            .collect(),
        content_type: value.content_type,
        body: source_api_response_body_from_generated(value.body)?,
        request_id: value.request_id,
        next_page_token: value.next_page_token,
    })
}

fn source_api_response_body_from_generated(
    value: Option<types::execute_source_api_response::Body>,
) -> Result<SourceApiResponseBody, ApiFailure> {
    match value {
        None => Ok(SourceApiResponseBody::None),
        Some(types::execute_source_api_response::Body::Text(value)) => {
            Ok(SourceApiResponseBody::Text { value })
        }
        Some(types::execute_source_api_response::Body::Binary(value)) => {
            Ok(SourceApiResponseBody::Binary {
                value_base64: base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    value,
                ),
            })
        }
        Some(types::execute_source_api_response::Body::Json(value)) => {
            let value = serde_json::to_value(value.as_ref()).map_err(|error| {
                decode_failure(
                    ErrorStage::ExecuteQuery,
                    format!("failed to decode source API JSON response body: {error}"),
                    None,
                )
            })?;
            Ok(SourceApiResponseBody::Json { value })
        }
    }
}

fn describe_source_api_problem_stage_for_code(code: ErrorCode) -> ErrorStage {
    if matches!(
        code,
        ErrorCode::Unauthenticated | ErrorCode::PermissionDenied
    ) {
        ErrorStage::Auth
    } else {
        ErrorStage::ResolveSource
    }
}

fn execute_source_api_problem_stage_for_code(code: ErrorCode) -> ErrorStage {
    if matches!(
        code,
        ErrorCode::Unauthenticated | ErrorCode::PermissionDenied
    ) {
        ErrorStage::Auth
    } else if matches!(code, ErrorCode::NotFound) {
        ErrorStage::ResolveSource
    } else {
        ErrorStage::ExecuteQuery
    }
}

#[cfg(test)]
mod tests {
    use onequery_cli_core::error::ErrorStage;
    use pretty_assertions::assert_eq;

    use super::NormalizedSourceApiPlan;
    use super::SourceApiBodyKind;
    use super::SourceApiFieldPolicy;
    use super::SourceApiInputMode;
    use super::SourceApiOperationKind;
    use super::normalized_source_api_plan_from_generated;
    use super::source_api_descriptor_from_generated;
    use super::types;
    use crate::transport::http::ApiFailure;

    #[test]
    fn normalized_source_api_plan_from_generated_maps_typed_plan_payload() {
        let plan = normalized_source_api_plan_from_generated(
            types::NormalizeSourceApiResponse {
                plan: buffa::MessageField::some(types::CliSourceApiPlan {
                    source_id: "source-1".to_owned(),
                    source_key: "github-prod".to_owned(),
                    provider: "github".to_owned(),
                    operation: "fetch".to_owned(),
                    kind:
                        types::CliSourceApiOperationKind::CLI_SOURCE_API_OPERATION_KIND_HTTP_REQUEST
                            .into(),
                    method: Some("POST".to_owned()),
                    selector: Some("/issues".to_owned()),
                    selector_template: Some("/{path}".to_owned()),
                    host: Some("api.github.com".to_owned()),
                    header_names: vec!["accept".to_owned()],
                    body_kind: types::CliSourceApiBodyKind::CLI_SOURCE_API_BODY_KIND_TEXT.into(),
                    body_paths: vec!["payload".to_owned()],
                    request_fingerprint: "fp_123".to_owned(),
                    descriptor_version: Some("github.v1".to_owned()),
                    ..Default::default()
                }),
                ..Default::default()
            },
            Some("req_cli_123".to_owned()),
        )
        .expect("expected typed normalize payload to decode");

        assert_eq!(
            plan,
            NormalizedSourceApiPlan {
                source_id: "source-1".to_owned(),
                source_key: "github-prod".to_owned(),
                provider: "github".to_owned(),
                operation: "fetch".to_owned(),
                kind: SourceApiOperationKind::HttpRequest,
                method: Some("POST".to_owned()),
                selector: Some("/issues".to_owned()),
                selector_template: Some("/{path}".to_owned()),
                host: Some("api.github.com".to_owned()),
                header_names: vec!["accept".to_owned()],
                body_kind: SourceApiBodyKind::Text,
                body_paths: vec!["payload".to_owned()],
                request_fingerprint: "fp_123".to_owned(),
                descriptor_version: Some("github.v1".to_owned()),
            }
        );
    }

    #[test]
    fn source_api_descriptor_from_generated_requires_operation_policies() {
        let error = source_api_descriptor_from_generated(
            types::DescribeSourceApiResponse {
                source: buffa::MessageField::some(types::CliSourceApiSource {
                    key: "github-prod".to_owned(),
                    provider: "github".to_owned(),
                    ..Default::default()
                }),
                descriptor_version: "github.v1".to_owned(),
                operations: vec![types::CliSourceApiOperation {
                    name: "fetch".to_owned(),
                    kind:
                        types::CliSourceApiOperationKind::CLI_SOURCE_API_OPERATION_KIND_HTTP_REQUEST
                            .into(),
                    summary: "Fetch a resource".to_owned(),
                    description: "Fetches a GitHub resource.".to_owned(),
                    selector_kind:
                        types::CliSourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_PATH.into(),
                    pagination_policy:
                        types::CliSourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_NONE
                            .into(),
                    field_policy: buffa::MessageField::some(types::CliSourceApiFieldPolicy {
                        supports_raw_fields: true,
                        supports_typed_fields: true,
                        ..Default::default()
                    }),
                    header_policy: buffa::MessageField::some(types::CliSourceApiHeaderPolicy {
                        allowed_names: vec!["accept".to_owned()],
                        ..Default::default()
                    }),
                    ..Default::default()
                }],
                ..Default::default()
            },
            Some("req_missing_policy".to_owned()),
        )
        .expect_err("expected missing method policy to fail");

        assert_eq!(
            error,
            ApiFailure::Decode(crate::transport::http::DecodeFailure {
                stage: ErrorStage::ResolveSource,
                message: "source API operation `fetch` missing method policy".to_owned(),
                request_id: Some("req_missing_policy".to_owned()),
            })
        );
    }

    #[test]
    fn source_api_descriptor_from_generated_maps_machine_readable_field_policy() {
        let descriptor = source_api_descriptor_from_generated(
            types::DescribeSourceApiResponse {
                source: buffa::MessageField::some(types::CliSourceApiSource {
                    key: "github-prod".to_owned(),
                    provider: "github".to_owned(),
                    ..Default::default()
                }),
                descriptor_version: "github.v1".to_owned(),
                operations: vec![types::CliSourceApiOperation {
                    name: "fetch".to_owned(),
                    kind:
                        types::CliSourceApiOperationKind::CLI_SOURCE_API_OPERATION_KIND_HTTP_REQUEST
                            .into(),
                    summary: "Fetch a resource".to_owned(),
                    description: "Fetches a GitHub resource.".to_owned(),
                    selector_kind:
                        types::CliSourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_PATH.into(),
                    method_policy: buffa::MessageField::some(types::CliSourceApiMethodPolicy {
                        default_method: Some("GET".to_owned()),
                        ..Default::default()
                    }),
                    field_policy: buffa::MessageField::some(types::CliSourceApiFieldPolicy {
                        supports_raw_fields: true,
                        supports_typed_fields: true,
                        supports_nested_paths: true,
                        supports_array_paths: true,
                        accepts_input: true,
                        input_mode:
                            types::CliSourceApiInputMode::CLI_SOURCE_API_INPUT_MODE_REQUEST_BODY
                                .into(),
                        merge_patches: false,
                        ..Default::default()
                    }),
                    header_policy: buffa::MessageField::some(types::CliSourceApiHeaderPolicy {
                        allowed_names: vec!["accept".to_owned()],
                        ..Default::default()
                    }),
                    pagination_policy:
                        types::CliSourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_NONE
                            .into(),
                    ..Default::default()
                }],
                ..Default::default()
            },
            Some("req_field_policy".to_owned()),
        )
        .expect("expected descriptor field policy to decode");

        assert_eq!(
            descriptor.operations[0].field_policy,
            SourceApiFieldPolicy {
                supports_raw_fields: true,
                supports_typed_fields: true,
                supports_nested_paths: true,
                supports_array_paths: true,
                accepts_input: true,
                input_mode: SourceApiInputMode::RequestBody,
                merge_patches: false,
            }
        );
    }
}
