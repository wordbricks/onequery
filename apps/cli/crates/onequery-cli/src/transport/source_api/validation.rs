use buffa::EnumValue;
use buffa::Enumeration;
use buffa::MessageField;
use onequery_core::error::ErrorStage;

use super::SourceApiBodyKind;
use super::SourceApiDescriptor;
use super::SourceApiExecutionResult;
use super::SourceApiFieldEncoding;
use super::SourceApiFieldPolicy;
use super::SourceApiInputMode;
use super::SourceApiOperation;
use super::SourceApiOperationKind;
use super::SourceApiPaginationPolicy;
use super::SourceApiPatchMode;
use super::SourceApiPathCapability;
use super::SourceApiPreview;
use super::SourceApiSelectorKind;
use super::SourceApiSource;
use crate::transport::api_failure::ApiFailure;
use crate::transport::api_failure::decode_failure;

pub(super) fn validate_source_api_descriptor(
    value: &SourceApiDescriptor,
    request_id: Option<String>,
) -> Result<(), ApiFailure> {
    let source = value.source.as_option().ok_or_else(|| {
        decode_failure(
            ErrorStage::SourceApiDescribe,
            "source API descriptor response missing source metadata",
            request_id.clone(),
        )
    })?;
    validate_source_api_source(source, ErrorStage::SourceApiDescribe, request_id.clone())?;

    for operation in &value.operations {
        validate_source_api_operation(operation, request_id.clone())?;
    }

    Ok(())
}

pub(super) fn required_source_api_preview(
    preview: MessageField<SourceApiPreview>,
    message: &'static str,
    request_id: Option<String>,
    stage: ErrorStage,
) -> Result<SourceApiPreview, ApiFailure> {
    let preview = preview
        .into_option()
        .ok_or_else(|| decode_failure(stage, message, request_id.clone()))?;

    if !preview.source.is_set() {
        return Err(decode_failure(
            stage,
            "source API execution response missing preview source metadata",
            request_id,
        ));
    }
    if let Some(source) = preview.source.as_option() {
        validate_source_api_source(source, stage, request_id.clone())?;
    }
    validate_required_source_api_enum(
        preview.kind,
        SourceApiOperationKind::SOURCE_API_OPERATION_KIND_UNSPECIFIED,
        stage,
        "source API preview response has invalid kind",
        request_id.clone(),
    )?;
    validate_required_source_api_enum(
        preview.body_kind,
        SourceApiBodyKind::SOURCE_API_BODY_KIND_UNSPECIFIED,
        stage,
        "source API preview response has invalid body kind",
        request_id.clone(),
    )?;
    validate_required_source_api_enum(
        preview.pagination_policy,
        SourceApiPaginationPolicy::SOURCE_API_PAGINATION_POLICY_UNSPECIFIED,
        stage,
        "source API preview response has invalid pagination policy",
        request_id,
    )?;

    Ok(preview)
}

pub(super) fn required_source_api_execution_result(
    result: MessageField<SourceApiExecutionResult>,
    message: &'static str,
    request_id: Option<String>,
) -> Result<SourceApiExecutionResult, ApiFailure> {
    let result = result
        .into_option()
        .ok_or_else(|| decode_failure(ErrorStage::SourceApiExecute, message, request_id.clone()))?;

    if !result.source.is_set() {
        return Err(decode_failure(
            ErrorStage::SourceApiExecute,
            "source API execution response missing source metadata",
            request_id,
        ));
    }
    if let Some(source) = result.source.as_option() {
        validate_source_api_source(source, ErrorStage::SourceApiExecute, request_id)?;
    }

    Ok(result)
}

fn validate_source_api_operation(
    value: &SourceApiOperation,
    request_id: Option<String>,
) -> Result<(), ApiFailure> {
    let operation_name = value.name.as_deref().unwrap_or("<unnamed>");

    validate_required_source_api_enum(
        value.kind,
        SourceApiOperationKind::SOURCE_API_OPERATION_KIND_UNSPECIFIED,
        ErrorStage::SourceApiDescribe,
        format!("source API operation `{operation_name}` has invalid kind"),
        request_id.clone(),
    )?;
    validate_required_source_api_enum(
        value.selector_kind,
        SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_UNSPECIFIED,
        ErrorStage::SourceApiDescribe,
        format!("source API operation `{operation_name}` has invalid selector kind"),
        request_id.clone(),
    )?;
    validate_required_source_api_enum(
        value.pagination_policy,
        SourceApiPaginationPolicy::SOURCE_API_PAGINATION_POLICY_UNSPECIFIED,
        ErrorStage::SourceApiDescribe,
        format!("source API operation `{operation_name}` has invalid pagination policy"),
        request_id.clone(),
    )?;

    require_source_api_operation_message(
        &value.method_policy,
        operation_name,
        "method policy",
        request_id.clone(),
    )?;
    let field_policy = require_source_api_operation_message(
        &value.field_policy,
        operation_name,
        "field policy",
        request_id.clone(),
    )?;
    require_source_api_operation_message(
        &value.header_policy,
        operation_name,
        "header policy",
        request_id.clone(),
    )?;
    validate_source_api_field_policy(field_policy, operation_name, request_id)
}

