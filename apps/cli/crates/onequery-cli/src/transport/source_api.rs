use buffa::EnumValue;
use buffa::MessageField;
use onequery_core::error::ErrorStage;
use serde_json::Value as JsonValue;

use crate::transport::api_failure::ApiFailure;
use crate::transport::api_failure::ApiSuccess;
use crate::transport::api_failure::decode_failure;
use crate::transport::api_failure::failure_from_connect;
use crate::transport::api_failure::success_response_request_id;
use crate::transport::api_failure::try_into_value;
use crate::transport::client::AuthenticatedApiClient;
use crate::transport::generated::types;
use crate::transport::response_decode::require_non_empty_text;
use crate::transport::source::source_selector_from_reference;

mod validation;

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

macro_rules! source_api_enum_label {
    (
        $label_fn:ident,
        $enum_ty:ty,
        $unspecified:path,
        {
            $(
                $variant:path => $label:literal,
            )+
        }
    ) => {
        pub(crate) fn $label_fn(value: EnumValue<$enum_ty>) -> &'static str {
            match value.as_known() {
                $(
                    Some($variant) => $label,
                )+
                Some($unspecified) => "unspecified",
                None => "unknown",
            }
        }
    };
}

pub(crate) async fn describe_source_api(
    client: &AuthenticatedApiClient,
    org: &str,
    source_key: &str,
) -> Result<ApiSuccess<SourceApiDescriptor>, ApiFailure> {
    let org_slug: String = try_into_value(org, ErrorStage::SourceApiDescribe)?;
    let source_key: String = try_into_value(source_key, ErrorStage::SourceApiDescribe)?;
    let response = match client
        .source_api()
        .describe_source_api(types::DescribeSourceApiRequest {
            org_slug: Some(org_slug),
            source: MessageField::some(source_selector_from_reference(
                &source_key,
                ErrorStage::SourceApiDescribe,
            )?),
            ..Default::default()
        })
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(error, ErrorStage::SourceApiDescribe));
        }
    };
    let request_id = success_response_request_id(&response);
    let payload = response.into_owned();
    validation::validate_source_api_descriptor(&payload, request_id.clone())?;

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
                ErrorStage::SourceApiPrepare,
            )?),
            draft: MessageField::some(draft.clone()),
            ..Default::default()
        })
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(error, ErrorStage::SourceApiPrepare));
        }
    };
    let request_id = success_response_request_id(&response);
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
                ErrorStage::SourceApiExecute,
            )?),
            draft: MessageField::some(draft.clone()),
            ..Default::default()
        })
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(error, ErrorStage::SourceApiExecute));
        }
    };
    let request_id = success_response_request_id(&response);
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
                ErrorStage::SourceApiExecute,
            )?),
            continuation_token: Some(try_into_value(
                continuation_token,
                ErrorStage::SourceApiExecute,
            )?),
            ..Default::default()
        })
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(error, ErrorStage::SourceApiExecute));
        }
    };
    let request_id = success_response_request_id(&response);
    let payload = response.into_owned();
    let payload = resume_source_api_outcome_from_generated(payload, request_id.clone())?;

    Ok(ApiSuccess {
        payload,
        request_id,
    })
}

source_api_enum_label!(
    source_api_operation_kind_label,
    SourceApiOperationKind,
    SourceApiOperationKind::SOURCE_API_OPERATION_KIND_UNSPECIFIED,
    {
        SourceApiOperationKind::SOURCE_API_OPERATION_KIND_HTTP_REQUEST => "http_request",
        SourceApiOperationKind::SOURCE_API_OPERATION_KIND_STRUCTURED_REQUEST => "structured_request",
    }
);

source_api_enum_label!(
    source_api_selector_kind_label,
    SourceApiSelectorKind,
    SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_UNSPECIFIED,
    {
        SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_NONE => "none",
        SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_PATH => "path",
        SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_IDENTIFIER => "identifier",
    }
);

