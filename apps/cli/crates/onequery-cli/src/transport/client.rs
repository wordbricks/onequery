use std::marker::PhantomData;
use std::time::Duration;

use reqwest::header::AUTHORIZATION;
use reqwest::header::HeaderMap;
use reqwest::header::HeaderName;
use reqwest::header::HeaderValue;
use url::Url;

use crate::transport::generated::Client as GeneratedCliClient;

const CLI_BASE_PATH: &str = "/api/cli";

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) enum ApiClientBuildFailure {
    InvalidBaseUrl { base_url: String, message: String },
    InvalidAuthToken { message: String },
    InvalidRequestId { message: String },
    HttpClient { message: String },
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) struct Authenticated;

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) struct Unauthenticated;

#[derive(Debug, Clone)]
pub(crate) struct ApiClient<State> {
    pub(crate) base_url: Url,
    cli: GeneratedCliClient,
    request_timeout: Duration,
    request_id: Option<String>,
    http: reqwest::Client,
    _state: PhantomData<State>,
}

pub(crate) type AuthenticatedApiClient = ApiClient<Authenticated>;
pub(crate) type UnauthenticatedApiClient = ApiClient<Unauthenticated>;

enum AuthHeader<'a> {
    None,
    Bearer(&'a str),
}

impl<State> ApiClient<State> {
    pub(crate) fn cli(&self) -> &GeneratedCliClient {
        &self.cli
    }
}

impl<State> ApiClient<State> {
    pub(crate) fn http(&self) -> &reqwest::Client {
        &self.http
    }

    pub(crate) fn app_url(&self, path: &str) -> String {
        let normalized_path = if path.starts_with('/') {
            path.to_owned()
        } else {
            format!("/{path}")
        };

        format!(
            "{}{}",
            self.base_url.as_str().trim_end_matches('/'),
            normalized_path
        )
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
    #[cfg(test)]
    pub(crate) fn new(
        base_url: &str,
        request_timeout_sec: u64,
        token: &str,
    ) -> Result<Self, ApiClientBuildFailure> {
        Self::new_with_timeout_and_request_id(
            base_url,
            Duration::from_secs(request_timeout_sec),
            token,
            None,
        )
    }

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
        Url::parse(base_url).map_err(|url_error| ApiClientBuildFailure::InvalidBaseUrl {
            base_url: base_url.to_owned(),
            message: url_error.to_string(),
        })?;
    let normalized_root = normalized_api_root(base_url.path()).to_owned();
    base_url.set_path(if normalized_root.is_empty() {
        "/"
    } else {
        normalized_root.as_str()
    });
    base_url.set_query(None);
    base_url.set_fragment(None);

    let mut headers = HeaderMap::new();
    if let AuthHeader::Bearer(raw_token) = auth_header {
        let trimmed_token = raw_token.trim();
        if trimmed_token.is_empty() {
            return Err(ApiClientBuildFailure::InvalidAuthToken {
                message: "auth token must not be empty".to_owned(),
            });
        }

        let bearer = format!("Bearer {trimmed_token}");
        let value = HeaderValue::from_str(&bearer).map_err(|header_error| {
            ApiClientBuildFailure::InvalidAuthToken {
                message: header_error.to_string(),
            }
        })?;
        headers.insert(AUTHORIZATION, value);
    }

    if let Some(request_id) = request_id.map(str::trim).filter(|value| !value.is_empty()) {
        let value = HeaderValue::from_str(request_id).map_err(|header_error| {
            ApiClientBuildFailure::InvalidRequestId {
                message: header_error.to_string(),
            }
        })?;
        headers.insert(HeaderName::from_static("x-request-id"), value);
    }

    let http = reqwest::Client::builder()
        .timeout(request_timeout)
        .default_headers(headers)
        .build()
        .map_err(|client_error| ApiClientBuildFailure::HttpClient {
            message: client_error.to_string(),
        })?;
    let http_for_cli = http.clone();
    let cli = GeneratedCliClient::new_with_client(cli_base_url(&base_url).as_str(), http_for_cli);

    Ok(ApiClient {
        base_url,
        cli,
        request_timeout,
        request_id: request_id.map(ToOwned::to_owned),
        http,
        _state: PhantomData,
    })
}

fn cli_base_url(base_url: &Url) -> String {
    let mut cli_url = base_url.clone();
    cli_url.set_path(match normalized_api_root(base_url.path()) {
        "" => CLI_BASE_PATH,
        _ => return format!("{}{CLI_BASE_PATH}", base_url.as_str().trim_end_matches('/')),
    });
    cli_url.set_query(None);
    cli_url.set_fragment(None);
    cli_url.to_string().trim_end_matches('/').to_owned()
}

fn normalized_api_root(base_path: &str) -> &str {
    let normalized_base = base_path.trim_end_matches('/');

    if normalized_base.is_empty() || normalized_base == "/" {
        return "";
    }

    if let Some(api_root) = normalized_base.strip_suffix(CLI_BASE_PATH) {
        return api_root;
    }

    normalized_base
}

#[cfg(test)]
mod tests {
    use std::io::Read;
    use std::io::Write;
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::time::Duration;