fn validate_source_api_field_policy(
    value: &SourceApiFieldPolicy,
    operation_name: &str,
    request_id: Option<String>,
) -> Result<(), ApiFailure> {
    for encoding in &value.field_encodings {
        validate_source_api_enum_value(
            *encoding,
            SourceApiFieldEncoding::SOURCE_API_FIELD_ENCODING_UNSPECIFIED,
            ErrorStage::SourceApiDescribe,
            format!(
                "source API operation `{operation_name}` field policy has invalid field encoding"
            ),
            request_id.clone(),
        )?;
    }
    for capability in &value.path_capabilities {
        validate_source_api_enum_value(
            *capability,
            SourceApiPathCapability::SOURCE_API_PATH_CAPABILITY_UNSPECIFIED,
            ErrorStage::SourceApiDescribe,
            format!(
                "source API operation `{operation_name}` field policy has invalid path capability"
            ),
            request_id.clone(),
        )?;
    }
    validate_required_source_api_enum(
        value.input_mode,
        SourceApiInputMode::SOURCE_API_INPUT_MODE_UNSPECIFIED,
        ErrorStage::SourceApiDescribe,
        format!("source API operation `{operation_name}` field policy has invalid input mode"),
        request_id.clone(),
    )?;
    validate_required_source_api_enum(
        value.patch_mode,
        SourceApiPatchMode::SOURCE_API_PATCH_MODE_UNSPECIFIED,
        ErrorStage::SourceApiDescribe,
        format!("source API operation `{operation_name}` field policy has invalid patch mode"),
        request_id,
    )
}

fn validate_source_api_source(
    value: &SourceApiSource,
    stage: ErrorStage,
    request_id: Option<String>,
) -> Result<(), ApiFailure> {
    match value.provider.as_deref() {
        Some(provider) if !provider.trim().is_empty() => Ok(()),
        _ => Err(decode_failure(
            stage,
            "source API source metadata has invalid provider",
            request_id,
        )),
    }
}

fn validate_required_source_api_enum<E>(
    value: Option<EnumValue<E>>,
    unspecified: E,
    stage: ErrorStage,
    message: impl Into<String>,
    request_id: Option<String>,
) -> Result<(), ApiFailure>
where
    E: Enumeration,
{
    let message = message.into();
    let value = value.ok_or_else(|| decode_failure(stage, message.clone(), request_id.clone()))?;
    validate_source_api_enum_value(value, unspecified, stage, message, request_id)
}

fn validate_source_api_enum_value<E>(
    value: EnumValue<E>,
    unspecified: E,
    stage: ErrorStage,
    message: impl Into<String>,
    request_id: Option<String>,
) -> Result<(), ApiFailure>
where
    E: Enumeration,
{
    match value.as_known() {
        Some(value) if value != unspecified => Ok(()),
        Some(_) | None => Err(decode_failure(stage, message, request_id)),
    }
}

