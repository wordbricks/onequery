use onequery_cli_core::error::ErrorStage;

use crate::transport::api_failure::ApiFailure;
use crate::transport::api_failure::decode_failure;

pub(crate) fn decode_required_bool(
    value: Option<bool>,
    stage: ErrorStage,
    message: &str,
    request_id: Option<String>,
) -> Result<bool, ApiFailure> {
    value.ok_or_else(|| decode_failure(stage, message, request_id))
}

pub(crate) fn decode_required_u32_as_usize(
    value: Option<u32>,
    stage: ErrorStage,
    message: &str,
    request_id: Option<String>,
) -> Result<usize, ApiFailure> {
    let value = value.ok_or_else(|| decode_failure(stage, message, request_id.clone()))?;
    usize::try_from(value).map_err(|error| decode_failure(stage, error.to_string(), request_id))
}

pub(crate) fn require_non_empty_text(
    value: Option<String>,
    stage: ErrorStage,
    message: &str,
    request_id: Option<String>,
) -> Result<String, ApiFailure> {
    value
        .filter(|value| !value.is_empty())
        .ok_or_else(|| decode_failure(stage, message, request_id))
}
