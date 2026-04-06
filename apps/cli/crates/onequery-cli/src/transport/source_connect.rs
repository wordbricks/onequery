use buffa::MessageField;
use buffa_types::google::protobuf::Struct as ProtoStruct;
use connectrpc::ErrorCode;
use onequery_cli_core::error::ErrorStage;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Map;
use serde_json::Value;

use crate::transport::client::AuthenticatedApiClient;
use crate::transport::generated::types;
use crate::transport::http::ApiFailure;
use crate::transport::http::ApiSuccess;
use crate::transport::http::ResponseFailureStages;
use crate::transport::http::conversion_failure;
use crate::transport::http::decode_failure;
use crate::transport::http::failure_from_connect;
use crate::transport::http::response_request_id;
use crate::transport::labels::content_format_to_str;
use crate::transport::labels::source_provider_from_str;
use crate::transport::labels::source_provider_to_str;
use crate::transport::source::SourceSummary;
use crate::transport::source::source_summary_from_generated;

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

pub(crate) async fn load_source_connect_guide(
    client: &AuthenticatedApiClient,
    org_slug: &str,
    source: &str,
) -> Result<ApiSuccess<SourceConnectGuide>, ApiFailure> {
    let org_slug: String =
        crate::transport::http::try_into_value(org_slug, ErrorStage::ResolveSource)?;
    let source = source_provider_from_str(source).ok_or_else(|| {
        conversion_failure(
            ErrorStage::ResolveSource,
            format!("unsupported source provider {source}"),
        )
    })?;

    let response = match client
        .cli()
        .get_source_connect_guide(types::GetSourceConnectGuideRequest {
            org_slug,
            source: source.into(),
            ..Default::default()
        })
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(
                error,
                ResponseFailureStages::from_connect_code(problem_stage_for_code),
            ));
        }
    };

    let request_id = response_request_id(response.headers());
    let payload = response.into_owned();

    Ok(ApiSuccess {
        payload: source_connect_guide_from_generated(payload, request_id.clone())?,
        request_id,
    })
}

pub(crate) async fn connect_source(
    client: &AuthenticatedApiClient,
    org_slug: &str,
    source: &str,
    mut input: Map<String, Value>,
) -> Result<ApiSuccess<SourceConnectResult>, ApiFailure> {
    let org_slug: String =
        crate::transport::http::try_into_value(org_slug, ErrorStage::ResolveSource)?;
    let source = source_provider_from_str(source).ok_or_else(|| {
        conversion_failure(
            ErrorStage::ResolveSource,
            format!("unsupported source provider {source}"),
        )
    })?;
    let name = input
        .remove("name")
        .and_then(|value| match value {
            Value::String(value) if !value.trim().is_empty() => Some(value),
            _ => None,
        })
        .ok_or_else(|| {
            conversion_failure(
                ErrorStage::ResolveSource,
                "source connect input must include non-empty string field `name`",
            )
        })?;
    let credentials = input.remove("credentials").ok_or_else(|| {
        conversion_failure(
            ErrorStage::ResolveSource,
            "source connect input must include object field `credentials`",
        )
    })?;
    let credentials = serde_json::from_value::<ProtoStruct>(credentials).map_err(|error| {
        conversion_failure(
            ErrorStage::ResolveSource,
            format!("invalid source connect credentials: {error}"),
        )
    })?;

    let response = match client
        .cli()
        .connect_source(types::ConnectSourceRequest {
            org_slug,
            source: source.into(),
            name,
            credentials: MessageField::some(credentials),
            ..Default::default()
        })
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(
                error,
                ResponseFailureStages::from_connect_code(problem_stage_for_code),
            ));
        }
    };

    let request_id = response_request_id(response.headers());
    let payload = response.into_owned();

    Ok(ApiSuccess {
        payload: source_connect_result_from_generated(payload, request_id.clone())?,
        request_id,
    })
}

fn problem_stage_for_code(code: ErrorCode) -> ErrorStage {
    match code {
        ErrorCode::Unauthenticated | ErrorCode::PermissionDenied => ErrorStage::Auth,
        ErrorCode::NotFound => ErrorStage::ResolveOrg,
        _ => ErrorStage::ResolveSource,
    }
}

