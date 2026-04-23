use buffa::EnumValue;
use buffa::MessageField;
use onequery_cli_core::error::ErrorStage;
use serde_json::Value as JsonValue;

use crate::transport::api_failure::ApiFailure;
use crate::transport::api_failure::ApiSuccess;
use crate::transport::api_failure::decode_failure;
use crate::transport::api_failure::failure_from_connect;
use crate::transport::api_failure::response_request_id;
use crate::transport::api_failure::try_into_value;
use crate::transport::client::AuthenticatedApiClient;
use crate::transport::generated::types;
use crate::transport::response_decode::require_non_empty_text;

pub(crate) type ProtoJsonObject = buffa_types::google::protobuf::Struct;
pub(crate) type ProtoJsonValue = buffa_types::google::protobuf::Value;

pub(crate) type SourceApiFieldEncoding = types::SourceApiFieldEncoding;
pub(crate) type SourceApiInputMode = types::SourceApiInputMode;
pub(crate) type SourceApiOperationKind = types::SourceApiOperationKind;
pub(crate) type SourceApiSelectorKind = types::SourceApiSelectorKind;
pub(crate) type SourceApiPaginationPolicy = types::SourceApiPaginationPolicy;
pub(crate) type SourceApiPatchMode = types::SourceApiPatchMode;
pub(crate) type SourceApiPathCapability = types::SourceApiPathCapability;
pub(crate) type SourceApiBodyKind = types::SourceApiBodyKind;
pub(crate) type SourceApiProvider = types::SourceProvider;
pub(crate) type SourceApiSource = types::CliSourceApiSource;
pub(crate) type SourceApiHeader = types::CliSourceApiHeader;
pub(crate) type SourceApiExample = types::CliSourceApiExample;
pub(crate) type SourceApiMethodPolicy = types::CliSourceApiMethodPolicy;
pub(crate) type SourceApiFieldPolicy = types::CliSourceApiFieldPolicy;
pub(crate) type SourceApiHeaderPolicy = types::CliSourceApiHeaderPolicy;
pub(crate) type SourceApiOperation = types::CliSourceApiOperation;
pub(crate) type SourceApiDescriptor = types::DescribeSourceApiResponse;
pub(crate) type SourceApiDraft = types::SourceApiDraft;
pub(crate) type SourceApiTarget = types::SourceApiTarget;
pub(crate) type SourceApiRequestBody = types::source_api_draft::Body;
pub(crate) type SourceApiPreview = types::SourceApiPreview;
pub(crate) type SourceApiExecutionResult = types::SourceApiExecutionResult;
pub(crate) type SourceApiResponseBody = types::source_api_execution_result::Body;

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum ExecuteSourceApiOutcome {
    Completed {
        preview: SourceApiPreview,
        result: SourceApiExecutionResult,
    },
    Continued {
        preview: SourceApiPreview,
        result: SourceApiExecutionResult,
        continuation_token: String,
    },
}

macro_rules! source_api_enum_surface {
    (
        $normalize:ident,
        $label_fn:ident,
        $enum_ty:ty,
        $default:path,
        $unspecified:path,
        {
            $(
                $variant:path => $label:literal,
            )+
        }
    ) => {
        pub(crate) fn $normalize(value: EnumValue<$enum_ty>) -> $enum_ty {
            match value.as_known() {
                $(
                    Some($variant) => $variant,
                )+
                Some($unspecified) | None => $default,
            }
        }

        pub(crate) fn $label_fn(value: EnumValue<$enum_ty>) -> &'static str {
            match $normalize(value) {
                $(
                    $variant => $label,
                )+
                $unspecified => unreachable!(),
            }
        }
    };
}

pub(crate) async fn describe_source_api(
    client: &AuthenticatedApiClient,
    org: &str,
    source_key: &str,
) -> Result<ApiSuccess<SourceApiDescriptor>, ApiFailure> {
    let org_slug: String = try_into_value(org, ErrorStage::ResolveSource)?;
    let source_key: String = try_into_value(source_key, ErrorStage::ResolveSource)?;
    let response = match client
        .source_api()
        .describe_source_api(types::DescribeSourceApiRequest {
            org_slug: Some(org_slug),
            source_key: Some(source_key),
            ..Default::default()
        })
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(error, ErrorStage::ResolveSource));
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

