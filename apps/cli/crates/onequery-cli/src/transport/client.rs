use std::marker::PhantomData;
use std::sync::Arc;
use std::time::Duration;

use connectrpc::client::ClientConfig;
use connectrpc::client::HttpClient as ConnectHttpClient;
use connectrpc::rustls;
use http::HeaderMap;
use http::header::AUTHORIZATION;
use http::header::HeaderValue;
use http::header::USER_AGENT;
use url::Url;

use crate::identifiers::REQUEST_ID_PARSE_ERROR_MESSAGE;
use crate::identifiers::is_request_id_format;
use crate::transport::generated::AuthClient as GeneratedAuthClient;
use crate::transport::generated::OrganizationClient as GeneratedOrganizationClient;
use crate::transport::generated::QueryClient as GeneratedQueryClient;
use crate::transport::generated::SourceApiClient as GeneratedSourceApiClient;
use crate::transport::generated::SourceClient as GeneratedSourceClient;

const CLI_BASE_PATH: &str = "/api/cli";
const CLI_USER_AGENT: &str = concat!("onequery-cli/", env!("CARGO_PKG_VERSION"));
const REQUEST_ID_HEADER: &str = "x-request-id";

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) enum ApiClientBuildFailure {
    BaseUrl { base_url: String, message: String },
    AuthToken { message: String },
    RequestId { message: String },
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) struct Authenticated;

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) struct Unauthenticated;

#[derive(Clone)]
pub(crate) struct ApiClient<State> {
    pub(crate) base_url: Url,
    auth: GeneratedAuthClient,
    organization: GeneratedOrganizationClient,
    query: GeneratedQueryClient,
    request_timeout: Duration,
    request_id: Option<String>,
    source: GeneratedSourceClient,
    source_api: GeneratedSourceApiClient,
    _state: PhantomData<State>,
}

pub(crate) type AuthenticatedApiClient = ApiClient<Authenticated>;
pub(crate) type UnauthenticatedApiClient = ApiClient<Unauthenticated>;

impl<State> std::fmt::Debug for ApiClient<State> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ApiClient")
            .field("base_url", &self.base_url)
            .field("request_timeout", &self.request_timeout)
            .field("request_id", &self.request_id)
            .finish_non_exhaustive()
    }
}

enum AuthHeader<'a> {
    None,
    Bearer(&'a str),
}

impl<State> ApiClient<State> {
    pub(crate) fn auth(&self) -> &GeneratedAuthClient {
        &self.auth
    }

    pub(crate) fn organization(&self) -> &GeneratedOrganizationClient {
        &self.organization
    }

    pub(crate) fn query(&self) -> &GeneratedQueryClient {
        &self.query
    }

    pub(crate) fn source(&self) -> &GeneratedSourceClient {
        &self.source
    }

    pub(crate) fn source_api(&self) -> &GeneratedSourceApiClient {
        &self.source_api
    }
}

impl UnauthenticatedApiClient {
    #[cfg(test)]
    pub(crate) fn new(
        base_url: &str,
        request_timeout_sec: u64,
    ) -> Result<Self, ApiClientBuildFailure> {
        Self::new_with_timeout_and_request_id(
            base_url,
            Duration::from_secs(request_timeout_sec),
            None,
        )
    }

    pub(crate) fn new_with_timeout_and_request_id(
        base_url: &str,
        request_timeout: Duration,
        request_id: Option<&str>,
    ) -> Result<Self, ApiClientBuildFailure> {
        build_client(base_url, request_timeout, AuthHeader::None, request_id)
    }

    pub(crate) fn authenticate(
        &self,
        token: &str,
    ) -> Result<AuthenticatedApiClient, ApiClientBuildFailure> {
        AuthenticatedApiClient::new_with_timeout_and_request_id(
            self.base_url.as_str(),
            self.request_timeout,
            token,
            self.request_id.as_deref(),
        )
    }
}

impl AuthenticatedApiClient {
    pub(crate) fn new_with_timeout_and_request_id(
        base_url: &str,
        request_timeout: Duration,
        token: &str,
        request_id: Option<&str>,
    ) -> Result<Self, ApiClientBuildFailure> {
        build_client(
            base_url,
            request_timeout,
            AuthHeader::Bearer(token),
            request_id,
        )
    }
}

