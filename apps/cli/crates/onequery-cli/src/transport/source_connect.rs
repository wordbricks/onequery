use onequery_cli_core::error::ErrorStage;
use reqwest::StatusCode;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Map;
use serde_json::Value;

use crate::transport::client::AuthenticatedApiClient;
use crate::transport::http::ApiFailure;
use crate::transport::http::ApiSuccess;
use crate::transport::http::TransportFailure;
use crate::transport::http::TransportFailureKind;
use crate::transport::http::decode_failure;
use crate::transport::http::parse_problem_response;
use crate::transport::http::response_request_id;
use crate::transport::source::SourceSummary;

const SOURCE_CONNECT_PATH_PREFIX: &str = "/api/cli/organizations";

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceConnectSchemaField {
    #[serde(rename = "type")]
    pub(crate) field_type: String,
    pub(crate) description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) pattern: Option<String>,
    #[serde(rename = "enum")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) enum_values: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceConnectInputSchema {
    #[serde(rename = "type")]
    pub(crate) field_type: String,
    pub(crate) required: Vec<String>,
    pub(crate) properties: SourceConnectInputSchemaProperties,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
pub(crate) struct SourceConnectInputSchemaProperties {
    pub(crate) name: SourceConnectSchemaField,
    pub(crate) credentials: SourceConnectSchemaField,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceConnectProviderGuide {
    pub(crate) provider: String,
    pub(crate) summary: String,
    pub(crate) required_credential_fields: Vec<String>,
    pub(crate) optional_credential_fields: Vec<String>,
    pub(crate) steps: Vec<String>,
    pub(crate) credential_template: Value,
    pub(crate) example_input: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceConnectGuide {
    pub(crate) title: String,
    pub(crate) description: String,
    pub(crate) format: String,
    pub(crate) content: String,
    pub(crate) command: String,
    pub(crate) input_schema: SourceConnectInputSchema,
    pub(crate) providers: Vec<SourceConnectProviderGuide>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceConnectResult {
    pub(crate) source: SourceSummary,
    pub(crate) next_command: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SourceConnectEnvelope<T> {
    data: T,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    request_id: Option<String>,
}

pub(crate) async fn load_source_connect_guide(
    client: &AuthenticatedApiClient,
    org_slug: &str,
    source: &str,
) -> Result<ApiSuccess<SourceConnectGuide>, ApiFailure> {
    let url =
        client.app_url(format!("{SOURCE_CONNECT_PATH_PREFIX}/{org_slug}/sources:connect").as_str());
    let response = client
        .http()
        .get(url)
        .query(&[("source", source)])
        .send()
        .await
        .map_err(|error| {
            ApiFailure::Transport(TransportFailure {
                kind: TransportFailureKind::SendRequest,
                stage: ErrorStage::ResolveSource,
                message: error.to_string(),
                retryable: error.is_connect() || error.is_timeout(),
            })
        })?;

    read_source_connect_response(response, ErrorStage::ResolveSource).await
}

pub(crate) async fn connect_source(
    client: &AuthenticatedApiClient,
    org_slug: &str,
    source: &str,
    input: Map<String, Value>,
) -> Result<ApiSuccess<SourceConnectResult>, ApiFailure> {
    let url =
        client.app_url(format!("{SOURCE_CONNECT_PATH_PREFIX}/{org_slug}/sources:connect").as_str());
    let response = client
        .http()
        .post(url)
        .query(&[("source", source)])
        .json(&Value::Object(input))
        .send()
        .await
        .map_err(|error| {
            ApiFailure::Transport(TransportFailure {
                kind: TransportFailureKind::SendRequest,
                stage: ErrorStage::ResolveSource,
                message: error.to_string(),
                retryable: error.is_connect() || error.is_timeout(),
            })
        })?;

    read_source_connect_response(response, ErrorStage::ResolveSource).await
}

async fn read_source_connect_response<T>(
    response: reqwest::Response,
    stage: ErrorStage,
) -> Result<ApiSuccess<T>, ApiFailure>
where
    T: for<'de> Deserialize<'de>,
{
    let request_id = response_request_id(response.headers());
    let status = response.status();
    let body = response.bytes().await.map_err(|error| {
        ApiFailure::Transport(TransportFailure {
            kind: TransportFailureKind::ReadResponseBody,
            stage,
            message: error.to_string(),
            retryable: error.is_connect() || error.is_timeout(),
        })
    })?;

    if !status.is_success() {
        return Err(ApiFailure::Problem(parse_problem_response(
            status,
            request_id,
            &body,
            problem_stage_for_status(status, stage),
        )));
    }

    let payload = serde_json::from_slice::<SourceConnectEnvelope<T>>(&body)
        .map_err(|error| decode_failure(stage, error.to_string(), request_id.clone()))?;

    Ok(ApiSuccess {
        payload: payload.data,
        request_id: payload.request_id.or(request_id),
    })
}

fn problem_stage_for_status(status: StatusCode, fallback: ErrorStage) -> ErrorStage {
    match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => ErrorStage::Auth,
        StatusCode::NOT_FOUND => ErrorStage::ResolveOrg,
        _ => fallback,
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use serde_json::json;

    use super::SourceConnectGuide;
    use super::SourceConnectInputSchema;
    use super::SourceConnectInputSchemaProperties;
    use super::SourceConnectProviderGuide;
    use super::SourceConnectResult;
    use super::SourceConnectSchemaField;
    use crate::transport::source::SourceSummary;

    #[test]
    fn source_connect_guide_deserializes_canonical_shape() {
        let payload = json!({
            "title": "OneQuery Source Connect Guide",
            "description": "Create one source connection.",
            "format": "markdown",
            "content": "1. Gather credentials.\n2. Run the command.",
            "command": "oneq source connect --source postgres --input '<json>'",
            "inputSchema": {
                "type": "object",
                "required": ["name", "credentials"],
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "CLI-safe org-unique source key",
                        "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$|^[A-Za-z0-9]$"
                    },
                    "credentials": {
                        "type": "object",
                        "description": "Provider-specific credentials"
                    }
                }
            },
            "providers": [{
                "provider": "postgres",
                "summary": "Connect Postgres.",
                "requiredCredentialFields": ["type", "host", "database", "username", "password"],
                "optionalCredentialFields": ["port", "sslMode"],
                "steps": ["Retrieve connection details.", "Run the command."],
                "credentialTemplate": {"type": "postgres", "host": "db.example.com"},
                "exampleInput": {"name": "warehouse", "provider": "postgres", "credentials": {"type": "postgres", "host": "db.example.com"}}
            }]
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
                command: "oneq source connect --source postgres --input '<json>'".to_owned(),
                input_schema: SourceConnectInputSchema {
                    field_type: "object".to_owned(),
                    required: vec!["name".to_owned(), "credentials".to_owned()],
                    properties: SourceConnectInputSchemaProperties {
                        name: SourceConnectSchemaField {
                            field_type: "string".to_owned(),
                            description: "CLI-safe org-unique source key".to_owned(),
                            pattern: Some(
                                "^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$|^[A-Za-z0-9]$".to_owned(),
                            ),
                            enum_values: None,
                        },
                        credentials: SourceConnectSchemaField {
                            field_type: "object".to_owned(),
                            description: "Provider-specific credentials".to_owned(),
                            pattern: None,
                            enum_values: None,
                        },
                    },
                },
                providers: vec![SourceConnectProviderGuide {
                    provider: "postgres".to_owned(),
                    summary: "Connect Postgres.".to_owned(),
                    required_credential_fields: vec![
                        "type".to_owned(),
                        "host".to_owned(),
                        "database".to_owned(),
                        "username".to_owned(),
                        "password".to_owned(),
                    ],
                    optional_credential_fields: vec!["port".to_owned(), "sslMode".to_owned()],
                    steps: vec![
                        "Retrieve connection details.".to_owned(),
                        "Run the command.".to_owned(),
                    ],
                    credential_template: json!({
                        "type": "postgres",
                        "host": "db.example.com",
                    }),
                    example_input: json!({
                        "name": "warehouse",
                        "provider": "postgres",
                        "credentials": {
                            "type": "postgres",
                            "host": "db.example.com",
                        }
                    }),
                }],
            }
        );
    }

    #[test]
    fn source_connect_result_deserializes_canonical_shape() {
        let payload = json!({
            "source": {
                "name": "warehouse",
                "provider": "postgres",
                "queryable": true,
                "status": "active"
            },
            "nextCommand": "oneq source show warehouse"
        });

        let parsed = serde_json::from_value::<SourceConnectResult>(payload)
            .expect("canonical source connect result should deserialize");
        assert_eq!(
            parsed,
            SourceConnectResult {
                source: SourceSummary {
                    name: Some("warehouse".to_owned()),
                    display_name: None,
                    provider_kind: Some("postgres".to_owned()),
                    queryable: Some(true),
                    status: Some("active".to_owned()),
                },
                next_command: "oneq source show warehouse".to_owned(),
            }
        );
    }
}
