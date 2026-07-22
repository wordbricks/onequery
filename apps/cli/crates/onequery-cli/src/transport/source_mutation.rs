use buffa::MessageField;
use onequery_core::error::ErrorStage;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Map;
use serde_json::Value;

use crate::transport::api_failure::ApiFailure;
use crate::transport::api_failure::ApiSuccess;
use crate::transport::api_failure::conversion_failure;
use crate::transport::api_failure::decode_failure;
use crate::transport::api_failure::failure_from_connect;
use crate::transport::api_failure::success_response_request_id;
use crate::transport::api_failure::try_into_value;
use crate::transport::client::AuthenticatedApiClient;
use crate::transport::generated::types;
use crate::transport::response_decode::require_non_empty_text;
use crate::transport::source::SourceSummary;
use crate::transport::source::SourceTestOutcome;
use crate::transport::source::SourceTestSupportedResult;
use crate::transport::source::decode_required_source_summary;
use crate::transport::source::source_selector_from_reference;
use crate::transport::well_known::required_duration_ms;

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SourceUpdatePayload {
    pub(crate) source: SourceSummary,
    pub(crate) outcome: SourceTestOutcome,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SourceDeletePayload {
    pub(crate) source: SourceSummary,
    pub(crate) deleted: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct SourceUpdateRequestPayload {
    pub(crate) credentials: Map<String, Value>,
}

pub(crate) async fn update_source(
    client: &AuthenticatedApiClient,
    org: &str,
    source: &str,
    request: &SourceUpdateRequestPayload,
) -> Result<ApiSuccess<SourceUpdatePayload>, ApiFailure> {
    let stage = ErrorStage::ResolveSource;
    let credentials = serde_json::from_value::<buffa_types::google::protobuf::Struct>(
        Value::Object(request.credentials.clone()),
    )
    .map_err(|error| conversion_failure(stage, error.to_string()))?;
    let response = client
        .source()
        .update_source(types::UpdateSourceRequest {
            org_slug: Some(try_into_value(org, stage)?),
            source: MessageField::some(source_selector_from_reference(source, stage)?),
            credentials: MessageField::some(credentials),
            ..Default::default()
        })
        .await
        .map_err(|error| failure_from_connect(error, stage))?;
    let request_id = success_response_request_id(&response);
    let payload = response.into_owned();
    let outcome = payload.outcome.ok_or_else(|| {
        decode_failure(
            stage,
            "source update response missing test outcome",
            request_id.clone(),
        )
    })?;
    let outcome = match outcome {
        types::update_source_response::Outcome::Supported(supported) => {
            decode_supported_test_outcome(*supported, request_id.clone())?
        }
        types::update_source_response::Outcome::Unsupported(unsupported) => {
            decode_unsupported_test_outcome(*unsupported, request_id.clone())?
        }
    };

    Ok(ApiSuccess {
        payload: SourceUpdatePayload {
            source: decode_required_source_summary(
                payload.source.into_option(),
                stage,
                "source update response missing source",
                request_id.clone(),
            )?,
            outcome,
        },
        request_id,
    })
}

pub(crate) async fn delete_source(
    client: &AuthenticatedApiClient,
    org: &str,
    source: &str,
) -> Result<ApiSuccess<SourceDeletePayload>, ApiFailure> {
    let stage = ErrorStage::ResolveSource;
    let response = client
        .source()
        .delete_source(types::DeleteSourceRequest {
            org_slug: Some(try_into_value(org, stage)?),
            source: MessageField::some(source_selector_from_reference(source, stage)?),
            ..Default::default()
        })
        .await
        .map_err(|error| failure_from_connect(error, stage))?;
    let request_id = success_response_request_id(&response);
    let payload = response.into_owned();
    if payload.deleted != Some(true) {
        return Err(decode_failure(
            stage,
            "source delete response did not confirm deletion",
            request_id,
        ));
    }

    Ok(ApiSuccess {
        payload: SourceDeletePayload {
            source: decode_required_source_summary(
                payload.source.into_option(),
                stage,
                "source delete response missing source",
                request_id.clone(),
            )?,
            deleted: true,
        },
        request_id,
    })
}

fn decode_supported_test_outcome(
    supported: types::TestSourceSupportedOutcome,
    request_id: Option<String>,
) -> Result<SourceTestOutcome, ApiFailure> {
    let latency_ms = required_duration_ms(
        supported.latency,
        ErrorStage::ResolveSource,
        "source update test response missing latency",
        request_id.clone(),
    )?;
    let result = supported.result.ok_or_else(|| {
        decode_failure(
            ErrorStage::ResolveSource,
            "source update test response missing result",
            request_id.clone(),
        )
    })?;
    let result = match result {
        types::test_source_supported_outcome::Result::Passed(passed) => {
            SourceTestSupportedResult::Passed {
                message: require_non_empty_text(
                    passed.message,
                    ErrorStage::ResolveSource,
                    "source update test response missing message",
                    request_id,
                )?,
            }
        }
        types::test_source_supported_outcome::Result::Failed(failed) => {
            SourceTestSupportedResult::Failed {
                message: require_non_empty_text(
                    failed.message,
                    ErrorStage::ResolveSource,
                    "source update test response missing message",
                    request_id.clone(),
                )?,
                error: require_non_empty_text(
                    failed.error,
                    ErrorStage::ResolveSource,
                    "source update test response missing error",
                    request_id,
                )?,
            }
        }
    };
    Ok(SourceTestOutcome::Supported {
        result,
        latency_ms: Some(latency_ms),
    })
}

fn decode_unsupported_test_outcome(
    unsupported: types::TestSourceUnsupportedOutcome,
    request_id: Option<String>,
) -> Result<SourceTestOutcome, ApiFailure> {
    let reason = match unsupported.reason.and_then(|value| value.as_known()) {
        Some(types::SourceTestUnsupportedReason::SOURCE_TEST_UNSUPPORTED_REASON_OAUTH) => "oauth",
        Some(
            types::SourceTestUnsupportedReason::SOURCE_TEST_UNSUPPORTED_REASON_NOT_IMPLEMENTED,
        ) => "not_implemented",
        Some(types::SourceTestUnsupportedReason::SOURCE_TEST_UNSUPPORTED_REASON_UNSPECIFIED)
        | None => {
            return Err(decode_failure(
                ErrorStage::ResolveSource,
                "source update test response has invalid unsupported reason",
                request_id,
            ));
        }
    };
    Ok(SourceTestOutcome::Unsupported {
        message: require_non_empty_text(
            unsupported.message,
            ErrorStage::ResolveSource,
            "source update test response missing message",
            request_id,
        )?,
        reason: reason.to_owned(),
    })
}
