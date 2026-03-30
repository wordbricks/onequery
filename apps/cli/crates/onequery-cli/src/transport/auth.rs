use reqwest::StatusCode;
use serde::Deserialize;

use crate::transport::client::AuthenticatedApiClient;
use crate::transport::client::UnauthenticatedApiClient;
use crate::transport::generated::types;
use crate::transport::http::ApiFailure;
use crate::transport::http::ApiProblem;
use crate::transport::http::ApiSuccess;
use crate::transport::http::ResponseFailureStages;
use crate::transport::http::decode_failure;
use crate::transport::http::failure_from_generated;
use crate::transport::http::response_request_id;
use crate::transport::http::try_into_value;
use onequery_cli_core::error::ErrorStage;

#[derive(Debug, Clone, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UserProfile {
    pub(crate) id: String,
    pub(crate) email: String,
    pub(crate) display_name: String,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct WhoAmI {
    pub(crate) auth_mode: Option<String>,
    pub(crate) user: UserProfile,
    pub(crate) active_org: Option<String>,
    pub(crate) issued_at: Option<String>,
    pub(crate) expires_at: Option<String>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct LoginSession {
    pub(crate) device_code: String,
    pub(crate) user_code: String,
    pub(crate) verification_uri: String,
    pub(crate) verification_uri_complete: String,
    pub(crate) poll_interval_ms: u64,
    pub(crate) expires_in_sec: u64,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct LoginCompletion {
    pub(crate) access_token: String,
    pub(crate) auth_mode: Option<String>,
    pub(crate) user: UserProfile,
    pub(crate) issued_at: Option<String>,
    pub(crate) expires_at: Option<String>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) enum LoginPollOutcome {
    Pending,
    SlowDown,
    Denied,
    Expired,
    Authorized { access_token: String },
}

pub(crate) async fn start_login_session(
    client: &UnauthenticatedApiClient,
) -> Result<ApiSuccess<LoginSession>, ApiFailure> {
    let response = match client.cli().cli_auth_device_authorization_start().await {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_generated(
                error,
                ResponseFailureStages::fixed(ErrorStage::Auth, ErrorStage::Auth),
            )
            .await);
        }
    };

    let request_id = response_request_id(response.headers());
    let payload = response.into_inner();
    let seconds_until_expiry = payload
        .data
        .expires_at
        .signed_duration_since(chrono::Utc::now())
        .num_seconds()
        .max(0);

    Ok(ApiSuccess {
        payload: LoginSession {
            device_code: payload.data.device_code.into(),
            user_code: payload.data.user_code.into(),
            verification_uri: payload.data.verification_url,
            verification_uri_complete: payload.data.verification_complete_url,
            poll_interval_ms: payload.data.poll_after_ms.get(),
            expires_in_sec: u64::try_from(seconds_until_expiry).unwrap_or(0),
        },
        request_id,
    })
}

pub(crate) async fn poll_login_session(
    client: &UnauthenticatedApiClient,
    session: &LoginSession,
) -> Result<ApiSuccess<LoginPollOutcome>, ApiFailure> {
    let body = types::CliAuthDeviceAuthorizationPollRequest {
        device_code: try_into_value(session.device_code.as_str(), ErrorStage::Auth)?,
    };
    let response = match client.cli().cli_auth_device_authorization_poll(&body).await {
        Ok(response) => Ok(response),
        Err(error) => Err(failure_from_generated(
            error,
            ResponseFailureStages::fixed(ErrorStage::Auth, ErrorStage::Auth),
        )
        .await),
    };

    match response {
        Ok(response) => {
            let request_id = response_request_id(response.headers());
            let payload = response.into_inner();
            let payload = match payload.data {
                types::CliAuthDeviceAuthorizationPollEnvelopeData::SuccessResponse(
                    types::CliAuthDeviceAuthorizationSuccessResponse { access_token, .. },
                ) => LoginPollOutcome::Authorized {
                    access_token: access_token.into(),
                },
                types::CliAuthDeviceAuthorizationPollEnvelopeData::PendingResponse(
                    types::CliAuthDeviceAuthorizationPendingResponse { poll_after_ms, .. },
                ) => {
                    if poll_after_ms.get() > session.poll_interval_ms {
                        LoginPollOutcome::SlowDown
                    } else {
                        LoginPollOutcome::Pending
                    }
                }
            };

            Ok(ApiSuccess {
                payload,
                request_id,
            })
        }
        Err(ApiFailure::Problem(problem)) => interpret_login_poll_problem(problem),
        Err(failure) => Err(failure),
    }
}