pub(crate) async fn preview_source_api(
    client: &AuthenticatedApiClient,
    org: &str,
    source_key: &str,
    draft: &SourceApiDraft,
) -> Result<ApiSuccess<SourceApiPreview>, ApiFailure> {
    let response = match client
        .source_api()
        .preview_source_api(types::PreviewSourceApiRequest {
            target: MessageField::some(source_api_target(
                org,
                source_key,
                ErrorStage::ExecuteQuery,
            )?),
            draft: MessageField::some(draft.clone()),
            ..Default::default()
        })
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(error, ErrorStage::ExecuteQuery));
        }
    };
    let request_id = response_request_id(response.headers());
    let payload = response.into_owned();
    let payload = preview_source_api_response_from_generated(payload, request_id.clone())?;

    Ok(ApiSuccess {
        payload,
        request_id,
    })
}

pub(crate) async fn execute_source_api(
    client: &AuthenticatedApiClient,
    org: &str,
    source_key: &str,
    draft: &SourceApiDraft,
) -> Result<ApiSuccess<ExecuteSourceApiOutcome>, ApiFailure> {
    let response = match client
        .source_api()
        .execute_source_api(types::ExecuteSourceApiRequest {
            target: MessageField::some(source_api_target(
                org,
                source_key,
                ErrorStage::ExecuteQuery,
            )?),
            draft: MessageField::some(draft.clone()),
            ..Default::default()
        })
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(error, ErrorStage::ExecuteQuery));
        }
    };
    let request_id = response_request_id(response.headers());
    let payload = response.into_owned();
    let payload = execute_source_api_outcome_from_generated(payload, request_id.clone())?;

    Ok(ApiSuccess {
        payload,
        request_id,
    })
}

pub(crate) async fn resume_source_api(
    client: &AuthenticatedApiClient,
    org: &str,
    source_key: &str,
    continuation_token: &str,
) -> Result<ApiSuccess<ExecuteSourceApiOutcome>, ApiFailure> {
    let response = match client
        .source_api()
        .resume_source_api(types::ResumeSourceApiRequest {
            target: MessageField::some(source_api_target(
                org,
                source_key,
                ErrorStage::ExecuteQuery,
            )?),
            continuation_token: Some(try_into_value(
                continuation_token,
                ErrorStage::ExecuteQuery,
            )?),
            ..Default::default()
        })
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(error, ErrorStage::ExecuteQuery));
        }
    };
    let request_id = response_request_id(response.headers());
    let payload = response.into_owned();
    let payload = resume_source_api_outcome_from_generated(payload, request_id.clone())?;

    Ok(ApiSuccess {
        payload,
        request_id,
    })
}

source_api_enum_surface!(
    source_api_operation_kind_or_http_request,
    source_api_operation_kind_label,
    SourceApiOperationKind,
    SourceApiOperationKind::SOURCE_API_OPERATION_KIND_HTTP_REQUEST,
    SourceApiOperationKind::SOURCE_API_OPERATION_KIND_UNSPECIFIED,
    {
        SourceApiOperationKind::SOURCE_API_OPERATION_KIND_HTTP_REQUEST => "http_request",
        SourceApiOperationKind::SOURCE_API_OPERATION_KIND_STRUCTURED_REQUEST => "structured_request",
    }
);

source_api_enum_surface!(
    source_api_selector_kind_or_none,
    source_api_selector_kind_label,
    SourceApiSelectorKind,
    SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_NONE,
    SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_UNSPECIFIED,
    {
        SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_NONE => "none",
        SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_PATH => "path",
        SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_IDENTIFIER => "identifier",
    }
);