fn build_client<State>(
    base_url: &str,
    request_timeout: Duration,
    auth_header: AuthHeader<'_>,
    request_id: Option<&str>,
) -> Result<ApiClient<State>, ApiClientBuildFailure> {
    let mut base_url =
        Url::parse(base_url).map_err(|url_error| ApiClientBuildFailure::BaseUrl {
            base_url: base_url.to_owned(),
            message: url_error.to_string(),
        })?;
    base_url.set_query(None);
    base_url.set_fragment(None);

    let mut auth_token = None;
    if let AuthHeader::Bearer(raw_token) = auth_header {
        let trimmed_token = raw_token.trim();
        if trimmed_token.is_empty() {
            return Err(ApiClientBuildFailure::AuthToken {
                message: "auth token must not be empty".to_owned(),
            });
        }
        auth_token = Some(trimmed_token.to_owned());
    }

    let request_id = request_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    let cli_base_url = cli_base_url(&base_url);
    let transport = connect_transport_for_base_url(&base_url)?;
    let config = connect_config(
        cli_base_url.as_str(),
        request_timeout,
        auth_token.as_deref(),
        request_id.as_deref(),
    )?;

    Ok(ApiClient {
        auth: GeneratedAuthClient::new(transport.clone(), config.clone()),
        base_url,
        organization: GeneratedOrganizationClient::new(transport.clone(), config.clone()),
        query: GeneratedQueryClient::new(transport.clone(), config.clone()),
        request_timeout,
        request_id,
        source: GeneratedSourceClient::new(transport.clone(), config.clone()),
        source_api: GeneratedSourceApiClient::new(transport, config),
        _state: PhantomData,
    })
}

fn connect_config(
    base_url: &str,
    request_timeout: Duration,
    auth_token: Option<&str>,
    request_id: Option<&str>,
) -> Result<ClientConfig, ApiClientBuildFailure> {
    // Comment: connect-rust's `default_header()` helper silently ignores invalid
    // name/value pairs, so build a typed header map here and fail deterministically.
    let mut default_headers = HeaderMap::new();
    default_headers.insert(USER_AGENT, HeaderValue::from_static(CLI_USER_AGENT));

    if let Some(token) = auth_token {
        default_headers.insert(AUTHORIZATION, authorization_header_value(token)?);
    }

    if let Some(request_id) = request_id {
        default_headers.insert(REQUEST_ID_HEADER, request_id_header_value(request_id)?);
    }

    Ok(
        ClientConfig::new(base_url.parse::<http::Uri>().map_err(|error| {
            ApiClientBuildFailure::BaseUrl {
                base_url: base_url.to_owned(),
                message: error.to_string(),
            }
        })?)
        .default_timeout(request_timeout)
        .default_headers(default_headers),
    )
}

fn connect_transport_for_base_url(
    base_url: &Url,
) -> Result<ConnectHttpClient, ApiClientBuildFailure> {
    match base_url.scheme() {
        "http" => Ok(ConnectHttpClient::plaintext()),
        "https" => Ok(ConnectHttpClient::with_tls(default_tls_config())),
        scheme => Err(ApiClientBuildFailure::BaseUrl {
            base_url: base_url.to_string(),
            message: format!("unsupported URL scheme {scheme}"),
        }),
    }
}

fn default_tls_config() -> Arc<rustls::ClientConfig> {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());

    Arc::new(
        rustls::ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth(),
    )
}

fn authorization_header_value(token: &str) -> Result<HeaderValue, ApiClientBuildFailure> {
    HeaderValue::from_str(format!("Bearer {token}").as_str()).map_err(|header_error| {
        ApiClientBuildFailure::AuthToken {
            message: header_error.to_string(),
        }
    })
}

fn request_id_header_value(request_id: &str) -> Result<HeaderValue, ApiClientBuildFailure> {
    if !is_request_id_format(request_id) {
        return Err(ApiClientBuildFailure::RequestId {
            message: REQUEST_ID_PARSE_ERROR_MESSAGE.to_owned(),
        });
    }

    HeaderValue::from_str(request_id).map_err(|header_error| ApiClientBuildFailure::RequestId {
        message: header_error.to_string(),
    })
}

