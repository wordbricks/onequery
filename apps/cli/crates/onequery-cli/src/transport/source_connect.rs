use buffa::EnumValue;
use buffa::MessageField;
use connectrpc::ErrorCode;
use onequery_cli_core::error::ErrorStage;
use serde::Deserialize;
use serde::Serialize;
use serde::de::DeserializeOwned;
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
use crate::transport::source::SourceSummary;
use crate::transport::source::source_summary_from_generated;

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

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PostgresSourceConnectCredentialsInput {
    database: String,
    host: String,
    password: String,
    port: Option<u32>,
    #[serde(alias = "ssl_mode")]
    ssl_mode: Option<String>,
    username: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MySqlSourceConnectCredentialsInput {
    database: String,
    host: String,
    password: String,
    port: Option<u32>,
    #[serde(alias = "ssl_mode")]
    ssl_mode: Option<String>,
    username: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MongoDbSourceConnectCredentialsInput {
    #[serde(alias = "connection_string")]
    connection_string: String,
    database: Option<String>,
    #[serde(default)]
    databases: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ServiceAccountInput {
    client_email: String,
    private_key: String,
    private_key_id: Option<String>,
    project_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct BigQuerySourceConnectCredentialsInput {
    access_token: Option<String>,
    expires_at: Option<u64>,
    project_id: String,
    refresh_token: Option<String>,
    service_account: Option<ServiceAccountInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct LaminarSourceConnectCredentialsInput {
    api_base_url: Option<String>,
    api_key: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct AwsAthenaConnectorSourceConnectCredentialsInput {
    connector_id: String,
    database: String,
    max_rows: Option<u32>,
    timeout_ms: Option<u32>,
    workgroup: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct GoogleAnalyticsSourceConnectCredentialsInput {
    access_token: Option<String>,
    expires_at: Option<u64>,
    property_id: String,
    refresh_token: Option<String>,
    service_account: Option<ServiceAccountInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct AmplitudeSourceConnectCredentialsInput {
    api_key: String,
    region: Option<String>,
    secret_key: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MixpanelSourceConnectCredentialsInput {
    project_id: String,
    region: Option<String>,
    secret: String,
    username: String,
    workspace_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PostHogSourceConnectCredentialsInput {
    host_url: String,
    personal_api_key: String,
    project_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SentrySourceConnectCredentialsInput {
    api_base_url: Option<String>,
    auth_token: String,
    organization_slug: String,
    project_slug: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct GitHubSourceConnectCredentialsInput {
    access_token: String,
    installation_id: Option<String>,
    #[serde(default)]
    repositories: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct LinearSourceConnectCredentialsInput {
    access_token: Option<String>,
    api_key: Option<String>,
    app_user_id: Option<String>,
    expires_at: Option<String>,
    linear_organization_id: Option<String>,
    linear_organization_name: Option<String>,
    refresh_token: Option<String>,
    scope: Option<String>,
    token_type: Option<String>,
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
    let provider = source_provider_from_str(source).ok_or_else(|| {
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
    let credentials = connect_source_credentials_from_json(provider, credentials)?;

    let response = match client
        .cli()
        .connect_source(types::ConnectSourceRequest {
            org_slug,
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

fn connect_source_credentials_from_json(
    provider: types::CliSourceProvider,
    value: Value,
) -> Result<types::ConnectSourceCredentials, ApiFailure> {
    match provider {
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_POSTGRES => {
            let input: PostgresSourceConnectCredentialsInput =
                parse_source_connect_credentials(value)?;

            Ok(types::ConnectSourceCredentials {
                kind: Some(types::connect_source_credentials::Kind::Postgres(Box::new(
                    postgres_message_from_input(input)?,
                ))),
                ..Default::default()
            })
        }
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_SUPABASE => {
            let input: PostgresSourceConnectCredentialsInput =
                parse_source_connect_credentials(value)?;

            Ok(types::ConnectSourceCredentials {
                kind: Some(types::connect_source_credentials::Kind::Supabase(Box::new(
                    postgres_message_from_input(input)?,
                ))),
                ..Default::default()
            })
        }
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_MYSQL => {
            let input: MySqlSourceConnectCredentialsInput =
                parse_source_connect_credentials(value)?;

            Ok(types::ConnectSourceCredentials {
                kind: Some(types::connect_source_credentials::Kind::Mysql(Box::new(
                    mysql_message_from_input(input)?,
                ))),
                ..Default::default()
            })
        }
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_MONGODB => {
            let input: MongoDbSourceConnectCredentialsInput =
                parse_source_connect_credentials(value)?;

            Ok(types::ConnectSourceCredentials {
                kind: Some(types::connect_source_credentials::Kind::Mongodb(Box::new(
                    types::ConnectSourceMongoDbCredentials {
                        connection_string: input.connection_string,
                        database: input.database,
                        databases: input.databases,
                        ..Default::default()
                    },
                ))),
                ..Default::default()
            })
        }
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_BIGQUERY => {
            let input: BigQuerySourceConnectCredentialsInput =
                parse_source_connect_credentials(value)?;

            Ok(types::ConnectSourceCredentials {
                kind: Some(types::connect_source_credentials::Kind::Bigquery(Box::new(
                    big_query_credentials_from_input(input)?,
                ))),
                ..Default::default()
            })
        }
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_LAMINAR => {
            let input: LaminarSourceConnectCredentialsInput =
                parse_source_connect_credentials(value)?;

            Ok(types::ConnectSourceCredentials {
                kind: Some(types::connect_source_credentials::Kind::Laminar(Box::new(
                    types::ConnectSourceLaminarCredentials {
                        api_base_url: input.api_base_url,
                        api_key: input.api_key,
                        ..Default::default()
                    },
                ))),
                ..Default::default()
            })
        }
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_AWS_ATHENA_CONNECTOR => {
            let input: AwsAthenaConnectorSourceConnectCredentialsInput =
                parse_source_connect_credentials(value)?;

            Ok(types::ConnectSourceCredentials {
                kind: Some(types::connect_source_credentials::Kind::AwsAthenaConnector(
                    Box::new(types::ConnectSourceAwsAthenaConnectorCredentials {
                        connector_id: input.connector_id,
                        database: input.database,
                        max_rows: input.max_rows,
                        timeout_ms: input.timeout_ms,
                        workgroup: input.workgroup,
                        ..Default::default()
                    }),
                )),
                ..Default::default()
            })
        }
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_GA => {
            let input: GoogleAnalyticsSourceConnectCredentialsInput =
                parse_source_connect_credentials(value)?;

            Ok(types::ConnectSourceCredentials {
                kind: Some(types::connect_source_credentials::Kind::Ga(Box::new(
                    google_analytics_credentials_from_input(input)?,
                ))),
                ..Default::default()
            })
        }
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_AMPLITUDE => {
            let input: AmplitudeSourceConnectCredentialsInput =
                parse_source_connect_credentials(value)?;

            Ok(types::ConnectSourceCredentials {
                kind: Some(types::connect_source_credentials::Kind::Amplitude(
                    Box::new(types::ConnectSourceAmplitudeCredentials {
                        api_key: input.api_key,
                        region: amplitude_region_from_input(input.region)?,
                        secret_key: input.secret_key,
                        ..Default::default()
                    }),
                )),
                ..Default::default()
            })
        }
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_MIXPANEL => {
            let input: MixpanelSourceConnectCredentialsInput =
                parse_source_connect_credentials(value)?;

            Ok(types::ConnectSourceCredentials {
                kind: Some(types::connect_source_credentials::Kind::Mixpanel(Box::new(
                    types::ConnectSourceMixpanelCredentials {
                        project_id: input.project_id,
                        region: mixpanel_region_from_input(input.region)?,
                        secret: input.secret,
                        username: input.username,
                        workspace_id: input.workspace_id,
                        ..Default::default()
                    },
                ))),
                ..Default::default()
            })
        }
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_POSTHOG => {
            let input: PostHogSourceConnectCredentialsInput =
                parse_source_connect_credentials(value)?;

            Ok(types::ConnectSourceCredentials {
                kind: Some(types::connect_source_credentials::Kind::Posthog(Box::new(
                    types::ConnectSourcePostHogCredentials {
                        host_url: input.host_url,
                        personal_api_key: input.personal_api_key,
                        project_id: input.project_id,
                        ..Default::default()
                    },
                ))),
                ..Default::default()
            })
        }
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_SENTRY => {
            let input: SentrySourceConnectCredentialsInput =
                parse_source_connect_credentials(value)?;

            Ok(types::ConnectSourceCredentials {
                kind: Some(types::connect_source_credentials::Kind::Sentry(Box::new(
                    types::ConnectSourceSentryCredentials {
                        api_base_url: input.api_base_url,
                        auth_token: input.auth_token,
                        organization_slug: input.organization_slug,
                        project_slug: input.project_slug,
                        ..Default::default()
                    },
                ))),
                ..Default::default()
            })
        }
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_GITHUB => {
            let input: GitHubSourceConnectCredentialsInput =
                parse_source_connect_credentials(value)?;

            Ok(types::ConnectSourceCredentials {
                kind: Some(types::connect_source_credentials::Kind::Github(Box::new(
                    types::ConnectSourceGitHubCredentials {
                        access_token: input.access_token,
                        installation_id: input.installation_id,
                        repositories: input.repositories,
                        ..Default::default()
                    },
                ))),
                ..Default::default()
            })
        }
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_LINEAR => {
            let input: LinearSourceConnectCredentialsInput =
                parse_source_connect_credentials(value)?;

            Ok(types::ConnectSourceCredentials {
                kind: Some(types::connect_source_credentials::Kind::Linear(Box::new(
                    linear_credentials_from_input(input)?,
                ))),
                ..Default::default()
            })
        }
        types::CliSourceProvider::CLI_SOURCE_PROVIDER_UNSPECIFIED => Err(
            source_connect_input_failure("source connect provider must be specified"),
        ),
    }
}

fn postgres_message_from_input(
    input: PostgresSourceConnectCredentialsInput,
) -> Result<types::ConnectSourcePostgresCredentials, ApiFailure> {
    Ok(types::ConnectSourcePostgresCredentials {
        database: input.database,
        host: input.host,
        password: input.password,
        port: input.port,
        ssl_mode: ssl_mode_from_input(input.ssl_mode)?,
        username: input.username,
        ..Default::default()
    })
}

fn mysql_message_from_input(
    input: MySqlSourceConnectCredentialsInput,
) -> Result<types::ConnectSourceMySqlCredentials, ApiFailure> {
    Ok(types::ConnectSourceMySqlCredentials {
        database: input.database,
        host: input.host,
        password: input.password,
        port: input.port,
        ssl_mode: ssl_mode_from_input(input.ssl_mode)?,
        username: input.username,
        ..Default::default()
    })
}

fn big_query_credentials_from_input(
    input: BigQuerySourceConnectCredentialsInput,
) -> Result<types::ConnectSourceBigQueryCredentials, ApiFailure> {
    let auth = match select_google_auth_mode(
        "bigquery",
        has_google_oauth_fields(
            input.access_token.as_deref(),
            input.refresh_token.as_deref(),
            input.expires_at,
        ),
        input.service_account.is_some(),
    )? {
        GoogleAuthMode::Oauth => Some(types::connect_source_big_query_credentials::Auth::Oauth(
            Box::new(types::ConnectSourceBigQueryOAuthCredentials {
                project_id: input.project_id,
                credentials: MessageField::some(google_oauth_credentials_from_input(
                    "bigquery",
                    input.access_token,
                    input.refresh_token,
                    input.expires_at,
                )?),
                ..Default::default()
            }),
        )),
        GoogleAuthMode::ServiceAccount => Some(
            types::connect_source_big_query_credentials::Auth::ServiceAccount(Box::new(
                types::ConnectSourceBigQueryServiceAccountCredentials {
                    project_id: input.project_id,
                    service_account: MessageField::some(service_account_from_input(
                        "bigquery",
                        input.service_account,
                    )?),
                    ..Default::default()
                },
            )),
        ),
    };

    Ok(types::ConnectSourceBigQueryCredentials {
        auth,
        ..Default::default()
    })
}

fn google_analytics_credentials_from_input(
    input: GoogleAnalyticsSourceConnectCredentialsInput,
) -> Result<types::ConnectSourceGoogleAnalyticsCredentials, ApiFailure> {
    let auth = match select_google_auth_mode(
        "ga",
        has_google_oauth_fields(
            input.access_token.as_deref(),
            input.refresh_token.as_deref(),
            input.expires_at,
        ),
        input.service_account.is_some(),
    )? {
        GoogleAuthMode::Oauth => Some(
            types::connect_source_google_analytics_credentials::Auth::Oauth(Box::new(
                types::ConnectSourceGoogleAnalyticsOAuthCredentials {
                    property_id: input.property_id,
                    credentials: MessageField::some(google_oauth_credentials_from_input(
                        "ga",
                        input.access_token,
                        input.refresh_token,
                        input.expires_at,
                    )?),
                    ..Default::default()
                },
            )),
        ),
        GoogleAuthMode::ServiceAccount => Some(
            types::connect_source_google_analytics_credentials::Auth::ServiceAccount(Box::new(
                types::ConnectSourceGoogleAnalyticsServiceAccountCredentials {
                    property_id: input.property_id,
                    service_account: MessageField::some(service_account_from_input(
                        "ga",
                        input.service_account,
                    )?),
                    ..Default::default()
                },
            )),
        ),
    };

    Ok(types::ConnectSourceGoogleAnalyticsCredentials {
        auth,
        ..Default::default()
    })
}

fn linear_credentials_from_input(
    input: LinearSourceConnectCredentialsInput,
) -> Result<types::ConnectSourceLinearCredentials, ApiFailure> {
    let has_oauth_fields = input.access_token.is_some()
        || input.app_user_id.is_some()
        || input.expires_at.is_some()
        || input.linear_organization_id.is_some()
        || input.linear_organization_name.is_some()
        || input.refresh_token.is_some()
        || input.scope.is_some()
        || input.token_type.is_some();

    if input.api_key.is_some() && has_oauth_fields {
        return Err(source_connect_input_failure(
            "source connect credentials must include either `apiKey` or Linear OAuth fields, not both",
        ));
    }

    let auth = if let Some(api_key) = input.api_key {
        Some(types::connect_source_linear_credentials::Auth::ApiKey(
            Box::new(types::ConnectSourceLinearApiKeyCredentials {
                api_key,
                ..Default::default()
            }),
        ))
    } else if has_oauth_fields {
        Some(types::connect_source_linear_credentials::Auth::Oauth(
            Box::new(types::ConnectSourceLinearOAuthCredentials {
                access_token: require_field(
                    input.access_token,
                    "source connect credentials must include `accessToken` for Linear OAuth",
                )?,
                app_user_id: input.app_user_id,
                expires_at: input.expires_at,
                linear_organization_id: require_field(
                    input.linear_organization_id,
                    "source connect credentials must include `linearOrganizationId` for Linear OAuth",
                )?,
                linear_organization_name: input.linear_organization_name,
                refresh_token: input.refresh_token,
                scope: input.scope,
                token_type: input.token_type,
                ..Default::default()
            }),
        ))
    } else {
        return Err(source_connect_input_failure(
            "source connect credentials must include either `apiKey` or Linear OAuth fields",
        ));
    };

    Ok(types::ConnectSourceLinearCredentials {
        auth,
        ..Default::default()
    })
}

fn parse_source_connect_credentials<T>(value: Value) -> Result<T, ApiFailure>
where
    T: DeserializeOwned,
{
    serde_json::from_value(value).map_err(|error| {
        source_connect_input_failure(format!("invalid source connect credentials: {error}"))
    })
}

fn source_connect_input_failure(message: impl Into<String>) -> ApiFailure {
    conversion_failure(ErrorStage::ResolveSource, message)
}

fn ssl_mode_from_input(
    value: Option<String>,
) -> Result<Option<EnumValue<types::CliSourceConnectSslMode>>, ApiFailure> {
    match value.as_deref() {
        None => Ok(None),
        Some("disable") => Ok(Some(
            types::CliSourceConnectSslMode::CLI_SOURCE_CONNECT_SSL_MODE_DISABLE.into(),
        )),
        Some("prefer") => Ok(Some(
            types::CliSourceConnectSslMode::CLI_SOURCE_CONNECT_SSL_MODE_PREFER.into(),
        )),
        Some("require") => Ok(Some(
            types::CliSourceConnectSslMode::CLI_SOURCE_CONNECT_SSL_MODE_REQUIRE.into(),
        )),
        Some(other) => Err(source_connect_input_failure(format!(
            "source connect credentials.sslMode must be one of `disable`, `prefer`, `require`; got `{other}`"
        ))),
    }
}

fn amplitude_region_from_input(
    value: Option<String>,
) -> Result<Option<EnumValue<types::CliSourceConnectAmplitudeRegion>>, ApiFailure> {
    match value.as_deref() {
        None => Ok(None),
        Some("us") => Ok(Some(
            types::CliSourceConnectAmplitudeRegion::CLI_SOURCE_CONNECT_AMPLITUDE_REGION_US.into(),
        )),
        Some("eu") => Ok(Some(
            types::CliSourceConnectAmplitudeRegion::CLI_SOURCE_CONNECT_AMPLITUDE_REGION_EU.into(),
        )),
        Some(other) => Err(source_connect_input_failure(format!(
            "source connect credentials.region must be one of `us`, `eu`; got `{other}`"
        ))),
    }
}

fn mixpanel_region_from_input(
    value: Option<String>,
) -> Result<Option<EnumValue<types::CliSourceConnectMixpanelRegion>>, ApiFailure> {
    match value.as_deref() {
        None => Ok(None),
        Some("us") => Ok(Some(
            types::CliSourceConnectMixpanelRegion::CLI_SOURCE_CONNECT_MIXPANEL_REGION_US.into(),
        )),
        Some("eu") => Ok(Some(
            types::CliSourceConnectMixpanelRegion::CLI_SOURCE_CONNECT_MIXPANEL_REGION_EU.into(),
        )),
        Some("in") => Ok(Some(
            types::CliSourceConnectMixpanelRegion::CLI_SOURCE_CONNECT_MIXPANEL_REGION_IN.into(),
        )),
        Some(other) => Err(source_connect_input_failure(format!(
            "source connect credentials.region must be one of `us`, `eu`, `in`; got `{other}`"
        ))),
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum GoogleAuthMode {
    Oauth,
    ServiceAccount,
}

fn select_google_auth_mode(
    provider: &str,
    has_oauth_fields: bool,
    has_service_account: bool,
) -> Result<GoogleAuthMode, ApiFailure> {
    if has_oauth_fields && has_service_account {
        return Err(source_connect_input_failure(format!(
            "source connect credentials for `{provider}` must include either OAuth tokens or `serviceAccount`, not both"
        )));
    }

    match (has_oauth_fields, has_service_account) {
        (true, false) => Ok(GoogleAuthMode::Oauth),
        (false, true) => Ok(GoogleAuthMode::ServiceAccount),
        (false, false) => Err(source_connect_input_failure(format!(
            "source connect credentials for `{provider}` must include OAuth tokens or `serviceAccount`"
        ))),
        (true, true) => unreachable!("handled above"),
    }
}

fn has_google_oauth_fields(
    access_token: Option<&str>,
    refresh_token: Option<&str>,
    expires_at: Option<u64>,
) -> bool {
    access_token.is_some() || refresh_token.is_some() || expires_at.is_some()
}

fn google_oauth_credentials_from_input(
    provider: &str,
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_at: Option<u64>,
) -> Result<types::ConnectSourceGoogleOAuthCredentials, ApiFailure> {
    Ok(types::ConnectSourceGoogleOAuthCredentials {
        access_token: require_field(
            access_token,
            format!("source connect credentials must include `accessToken` for `{provider}` OAuth"),
        )?,
        refresh_token: require_field(
            refresh_token,
            format!(
                "source connect credentials must include `refreshToken` for `{provider}` OAuth"
            ),
        )?,
        expires_at: require_field(
            expires_at,
            format!("source connect credentials must include `expiresAt` for `{provider}` OAuth"),
        )?,
        ..Default::default()
    })
}

fn service_account_from_input(
    provider: &str,
    service_account: Option<ServiceAccountInput>,
) -> Result<types::ConnectSourceServiceAccountCredentials, ApiFailure> {
    let service_account = require_field(
        service_account,
        format!(
            "source connect credentials must include `serviceAccount` for `{provider}` service-account auth"
        ),
    )?;

    Ok(types::ConnectSourceServiceAccountCredentials {
        client_email: service_account.client_email,
        private_key: service_account.private_key,
        private_key_id: service_account.private_key_id,
        project_id: service_account.project_id,
        ..Default::default()
    })
}

fn require_field<T>(value: Option<T>, message: impl Into<String>) -> Result<T, ApiFailure> {
    value.ok_or_else(|| source_connect_input_failure(message))
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
    _request_id: Option<String>,
) -> Result<SourceConnectGuide, ApiFailure> {
    Ok(SourceConnectGuide {
        title: response.title,
        description: response.description,
        format: content_format_to_str(response.format),
        content: response.content,
        command: response.command,
    })
}

fn source_connect_result_from_generated(
    response: types::ConnectSourceResponse,
    request_id: Option<String>,
) -> Result<SourceConnectResult, ApiFailure> {
    let source = response.source.into_option().ok_or_else(|| {
        decode_failure(
            ErrorStage::ResolveSource,
            "source connect response missing source",
            request_id,
        )
    })?;

    Ok(SourceConnectResult {
        source: source_summary_from_generated(source),
        next_command: response.next_command,
    })
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use serde_json::json;

    use super::SourceConnectGuide;
    use super::SourceConnectResult;
    use super::connect_source_credentials_from_json;
    use super::types;
    use crate::transport::http::ApiFailure;
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
                    provider: Some("postgres".to_owned()),
                    queryable: Some(true),
                    status: Some("active".to_owned()),
                },
                next_command: "onequery source show warehouse".to_owned(),
            }
        );
    }

    #[test]
    fn strict_source_connect_credentials_reject_unknown_fields() {
        let error = connect_source_credentials_from_json(
            types::CliSourceProvider::CLI_SOURCE_PROVIDER_POSTGRES,
            json!({
                "host": "db.example.com",
                "database": "app",
                "username": "onequery",
                "password": "secret",
                "unexpected": true,
            }),
        )
        .expect_err("unknown credentials fields should be rejected");

        let ApiFailure::Problem(problem) = error else {
            panic!("expected problem failure");
        };
        let detail = problem.detail.expect("problem detail should be present");

        assert!(detail.contains("unknown field `unexpected`"));
    }

    #[test]
    fn bigquery_service_account_credentials_build_typed_auth_shape() {
        let credentials = connect_source_credentials_from_json(
            types::CliSourceProvider::CLI_SOURCE_PROVIDER_BIGQUERY,
            json!({
                "projectId": "analytics-project",
                "serviceAccount": {
                    "projectId": "analytics-project",
                    "clientEmail": "onequery@analytics-project.iam.gserviceaccount.com",
                    "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
                    "privateKeyId": "key-id"
                }
            }),
        )
        .expect("service-account input should parse");

        let Some(types::connect_source_credentials::Kind::Bigquery(bigquery)) = credentials.kind
        else {
            panic!("expected bigquery credentials kind");
        };
        let Some(types::connect_source_big_query_credentials::Auth::ServiceAccount(auth)) =
            bigquery.auth
        else {
            panic!("expected service-account auth");
        };
        let service_account = auth
            .service_account
            .into_option()
            .expect("service-account message should be present");

        assert_eq!(auth.project_id, "analytics-project");
        assert_eq!(service_account.project_id, "analytics-project");
        assert_eq!(
            service_account.client_email,
            "onequery@analytics-project.iam.gserviceaccount.com"
        );
        assert_eq!(service_account.private_key_id.as_deref(), Some("key-id"));
    }

    #[test]
    fn supabase_credentials_build_supabase_oneof_variant() {
        let credentials = connect_source_credentials_from_json(
            types::CliSourceProvider::CLI_SOURCE_PROVIDER_SUPABASE,
            json!({
                "host": "db.project-ref.supabase.co",
                "port": 5432,
                "database": "postgres",
                "username": "postgres.project-ref",
                "password": "supabase-db-password",
                "sslMode": "require"
            }),
        )
        .expect("supabase input should parse");

        let Some(types::connect_source_credentials::Kind::Supabase(postgres)) = credentials.kind
        else {
            panic!("expected supabase credentials kind");
        };

        assert_eq!(postgres.host, "db.project-ref.supabase.co");
        assert_eq!(postgres.port, Some(5432));
        assert_eq!(
            postgres.ssl_mode,
            Some(types::CliSourceConnectSslMode::CLI_SOURCE_CONNECT_SSL_MODE_REQUIRE.into())
        );
    }
}
