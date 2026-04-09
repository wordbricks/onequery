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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) syntaxes: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) transport_rules: Vec<String>,
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
            org_slug,
            source_key,
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
            body: normalize_source_api_request_body_to_generated(&payload.body)?,
            page_token: try_into_option(payload.page_token.as_deref(), ErrorStage::ExecuteQuery)?,
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
            org_slug,
            source_key,
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
            request_id,
        )
    })?;

    Ok(SourceApiDescriptor {
        source: source_api_source_from_generated(source),
        descriptor_version: value.descriptor_version,
        default_path_operation: non_empty(value.default_path_operation),
        operations: value
            .operations
            .into_iter()
            .map(source_api_operation_from_generated)
            .collect(),
        examples: value
            .examples
            .into_iter()
            .map(source_api_example_from_generated)
            .collect(),
        notes: value.notes,
    })
}

fn source_api_operation_from_generated(value: types::CliSourceApiOperation) -> SourceApiOperation {
    SourceApiOperation {
        name: value.name,
        kind: source_api_operation_kind_from_generated(value.kind),
        summary: value.summary,
        description: value.description,
        selector_kind: source_api_selector_kind_from_generated(value.selector_kind),
        selector_label: non_empty(value.selector_label),
        method_policy: value
            .method_policy
            .into_option()
            .map(source_api_method_policy_from_generated)
            .unwrap_or_default(),
        field_policy: value
            .field_policy
            .into_option()
            .map(source_api_field_policy_from_generated)
            .unwrap_or_default(),
        header_policy: value
            .header_policy
            .into_option()
            .map(source_api_header_policy_from_generated)
            .unwrap_or_default(),
        pagination_policy: source_api_pagination_policy_from_generated(value.pagination_policy),
        examples: value
            .examples
            .into_iter()
            .map(source_api_example_from_generated)
            .collect(),
        notes: value.notes,
    }
}

fn source_api_method_policy_from_generated(
    value: types::CliSourceApiMethodPolicy,
) -> SourceApiMethodPolicy {
    SourceApiMethodPolicy {
        default_method: non_empty(value.default_method),
        allowed_methods: value.allowed_methods,
    }
}

fn source_api_field_policy_from_generated(
    value: types::CliSourceApiFieldPolicy,
) -> SourceApiFieldPolicy {
    SourceApiFieldPolicy {
        supports_raw_fields: value.supports_raw_fields,
        supports_typed_fields: value.supports_typed_fields,
        syntaxes: value.syntaxes,
        transport_rules: value.transport_rules,
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
        display_name: non_empty(value.display_name),
    }
}

fn source_api_example_from_generated(value: types::CliSourceApiExample) -> SourceApiExample {
    SourceApiExample {
        label: value.label,
        description: non_empty(value.description),
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

fn source_api_header_to_generated(value: &SourceApiHeader) -> types::CliSourceApiHeader {
    types::CliSourceApiHeader {
        name: value.name.clone(),
        value: value.value.clone(),
        ..Default::default()
    }
}

fn source_api_request_body_to_generated(
    value: &SourceApiRequestBody,
) -> Result<Option<types::execute_source_api_request::Body>, ApiFailure> {
    match value {
        SourceApiRequestBody::None => Ok(None),
        SourceApiRequestBody::Json { value } => Ok(Some(
            types::execute_source_api_request::Body::JsonBody(Box::new(
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
            types::execute_source_api_request::Body::TextBody(value.clone()),
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
            Ok(Some(types::execute_source_api_request::Body::BinaryBody(
                bytes,
            )))
        }
    }
}

fn normalize_source_api_request_body_to_generated(
    value: &SourceApiRequestBody,
) -> Result<Option<types::normalize_source_api_request::Body>, ApiFailure> {
    match value {
        SourceApiRequestBody::None => Ok(None),
        SourceApiRequestBody::Json { value } => Ok(Some(
            types::normalize_source_api_request::Body::JsonBody(Box::new(
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
            types::normalize_source_api_request::Body::TextBody(value.clone()),
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
            Ok(Some(types::normalize_source_api_request::Body::BinaryBody(
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

    let plan = serde_json::to_value(plan).map_err(|error| {
        decode_failure(
            ErrorStage::ExecuteQuery,
            format!("failed to decode source API normalize response: {error}"),
            request_id.clone(),
        )
    })?;

    serde_json::from_value(plan).map_err(|error| {
        decode_failure(
            ErrorStage::ExecuteQuery,
            format!("failed to decode source API normalize response: {error}"),
            request_id,
        )
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
        selector: non_empty(value.selector),
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
        request_id: non_empty(value.request_id),
        next_page_token: non_empty(value.next_page_token),
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

fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|candidate| !candidate.trim().is_empty())
}
