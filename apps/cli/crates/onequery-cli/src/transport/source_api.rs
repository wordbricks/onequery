use buffa::EnumValue;
use buffa::MessageField;
use connectrpc::ErrorCode;
use onequery_cli_core::error::ErrorStage;
use serde_json::Value as JsonValue;

use crate::transport::client::AuthenticatedApiClient;
use crate::transport::generated::types;
use crate::transport::http::ApiFailure;
use crate::transport::http::ApiSuccess;
use crate::transport::http::ResponseFailureStages;
use crate::transport::http::decode_failure;
use crate::transport::http::failure_from_connect;
use crate::transport::http::response_request_id;
use crate::transport::http::try_into_option;
use crate::transport::http::try_into_value;

pub(crate) type ProtoJsonObject = buffa_types::google::protobuf::Struct;
pub(crate) type ProtoJsonValue = buffa_types::google::protobuf::Value;

pub(crate) type SourceApiInputMode = types::CliSourceApiInputMode;
pub(crate) type SourceApiOperationKind = types::CliSourceApiOperationKind;
pub(crate) type SourceApiSelectorKind = types::CliSourceApiSelectorKind;
pub(crate) type SourceApiPaginationPolicy = types::CliSourceApiPaginationPolicy;
pub(crate) type SourceApiBodyKind = types::CliSourceApiBodyKind;
pub(crate) type SourceApiSource = types::CliSourceApiSource;
pub(crate) type SourceApiHeader = types::CliSourceApiHeader;
pub(crate) type SourceApiExample = types::CliSourceApiExample;
pub(crate) type SourceApiMethodPolicy = types::CliSourceApiMethodPolicy;
pub(crate) type SourceApiFieldPolicy = types::CliSourceApiFieldPolicy;
pub(crate) type SourceApiHeaderPolicy = types::CliSourceApiHeaderPolicy;
pub(crate) type SourceApiOperation = types::CliSourceApiOperation;
pub(crate) type SourceApiDescriptor = types::DescribeSourceApiResponse;
pub(crate) type SourceApiDraft = types::SourceApiDraft;
pub(crate) type SourceApiRequestBody = types::source_api_draft::Body;
pub(crate) type PrepareSourceApiResult = types::PrepareSourceApiResponse;
pub(crate) type PreparedSourceApiPreview = types::PreparedSourceApiPreview;
pub(crate) type ExecutePreparedSourceApiResult = types::ExecutePreparedSourceApiResponse;
pub(crate) type SourceApiResponseBody = types::execute_prepared_source_api_response::Body;

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
    validate_source_api_descriptor(&payload, request_id.clone())?;

    Ok(ApiSuccess {
        payload,
        request_id,
    })
}

pub(crate) async fn prepare_source_api(
    client: &AuthenticatedApiClient,
    org: &str,
    source_key: &str,
    draft: &SourceApiDraft,
) -> Result<ApiSuccess<PrepareSourceApiResult>, ApiFailure> {
    let response = match client
        .cli()
        .prepare_source_api(types::PrepareSourceApiRequest {
            draft: MessageField::some(source_api_draft_with_context(org, source_key, draft)?),
            ..Default::default()
        })
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(
                error,
                ResponseFailureStages::from_connect_code(
                    execute_prepared_source_api_problem_stage_for_code,
                ),
            ));
        }
    };
    let request_id = response_request_id(response.headers());
    let payload = response.into_owned();
    validate_prepare_source_api_result(&payload, request_id.clone())?;

    Ok(ApiSuccess {
        payload,
        request_id,
    })
}

pub(crate) async fn execute_prepared_source_api(
    client: &AuthenticatedApiClient,
    prepared_token: &str,
    page_token: Option<&str>,
) -> Result<ApiSuccess<ExecutePreparedSourceApiResult>, ApiFailure> {
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
                ResponseFailureStages::from_connect_code(
                    execute_prepared_source_api_problem_stage_for_code,
                ),
            ));
        }
    };
    let request_id = response_request_id(response.headers());
    let payload = response.into_owned();
    validate_execute_prepared_source_api_result(&payload, request_id.clone())?;

    Ok(ApiSuccess {
        payload,
        request_id,
    })
}