source_api_enum_surface!(
    source_api_pagination_policy_or_none,
    source_api_pagination_policy_label,
    SourceApiPaginationPolicy,
    SourceApiPaginationPolicy::SOURCE_API_PAGINATION_POLICY_NONE,
    SourceApiPaginationPolicy::SOURCE_API_PAGINATION_POLICY_UNSPECIFIED,
    {
        SourceApiPaginationPolicy::SOURCE_API_PAGINATION_POLICY_NONE => "none",
        SourceApiPaginationPolicy::SOURCE_API_PAGINATION_POLICY_CONTINUATION_TOKEN => "continuation_token",
    }
);

source_api_enum_surface!(
    source_api_body_kind_or_none,
    source_api_body_kind_label,
    SourceApiBodyKind,
    SourceApiBodyKind::SOURCE_API_BODY_KIND_NONE,
    SourceApiBodyKind::SOURCE_API_BODY_KIND_UNSPECIFIED,
    {
        SourceApiBodyKind::SOURCE_API_BODY_KIND_NONE => "none",
        SourceApiBodyKind::SOURCE_API_BODY_KIND_JSON => "json",
        SourceApiBodyKind::SOURCE_API_BODY_KIND_TEXT => "text",
        SourceApiBodyKind::SOURCE_API_BODY_KIND_BINARY => "binary",
    }
);

source_api_enum_surface!(
    source_api_input_mode_or_none,
    source_api_input_mode_label,
    SourceApiInputMode,
    SourceApiInputMode::SOURCE_API_INPUT_MODE_NONE,
    SourceApiInputMode::SOURCE_API_INPUT_MODE_UNSPECIFIED,
    {
        SourceApiInputMode::SOURCE_API_INPUT_MODE_NONE => "none",
        SourceApiInputMode::SOURCE_API_INPUT_MODE_REQUEST_OBJECT => "request object",
        SourceApiInputMode::SOURCE_API_INPUT_MODE_REQUEST_BODY => "request body",
    }
);

source_api_enum_surface!(
    source_api_patch_mode_or_none,
    source_api_patch_mode_label,
    SourceApiPatchMode,
    SourceApiPatchMode::SOURCE_API_PATCH_MODE_NONE,
    SourceApiPatchMode::SOURCE_API_PATCH_MODE_UNSPECIFIED,
    {
        SourceApiPatchMode::SOURCE_API_PATCH_MODE_NONE => "none",
        SourceApiPatchMode::SOURCE_API_PATCH_MODE_SEPARATE => "separate",
        SourceApiPatchMode::SOURCE_API_PATCH_MODE_MERGE => "merge",
    }
);

pub(crate) fn source_api_field_policy_has_encoding(
    policy: &SourceApiFieldPolicy,
    encoding: SourceApiFieldEncoding,
) -> bool {
    policy
        .field_encodings
        .iter()
        .any(|value| value.as_known() == Some(encoding))
}

