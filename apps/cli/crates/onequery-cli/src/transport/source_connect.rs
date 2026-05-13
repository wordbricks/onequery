use buffa::EnumValue;
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
use crate::transport::client::AuthenticatedApiClient;
use crate::transport::generated::types;
use crate::transport::source::SourceSummary;
use crate::transport::source::source_summary_from_generated;
use crate::transport::source_api::proto_json_object_from_json;
use crate::transport::source_connect_provider::SourceConnectProvider;

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceConnectGuide {
    pub(crate) title: String,
    pub(crate) description: String,
    pub(crate) format: String,
    pub(crate) content: String,
    pub(crate) command: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceConnectResult {
    pub(crate) source: SourceSummary,
    pub(crate) next_command: String,
}

pub(crate) async fn load_source_connect_guide(
    client: &AuthenticatedApiClient,
    org_slug: &str,
    source: SourceConnectProvider,
) -> Result<ApiSuccess<SourceConnectGuide>, ApiFailure> {
    let org_slug: String =
        crate::transport::api_failure::try_into_value(org_slug, ErrorStage::ResolveSource)?;

    let response = match client
        .source()
        .get_source_connect_guide(types::GetSourceConnectGuideRequest {
            org_slug: Some(org_slug),
            provider: Some(source.to_string()),
            ..Default::default()
        })
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(error, ErrorStage::ResolveSource));
        }
    };

    let request_id = success_response_request_id(&response);
    let payload = response.into_owned();

    Ok(ApiSuccess {
        payload: source_connect_guide_from_generated(payload, request_id.clone())?,
        request_id,
    })
}

pub(crate) async fn connect_source(
    client: &AuthenticatedApiClient,
    org_slug: &str,
    source: &SourceConnectProvider,
    mut input: Map<String, Value>,
) -> Result<ApiSuccess<SourceConnectResult>, ApiFailure> {
    let org_slug: String =
        crate::transport::api_failure::try_into_value(org_slug, ErrorStage::ResolveSource)?;
    let source_key = input
        .remove("sourceKey")
        .and_then(|value| match value {
            Value::String(value) if !value.trim().is_empty() => Some(value),
            _ => None,
        })
        .ok_or_else(|| {
            conversion_failure(
                ErrorStage::ResolveSource,
                "source connect input must include non-empty string field `sourceKey`",
            )
        })?;
    let credentials = input.remove("credentials").ok_or_else(|| {
        conversion_failure(
            ErrorStage::ResolveSource,
            "source connect input must include object field `credentials`",
        )
    })?;
    let credentials = connect_source_credentials_from_json(credentials)?;

    let response = match client
        .source()
        .connect_source(types::ConnectSourceRequest {
            org_slug: Some(org_slug),
            source_key: Some(source_key),
            provider: Some(source.to_string()),
            credentials: MessageField::some(credentials),
            ..Default::default()
        })
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(error, ErrorStage::ResolveSource));
        }
    };

    let request_id = success_response_request_id(&response);
    let payload = response.into_owned();

    Ok(ApiSuccess {
        payload: source_connect_result_from_generated(payload, request_id.clone())?,
        request_id,
    })
}

fn connect_source_credentials_from_json(
    value: Value,
) -> Result<::buffa_types::google::protobuf::Struct, ApiFailure> {
    proto_json_object_from_json(value).map_err(|error| {
        conversion_failure(
            ErrorStage::ResolveSource,
            format!("source connect credentials must be a JSON object: {error}"),
        )
    })
}

fn source_connect_guide_from_generated(
    response: types::GetSourceConnectGuideResponse,
    request_id: Option<String>,
) -> Result<SourceConnectGuide, ApiFailure> {
    Ok(SourceConnectGuide {
        title: response.title.ok_or_else(|| {
            decode_failure(
                ErrorStage::ResolveSource,
                "source connect guide response missing title",
                request_id.clone(),
            )
        })?,
        description: response.description.ok_or_else(|| {
            decode_failure(
                ErrorStage::ResolveSource,
                "source connect guide response missing description",
                request_id.clone(),
            )
        })?,
        format: content_format_from_generated(response.format, request_id.clone())?,
        content: response.content.ok_or_else(|| {
            decode_failure(
                ErrorStage::ResolveSource,
                "source connect guide response missing content",
                request_id.clone(),
            )
        })?,
        command: response.command.ok_or_else(|| {
            decode_failure(
                ErrorStage::ResolveSource,
                "source connect guide response missing command",
                request_id,
            )
        })?,
    })
}