pub(crate) async fn whoami(
    client: &AuthenticatedApiClient,
) -> Result<ApiSuccess<WhoAmI>, ApiFailure> {
    // CONTEXT: Part 6 promotes session reads to the top-level `/session` route
    // rather than nesting them under `/auth`.
    let response = match client.cli().cli_session_read(None).await {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_generated(
                error,
                ResponseFailureStages::fixed(ErrorStage::Auth, ErrorStage::Auth),
            )
            .await);
        }
    };
    let request_id = response_request_id(response.headers());
    let payload = response.into_inner();
    let user = payload.data.user.ok_or_else(|| {
        decode_failure(
            ErrorStage::Auth,
            "session response missing user payload",
            request_id.clone(),
        )
    })?;

    Ok(ApiSuccess {
        payload: WhoAmI {
            auth_mode: payload
                .data
                .auth_mode
                .map(|auth_mode| auth_mode.to_string()),
            user: projected_user_from_response(user, request_id.clone())?,
            active_org: payload.data.active_org_slug.map(Into::into),
            issued_at: format_datetime(payload.data.issued_at),
            expires_at: format_datetime(payload.data.expires_at),
        },
        request_id,
    })
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct RefreshedAuthSession {
    pub(crate) completion: LoginCompletion,
    pub(crate) active_org: Option<String>,
}

pub(crate) async fn refresh_session(
    client: &AuthenticatedApiClient,
) -> Result<ApiSuccess<RefreshedAuthSession>, ApiFailure> {
    let response = match client.cli().cli_session_refresh().await {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_generated(
                error,
                ResponseFailureStages::fixed(ErrorStage::Auth, ErrorStage::Auth),
            )
            .await);
        }
    };
    let request_id = response_request_id(response.headers());
    let payload = response.into_inner();

    Ok(ApiSuccess {
        payload: RefreshedAuthSession {
            completion: LoginCompletion {
                access_token: payload.data.access_token.into(),
                auth_mode: Some(payload.data.auth_mode.to_string()),
                user: UserProfile {
                    id: payload.data.user.id,
                    email: payload.data.user.email,
                    display_name: payload.data.user.display_name,
                },
                issued_at: format_datetime(payload.data.issued_at),
                expires_at: format_datetime(payload.data.expires_at),
            },
            active_org: payload.data.active_org_slug.map(Into::into),
        },
        request_id,
    })
}

fn interpret_login_poll_problem(
    problem: ApiProblem,
) -> Result<ApiSuccess<LoginPollOutcome>, ApiFailure> {
    let payload = match (problem.status, problem.code.as_deref()) {
        (StatusCode::FORBIDDEN, Some("login_denied")) => LoginPollOutcome::Denied,
        (StatusCode::GONE, Some("login_session_expired")) => LoginPollOutcome::Expired,
        _ => return Err(ApiFailure::Problem(problem)),
    };

    Ok(ApiSuccess {
        payload,
        request_id: problem.request_id,
    })
}

fn projected_user_from_response(
    user: types::CliAuthSessionProjectedUser,
    request_id: Option<String>,
) -> Result<UserProfile, ApiFailure> {
    let missing_field = |field: &str| {
        decode_failure(
            ErrorStage::Auth,
            format!("session response missing user.{field}"),
            request_id.clone(),
        )
    };

    Ok(UserProfile {
        id: user.id.ok_or_else(|| missing_field("id"))?,
        email: user.email.ok_or_else(|| missing_field("email"))?,
        display_name: user
            .display_name
            .ok_or_else(|| missing_field("displayName"))?,
    })
}

