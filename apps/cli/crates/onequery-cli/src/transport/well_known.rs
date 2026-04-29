use buffa::MessageField;
use buffa_types::google::protobuf::Duration;
use buffa_types::google::protobuf::Timestamp;
use onequery_core::error::ErrorStage;

use crate::transport::api_failure::ApiFailure;
use crate::transport::api_failure::conversion_failure;
use crate::transport::api_failure::decode_failure;

pub(crate) fn duration_from_ms(
    value: u64,
    stage: ErrorStage,
) -> Result<MessageField<Duration>, ApiFailure> {
    let seconds = i64::try_from(value / 1_000)
        .map_err(|error| conversion_failure(stage, error.to_string()))?;
    let nanos = i32::try_from((value % 1_000) * 1_000_000)
        .map_err(|error| conversion_failure(stage, error.to_string()))?;

    Ok(MessageField::some(Duration {
        seconds,
        nanos,
        ..Default::default()
    }))
}

pub(crate) fn optional_duration_from_ms(
    value: Option<u64>,
    stage: ErrorStage,
) -> Result<MessageField<Duration>, ApiFailure> {
    value
        .map(|value| duration_from_ms(value, stage))
        .transpose()
        .map(|value| value.unwrap_or_else(MessageField::none))
}

pub(crate) fn required_duration_ms(
    value: MessageField<Duration>,
    stage: ErrorStage,
    missing_message: &str,
    request_id: Option<String>,
) -> Result<u64, ApiFailure> {
    let duration = value
        .into_option()
        .ok_or_else(|| decode_failure(stage, missing_message, request_id.clone()))?;

    duration_ms(duration, stage, missing_message, request_id)
}

pub(crate) fn duration_ms(
    duration: Duration,
    stage: ErrorStage,
    message: &str,
    request_id: Option<String>,
) -> Result<u64, ApiFailure> {
    if duration.seconds < 0 || duration.nanos < 0 || duration.nanos > 999_999_999 {
        return Err(decode_failure(
            stage,
            format!("{message} with an invalid duration"),
            request_id,
        ));
    }

    let millis =
        i128::from(duration.seconds) * 1_000 + (i128::from(duration.nanos) + 500_000) / 1_000_000;

    u64::try_from(millis).map_err(|error| decode_failure(stage, error.to_string(), request_id))
}

pub(crate) fn timestamp_from_epoch_ms(
    value: u64,
    stage: ErrorStage,
) -> Result<MessageField<Timestamp>, ApiFailure> {
    let seconds = i64::try_from(value / 1_000)
        .map_err(|error| conversion_failure(stage, error.to_string()))?;
    let nanos = i32::try_from((value % 1_000) * 1_000_000)
        .map_err(|error| conversion_failure(stage, error.to_string()))?;

    Ok(MessageField::some(Timestamp {
        seconds,
        nanos,
        ..Default::default()
    }))
}

pub(crate) fn timestamp_from_rfc3339(
    value: &str,
    stage: ErrorStage,
    field: &str,
) -> Result<MessageField<Timestamp>, ApiFailure> {
    let parsed = chrono::DateTime::parse_from_rfc3339(value).map_err(|error| {
        conversion_failure(
            stage,
            format!("{field} must be an RFC3339 timestamp: {error}"),
        )
    })?;
    let utc = parsed.with_timezone(&chrono::Utc);

    Ok(MessageField::some(Timestamp {
        seconds: utc.timestamp(),
        nanos: i32::try_from(utc.timestamp_subsec_nanos())
            .map_err(|error| conversion_failure(stage, error.to_string()))?,
        ..Default::default()
    }))
}