pub(crate) fn source_api_operation_kind_or_http_request(
    value: EnumValue<SourceApiOperationKind>,
) -> SourceApiOperationKind {
    match value.as_known() {
        Some(SourceApiOperationKind::CLI_SOURCE_API_OPERATION_KIND_STRUCTURED_REQUEST) => {
            SourceApiOperationKind::CLI_SOURCE_API_OPERATION_KIND_STRUCTURED_REQUEST
        }
        Some(SourceApiOperationKind::CLI_SOURCE_API_OPERATION_KIND_HTTP_REQUEST)
        | Some(SourceApiOperationKind::CLI_SOURCE_API_OPERATION_KIND_UNSPECIFIED)
        | None => SourceApiOperationKind::CLI_SOURCE_API_OPERATION_KIND_HTTP_REQUEST,
    }
}

pub(crate) fn source_api_selector_kind_or_none(
    value: EnumValue<SourceApiSelectorKind>,
) -> SourceApiSelectorKind {
    match value.as_known() {
        Some(SourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_PATH) => {
            SourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_PATH
        }
        Some(SourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_IDENTIFIER) => {
            SourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_IDENTIFIER
        }
        Some(SourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_NONE)
        | Some(SourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_UNSPECIFIED)
        | None => SourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_NONE,
    }
}

pub(crate) fn source_api_pagination_policy_or_none(
    value: EnumValue<SourceApiPaginationPolicy>,
) -> SourceApiPaginationPolicy {
    match value.as_known() {
        Some(SourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_OPAQUE_TOKEN) => {
            SourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_OPAQUE_TOKEN
        }
        Some(SourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_NONE)
        | Some(SourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_UNSPECIFIED)
        | None => SourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_NONE,
    }
}

pub(crate) fn source_api_body_kind_or_none(
    value: EnumValue<SourceApiBodyKind>,
) -> SourceApiBodyKind {
    match value.as_known() {
        Some(SourceApiBodyKind::CLI_SOURCE_API_BODY_KIND_JSON) => {
            SourceApiBodyKind::CLI_SOURCE_API_BODY_KIND_JSON
        }
        Some(SourceApiBodyKind::CLI_SOURCE_API_BODY_KIND_TEXT) => {
            SourceApiBodyKind::CLI_SOURCE_API_BODY_KIND_TEXT
        }
        Some(SourceApiBodyKind::CLI_SOURCE_API_BODY_KIND_BINARY) => {
            SourceApiBodyKind::CLI_SOURCE_API_BODY_KIND_BINARY
        }
        Some(SourceApiBodyKind::CLI_SOURCE_API_BODY_KIND_NONE)
        | Some(SourceApiBodyKind::CLI_SOURCE_API_BODY_KIND_UNSPECIFIED)
        | None => SourceApiBodyKind::CLI_SOURCE_API_BODY_KIND_NONE,
    }
}

pub(crate) fn source_api_input_mode_or_none(
    value: EnumValue<SourceApiInputMode>,
) -> SourceApiInputMode {
    match value.as_known() {
        Some(SourceApiInputMode::CLI_SOURCE_API_INPUT_MODE_REQUEST_OBJECT) => {
            SourceApiInputMode::CLI_SOURCE_API_INPUT_MODE_REQUEST_OBJECT
        }
        Some(SourceApiInputMode::CLI_SOURCE_API_INPUT_MODE_REQUEST_BODY) => {
            SourceApiInputMode::CLI_SOURCE_API_INPUT_MODE_REQUEST_BODY
        }
        Some(SourceApiInputMode::CLI_SOURCE_API_INPUT_MODE_NONE)
        | Some(SourceApiInputMode::CLI_SOURCE_API_INPUT_MODE_UNSPECIFIED)
        | None => SourceApiInputMode::CLI_SOURCE_API_INPUT_MODE_NONE,
    }
}

