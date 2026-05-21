use buffa::EnumValue;
use buffa::MessageField;
use serde_json::Map;
use serde_json::Value;
use thiserror::Error;

use crate::SourceConnectGuide;
use crate::SourceConnectProvider;
use crate::SourceConnectResult;
use crate::SourceConnectSourceSummary;

pub use onequery_proto_cli::onequery::cli::v1 as types;

#[derive(Debug, Clone, Eq, PartialEq, Error)]
pub enum SourceConnectProtoError {
    #[error("{0}")]
    Conversion(String),
    #[error("{message}")]
    Decode {
        message: String,
        request_id: Option<String>,
    },
}

impl SourceConnectProtoError {
    pub fn decode(message: impl Into<String>, request_id: Option<String>) -> Self {
        Self::Decode {
            message: message.into(),
            request_id,
        }
    }
}

pub fn get_source_connect_guide_request(
    org_slug: &str,
    source: &SourceConnectProvider,
) -> types::GetSourceConnectGuideRequest {
    types::GetSourceConnectGuideRequest {
        org_slug: Some(org_slug.to_owned()),
        provider: Some(source.to_string()),
        ..Default::default()
    }
}

pub fn connect_source_request_from_input(
    org_slug: &str,
    source: &SourceConnectProvider,
    mut input: Map<String, Value>,
) -> Result<types::ConnectSourceRequest, SourceConnectProtoError> {
    let source_key = input
        .remove("sourceKey")
        .and_then(|value| match value {
            Value::String(value) if !value.trim().is_empty() => Some(value),
            Value::Null
            | Value::Bool(_)
            | Value::Number(_)
            | Value::String(_)
            | Value::Array(_)
            | Value::Object(_) => None,
        })
        .ok_or_else(|| {
            SourceConnectProtoError::Conversion(
                "source connect input must include non-empty string field `sourceKey`".to_owned(),
            )
        })?;
    let credentials = input.remove("credentials").ok_or_else(|| {
        SourceConnectProtoError::Conversion(
            "source connect input must include object field `credentials`".to_owned(),
        )
    })?;
    let credentials = connect_source_credentials_from_json(credentials)?;

    Ok(types::ConnectSourceRequest {
        org_slug: Some(org_slug.to_owned()),
        source_key: Some(source_key),
        provider: Some(source.to_string()),
        credentials: MessageField::some(credentials),
        ..Default::default()
    })
}

fn connect_source_credentials_from_json(
    value: Value,
) -> Result<::buffa_types::google::protobuf::Struct, SourceConnectProtoError> {
    serde_json::from_value::<::buffa_types::google::protobuf::Struct>(value).map_err(|error| {
        SourceConnectProtoError::Conversion(format!(
            "source connect credentials must be a JSON object: {error}"
        ))
    })
}

pub fn source_connect_guide_from_generated(
    response: types::GetSourceConnectGuideResponse,
    request_id: Option<String>,
) -> Result<SourceConnectGuide, SourceConnectProtoError> {
    Ok(SourceConnectGuide {
        title: response.title.ok_or_else(|| {
            SourceConnectProtoError::decode(
                "source connect guide response missing title",
                request_id.clone(),
            )
        })?,
        description: response.description.ok_or_else(|| {
            SourceConnectProtoError::decode(
                "source connect guide response missing description",
                request_id.clone(),
            )
        })?,
        format: content_format_from_generated(response.format, request_id.clone())?,
        content: response.content.ok_or_else(|| {
            SourceConnectProtoError::decode(
                "source connect guide response missing content",
                request_id.clone(),
            )
        })?,
        command: response.command.ok_or_else(|| {
            SourceConnectProtoError::decode(
                "source connect guide response missing command",
                request_id,
            )
        })?,
    })
}