fn content_format_from_generated(
    value: Option<EnumValue<types::ContentFormat>>,
    request_id: Option<String>,
) -> Result<String, ApiFailure> {
    match value {
        Some(value) => match value.as_known() {
            Some(types::ContentFormat::CONTENT_FORMAT_MARKDOWN) => Ok("markdown".to_owned()),
            Some(types::ContentFormat::CONTENT_FORMAT_UNSPECIFIED) | None => Err(decode_failure(
                ErrorStage::ResolveSource,
                "source connect guide response has invalid format",
                request_id,
            )),
        },
        None => Err(decode_failure(
            ErrorStage::ResolveSource,
            "source connect guide response missing format",
            request_id,
        )),
    }
}

fn source_connect_result_from_generated(
    response: types::ConnectSourceResponse,
    request_id: Option<String>,
) -> Result<SourceConnectResult, ApiFailure> {
    let source = response.source.into_option().ok_or_else(|| {
        decode_failure(
            ErrorStage::ResolveSource,
            "source connect response missing source",
            request_id.clone(),
        )
    })?;

    Ok(SourceConnectResult {
        source: source_summary_from_generated(
            source,
            ErrorStage::ResolveSource,
            request_id.clone(),
        )?,
        next_command: response.next_command.ok_or_else(|| {
            decode_failure(
                ErrorStage::ResolveSource,
                "source connect response missing nextCommand",
                request_id,
            )
        })?,
    })
}

#[cfg(test)]
mod tests {
    use onequery_core::error::ErrorStage;
    use pretty_assertions::assert_eq;
    use serde_json::json;

    use super::SourceConnectGuide;
    use super::SourceConnectResult;
    use super::connect_source_credentials_from_json;
    use super::source_connect_guide_from_generated;
    use super::types;
    use crate::transport::api_failure::ApiFailure;
    use crate::transport::source::SourceSummary;

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
                title: Some("Guide".to_owned()),
                description: Some("Create one source connection.".to_owned()),
                format: Some(types::ContentFormat::CONTENT_FORMAT_UNSPECIFIED.into()),
                content: Some("Run the command.".to_owned()),
                command: Some("onequery source connect --source postgres".to_owned()),
                ..Default::default()
            },
            Some("req_source_connect_format".to_owned()),
        )
        .expect_err("expected invalid format to fail");

        assert_eq!(
            error,
            ApiFailure::Decode(crate::transport::api_failure::DecodeFailure {
                stage: ErrorStage::ResolveSource,
                message: "source connect guide response has invalid format".to_owned(),
                request_id: Some("req_source_connect_format".to_owned()),
            })
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
                source: SourceSummary {
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
        let error = connect_source_credentials_from_json(
            json!("not an object"),
        )
        .expect_err("non-object credentials should be rejected");

        let ApiFailure::Problem(problem) = error else {
            panic!("expected problem failure");
        };
        let detail = problem.server_message;

        assert!(detail.contains("source connect credentials must be a JSON object"));
    }

    #[test]
    fn source_connect_credentials_preserve_json_object_shape() {
        let credentials = connect_source_credentials_from_json(
            json!({
                "host": "db.example.com",
                "database": "app",
                "username": "onequery",
                "password": "secret",
                "nested": {
                    "enabled": true
                },
            }),
        )
        .expect("object credentials should parse");

        assert_eq!(
            serde_json::to_value(credentials).expect("struct should serialize"),
            json!({
                "host": "db.example.com",
                "database": "app",
                "username": "onequery",
                "password": "secret",
                "nested": {
                    "enabled": true
                }
            })
        );
    }
}