pub(crate) fn source_api_operation_kind_label(
    value: EnumValue<SourceApiOperationKind>,
) -> &'static str {
    match source_api_operation_kind_or_http_request(value) {
        SourceApiOperationKind::CLI_SOURCE_API_OPERATION_KIND_HTTP_REQUEST => "http_request",
        SourceApiOperationKind::CLI_SOURCE_API_OPERATION_KIND_STRUCTURED_REQUEST => {
            "structured_request"
        }
        SourceApiOperationKind::CLI_SOURCE_API_OPERATION_KIND_UNSPECIFIED => unreachable!(),
    }
}

pub(crate) fn source_api_body_kind_label(value: EnumValue<SourceApiBodyKind>) -> &'static str {
    match source_api_body_kind_or_none(value) {
        SourceApiBodyKind::CLI_SOURCE_API_BODY_KIND_NONE => "none",
        SourceApiBodyKind::CLI_SOURCE_API_BODY_KIND_JSON => "json",
        SourceApiBodyKind::CLI_SOURCE_API_BODY_KIND_TEXT => "text",
        SourceApiBodyKind::CLI_SOURCE_API_BODY_KIND_BINARY => "binary",
        SourceApiBodyKind::CLI_SOURCE_API_BODY_KIND_UNSPECIFIED => unreachable!(),
    }
}

pub(crate) fn source_api_pagination_policy_label(
    value: EnumValue<SourceApiPaginationPolicy>,
) -> &'static str {
    match source_api_pagination_policy_or_none(value) {
        SourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_NONE => "none",
        SourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_OPAQUE_TOKEN => "opaque_token",
        SourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_UNSPECIFIED => unreachable!(),
    }
}