fn content_format_from_generated(
    value: Option<EnumValue<types::ContentFormat>>,
    request_id: Option<String>,
) -> Result<String, SourceConnectProtoError> {
    match value {
        Some(value) => match value.as_known() {
            Some(types::ContentFormat::CONTENT_FORMAT_MARKDOWN) => Ok("markdown".to_owned()),
            Some(types::ContentFormat::CONTENT_FORMAT_UNSPECIFIED) | None => {
                Err(SourceConnectProtoError::decode(
                    "source connect guide response has invalid format",
                    request_id,
                ))
            }
        },
        None => Err(SourceConnectProtoError::decode(
            "source connect guide response missing format",
            request_id,
        )),
    }
}

pub fn source_connect_result_from_generated(
    response: types::ConnectSourceResponse,
    request_id: Option<String>,
) -> Result<SourceConnectResult, SourceConnectProtoError> {
    let source = response.source.into_option().ok_or_else(|| {
        SourceConnectProtoError::decode(
            "source connect response missing source",
            request_id.clone(),
        )
    })?;

    Ok(SourceConnectResult {
        source: source_connect_source_summary_from_generated(source, request_id.clone())?,
        next_command: response.next_command.ok_or_else(|| {
            SourceConnectProtoError::decode(
                "source connect response missing nextCommand",
                request_id,
            )
        })?,
    })
}

fn source_connect_source_summary_from_generated(
    source: types::CliSource,
    request_id: Option<String>,
) -> Result<SourceConnectSourceSummary, SourceConnectProtoError> {
    Ok(SourceConnectSourceSummary {
        source_key: require_non_empty_string(
            source.source_key,
            "source connect response source missing sourceKey",
            request_id.clone(),
        )?,
        display_name: source.display_name.filter(|value| !value.is_empty()),
        provider: require_non_empty_string(
            source.provider,
            "source connect response source missing provider",
            request_id.clone(),
        )?,
        status: source_status_from_generated(source.status, request_id)?,
        interfaces: source_interfaces_from_generated(source.interfaces),
    })
}

fn require_non_empty_string(
    value: Option<String>,
    message: &'static str,
    request_id: Option<String>,
) -> Result<String, SourceConnectProtoError> {
    match value {
        Some(value) if !value.is_empty() => Ok(value),
        Some(_) | None => Err(SourceConnectProtoError::decode(message, request_id)),
    }
}

fn source_status_from_generated(
    value: Option<EnumValue<types::SourceStatus>>,
    request_id: Option<String>,
) -> Result<String, SourceConnectProtoError> {
    match value.and_then(|value| value.as_known()) {
        Some(types::SourceStatus::SOURCE_STATUS_ACTIVE) => Ok("active".to_owned()),
        Some(types::SourceStatus::SOURCE_STATUS_ERROR) => Ok("error".to_owned()),
        Some(types::SourceStatus::SOURCE_STATUS_DISCONNECTED) => Ok("disconnected".to_owned()),
        Some(types::SourceStatus::SOURCE_STATUS_UNSPECIFIED) | None => {
            Err(SourceConnectProtoError::decode(
                "source connect response source has invalid status",
                request_id,
            ))
        }
    }
}

