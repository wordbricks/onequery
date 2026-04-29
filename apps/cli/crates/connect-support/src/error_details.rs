use base64::Engine;
use buffa::Message;
use connectrpc::ConnectError;
use connectrpc::error::ErrorDetail;

pub const ERROR_INFO_DETAIL_TYPE: &str = "google.rpc.ErrorInfo";
pub const BAD_REQUEST_DETAIL_TYPE: &str = "google.rpc.BadRequest";
pub const RETRY_INFO_DETAIL_TYPE: &str = "google.rpc.RetryInfo";
pub const RESOURCE_INFO_DETAIL_TYPE: &str = "google.rpc.ResourceInfo";
pub const PRECONDITION_FAILURE_DETAIL_TYPE: &str = "google.rpc.PreconditionFailure";

#[must_use]
pub fn metadata_value<'a>(
    metadata: &'a std::collections::HashMap<String, String>,
    key: &str,
) -> Option<&'a str> {
    metadata
        .get(key)
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

pub fn domain_error_info<ErrorInfo, Domain>(
    error: &ConnectError,
    domain: &str,
    detail_domain: Domain,
) -> Result<Option<ErrorInfo>, DetailDecodeError>
where
    ErrorInfo: Message,
    Domain: Fn(&ErrorInfo) -> &str,
{
    let mut matching_error_info = None;

    for detail in &error.details {
        if detail.type_url.as_str() != ERROR_INFO_DETAIL_TYPE {
            continue;
        }

        let error_info = decode_connect_detail::<ErrorInfo>(detail)?;
        if detail_domain(&error_info) != domain {
            continue;
        }

        if matching_error_info.replace(error_info).is_some() {
            return Err(DetailDecodeError::Duplicate {
                type_url: ERROR_INFO_DETAIL_TYPE,
            });
        }
    }

    Ok(matching_error_info)
}

/// Return the first decodable `google.rpc.ErrorInfo` for `domain`.
///
/// This is intentionally lenient for user-facing recovery paths: malformed
/// details from an intermediary or older peer do not hide a later valid detail.
/// Use [`domain_error_info`] when malformed or duplicate details must remain
/// visible to diagnostics.
pub fn first_decodable_domain_error_info<ErrorInfo, Domain>(
    error: &ConnectError,
    domain: &str,
    detail_domain: Domain,
) -> Option<ErrorInfo>
where
    ErrorInfo: Message,
    Domain: Fn(&ErrorInfo) -> &str,
{
    error.details.iter().find_map(|detail| {
        if detail.type_url.as_str() != ERROR_INFO_DETAIL_TYPE {
            return None;
        }

        let error_info = decode_connect_detail::<ErrorInfo>(detail).ok()?;
        if detail_domain(&error_info) == domain {
            Some(error_info)
        } else {
            None
        }
    })
}

pub fn decode_connect_detail<MessageType>(
    detail: &ErrorDetail,
) -> Result<MessageType, DetailDecodeError>
where
    MessageType: Message,
{
    let value = detail
        .value
        .as_deref()
        .ok_or(DetailDecodeError::MissingValue {
            type_url: detail.type_url.clone(),
        })?;
    let bytes = base64::engine::general_purpose::STANDARD_NO_PAD
        .decode(value)
        .or_else(|_| base64::engine::general_purpose::STANDARD.decode(value))
        .map_err(|source| DetailDecodeError::InvalidBase64 {
            type_url: detail.type_url.clone(),
            source,
        })?;

    MessageType::decode_from_slice(bytes.as_slice()).map_err(|source| {
        DetailDecodeError::InvalidMessage {
            type_url: detail.type_url.clone(),
            source,
        }
    })
}

#[derive(Debug)]
pub enum DetailDecodeError {
    MissingValue {
        type_url: String,
    },
    InvalidBase64 {
        type_url: String,
        source: base64::DecodeError,
    },
    InvalidMessage {
        type_url: String,
        source: buffa::DecodeError,
    },
    Duplicate {
        type_url: &'static str,
    },
}

impl std::fmt::Display for DetailDecodeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingValue { type_url } => {
                write!(formatter, "server returned {type_url} detail without value")
            }
            Self::InvalidBase64 { type_url, .. } | Self::InvalidMessage { type_url, .. } => {
                write!(formatter, "failed to decode {type_url} detail")
            }
            Self::Duplicate { type_url } => {
                write!(formatter, "server returned duplicate {type_url} entries")
            }
        }
    }
}