pub(crate) fn source_api_input_mode_label(value: EnumValue<SourceApiInputMode>) -> &'static str {
    match source_api_input_mode_or_none(value) {
        SourceApiInputMode::CLI_SOURCE_API_INPUT_MODE_NONE => "none",
        SourceApiInputMode::CLI_SOURCE_API_INPUT_MODE_REQUEST_OBJECT => "request object",
        SourceApiInputMode::CLI_SOURCE_API_INPUT_MODE_REQUEST_BODY => "request body",
        SourceApiInputMode::CLI_SOURCE_API_INPUT_MODE_UNSPECIFIED => unreachable!(),
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

fn source_api_draft_with_context(
    org: &str,
    source_key: &str,
    draft: &SourceApiDraft,
) -> Result<types::SourceApiDraft, ApiFailure> {
    let mut draft = draft.clone();
    draft.org_slug = try_into_value(org, ErrorStage::ExecuteQuery)?;
    draft.source_key = try_into_value(source_key, ErrorStage::ExecuteQuery)?;
    Ok(draft)
}

fn validate_source_api_descriptor(
    value: &SourceApiDescriptor,
    request_id: Option<String>,
) -> Result<(), ApiFailure> {
    if !value.source.is_set() {
        return Err(decode_failure(
            ErrorStage::ResolveSource,
            "source API descriptor response missing source metadata",
            request_id,
        ));
    }

    for operation in &value.operations {
        validate_source_api_operation(operation, request_id.clone())?;
    }

    Ok(())
}

fn validate_source_api_operation(
    value: &SourceApiOperation,
    request_id: Option<String>,
) -> Result<(), ApiFailure> {
    let operation_name = value.name.clone();

    validate_required_operation_message(
        value.method_policy.is_set(),
        &operation_name,
        "method policy",
        request_id.clone(),
    )?;
    validate_required_operation_message(
        value.field_policy.is_set(),
        &operation_name,
        "field policy",
        request_id.clone(),
    )?;
    validate_required_operation_message(
        value.header_policy.is_set(),
        &operation_name,
        "header policy",
        request_id,
    )
}

fn validate_required_operation_message(
    is_set: bool,
    operation_name: &str,
    field_name: &str,
    request_id: Option<String>,
) -> Result<(), ApiFailure> {
    if is_set {
        return Ok(());
    }

    Err(decode_failure(
        ErrorStage::ResolveSource,
        format!("source API operation `{operation_name}` missing {field_name}"),
        request_id,
    ))
}

fn validate_prepare_source_api_result(
    value: &PrepareSourceApiResult,
    request_id: Option<String>,
) -> Result<(), ApiFailure> {
    if value.preview.is_set() {
        return Ok(());
    }

    Err(decode_failure(
        ErrorStage::ExecuteQuery,
        "source API prepare response missing preview",
        request_id,
    ))
}

fn validate_execute_prepared_source_api_result(
    value: &ExecutePreparedSourceApiResult,
    request_id: Option<String>,
) -> Result<(), ApiFailure> {
    if value.source.is_set() {
        return Ok(());
    }

    Err(decode_failure(
        ErrorStage::ExecuteQuery,
        "source API execution response missing source metadata",
        request_id,
    ))
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

fn execute_prepared_source_api_problem_stage_for_code(code: ErrorCode) -> ErrorStage {
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

    use super::json_from_proto_json_value;
    use super::proto_json_value_from_json;
    use super::source_api_body_kind_label;
    use super::source_api_input_mode_label;
    use super::source_api_operation_kind_label;
    use super::source_api_pagination_policy_label;
    use super::source_api_selector_kind_or_none;
    use super::types;
    use super::validate_prepare_source_api_result;
    use crate::transport::http::ApiFailure;

    #[test]
    fn validate_prepare_source_api_result_requires_preview() {
        let error = validate_prepare_source_api_result(
            &types::PrepareSourceApiResponse {
                prepared_token: "prepared_123".to_owned(),
                ..Default::default()
            },
            Some("req_cli_123".to_owned()),
        )
        .expect_err("expected missing preview to fail");

        assert_eq!(
            error,
            ApiFailure::Decode(crate::transport::http::DecodeFailure {
                stage: ErrorStage::ExecuteQuery,
                message: "source API prepare response missing preview".to_owned(),
                request_id: Some("req_cli_123".to_owned()),
            })
        );
    }

    #[test]
    fn validate_source_api_descriptor_requires_operation_policies() {
        let error = source_api_descriptor(
            &types::DescribeSourceApiResponse {
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
    fn validate_execute_prepared_source_api_result_requires_source() {
        let error = execute_prepared_source_api_result(
            &types::ExecutePreparedSourceApiResponse {
                operation: "fetch".to_owned(),
                status: 200,
                content_type: "application/json".to_owned(),
                ..Default::default()
            },
            Some("req_missing_source".to_owned()),
        )
        .expect_err("expected missing source to fail");

        assert_eq!(
            error,
            ApiFailure::Decode(crate::transport::http::DecodeFailure {
                stage: ErrorStage::ExecuteQuery,
                message: "source API execution response missing source metadata".to_owned(),
                request_id: Some("req_missing_source".to_owned()),
            })
        );
    }

    #[test]
    fn source_api_enum_helpers_keep_cli_labels_stable() {
        assert_eq!(
            source_api_operation_kind_label(
                types::CliSourceApiOperationKind::CLI_SOURCE_API_OPERATION_KIND_HTTP_REQUEST.into(),
            ),
            "http_request"
        );
        assert_eq!(
            source_api_body_kind_label(
                types::CliSourceApiBodyKind::CLI_SOURCE_API_BODY_KIND_TEXT.into(),
            ),
            "text"
        );
        assert_eq!(
            source_api_pagination_policy_label(
                types::CliSourceApiPaginationPolicy::CLI_SOURCE_API_PAGINATION_POLICY_OPAQUE_TOKEN
                    .into(),
            ),
            "opaque_token"
        );
        assert_eq!(
            source_api_input_mode_label(
                types::CliSourceApiInputMode::CLI_SOURCE_API_INPUT_MODE_REQUEST_BODY.into(),
            ),
            "request body"
        );
        assert_eq!(
            source_api_selector_kind_or_none(
                types::CliSourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_UNSPECIFIED.into(),
            ),
            types::CliSourceApiSelectorKind::CLI_SOURCE_API_SELECTOR_KIND_NONE
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

    fn source_api_descriptor(
        value: &types::DescribeSourceApiResponse,
        request_id: Option<String>,
    ) -> Result<(), ApiFailure> {
        super::validate_source_api_descriptor(value, request_id)
    }

    fn execute_prepared_source_api_result(
        value: &types::ExecutePreparedSourceApiResponse,
        request_id: Option<String>,
    ) -> Result<(), ApiFailure> {
        super::validate_execute_prepared_source_api_result(value, request_id)
    }
}