fn require_source_api_operation_message<'a, T: Default>(
    value: &'a MessageField<T>,
    operation_name: &str,
    field_name: &str,
    request_id: Option<String>,
) -> Result<&'a T, ApiFailure> {
    value.as_option().ok_or_else(|| {
        decode_failure(
            ErrorStage::SourceApiDescribe,
            format!("source API operation `{operation_name}` missing {field_name}"),
            request_id,
        )
    })
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::super::types;
    use super::*;

    #[test]
    fn validate_source_api_descriptor_requires_operation_policies() {
        let mut operation = valid_source_api_operation();
        operation.method_policy = buffa::MessageField::none();
        let descriptor = source_api_descriptor_with_operation(operation);

        let error =
            validate_source_api_descriptor(&descriptor, Some("req_missing_policy".to_owned()))
                .expect_err("expected missing method policy to fail");

        assert_eq!(
            error,
            ApiFailure::Decode(crate::transport::api_failure::DecodeFailure {
                stage: ErrorStage::SourceApiDescribe,
                message: "source API operation `fetch` missing method policy".to_owned(),
                request_id: Some("req_missing_policy".to_owned()),
            })
        );
    }

    #[test]
    fn validate_source_api_descriptor_rejects_unspecified_operation_enum() {
        let mut descriptor = valid_source_api_descriptor();
        descriptor.operations[0].selector_kind =
            Some(types::SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_UNSPECIFIED.into());

        let error =
            validate_source_api_descriptor(&descriptor, Some("req_invalid_selector".to_owned()))
                .expect_err("expected invalid selector kind to fail");

        assert_eq!(
            error,
            ApiFailure::Decode(crate::transport::api_failure::DecodeFailure {
                stage: ErrorStage::SourceApiDescribe,
                message: "source API operation `fetch` has invalid selector kind".to_owned(),
                request_id: Some("req_invalid_selector".to_owned()),
            })
        );
    }

    #[test]
    fn validate_source_api_descriptor_rejects_unknown_repeated_enum_value() {
        let mut operation = valid_source_api_operation();
        operation.field_policy = buffa::MessageField::some(types::CliSourceApiFieldPolicy {
            field_encodings: vec![99.into()],
            ..valid_source_api_field_policy()
        });
        let descriptor = source_api_descriptor_with_operation(operation);

        let error = validate_source_api_descriptor(
            &descriptor,
            Some("req_unknown_field_encoding".to_owned()),
        )
        .expect_err("expected unknown field encoding to fail");

        assert_eq!(
            error,
            ApiFailure::Decode(crate::transport::api_failure::DecodeFailure {
                stage: ErrorStage::SourceApiDescribe,
                message: "source API operation `fetch` field policy has invalid field encoding"
                    .to_owned(),
                request_id: Some("req_unknown_field_encoding".to_owned()),
            })
        );
    }

    #[test]
    fn required_source_api_preview_rejects_invalid_preview_enum() {
        let preview = buffa::MessageField::some(types::SourceApiPreview {
            body_kind: Some(types::SourceApiBodyKind::SOURCE_API_BODY_KIND_UNSPECIFIED.into()),
            ..valid_source_api_preview()
        });

        let error = required_source_api_preview(
            preview,
            "source API preview response missing preview",
            Some("req_invalid_preview".to_owned()),
            ErrorStage::SourceApiPrepare,
        )
        .expect_err("expected invalid preview body kind to fail");

        assert_eq!(
            error,
            ApiFailure::Decode(crate::transport::api_failure::DecodeFailure {
                stage: ErrorStage::SourceApiPrepare,
                message: "source API preview response has invalid body kind".to_owned(),
                request_id: Some("req_invalid_preview".to_owned()),
            })
        );
    }

    fn valid_source_api_descriptor() -> types::DescribeSourceApiResponse {
        source_api_descriptor_with_operation(valid_source_api_operation())
    }

    fn source_api_descriptor_with_operation(
        operation: types::CliSourceApiOperation,
    ) -> types::DescribeSourceApiResponse {
        types::DescribeSourceApiResponse {
            source: buffa::MessageField::some(valid_source_api_source()),
            descriptor_version: Some("github.v1".to_owned()),
            operations: vec![operation],
            ..Default::default()
        }
    }

    fn valid_source_api_source() -> types::CliSourceApiSource {
        types::CliSourceApiSource {
            source_key: Some("github-prod".to_owned()),
            provider: Some("github".to_owned()),
            ..Default::default()
        }
    }

    fn valid_source_api_operation() -> types::CliSourceApiOperation {
        types::CliSourceApiOperation {
            name: Some("fetch".to_owned()),
            kind: Some(
                types::SourceApiOperationKind::SOURCE_API_OPERATION_KIND_HTTP_REQUEST.into(),
            ),
            summary: Some("Fetch a resource".to_owned()),
            description: Some("Fetches a GitHub resource.".to_owned()),
            selector_kind: Some(types::SourceApiSelectorKind::SOURCE_API_SELECTOR_KIND_PATH.into()),
            selector_label: Some("path".to_owned()),
            method_policy: buffa::MessageField::some(types::CliSourceApiMethodPolicy {
                default_method: Some("GET".to_owned()),
                allowed_methods: vec!["GET".to_owned()],
                ..Default::default()
            }),
            field_policy: buffa::MessageField::some(valid_source_api_field_policy()),
            header_policy: buffa::MessageField::some(types::CliSourceApiHeaderPolicy {
                allowed_request_header_names: vec!["accept".to_owned()],
                ..Default::default()
            }),
            pagination_policy: Some(
                types::SourceApiPaginationPolicy::SOURCE_API_PAGINATION_POLICY_NONE.into(),
            ),
            ..Default::default()
        }
    }

    fn valid_source_api_field_policy() -> types::CliSourceApiFieldPolicy {
        types::CliSourceApiFieldPolicy {
            field_encodings: vec![
                types::SourceApiFieldEncoding::SOURCE_API_FIELD_ENCODING_RAW.into(),
            ],
            path_capabilities: vec![
                types::SourceApiPathCapability::SOURCE_API_PATH_CAPABILITY_NESTED.into(),
            ],
            input_mode: Some(types::SourceApiInputMode::SOURCE_API_INPUT_MODE_NONE.into()),
            patch_mode: Some(types::SourceApiPatchMode::SOURCE_API_PATCH_MODE_NONE.into()),
            ..Default::default()
        }
    }

    fn valid_source_api_preview() -> types::SourceApiPreview {
        types::SourceApiPreview {
            source: buffa::MessageField::some(valid_source_api_source()),
            operation_name: Some("fetch".to_owned()),
            kind: Some(
                types::SourceApiOperationKind::SOURCE_API_OPERATION_KIND_HTTP_REQUEST.into(),
            ),
            method: Some("GET".to_owned()),
            body_kind: Some(types::SourceApiBodyKind::SOURCE_API_BODY_KIND_NONE.into()),
            pagination_policy: Some(
                types::SourceApiPaginationPolicy::SOURCE_API_PAGINATION_POLICY_NONE.into(),
            ),
            ..Default::default()
        }
    }
}