source_api_enum_label!(
    source_api_pagination_policy_label,
    SourceApiPaginationPolicy,
    SourceApiPaginationPolicy::SOURCE_API_PAGINATION_POLICY_UNSPECIFIED,
    {
        SourceApiPaginationPolicy::SOURCE_API_PAGINATION_POLICY_NONE => "none",
        SourceApiPaginationPolicy::SOURCE_API_PAGINATION_POLICY_CONTINUATION_TOKEN => "continuation_token",
    }
);

source_api_enum_label!(
    source_api_body_kind_label,
    SourceApiBodyKind,
    SourceApiBodyKind::SOURCE_API_BODY_KIND_UNSPECIFIED,
    {
        SourceApiBodyKind::SOURCE_API_BODY_KIND_NONE => "none",
        SourceApiBodyKind::SOURCE_API_BODY_KIND_JSON => "json",
        SourceApiBodyKind::SOURCE_API_BODY_KIND_TEXT => "text",
        SourceApiBodyKind::SOURCE_API_BODY_KIND_BINARY => "binary",
    }
);

source_api_enum_label!(
    source_api_field_encoding_label,
    SourceApiFieldEncoding,
    SourceApiFieldEncoding::SOURCE_API_FIELD_ENCODING_UNSPECIFIED,
    {
        SourceApiFieldEncoding::SOURCE_API_FIELD_ENCODING_RAW => "raw",
        SourceApiFieldEncoding::SOURCE_API_FIELD_ENCODING_TYPED => "typed",
    }
);

source_api_enum_label!(
    source_api_path_capability_label,
    SourceApiPathCapability,
    SourceApiPathCapability::SOURCE_API_PATH_CAPABILITY_UNSPECIFIED,
    {
        SourceApiPathCapability::SOURCE_API_PATH_CAPABILITY_NESTED => "nested",
        SourceApiPathCapability::SOURCE_API_PATH_CAPABILITY_ARRAY => "array",
    }
);

source_api_enum_label!(
    source_api_input_mode_label,
    SourceApiInputMode,
    SourceApiInputMode::SOURCE_API_INPUT_MODE_UNSPECIFIED,
    {
        SourceApiInputMode::SOURCE_API_INPUT_MODE_NONE => "none",
        SourceApiInputMode::SOURCE_API_INPUT_MODE_REQUEST_OBJECT => "request object",
        SourceApiInputMode::SOURCE_API_INPUT_MODE_REQUEST_BODY => "request body",
    }
);

source_api_enum_label!(
    source_api_patch_mode_label,
    SourceApiPatchMode,
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
        source: MessageField::some(source_selector_from_reference(source_key, stage)?),
        ..Default::default()
    })
}

fn execute_source_api_outcome_from_generated(
    value: types::ExecuteSourceApiResponse,
    request_id: Option<String>,
) -> Result<ExecuteSourceApiOutcome, ApiFailure> {
    match value.outcome {
        Some(types::execute_source_api_response::Outcome::Completed(completed)) => {
            Ok(ExecuteSourceApiOutcome::Completed {
                preview: validation::required_source_api_preview(
                    completed.preview,
                    "source API execution response missing preview",
                    request_id.clone(),
                    ErrorStage::SourceApiExecute,
                )?,
                result: validation::required_source_api_execution_result(
                    completed.result,
                    "source API execution response missing result",
                    request_id,
                )?,
            })
        }
        Some(types::execute_source_api_response::Outcome::Continued(continued)) => {
            Ok(ExecuteSourceApiOutcome::Continued {
                preview: validation::required_source_api_preview(
                    continued.preview,
                    "source API execution response missing preview",
                    request_id.clone(),
                    ErrorStage::SourceApiExecute,
                )?,
                result: validation::required_source_api_execution_result(
                    continued.result,
                    "source API execution response missing result",
                    request_id.clone(),
                )?,
                continuation_token: require_non_empty_text(
                    continued.continuation_token,
                    ErrorStage::SourceApiExecute,
                    "source API execution response missing continuation token",
                    request_id,
                )?,
            })
        }
        None => Err(decode_failure(
            ErrorStage::SourceApiExecute,
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
                preview: validation::required_source_api_preview(
                    completed.preview,
                    "source API execution response missing preview",
                    request_id.clone(),
                    ErrorStage::SourceApiExecute,
                )?,
                result: validation::required_source_api_execution_result(
                    completed.result,
                    "source API execution response missing result",
                    request_id,
                )?,
            })
        }
        Some(types::resume_source_api_response::Outcome::Continued(continued)) => {
            Ok(ExecuteSourceApiOutcome::Continued {
                preview: validation::required_source_api_preview(
                    continued.preview,
                    "source API execution response missing preview",
                    request_id.clone(),
                    ErrorStage::SourceApiExecute,
                )?,
                result: validation::required_source_api_execution_result(
                    continued.result,
                    "source API execution response missing result",
                    request_id.clone(),
                )?,
                continuation_token: require_non_empty_text(
                    continued.continuation_token,
                    ErrorStage::SourceApiExecute,
                    "source API execution response missing continuation token",
                    request_id,
                )?,
            })
        }
        None => Err(decode_failure(
            ErrorStage::SourceApiExecute,
            "source API execution response missing outcome",
            request_id,
        )),
    }
}