fn format_datetime(datetime: Option<chrono::DateTime<chrono::Utc>>) -> Option<String> {
    datetime.map(|datetime| datetime.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

#[cfg(test)]
mod tests {
    use std::io::Read;
    use std::io::Write;
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::time::Duration;

    use pretty_assertions::assert_eq;
    use reqwest::StatusCode;
    use serde_json::json;
    use serde_json::to_string;
    use time::Duration as TimeDuration;
    use time::OffsetDateTime;
    use time::format_description::well_known::Rfc3339;

    use crate::transport::client::AuthenticatedApiClient;
    use crate::transport::client::UnauthenticatedApiClient;
    use crate::transport::http::ApiFailure;
    use crate::transport::http::ApiProblem;
    use crate::transport::http::ApiSuccess;
    use onequery_cli_core::error::ErrorStage;

    use super::LoginPollOutcome;
    use super::LoginSession;
    use super::RefreshedAuthSession;
    use super::UserProfile;
    use super::WhoAmI;
    use super::poll_login_session;
    use super::refresh_session;
    use super::start_login_session;
    use super::whoami;

    fn sample_session() -> LoginSession {
        LoginSession {
            device_code: "device-code-123".to_owned(),
            user_code: "ABCD1234".to_owned(),
            verification_uri: "https://example.test/device".to_owned(),
            verification_uri_complete: "https://example.test/device?user_code=ABCD1234".to_owned(),
            poll_interval_ms: 5_000,
            expires_in_sec: 180,
        }
    }

    fn future_expires_at(seconds_from_now: i64) -> String {
        (OffsetDateTime::now_utc() + TimeDuration::seconds(seconds_from_now))
            .format(&Rfc3339)
            .expect("expected RFC3339 timestamp")
    }

    fn success_envelope(request_id: &str, data: serde_json::Value) -> String {
        json!({
            "requestId": request_id,
            "data": data,
            "warnings": [],
        })
        .to_string()
    }

    #[tokio::test]
    async fn start_login_session_uses_device_authorization_endpoint() {
        let listener =
            TcpListener::bind("127.0.0.1:0").expect("expected test TCP listener to bind");
        let address = listener
            .local_addr()
            .expect("expected test listener address");
        let (request_tx, request_rx) = mpsc::channel();
        let expires_at = future_expires_at(180);

        std::thread::spawn(move || {
            let (mut stream, _) = listener
                .accept()
                .expect("expected CLI request to connect to test listener");

            let mut request_bytes = Vec::new();
            let mut chunk = [0_u8; 1024];
            loop {
                let read = stream
                    .read(&mut chunk)
                    .expect("expected request bytes from CLI");
                if read == 0 {
                    break;
                }

                request_bytes.extend_from_slice(&chunk[..read]);
                if request_bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }

            let request = String::from_utf8_lossy(&request_bytes).into_owned();
            request_tx
                .send(request)
                .expect("expected request receiver for start login");

            let response_body = success_envelope(
                "req_start",
                json!({
                    "state": "pending",
                    "deviceCode": "device-code-123",
                    "userCode": "ABCD1234",
                    "verificationUrl": "https://example.test/device",
                    "verificationCompleteUrl": "https://example.test/device?user_code=ABCD1234",
                    "pollAfterMs": 5000,
                    "expiresAt": expires_at,
                }),
            );
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .expect("expected response write to CLI");
        });

        let client = UnauthenticatedApiClient::new(&format!("http://{address}"), 5)
            .expect("expected API client");

        let session = start_login_session(&client)
            .await
            .expect("expected device authorization response")
            .payload;
        let request = request_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("expected captured request");

        assert_eq!(
            (
                request.lines().next(),
                session.device_code,
                session.user_code,
                session.verification_uri,
                session.verification_uri_complete,
                session.poll_interval_ms,
                session.expires_in_sec >= 179,
            ),
            (
                Some("POST /api/cli/auth/device-authorizations HTTP/1.1"),
                "device-code-123".to_owned(),
                "ABCD1234".to_owned(),
                "https://example.test/device".to_owned(),
                "https://example.test/device?user_code=ABCD1234".to_owned(),
                5_000,
                true,
            )
        );
    }

    #[tokio::test]
    async fn start_login_session_rewrites_cli_stemmed_base_url_to_auth_endpoint() {
        let listener =
            TcpListener::bind("127.0.0.1:0").expect("expected test TCP listener to bind");
        let address = listener
            .local_addr()
            .expect("expected test listener address");
        let (request_tx, request_rx) = mpsc::channel();

        std::thread::spawn(move || {
            let (mut stream, _) = listener
                .accept()
                .expect("expected CLI request to connect to test listener");

            let mut request_bytes = Vec::new();
            let mut chunk = [0_u8; 1024];
            loop {
                let read = stream
                    .read(&mut chunk)
                    .expect("expected request bytes from CLI");
                if read == 0 {
                    break;
                }

                request_bytes.extend_from_slice(&chunk[..read]);
                if request_bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }

            let request = String::from_utf8_lossy(&request_bytes).into_owned();
            request_tx
                .send(request)
                .expect("expected request receiver for start login");

            let response_body = success_envelope(
                "req_start",
                json!({
                    "state": "pending",
                    "deviceCode": "device-code-123",
                    "userCode": "ABCD1234",
                    "verificationUrl": "https://example.test/device",
                    "verificationCompleteUrl": "https://example.test/device?user_code=ABCD1234",
                    "pollAfterMs": 5000,
                    "expiresAt": future_expires_at(180),
                }),
            );
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .expect("expected response write to CLI");
        });

        let client = UnauthenticatedApiClient::new(&format!("http://{address}/api/cli"), 5)
            .expect("expected API client");

        start_login_session(&client)
            .await
            .expect("expected device authorization response");

        let request = request_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("expected captured request");
        assert_eq!(
            request.lines().next(),
            Some("POST /api/cli/auth/device-authorizations HTTP/1.1")
        );
    }

    #[tokio::test]
    async fn poll_login_session_uses_device_authorization_poll_endpoint() {
        let listener =
            TcpListener::bind("127.0.0.1:0").expect("expected test TCP listener to bind");
        let address = listener
            .local_addr()
            .expect("expected test listener address");
        let (request_tx, request_rx) = mpsc::channel();

        std::thread::spawn(move || {
            let (mut stream, _) = listener
                .accept()
                .expect("expected CLI request to connect to test listener");

            let mut request_bytes = Vec::new();
            let mut chunk = [0_u8; 1024];
            loop {
                let read = stream
                    .read(&mut chunk)
                    .expect("expected request bytes from CLI");
                if read == 0 {
                    break;
                }

                request_bytes.extend_from_slice(&chunk[..read]);
                if request_bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }

            let request = String::from_utf8_lossy(&request_bytes).into_owned();
            request_tx
                .send(request)
                .expect("expected request receiver for poll login");

            let response_body = success_envelope(
                "req_poll",
                json!({
                    "state": "authorized",
                    "accessToken": "pat_123",
                    "authMode": "bearer_token",
                    "user": {
                        "id": "user-1",
                        "email": "alice@example.com",
                        "displayName": "Alice",
                    },
                    "activeOrgSlug": "acme",
                    "issuedAt": "2026-03-10T00:00:00.000Z",
                    "expiresAt": "2026-03-17T00:00:00.000Z",
                }),
            );
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nx-request-id: req_poll\r\nconnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .expect("expected response write to CLI");
        });

        let client = UnauthenticatedApiClient::new(&format!("http://{address}"), 5)
            .expect("expected API client");

        let response = poll_login_session(&client, &sample_session())
            .await
            .expect("expected authorized poll response");
        let request = request_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("expected captured request");

        assert_eq!(
            (
                response,
                request.lines().next(),
                request.contains("\"deviceCode\":\"device-code-123\""),
            ),
            (
                ApiSuccess {
                    payload: LoginPollOutcome::Authorized {
                        access_token: "pat_123".to_owned(),
                    },
                    request_id: Some("req_poll".to_owned()),
                },
                Some("POST /api/cli/auth/device-authorizations:poll HTTP/1.1"),
                true,
            )
        );
    }

    #[tokio::test]
    async fn poll_login_session_maps_pending_response_to_pending_outcome() {
        let listener =
            TcpListener::bind("127.0.0.1:0").expect("expected test TCP listener to bind");
        let address = listener
            .local_addr()
            .expect("expected test listener address");

        std::thread::spawn(move || {
            let (mut stream, _) = listener
                .accept()
                .expect("expected CLI request to connect to test listener");

            let mut request_bytes = Vec::new();
            let mut chunk = [0_u8; 1024];
            loop {
                let read = stream
                    .read(&mut chunk)
                    .expect("expected request bytes from CLI");
                if read == 0 {
                    break;
                }

                request_bytes.extend_from_slice(&chunk[..read]);
                if request_bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }

            let response_body = success_envelope(
                "req_pending",
                json!({
                    "state": "pending",
                    "pollAfterMs": 5000,
                }),
            );
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nx-request-id: req_pending\r\nconnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .expect("expected response write to CLI");
        });

        let client = UnauthenticatedApiClient::new(&format!("http://{address}"), 5)
            .expect("expected API client");

        let response = poll_login_session(&client, &sample_session())
            .await
            .expect("expected pending poll response");

        assert_eq!(
            response,
            ApiSuccess {
                payload: LoginPollOutcome::Pending,
                request_id: Some("req_pending".to_owned()),
            }
        );
    }

    #[tokio::test]
    async fn poll_login_session_maps_larger_pending_delay_to_slow_down_outcome() {
        let listener =
            TcpListener::bind("127.0.0.1:0").expect("expected test TCP listener to bind");
        let address = listener
            .local_addr()
            .expect("expected test listener address");

        std::thread::spawn(move || {
            let (mut stream, _) = listener
                .accept()
                .expect("expected CLI request to connect to test listener");

            let mut request_bytes = Vec::new();
            let mut chunk = [0_u8; 1024];
            loop {
                let read = stream
                    .read(&mut chunk)
                    .expect("expected request bytes from CLI");
                if read == 0 {
                    break;
                }

                request_bytes.extend_from_slice(&chunk[..read]);
                if request_bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }

            let response_body = success_envelope(
                "req_slow",
                json!({
                    "state": "pending",
                    "pollAfterMs": 10000,
                }),
            );
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nx-request-id: req_slow\r\nconnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .expect("expected response write to CLI");
        });

        let client = UnauthenticatedApiClient::new(&format!("http://{address}"), 5)
            .expect("expected API client");

        let response = poll_login_session(&client, &sample_session())
            .await
            .expect("expected slow_down poll response");

        assert_eq!(
            response,
            ApiSuccess {
                payload: LoginPollOutcome::SlowDown,
                request_id: Some("req_slow".to_owned()),
            }
        );
    }

    #[tokio::test]
    async fn poll_login_session_maps_login_denied_problem_to_denied_outcome() {
        let listener =
            TcpListener::bind("127.0.0.1:0").expect("expected test TCP listener to bind");
        let address = listener
            .local_addr()
            .expect("expected test listener address");

        std::thread::spawn(move || {
            let (mut stream, _) = listener
                .accept()
                .expect("expected CLI request to connect to test listener");

            let mut request_bytes = Vec::new();
            let mut chunk = [0_u8; 1024];
            loop {
                let read = stream
                    .read(&mut chunk)
                    .expect("expected request bytes from CLI");
                if read == 0 {
                    break;
                }

                request_bytes.extend_from_slice(&chunk[..read]);
                if request_bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }

            let response_body = r#"{"type":"https://onequery.invalid/problems/cli/login-denied","title":"Login Denied","status":403,"detail":"device authorization was denied","code":"login_denied","stage":"auth","requestId":"req_denied","retryable":false}"#;
            let response = format!(
                "HTTP/1.1 403 Forbidden\r\ncontent-type: application/json\r\ncontent-length: {}\r\nx-request-id: req_denied\r\nconnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .expect("expected response write to CLI");
        });

        let client = UnauthenticatedApiClient::new(&format!("http://{address}"), 5)
            .expect("expected API client");

        let response = poll_login_session(&client, &sample_session())
            .await
            .expect("expected denied poll response");

        assert_eq!(
            response,
            ApiSuccess {
                payload: LoginPollOutcome::Denied,
                request_id: Some("req_denied".to_owned()),
            }
        );
    }

    #[tokio::test]
    async fn poll_login_session_preserves_rate_limited_problem_failures() {
        let listener =
            TcpListener::bind("127.0.0.1:0").expect("expected test TCP listener to bind");
        let address = listener
            .local_addr()
            .expect("expected test listener address");

        std::thread::spawn(move || {
            let (mut stream, _) = listener
                .accept()
                .expect("expected CLI request to connect to test listener");

            let mut request_bytes = Vec::new();
            let mut chunk = [0_u8; 1024];
            loop {
                let read = stream
                    .read(&mut chunk)
                    .expect("expected request bytes from CLI");
                if read == 0 {
                    break;
                }

                request_bytes.extend_from_slice(&chunk[..read]);
                if request_bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }

            let response_body = r#"{"type":"https://onequery.invalid/problems/cli/login-rate-limited","title":"Login Rate Limited","status":429,"detail":"polling is temporarily rate limited","code":"login_rate_limited","stage":"auth","requestId":"req_rate_limited","retryable":true,"retryAfterMs":10000}"#;
            let response = format!(
                "HTTP/1.1 429 Too Many Requests\r\ncontent-type: application/json\r\ncontent-length: {}\r\nx-request-id: req_rate_limited\r\nconnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .expect("expected response write to CLI");
        });

        let client = UnauthenticatedApiClient::new(&format!("http://{address}"), 5)
            .expect("expected API client");

        let expected_raw_body = to_string(&super::types::CliProblem {
            code: super::types::CliProblemCode::LoginRateLimited,
            detail: Some("polling is temporarily rate limited".to_owned()),
            errors: Vec::new(),
            hint: None,
            instance: None,
            request_id: super::types::CliProblemRequestId::try_from("req_rate_limited".to_owned())
                .expect("expected request id"),
            retry_after_ms: Some(
                std::num::NonZeroU64::new(10_000).expect("expected non-zero retry delay"),
            ),
            retryable: true,
            stage: super::types::CliProblemStage::Auth,
            status: 429,
            title: "Login Rate Limited".to_owned(),
            type_: "https://onequery.invalid/problems/cli/login-rate-limited".to_owned(),
        })
        .expect("expected canonical problem JSON");

        let failure = poll_login_session(&client, &sample_session())
            .await
            .expect_err("expected rate-limited poll response to remain a problem failure");

        assert_eq!(
            failure,
            ApiFailure::Problem(ApiProblem {
                status: StatusCode::TOO_MANY_REQUESTS,
                problem_type: Some(
                    "https://onequery.invalid/problems/cli/login-rate-limited".to_owned(),
                ),
                title: Some("Login Rate Limited".to_owned()),
                detail: Some("polling is temporarily rate limited".to_owned()),
                code: Some("login_rate_limited".to_owned()),
                retryable: true,
                stage: ErrorStage::Auth,
                hint: None,
                request_id: Some("req_rate_limited".to_owned()),
                validation_issues: Vec::new(),
                raw_body: expected_raw_body,
            })
        );
    }

    #[tokio::test]
    async fn whoami_decodes_active_org_and_request_id() {
        let listener =
            TcpListener::bind("127.0.0.1:0").expect("expected test TCP listener to bind");
        let address = listener
            .local_addr()
            .expect("expected test listener address");
        let (request_line_tx, request_line_rx) = mpsc::channel();

        std::thread::spawn(move || {
            let (mut stream, _) = listener
                .accept()
                .expect("expected CLI request to connect to test listener");

            let mut request_bytes = Vec::new();
            let mut chunk = [0_u8; 1024];
            loop {
                let read = stream
                    .read(&mut chunk)
                    .expect("expected request bytes from CLI");
                if read == 0 {
                    break;
                }

                request_bytes.extend_from_slice(&chunk[..read]);
                if request_bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }

            let request = String::from_utf8_lossy(&request_bytes);
            let request_line = request
                .lines()
                .next()
                .expect("expected HTTP request line")
                .to_owned();
            request_line_tx
                .send(request_line)
                .expect("expected request line receiver");

            let response_body = success_envelope(
                "req_whoami",
                json!({
                    "authMode": "bearer_token",
                    "user": {
                        "id": "user-1",
                        "email": "alice@example.com",
                        "displayName": "Alice",
                    },
                    "activeOrgSlug": "acme",
                    "issuedAt": "2026-03-10T00:00:00.000Z",
                    "expiresAt": "2026-03-17T00:00:00.000Z",
                }),
            );
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nx-request-id: req_whoami\r\nconnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .expect("expected response write to CLI");
        });

        let client = AuthenticatedApiClient::new(&format!("http://{address}"), 5, "pat_123")
            .expect("expected API client");

        let response = whoami(&client).await.expect("expected whoami response");
        let request_line = request_line_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("expected captured request line");

        assert_eq!(
            (response, request_line),
            (
                ApiSuccess {
                    payload: WhoAmI {
                        auth_mode: Some("bearer_token".to_owned()),
                        user: UserProfile {
                            id: "user-1".to_owned(),
                            email: "alice@example.com".to_owned(),
                            display_name: "Alice".to_owned(),
                        },
                        active_org: Some("acme".to_owned()),
                        issued_at: Some("2026-03-10T00:00:00Z".to_owned()),
                        expires_at: Some("2026-03-17T00:00:00Z".to_owned()),
                    },
                    request_id: Some("req_whoami".to_owned()),
                },
                "GET /api/cli/session HTTP/1.1".to_owned(),
            )
        );
    }

    #[tokio::test]
    async fn refresh_session_uses_explicit_refresh_endpoint_and_decodes_session_metadata() {
        let listener =
            TcpListener::bind("127.0.0.1:0").expect("expected test TCP listener to bind");
        let address = listener
            .local_addr()
            .expect("expected test listener address");
        let (request_line_tx, request_line_rx) = mpsc::channel();

        std::thread::spawn(move || {
            let (mut stream, _) = listener
                .accept()
                .expect("expected CLI request to connect to test listener");

            let mut request_bytes = Vec::new();
            let mut chunk = [0_u8; 1024];
            loop {
                let read = stream
                    .read(&mut chunk)
                    .expect("expected request bytes from CLI");
                if read == 0 {
                    break;
                }

                request_bytes.extend_from_slice(&chunk[..read]);
                if request_bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }

            let request = String::from_utf8_lossy(&request_bytes);
            let request_line = request
                .lines()
                .next()
                .expect("expected HTTP request line")
                .to_owned();
            request_line_tx
                .send(request_line)
                .expect("expected request line receiver");

            let response_body = success_envelope(
                "req_refresh",
                json!({
                    "accessToken": "session-token-refreshed",
                    "authMode": "bearer_token",
                    "user": {
                        "id": "user-1",
                        "email": "alice@example.com",
                        "displayName": "Alice",
                    },
                    "activeOrgSlug": "acme",
                    "issuedAt": "2026-03-10T00:00:00.000Z",
                    "expiresAt": "2026-03-17T00:00:00.000Z",
                }),
            );
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nx-request-id: req_refresh\r\nconnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .expect("expected response write to CLI");
        });

        let client = AuthenticatedApiClient::new(&format!("http://{address}"), 5, "pat_123")
            .expect("expected API client");

        let response = refresh_session(&client)
            .await
            .expect("expected refreshed session response");
        let request_line = request_line_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("expected captured request line");

        assert_eq!(
            (response, request_line),
            (
                ApiSuccess {
                    payload: RefreshedAuthSession {
                        completion: super::LoginCompletion {
                            access_token: "session-token-refreshed".to_owned(),
                            auth_mode: Some("bearer_token".to_owned()),
                            user: UserProfile {
                                id: "user-1".to_owned(),
                                email: "alice@example.com".to_owned(),
                                display_name: "Alice".to_owned(),
                            },
                            issued_at: Some("2026-03-10T00:00:00Z".to_owned()),
                            expires_at: Some("2026-03-17T00:00:00Z".to_owned()),
                        },
                        active_org: Some("acme".to_owned()),
                    },
                    request_id: Some("req_refresh".to_owned()),
                },
                "POST /api/cli/session:refresh HTTP/1.1".to_owned(),
            )
        );
    }
}