fn source_interfaces_from_generated(values: Vec<EnumValue<types::SourceInterface>>) -> Vec<String> {
    values
        .into_iter()
        .filter_map(|value| match value.as_known() {
            Some(types::SourceInterface::SOURCE_INTERFACE_QUERY) => Some("query".to_owned()),
            Some(types::SourceInterface::SOURCE_INTERFACE_API) => Some("api".to_owned()),
            Some(types::SourceInterface::SOURCE_INTERFACE_UNSPECIFIED) | None => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use serde_json::json;

    use super::SourceConnectProtoError;
    use super::connect_source_credentials_from_json;
    use super::source_connect_guide_from_generated;
    use super::source_connect_result_from_generated;
    use super::types;
    use crate::SourceConnectGuide;
    use crate::SourceConnectResult;
    use crate::SourceConnectSourceSummary;

    #[test]
    fn source_connect_guide_deserializes_canonical_shape() {
        let payload = json!({
            "title": "OneQuery Source Connect Guide",
            "description": "Create one source connection.",
            "format": "markdown",
            "content": "1. Gather credentials.\n2. Run the command.",
            "command": "onequery source connect --source postgres --input '<json>'"
        });

        let parsed = serde_json::from_value::<SourceConnectGuide>(payload)
            .expect("canonical source connect guide should deserialize");
        assert_eq!(
            parsed,
            SourceConnectGuide {
                title: "OneQuery Source Connect Guide".to_owned(),
                description: "Create one source connection.".to_owned(),
                format: "markdown".to_owned(),
                content: "1. Gather credentials.\n2. Run the command.".to_owned(),
                command: "onequery source connect --source postgres --input '<json>'".to_owned(),
            }
        );
    }

    #[test]
    fn source_connect_guide_from_generated_rejects_invalid_format() {
        let error = source_connect_guide_from_generated(
            types::GetSourceConnectGuideResponse {
                title: Some("OneQuery Source Connect Guide".to_owned()),
                description: Some("Create one source connection.".to_owned()),
                format: Some(types::ContentFormat::CONTENT_FORMAT_UNSPECIFIED.into()),
                content: Some("content".to_owned()),
                command: Some("onequery source connect --source postgres".to_owned()),
                ..Default::default()
            },
            Some("req-1".to_owned()),
        )
        .expect_err("invalid format should fail");

        assert_eq!(
            error,
            SourceConnectProtoError::Decode {
                message: "source connect guide response has invalid format".to_owned(),
                request_id: Some("req-1".to_owned()),
            }
        );
    }

    #[test]
    fn source_connect_result_deserializes_canonical_shape() {
        let payload = json!({
            "source": {
                "sourceKey": "warehouse",
                "provider": "postgres",
                "status": "active",
                "interfaces": ["query"]
            },
            "nextCommand": "onequery source show warehouse"
        });

        let parsed = serde_json::from_value::<SourceConnectResult>(payload)
            .expect("canonical source connect result should deserialize");
        assert_eq!(
            parsed,
            SourceConnectResult {
                source: SourceConnectSourceSummary {
                    source_key: "warehouse".to_owned(),
                    display_name: None,
                    provider: "postgres".to_owned(),
                    status: "active".to_owned(),
                    interfaces: vec!["query".to_owned()],
                },
                next_command: "onequery source show warehouse".to_owned(),
            }
        );
    }

    #[test]
    fn source_connect_credentials_reject_non_object_json() {
        let error = connect_source_credentials_from_json(json!("not an object"))
            .expect_err("non-object credentials should be rejected");

        assert!(error.to_string().contains("must be a JSON object"));
    }

    #[test]
    fn source_connect_result_from_generated_decodes_source_summary() {
        let result = source_connect_result_from_generated(
            types::ConnectSourceResponse {
                source: buffa::MessageField::some(types::CliSource {
                    source_key: Some("warehouse".to_owned()),
                    provider: Some("postgres".to_owned()),
                    status: Some(types::SourceStatus::SOURCE_STATUS_ACTIVE.into()),
                    interfaces: vec![types::SourceInterface::SOURCE_INTERFACE_QUERY.into()],
                    ..Default::default()
                }),
                next_command: Some("onequery source show warehouse".to_owned()),
                ..Default::default()
            },
            None,
        )
        .expect("expected result to decode");

        assert_eq!(
            result,
            SourceConnectResult {
                source: SourceConnectSourceSummary {
                    source_key: "warehouse".to_owned(),
                    display_name: None,
                    provider: "postgres".to_owned(),
                    status: "active".to_owned(),
                    interfaces: vec!["query".to_owned()],
                },
                next_command: "onequery source show warehouse".to_owned(),
            }
        );
    }
}