pub(crate) fn source_api_field_policy_has_path_capability(
    policy: &SourceApiFieldPolicy,
    capability: SourceApiPathCapability,
) -> bool {
    policy
        .path_capabilities
        .iter()
        .any(|value| value.as_known() == Some(capability))
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

fn source_api_target(
    org: &str,
    source_key: &str,
    stage: ErrorStage,
) -> Result<SourceApiTarget, ApiFailure> {
    Ok(SourceApiTarget {
        org_slug: Some(try_into_value(org, stage)?),
        source_key: Some(try_into_value(source_key, stage)?),
        ..Default::default()
    })
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
    let operation_name = value.name.as_deref().unwrap_or("<unnamed>");

    validate_required_operation_message(
        value.method_policy.is_set(),
        operation_name,
        "method policy",
        request_id.clone(),
    )?;
    validate_required_operation_message(
        value.field_policy.is_set(),
        operation_name,
        "field policy",
        request_id.clone(),
    )?;
    validate_required_operation_message(
        value.header_policy.is_set(),
        operation_name,
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

fn execute_source_api_outcome_from_generated(
    value: types::ExecuteSourceApiResponse,
    request_id: Option<String>,
) -> Result<ExecuteSourceApiOutcome, ApiFailure> {
    match value.outcome {
        Some(types::execute_source_api_response::Outcome::Completed(completed)) => {
            Ok(ExecuteSourceApiOutcome::Completed {
                preview: required_source_api_preview(
                    completed.preview,
                    "source API execution response missing preview",
                    request_id.clone(),
                )?,
                result: required_source_api_execution_result(
                    completed.result,
                    "source API execution response missing result",
                    request_id,
                )?,
            })
        }
        Some(types::execute_source_api_response::Outcome::Continued(continued)) => {
            Ok(ExecuteSourceApiOutcome::Continued {
                preview: required_source_api_preview(
                    continued.preview,
                    "source API execution response missing preview",
                    request_id.clone(),
                )?,
                result: required_source_api_execution_result(
                    continued.result,
                    "source API execution response missing result",
                    request_id.clone(),
                )?,
                continuation_token: require_non_empty_text(
                    continued.continuation_token,
                    ErrorStage::ExecuteQuery,
                    "source API execution response missing continuation token",
                    request_id,
                )?,
            })
        }
        None => Err(decode_failure(
            ErrorStage::ExecuteQuery,
            "source API execution response missing outcome",
            request_id,
        )),
    }
}

fn resume_source_api_outcome_from_generated(
    value: types::ResumeSourceApiResponse,
    request_id: Option<String>,
) -> Result<ExecuteSourceApiOutcome, ApiFailure> {
    match value.outcome {
        Some(types::resume_source_api_response::Outcome::Completed(completed)) => {
            Ok(ExecuteSourceApiOutcome::Completed {
                preview: required_source_api_preview(
                    completed.preview,
                    "source API execution response missing preview",
                    request_id.clone(),
                )?,
                result: required_source_api_execution_result(
                    completed.result,
                    "source API execution response missing result",
                    request_id,
                )?,
            })
        }
        Some(types::resume_source_api_response::Outcome::Continued(continued)) => {
            Ok(ExecuteSourceApiOutcome::Continued {
                preview: required_source_api_preview(
                    continued.preview,
                    "source API execution response missing preview",
                    request_id.clone(),
                )?,
                result: required_source_api_execution_result(
                    continued.result,
                    "source API execution response missing result",
                    request_id.clone(),
                )?,
                continuation_token: require_non_empty_text(
                    continued.continuation_token,
                    ErrorStage::ExecuteQuery,
                    "source API execution response missing continuation token",
                    request_id,
                )?,
            })
        }
        None => Err(decode_failure(
            ErrorStage::ExecuteQuery,
            "source API execution response missing outcome",
            request_id,
        )),
    }
}

fn preview_source_api_response_from_generated(
    value: types::PreviewSourceApiResponse,
    request_id: Option<String>,
) -> Result<SourceApiPreview, ApiFailure> {
    required_source_api_preview(
        value.preview,
        "source API preview response missing preview",
        request_id,
    )
}

fn required_source_api_preview(
    preview: MessageField<SourceApiPreview>,
    message: &'static str,
    request_id: Option<String>,
) -> Result<SourceApiPreview, ApiFailure> {
    let preview = preview
        .into_option()
        .ok_or_else(|| decode_failure(ErrorStage::ExecuteQuery, message, request_id.clone()))?;

    if !preview.source.is_set() {
        return Err(decode_failure(
            ErrorStage::ExecuteQuery,
            "source API execution response missing preview source metadata",
            request_id,
        ));
    }

    Ok(preview)
}

fn required_source_api_execution_result(
    result: MessageField<SourceApiExecutionResult>,
    message: &'static str,
    request_id: Option<String>,
) -> Result<SourceApiExecutionResult, ApiFailure> {
    let result = result
        .into_option()
        .ok_or_else(|| decode_failure(ErrorStage::ExecuteQuery, message, request_id.clone()))?;

    if !result.source.is_set() {
        return Err(decode_failure(
            ErrorStage::ExecuteQuery,
            "source API execution response missing source metadata",
            request_id,
        ));
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use onequery_cli_core::error::ErrorStage;
    use pretty_assertions::assert_eq;
    use serde_json::json;

    use super::execute_source_api_outcome_from_generated;
    use super::json_from_proto_json_value;
    use super::proto_json_object_from_json;
    use super::proto_json_value_from_json;
    use super::source_api_body_kind_label;
    use super::source_api_input_mode_label;
    use super::source_api_operation_kind_label;
    use super::source_api_pagination_policy_label;
    use super::source_api_selector_kind_label;
    use super::source_api_selector_kind_or_none;
    use super::types;
    use crate::transport::api_failure::ApiFailure;

    #[test]
    fn validate_execute_source_api_outcome_requires_preview() {
        let error = execute_source_api_outcome_from_generated(
            types::ExecuteSourceApiResponse {
                outcome: Some(types::execute_source_api_response::Outcome::PreviewOnly(
                    Box::new(types::ExecuteSourceApiPreviewOnly {
                        ..Default::default()
                    }),
                )),
                ..Default::default()
            },
            Some("req_cli_123".to_owned()),
        )
        .expect_err("expected missing preview to fail");

        assert_eq!(
            error,
            ApiFailure::Decode(crate::transport::api_failure::DecodeFailure {
                stage: ErrorStage::ExecuteQuery,
                message: "source API execution response missing preview".to_owned(),
                request_id: Some("req_cli_123".to_owned()),
            })
        );
    }

    #[test]
    fn validate_execute_source_api_outcome_requires_outcome() {
        let error = execute_source_api_outcome_from_generated(
            types::ExecuteSourceApiResponse::default(),
            Some("req_missing_outcome".to_owned()),
        )
        .expect_err("expected missing outcome to fail");

        assert_eq!(
            error,
            ApiFailure::Decode(crate::transport::api_failure::DecodeFailure {
                stage: ErrorStage::ExecuteQuery,
                message: "source API execution response missing outcome".to_owned(),
                request_id: Some("req_missing_outcome".to_owned()),
            })
        );
    }

    #[test]
    fn validate_source_api_descriptor_requires_operation_policies() {
        let error = source_api_descriptor(
            &types::DescribeSourceApiResponse {
                source: buffa::MessageField::some(types::CliSourceApiSource {
                    source_key: Some("github-prod".to_owned()),
                    provider: Some(types::SourceProvider::SOURCE_PROVIDER_GITHUB.into()),
                    ..Default::default()
                }),
                descriptor_version: Some("github.v1".to_owned()),
                operations: vec![types::CliSourceApiOperation {
                    name: Some("fetch".to_owned()),
                    kind: Some(
                        types::SourceApiOperationKind::SOURCE_API_OPERATION_KIND_HTTP_REQUEST
                            .into(),
                    ),
                    summary: Some("Fetch a resource".to_owned()),
                    description: Some("Fetches a GitHub resource.".to_owned()),
                    selector_kind: Some(
                        types::SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_PATH.into(),
                    ),
                    pagination_policy: Some(
                        types::SourceApiPaginationPolicy::SOURCE_API_PAGINATION_POLICY_NONE.into(),
                    ),
                    field_policy: buffa::MessageField::some(types::CliSourceApiFieldPolicy {
                        allows_raw_fields: Some(true),
                        allows_typed_fields: Some(true),
                        ..Default::default()
                    }),
                    header_policy: buffa::MessageField::some(types::CliSourceApiHeaderPolicy {
                        allowed_request_header_names: vec!["accept".to_owned()],
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
            ApiFailure::Decode(crate::transport::api_failure::DecodeFailure {
                stage: ErrorStage::ResolveSource,
                message: "source API operation `fetch` missing method policy".to_owned(),
                request_id: Some("req_missing_policy".to_owned()),
            })
        );
    }

    #[test]
    fn validate_execute_source_api_outcome_requires_source() {
        let error = execute_source_api_outcome(
            types::ExecuteSourceApiResponse {
                outcome: Some(types::execute_source_api_response::Outcome::Completed(
                    Box::new(types::ExecuteSourceApiCompleted {
                        preview: buffa::MessageField::some(types::SourceApiPreview {
                            source: buffa::MessageField::some(types::CliSourceApiSource {
                                source_key: Some("github-prod".to_owned()),
                                provider: Some(types::SourceProvider::SOURCE_PROVIDER_GITHUB.into()),
                                ..Default::default()
                            }),
                            operation: Some("fetch".to_owned()),
                            kind: Some(
                                types::SourceApiOperationKind::SOURCE_API_OPERATION_KIND_HTTP_REQUEST
                                    .into(),
                            ),
                            body_kind: Some(
                                types::SourceApiBodyKind::SOURCE_API_BODY_KIND_NONE.into(),
                            ),
                            pagination_policy: Some(
                                types::SourceApiPaginationPolicy::SOURCE_API_PAGINATION_POLICY_NONE
                                    .into(),
                            ),
                            ..Default::default()
                        }),
                        result: buffa::MessageField::some(types::SourceApiExecutionResult {
                            operation: Some("fetch".to_owned()),
                            status: Some(200),
                            content_type: Some("application/json".to_owned()),
                            ..Default::default()
                        }),
                        ..Default::default()
                    }),
                )),
                ..Default::default()
            },
            Some("req_missing_source".to_owned()),
        )
        .expect_err("expected missing source to fail");

        assert_eq!(
            error,
            ApiFailure::Decode(crate::transport::api_failure::DecodeFailure {
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
                types::SourceApiOperationKind::SOURCE_API_OPERATION_KIND_HTTP_REQUEST.into(),
            ),
            "http_request"
        );
        assert_eq!(
            source_api_body_kind_label(types::SourceApiBodyKind::SOURCE_API_BODY_KIND_TEXT.into(),),
            "text"
        );
        assert_eq!(
            source_api_pagination_policy_label(
                types::SourceApiPaginationPolicy::SOURCE_API_PAGINATION_POLICY_CONTINUATION_TOKEN
                    .into(),
            ),
            "continuation_token"
        );
        assert_eq!(
            source_api_input_mode_label(
                types::SourceApiInputMode::SOURCE_API_INPUT_MODE_REQUEST_BODY.into(),
            ),
            "request body"
        );
        assert_eq!(
            source_api_selector_kind_label(
                types::SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_IDENTIFIER.into(),
            ),
            "identifier"
        );
        assert_eq!(
            source_api_selector_kind_or_none(
                types::SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_UNSPECIFIED.into(),
            ),
            types::SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_NONE
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

    #[test]
    fn proto_json_object_from_json_preserves_nested_object_shape() {
        let value = proto_json_object_from_json(json!({
            "params": {
                "limit": 25,
                "labels": ["bug", "feature"]
            }
        }))
        .expect("expected JSON object to encode as protobuf Struct");

        assert_eq!(
            serde_json::to_value(value).expect("expected Struct to serialize"),
            json!({
                "params": {
                    "limit": 25.0,
                    "labels": ["bug", "feature"]
                }
            })
        );
    }

    #[test]
    fn generated_source_api_transport_types_keep_wkt_payloads_as_truth() {
        let draft = types::SourceApiDraft {
            body: Some(types::source_api_draft::Body::FieldPatch(Box::new(
                proto_json_object_from_json(json!({
                    "params": {
                        "state": "open"
                    }
                }))
                .expect("expected JSON object to encode as protobuf Struct"),
            ))),
            ..Default::default()
        };

        let draft_json = serde_json::to_value(draft).expect("expected draft to serialize");
        assert_eq!(
            draft_json.get("fieldPatch"),
            Some(&json!({
                "params": {
                    "state": "open"
                }
            }))
        );
        assert!(draft_json.get("requestId").is_none());
    }

    fn source_api_descriptor(
        value: &types::DescribeSourceApiResponse,
        request_id: Option<String>,
    ) -> Result<(), ApiFailure> {
        super::validate_source_api_descriptor(value, request_id)
    }

    fn execute_source_api_outcome(
        value: types::ExecuteSourceApiResponse,
        request_id: Option<String>,
    ) -> Result<super::ExecuteSourceApiOutcome, ApiFailure> {
        super::execute_source_api_outcome_from_generated(value, request_id)
    }
}