fn cli_base_url(base_url: &Url) -> String {
    format!("{}{CLI_BASE_PATH}", base_url.as_str().trim_end_matches('/'))
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use http::header::AUTHORIZATION;
    use http::header::USER_AGENT;
    use pretty_assertions::assert_eq;

    use super::ApiClientBuildFailure;
    use super::CLI_USER_AGENT;
    use super::UnauthenticatedApiClient;
    use super::cli_base_url;
    use super::connect_config;

    #[test]
    fn unauthenticated_connect_config_does_not_attach_authorization_header() {
        let config = connect_config(
            "http://example.test/api/cli",
            Duration::from_secs(5),
            None,
            None,
        )
        .expect("expected connect config");

        assert_eq!(config.default_timeout, Some(Duration::from_secs(5)));
        assert_eq!(config.default_headers.get(AUTHORIZATION), None);
    }

    #[test]
    fn authenticated_connect_config_attaches_authorization_header() {
        let config = connect_config(
            "http://example.test/api/cli",
            Duration::from_secs(5),
            Some("pat_123"),
            None,
        )
        .expect("expected connect config");

        assert_eq!(
            config
                .default_headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
            Some("Bearer pat_123")
        );
    }

    #[test]
    fn connect_config_attaches_cli_user_agent_header() {
        let config = connect_config(
            "http://example.test/api/cli",
            Duration::from_secs(5),
            None,
            None,
        )
        .expect("expected connect config");

        assert_eq!(
            config
                .default_headers
                .get(USER_AGENT)
                .and_then(|value| value.to_str().ok()),
            Some(CLI_USER_AGENT)
        );
    }

    #[test]
    fn unauthenticated_client_authenticate_rejects_blank_tokens() {
        let client = UnauthenticatedApiClient::new("http://example.test", 5)
            .expect("expected unauthenticated client");

        assert_eq!(
            client
                .authenticate("   ")
                .expect_err("expected invalid token"),
            ApiClientBuildFailure::AuthToken {
                message: "auth token must not be empty".to_owned(),
            }
        );
    }

    #[test]
    fn connect_config_attaches_request_id_when_configured() {
        let config = connect_config(
            "http://example.test/api/cli",
            Duration::from_secs(5),
            None,
            Some("req_cli_123"),
        )
        .expect("expected connect config");

        assert_eq!(
            config
                .default_headers
                .get("x-request-id")
                .and_then(|value| value.to_str().ok()),
            Some("req_cli_123")
        );
    }

    #[test]
    fn authenticate_preserves_request_id_and_timeout() {
        let client = UnauthenticatedApiClient::new_with_timeout_and_request_id(
            "http://example.test",
            Duration::from_secs(5),
            Some("req_cli_123"),
        )
        .expect("expected unauthenticated client with request ID");
        let authenticated = client
            .authenticate("pat_123")
            .expect("expected authenticated client");

        assert_eq!(authenticated.base_url, client.base_url);
        assert_eq!(authenticated.request_timeout, client.request_timeout);
        assert_eq!(authenticated.request_id, Some("req_cli_123".to_owned()));
    }

    #[test]
    fn unauthenticated_client_rejects_invalid_request_id_headers() {
        assert_eq!(
            UnauthenticatedApiClient::new_with_timeout_and_request_id(
                "http://example.test",
                Duration::from_secs(5),
                Some("bad.id"),
            )
            .expect_err("expected invalid request ID"),
            ApiClientBuildFailure::RequestId {
                message: crate::identifiers::REQUEST_ID_PARSE_ERROR_MESSAGE.to_owned(),
            }
        );
    }

    #[test]
    fn unauthenticated_client_builds_cli_base_url_from_origin() {
        let client = UnauthenticatedApiClient::new("http://example.test", 5)
            .expect("expected unauthenticated client");

        assert_eq!(client.base_url.as_str(), "http://example.test/");
        assert_eq!(
            cli_base_url(&client.base_url),
            "http://example.test/api/cli"
        );
    }
}