    use pretty_assertions::assert_eq;
    use reqwest::header::AUTHORIZATION;
    use reqwest::header::HeaderName;

    use super::ApiClient;
    use super::ApiClientBuildFailure;
    use super::AuthenticatedApiClient;
    use super::UnauthenticatedApiClient;

    #[tokio::test]
    async fn unauthenticated_client_does_not_attach_authorization_header() {
        let client = UnauthenticatedApiClient::new("http://example.test", 5)
            .expect("expected unauthenticated client");

        assert_eq!(capture_request_header(&client, AUTHORIZATION).await, None);
    }

    #[tokio::test]
    async fn authenticated_client_attaches_authorization_header() {
        let client = AuthenticatedApiClient::new("http://example.test", 5, "pat_123")
            .expect("expected authenticated client");

        assert_eq!(
            capture_request_header(&client, AUTHORIZATION)
                .await
                .as_deref(),
            Some("Bearer pat_123")
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
            ApiClientBuildFailure::InvalidAuthToken {
                message: "auth token must not be empty".to_owned(),
            }
        );
    }

    #[tokio::test]
    async fn unauthenticated_client_attaches_request_id_when_configured() {
        let client = UnauthenticatedApiClient::new_with_timeout_and_request_id(
            "http://example.test",
            Duration::from_secs(5),
            Some("req_cli_123"),
        )
        .expect("expected unauthenticated client with request ID");

        assert_eq!(
            capture_request_header(&client, HeaderName::from_static("x-request-id"))
                .await
                .as_deref(),
            Some("req_cli_123")
        );
    }

    #[tokio::test]
    async fn authenticate_preserves_request_id_header() {
        let client = UnauthenticatedApiClient::new_with_timeout_and_request_id(
            "http://example.test",
            Duration::from_secs(5),
            Some("req_cli_123"),
        )
        .expect("expected unauthenticated client with request ID");
        let authenticated = client
            .authenticate("pat_123")
            .expect("expected authenticated client");

        assert_eq!(
            capture_request_header(&authenticated, HeaderName::from_static("x-request-id"))
                .await
                .as_deref(),
            Some("req_cli_123")
        );
    }

    #[test]
    fn unauthenticated_client_rejects_invalid_request_id_headers() {
        assert_eq!(
            UnauthenticatedApiClient::new_with_timeout_and_request_id(
                "http://example.test",
                Duration::from_secs(5),
                Some("bad\nid"),
            )
            .expect_err("expected invalid request ID"),
            ApiClientBuildFailure::InvalidRequestId {
                message: "failed to parse header value".to_owned(),
            }
        );
    }

    async fn capture_request_header<State>(
        client: &ApiClient<State>,
        header_name: HeaderName,
    ) -> Option<String> {
        let listener =
            TcpListener::bind("127.0.0.1:0").expect("expected test TCP listener to bind");
        let address = listener
            .local_addr()
            .expect("expected test listener address");
        let (request_tx, request_rx) = mpsc::channel();

        std::thread::spawn(move || {
            let (mut stream, _) = listener
                .accept()
                .expect("expected request to connect to test listener");

            let mut request_bytes = Vec::new();
            let mut chunk = [0_u8; 1024];
            loop {
                let read = stream
                    .read(&mut chunk)
                    .expect("expected request bytes from client");
                if read == 0 {
                    break;
                }

                request_bytes.extend_from_slice(&chunk[..read]);
                if request_bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }

            request_tx
                .send(String::from_utf8_lossy(&request_bytes).into_owned())
                .expect("expected request receiver");

            let response = "HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\nok";
            stream
                .write_all(response.as_bytes())
                .expect("expected test response write");
        });

        let request_url = format!("http://{address}");
        client
            .http()
            .get(request_url)
            .send()
            .await
            .expect("expected request send");

        request_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("expected captured request")
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                if name.eq_ignore_ascii_case(header_name.as_str()) {
                    Some(value.trim().to_owned())
                } else {
                    None
                }
            })
    }
}
