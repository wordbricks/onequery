use buffa::MessageField;
use connectrpc::ErrorCode;
use onequery_cli_core::error::ErrorStage;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value as JsonValue;

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

pub(crate) type ProtoJsonObject = buffa_types::google::protobuf::Struct;
pub(crate) type ProtoJsonValue = buffa_types::google::protobuf::Value;

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

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecuteSourceApiRequestPayload {
    // Comment: the CLI still carries descriptor_version until the command flow
    // finishes deleting the legacy request-planning shape. The prepared wire
    // contract ignores it.
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
    pub(crate) field_patch: Option<ProtoJsonObject>,
    #[serde(flatten)]
    pub(crate) body: SourceApiRequestBody,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) page_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[derive(Default)]
pub(crate) enum SourceApiRequestBody {
    #[default]
    None,
    Json {
        value: ProtoJsonValue,
    },
    Text {
        value: String,
    },
    Binary {
        value_base64: String,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[derive(Default)]
pub(crate) enum SourceApiResponseBody {
    #[default]
    None,
    Json {
        value: ProtoJsonValue,
    },
    Text {
        value: String,
    },
    Binary {
        value_base64: String,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Default)]
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
    pub(crate) next_page_token: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreparedSourceApiPreview {
    pub(crate) source_key: String,
    pub(crate) provider: String,
    pub(crate) operation: String,
    pub(crate) kind: SourceApiOperationKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) method: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) selector: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) host: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) header_names: Vec<String>,
    pub(crate) body_kind: SourceApiBodyKind,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) body_paths: Vec<String>,
    pub(crate) pagination_policy: SourceApiPaginationPolicy,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrepareSourceApiResult {
    pub(crate) prepared_token: String,
    pub(crate) preview: PreparedSourceApiPreview,
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

pub(crate) async fn prepare_source_api(
    client: &AuthenticatedApiClient,
    org: &str,
    source_key: &str,
    payload: &ExecuteSourceApiRequestPayload,
) -> Result<ApiSuccess<PrepareSourceApiResult>, ApiFailure> {
    let org_slug: String = try_into_value(org, ErrorStage::ExecuteQuery)?;
    let source_key: String = try_into_value(source_key, ErrorStage::ExecuteQuery)?;
    let response = match client
        .cli()
        .prepare_source_api(types::PrepareSourceApiRequest {
            draft: MessageField::some(source_api_draft_to_generated(
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
        payload: prepare_source_api_result_from_generated(payload, request_id.clone())?,
        request_id,
    })
}

pub(crate) async fn execute_prepared_source_api(
    client: &AuthenticatedApiClient,
    prepared_token: &str,
    page_token: Option<&str>,
) -> Result<ApiSuccess<ExecuteSourceApiResponse>, ApiFailure> {
    let response = match client
        .cli()
        .execute_prepared_source_api(types::ExecutePreparedSourceApiRequest {
            prepared_token: try_into_value(prepared_token, ErrorStage::ExecuteQuery)?,
            page_token: try_into_option(page_token, ErrorStage::ExecuteQuery)?,
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

fn source_api_draft_to_generated(
    org: &str,
    source_key: &str,
    payload: &ExecuteSourceApiRequestPayload,
) -> Result<types::SourceApiDraft, ApiFailure> {
    Ok(types::SourceApiDraft {
        org_slug: try_into_value(org, ErrorStage::ExecuteQuery)?,
        source_key: try_into_value(source_key, ErrorStage::ExecuteQuery)?,
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
        field_patch: field_patch_to_generated(payload.field_patch.as_ref()),
        body: source_api_request_body_to_generated(&payload.body)?,
        ..Default::default()
    })
}

fn source_api_request_body_to_generated(
    value: &SourceApiRequestBody,
) -> Result<Option<types::source_api_draft::Body>, ApiFailure> {
    match value {
        SourceApiRequestBody::None => Ok(None),
        SourceApiRequestBody::Json { value } => Ok(Some(types::source_api_draft::Body::JsonBody(
            Box::new(value.clone()),
        ))),
        SourceApiRequestBody::Text { value } => {
            Ok(Some(types::source_api_draft::Body::TextBody(value.clone())))
        }
        SourceApiRequestBody::Binary { value_base64 } => {
            Ok(Some(types::source_api_draft::Body::BinaryBody(
                request_binary_body_to_generated(value_base64)?,
            )))
        }
    }
}

pub(crate) fn proto_json_value_from_json(
    value: JsonValue,
) -> Result<ProtoJsonValue, serde_json::Error> {
    serde_json::from_value::<ProtoJsonValue>(value)
}

pub(crate) fn proto_json_object_from_json(
    value: JsonValue,
) -> Result<ProtoJsonObject, serde_json::Error> {
    serde_json::from_value::<ProtoJsonObject>(value)
}

pub(crate) fn json_from_proto_json_value(
    value: &ProtoJsonValue,
) -> Result<JsonValue, serde_json::Error> {
    serde_json::to_value(value).map(normalize_renderable_json_numbers)
}

fn normalize_renderable_json_numbers(value: JsonValue) -> JsonValue {
    match value {
        JsonValue::Array(values) => JsonValue::Array(
            values
                .into_iter()
                .map(normalize_renderable_json_numbers)
                .collect(),
        ),
        JsonValue::Object(entries) => JsonValue::Object(
            entries
                .into_iter()
                .map(|(key, value)| (key, normalize_renderable_json_numbers(value)))
                .collect(),
        ),
        JsonValue::Number(number) => normalize_renderable_json_number(number),
        JsonValue::Null | JsonValue::Bool(_) | JsonValue::String(_) => value,
    }
}

fn normalize_renderable_json_number(number: serde_json::Number) -> JsonValue {
    if number.as_i64().is_some() || number.as_u64().is_some() {
        return JsonValue::Number(number);
    }

    let Some(float) = number.as_f64() else {
        return JsonValue::Number(number);
    };

    // Comment: `google.protobuf.Value` stores JSON numbers as doubles, so the
    // generated serde path re-emits exact integers as `1.0`. Normalize those
    // back to whole JSON numbers before the CLI renders them.
    if float.fract() != 0.0 {
        return JsonValue::Number(number);
    }

    if float >= i64::MIN as f64 && float <= i64::MAX as f64 {
        let integer = float as i64;
        if integer as f64 == float {
            return JsonValue::Number(serde_json::Number::from(integer));
        }
    }

    if float >= 0.0 && float <= u64::MAX as f64 {
        let integer = float as u64;
        if integer as f64 == float {
            return JsonValue::Number(serde_json::Number::from(integer));
        }
    }

    JsonValue::Number(number)
}

fn request_binary_body_to_generated(value_base64: &str) -> Result<Vec<u8>, ApiFailure> {
    base64::Engine::decode(&base64::engine::general_purpose::STANDARD, value_base64).map_err(
        |error| {
            conversion_failure(
                ErrorStage::ExecuteQuery,
                format!("invalid source API binary request body: {error}"),
            )
        },
    )
}

fn field_patch_to_generated(value: Option<&ProtoJsonObject>) -> MessageField<ProtoJsonObject> {
    value
        .cloned()
        .map(MessageField::some)
        .unwrap_or_else(MessageField::none)
}

fn prepare_source_api_result_from_generated(
    value: types::PrepareSourceApiResponse,
    request_id: Option<String>,
) -> Result<PrepareSourceApiResult, ApiFailure> {
    let preview = value.preview.into_option().ok_or_else(|| {
        decode_failure(
            ErrorStage::ExecuteQuery,
            "source API prepare response missing preview",
            request_id.clone(),
        )
    })?;

    Ok(PrepareSourceApiResult {
        prepared_token: value.prepared_token,
        preview: prepared_source_api_preview_from_generated(preview),
    })
}

fn prepared_source_api_preview_from_generated(
    value: types::PreparedSourceApiPreview,
) -> PreparedSourceApiPreview {
    PreparedSourceApiPreview {
        source_key: value.source_key,
        provider: value.provider,
        operation: value.operation,
        kind: source_api_operation_kind_from_generated(value.kind),
        method: value.method,
        selector: value.selector,
        url: value.url,
        host: value.host,
        header_names: value.header_names,
        body_kind: source_api_body_kind_from_generated(value.body_kind),
        body_paths: value.body_paths,
        pagination_policy: source_api_pagination_policy_from_generated(value.pagination_policy),
    }
}

fn source_api_response_from_generated(
    value: types::ExecutePreparedSourceApiResponse,
    request_id: Option<String>,
) -> Result<ExecuteSourceApiResponse, ApiFailure> {
    let source = value.source.into_option().ok_or_else(|| {
        decode_failure(
            ErrorStage::ExecuteQuery,
            "source API execution response missing source metadata",
            request_id.clone(),
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
        next_page_token: value.next_page_token,
    })
}

fn source_api_response_body_from_generated(
    value: Option<types::execute_prepared_source_api_response::Body>,
) -> Result<SourceApiResponseBody, ApiFailure> {
    match value {
        None => Ok(SourceApiResponseBody::None),
        Some(types::execute_prepared_source_api_response::Body::Text(value)) => {
            Ok(SourceApiResponseBody::Text { value })
        }
        Some(types::execute_prepared_source_api_response::Body::Binary(value)) => {
            Ok(SourceApiResponseBody::Binary {
                value_base64: base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    value,
                ),
            })
        }
        Some(types::execute_prepared_source_api_response::Body::Json(value)) => {
            Ok(SourceApiResponseBody::Json { value: *value })
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
    use serde_json::json;

    use super::SourceApiBodyKind;
    use super::SourceApiFieldPolicy;
    use super::SourceApiInputMode;
    use super::SourceApiOperationKind;
    use super::SourceApiPaginationPolicy;
    use super::json_from_proto_json_value;
    use super::prepare_source_api_result_from_generated;
    use super::proto_json_value_from_json;
    use super::source_api_descriptor_from_generated;
    use super::types;
    use crate::transport::http::ApiFailure;

    #[test]
    fn prepare_source_api_result_from_generated_maps_preview_payload() {
        let prepared = prepare_source_api_result_from_generated(
            types::PrepareSourceApiResponse {
                prepared_token: "prepared_123".to_owned(),
                preview: buffa::MessageField::some(types::PreparedSourceApiPreview {
                    source_key: "github-prod".to_owned(),
                    provider: "github".to_owned(),
                    operation: "fetch".to_owned(),
                    kind:
                        types::CliSourceApiOperationKind::CLI_SOURCE_API_OPERATION_KIND_HTTP_REQUEST
                            .into(),
                    method: Some("POST".to_owned()),
                    selector: Some("/issues".to_owned()),
                    url: Some("https://api.github.com/issues".to_owned()),
                    host: Some("api.github.com".to_owned()),
                    header_names: vec!["accept".to_owned()],
                    body_kind: types::CliSourceApiBodyKind::CLI_SOURCE_API_BODY_KIND_TEXT.into(),
                    body_paths: vec!["payload".to_owned()],
                    pagination_policy:
                        types::CliSourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_OPAQUE_TOKEN
                            .into(),
                    ..Default::default()
                }),
                ..Default::default()
            },
            Some("req_cli_123".to_owned()),
        )
        .expect("expected typed prepare payload to decode");

        assert_eq!(
            prepared,
            super::PrepareSourceApiResult {
                prepared_token: "prepared_123".to_owned(),
                preview: super::PreparedSourceApiPreview {
                    source_key: "github-prod".to_owned(),
                    provider: "github".to_owned(),
                    operation: "fetch".to_owned(),
                    kind: SourceApiOperationKind::HttpRequest,
                    method: Some("POST".to_owned()),
                    selector: Some("/issues".to_owned()),
                    url: Some("https://api.github.com/issues".to_owned()),
                    host: Some("api.github.com".to_owned()),
                    header_names: vec!["accept".to_owned()],
                    body_kind: SourceApiBodyKind::Text,
                    body_paths: vec!["payload".to_owned()],
                    pagination_policy: SourceApiPaginationPolicy::OpaqueToken,
                },
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

    #[test]
    fn json_from_proto_json_value_preserves_integral_json_numbers() {
        let value = proto_json_value_from_json(json!({
            "items": [1, 2, 3.5]
        }))
        .expect("expected JSON value to encode as protobuf WKT");

        assert_eq!(
            json_from_proto_json_value(&value).expect("expected protobuf WKT to decode"),
            json!({
                "items": [1, 2, 3.5]
            })
        );
    }
}