fn preview_source_api_response_from_generated(
    value: types::PreviewSourceApiResponse,
    request_id: Option<String>,
) -> Result<SourceApiPreview, ApiFailure> {
    validation::required_source_api_preview(
        value.preview,
        "source API preview response missing preview",
        request_id,
        ErrorStage::SourceApiPrepare,
    )
}

#[cfg(test)]
mod tests {
    use onequery_core::error::ErrorStage;
    use pretty_assertions::assert_eq;
    use serde_json::json;

    use super::execute_source_api_outcome_from_generated;
    use super::json_from_proto_json_value;
    use super::preview_source_api_response_from_generated;
    use super::proto_json_object_from_json;
    use super::proto_json_value_from_json;
    use super::source_api_body_kind_label;
    use super::source_api_input_mode_label;
    use super::source_api_operation_kind_label;
    use super::source_api_pagination_policy_label;
    use super::source_api_selector_kind_label;
    use super::types;
    use crate::transport::api_failure::ApiFailure;

    #[test]
    fn validate_preview_source_api_response_requires_preview() {
        let error = preview_source_api_response_from_generated(
            types::PreviewSourceApiResponse::default(),
            Some("req_cli_123".to_owned()),
        )
        .expect_err("expected missing preview to fail");

        assert_eq!(
            error,
            ApiFailure::Decode(crate::transport::api_failure::DecodeFailure {
                stage: ErrorStage::SourceApiPrepare,
                message: "source API preview response missing preview".to_owned(),
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
                stage: ErrorStage::SourceApiExecute,
                message: "source API execution response missing outcome".to_owned(),
                request_id: Some("req_missing_outcome".to_owned()),
            })
        );
    }

    #[test]
    fn validate_execute_source_api_outcome_requires_source() {
        let error = execute_source_api_outcome(
            types::ExecuteSourceApiResponse {
                outcome: Some(types::execute_source_api_response::Outcome::Completed(
                    Box::new(types::SourceApiExecutionCompleted {
                        preview: buffa::MessageField::some(types::SourceApiPreview {
                            source: buffa::MessageField::some(types::CliSourceApiSource {
                                source_key: Some("github-prod".to_owned()),
                                provider: Some("github".to_owned()),
                                ..Default::default()
                            }),
                            operation_name: Some("fetch".to_owned()),
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
                            operation_name: Some("fetch".to_owned()),
                            http_status_code: Some(200),
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
                stage: ErrorStage::SourceApiExecute,
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
            source_api_selector_kind_label(
                types::SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_UNSPECIFIED.into(),
            ),
            "unspecified"
        );
        assert_eq!(source_api_selector_kind_label(99.into()), "unknown");
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

    fn execute_source_api_outcome(
        value: types::ExecuteSourceApiResponse,
        request_id: Option<String>,
    ) -> Result<super::ExecuteSourceApiOutcome, ApiFailure> {
        super::execute_source_api_outcome_from_generated(value, request_id)
    }
}