fn source_connect_guide_from_generated(
    response: types::GetSourceConnectGuideResponse,
    request_id: Option<String>,
) -> Result<SourceConnectGuide, ApiFailure> {
    let input_schema = response.input_schema.into_option().ok_or_else(|| {
        decode_failure(
            ErrorStage::ResolveSource,
            "source connect guide missing input schema",
            request_id.clone(),
        )
    })?;

    Ok(SourceConnectGuide {
        title: response.title,
        description: response.description,
        format: content_format_to_str(response.format),
        content: response.content,
        command: response.command,
        input_schema: input_schema_from_generated(input_schema, request_id.clone())?,
        providers: response
            .providers
            .into_iter()
            .map(|provider| provider_guide_from_generated(provider, request_id.clone()))
            .collect::<Result<Vec<_>, _>>()?,
    })
}

fn input_schema_from_generated(
    schema: types::CliSourceConnectInputSchema,
    request_id: Option<String>,
) -> Result<SourceConnectInputSchema, ApiFailure> {
    let properties = schema.properties.into_option().ok_or_else(|| {
        decode_failure(
            ErrorStage::ResolveSource,
            "source connect guide missing input schema properties",
            request_id.clone(),
        )
    })?;

    Ok(SourceConnectInputSchema {
        field_type: schema.r#type,
        required: schema.required,
        properties: SourceConnectInputSchemaProperties {
            name: schema_field_from_generated(properties.name.into_option().ok_or_else(|| {
                decode_failure(
                    ErrorStage::ResolveSource,
                    "source connect guide missing input schema name field",
                    request_id.clone(),
                )
            })?),
            credentials: schema_field_from_generated(
                properties.credentials.into_option().ok_or_else(|| {
                    decode_failure(
                        ErrorStage::ResolveSource,
                        "source connect guide missing input schema credentials field",
                        request_id,
                    )
                })?,
            ),
        },
    })
}

fn schema_field_from_generated(
    field: types::CliSourceConnectSchemaField,
) -> SourceConnectSchemaField {
    SourceConnectSchemaField {
        field_type: field.r#type,
        description: field.description,
        pattern: field.pattern,
        enum_values: (!field.enum_values.is_empty()).then_some(field.enum_values),
    }
}

fn provider_guide_from_generated(
    guide: types::CliSourceConnectProviderGuide,
    request_id: Option<String>,
) -> Result<SourceConnectProviderGuide, ApiFailure> {
    Ok(SourceConnectProviderGuide {
        provider: source_provider_to_str(guide.provider),
        summary: guide.summary,
        required_credential_fields: guide.required_credential_fields,
        optional_credential_fields: guide.optional_credential_fields,
        steps: guide.steps,
        credential_template: struct_to_json(
            guide.credential_template.into_option().ok_or_else(|| {
                decode_failure(
                    ErrorStage::ResolveSource,
                    "source connect guide missing credential template",
                    request_id.clone(),
                )
            })?,
            request_id.clone(),
        )?,
        example_input: struct_to_json(
            guide.example_input.into_option().ok_or_else(|| {
                decode_failure(
                    ErrorStage::ResolveSource,
                    "source connect guide missing example input",
                    request_id,
                )
            })?,
            None,
        )?,
    })
}

fn source_connect_result_from_generated(
    response: types::ConnectSourceResponse,
    request_id: Option<String>,
) -> Result<SourceConnectResult, ApiFailure> {
    let source = response.source.into_option().ok_or_else(|| {
        decode_failure(
            ErrorStage::ResolveSource,
            "source connect response missing source summary",
            request_id,
        )
    })?;

    Ok(SourceConnectResult {
        source: source_summary_from_generated(source),
        next_command: response.next_command,
    })
}

fn struct_to_json(value: ProtoStruct, request_id: Option<String>) -> Result<Value, ApiFailure> {
    serde_json::to_value(value)
        .map_err(|error| decode_failure(ErrorStage::ResolveSource, error.to_string(), request_id))
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
            "command": "onequery source connect --source postgres --input '<json>'",
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
                command: "onequery source connect --source postgres --input '<json>'".to_owned(),
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
            "nextCommand": "onequery source show warehouse"
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
                next_command: "onequery source show warehouse".to_owned(),
            }
        );
    }
}