impl std::error::Error for DetailDecodeError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::MissingValue { .. } | Self::Duplicate { .. } => None,
            Self::InvalidBase64 { source, .. } => Some(source),
            Self::InvalidMessage { source, .. } => Some(source),
        }
    }
}

#[must_use]
pub fn protobuf_duration_to_ms(duration: buffa_types::google::protobuf::Duration) -> Option<u64> {
    if duration.seconds < 0 || !(0..1_000_000_000).contains(&duration.nanos) {
        return None;
    }

    let seconds = u64::try_from(duration.seconds).ok()?;
    let nanos = u64::try_from(duration.nanos).ok()?;
    let millis_from_seconds = seconds.checked_mul(1000)?;
    let millis_from_nanos = nanos / 1_000_000;
    millis_from_seconds.checked_add(millis_from_nanos)
}

#[must_use]
pub fn reason_to_code(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    Some(trimmed.replace('-', "_").to_ascii_lowercase())
}

#[must_use]
pub fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|candidate| !candidate.trim().is_empty())
}

#[must_use]
pub fn non_empty_string(value: String) -> Option<String> {
    non_empty(Some(value))
}

#[cfg(test)]
mod tests {
    use base64::Engine;
    use connectrpc::ConnectError;
    use connectrpc::ErrorCode;
    use connectrpc::error::ErrorDetail;

    use super::ERROR_INFO_DETAIL_TYPE;
    use super::domain_error_info;
    use super::first_decodable_domain_error_info;
    use super::protobuf_duration_to_ms;

    #[test]
    fn strict_domain_error_info_returns_malformed_detail_errors() {
        let mut error = ConnectError::new(ErrorCode::Unavailable, "unavailable");
        error.details.push(ErrorDetail {
            type_url: ERROR_INFO_DETAIL_TYPE.to_owned(),
            value: Some("not-base64".to_owned()),
            debug: None,
        });
        error.details.push(duration_detail(1));

        let decoded = domain_error_info(
            &error,
            "matching",
            |duration: &buffa_types::google::protobuf::Duration| {
                if duration.seconds == 1 {
                    "matching"
                } else {
                    "other"
                }
            },
        );

        assert!(decoded.is_err());
    }

    #[test]
    fn first_decodable_domain_error_info_skips_malformed_details() {
        let mut error = ConnectError::new(ErrorCode::Unavailable, "unavailable");
        error.details.push(ErrorDetail {
            type_url: ERROR_INFO_DETAIL_TYPE.to_owned(),
            value: Some("not-base64".to_owned()),
            debug: None,
        });
        error.details.push(duration_detail(1));

        let decoded = first_decodable_domain_error_info(
            &error,
            "matching",
            |duration: &buffa_types::google::protobuf::Duration| {
                if duration.seconds == 1 {
                    "matching"
                } else {
                    "other"
                }
            },
        );

        assert_eq!(decoded.map(|duration| duration.seconds), Some(1));
    }

    #[test]
    fn protobuf_duration_to_ms_rejects_invalid_duration_shapes() {
        assert_eq!(
            protobuf_duration_to_ms(buffa_types::google::protobuf::Duration {
                seconds: -1,
                nanos: 0,
                ..Default::default()
            }),
            None
        );
        assert_eq!(
            protobuf_duration_to_ms(buffa_types::google::protobuf::Duration {
                seconds: 0,
                nanos: -1,
                ..Default::default()
            }),
            None
        );
        assert_eq!(
            protobuf_duration_to_ms(buffa_types::google::protobuf::Duration {
                seconds: 0,
                nanos: 1_000_000_000,
                ..Default::default()
            }),
            None
        );
    }

    #[test]
    fn protobuf_duration_to_ms_accepts_valid_duration_shapes() {
        assert_eq!(
            protobuf_duration_to_ms(buffa_types::google::protobuf::Duration {
                seconds: 2,
                nanos: 123_456_789,
                ..Default::default()
            }),
            Some(2123)
        );
    }

    fn duration_detail(seconds: i64) -> ErrorDetail {
        let duration = buffa_types::google::protobuf::Duration {
            seconds,
            ..Default::default()
        };

        ErrorDetail {
            type_url: ERROR_INFO_DETAIL_TYPE.to_owned(),
            value: Some(
                base64::engine::general_purpose::STANDARD_NO_PAD
                    .encode(buffa::Message::encode_to_vec(&duration)),
            ),
            debug: None,
        }
    }
}
