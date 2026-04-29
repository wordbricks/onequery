use serde::Deserialize;

use crate::transport::api_failure::ApiFailure;
use crate::transport::api_failure::ApiSuccess;
use crate::transport::api_failure::decode_failure;
use crate::transport::api_failure::failure_from_connect;
use crate::transport::api_failure::success_response_request_id;
use crate::transport::api_failure::try_into_value;
use crate::transport::client::AuthenticatedApiClient;
use crate::transport::client::UnauthenticatedApiClient;
use crate::transport::generated::types;
use crate::transport::well_known::required_duration_ms;
use onequery_core::error::ErrorStage;

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
    Pending { poll_after_ms: u64 },
    RateLimited { poll_after_ms: u64 },
    Denied,
    Expired,
    Authorized { access_token: String },
}

pub(crate) async fn start_login_session(
    client: &UnauthenticatedApiClient,
) -> Result<ApiSuccess<LoginSession>, ApiFailure> {
    let response = match client
        .auth()
        .start_device_authorization(types::StartDeviceAuthorizationRequest::default())
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(error, ErrorStage::Auth));
        }
    };

    let request_id = success_response_request_id(&response);
    let payload = response.into_owned();

    Ok(ApiSuccess {
        payload: login_session_from_generated(payload, request_id.clone())?,
        request_id,
    })
}

pub(crate) async fn poll_login_session(
    client: &UnauthenticatedApiClient,
    session: &LoginSession,
) -> Result<ApiSuccess<LoginPollOutcome>, ApiFailure> {
    let body = types::PollDeviceAuthorizationRequest {
        device_code: Some(try_into_value(
            session.device_code.as_str(),
            ErrorStage::Auth,
        )?),
        ..Default::default()
    };
    let response = match client.auth().poll_device_authorization(body).await {
        Ok(response) => response,
        Err(error) => return Err(failure_from_connect(error, ErrorStage::Auth)),
    };

    let request_id = success_response_request_id(&response);
    let payload = login_poll_outcome_from_generated(response.into_owned(), request_id.clone())?;

    Ok(ApiSuccess {
        payload,
        request_id,
    })
}

pub(crate) async fn whoami(
    client: &AuthenticatedApiClient,
) -> Result<ApiSuccess<WhoAmI>, ApiFailure> {
    let response = match client
        .auth()
        .get_session(types::GetSessionRequest::default())
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(error, ErrorStage::Auth));
        }
    };
    let request_id = success_response_request_id(&response);

    Ok(ApiSuccess {
        payload: whoami_from_generated(response.into_owned(), request_id.clone())?,
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
    let response = match client
        .auth()
        .refresh_session(types::RefreshSessionRequest::default())
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(error, ErrorStage::Auth));
        }
    };
    let request_id = success_response_request_id(&response);

    Ok(ApiSuccess {
        payload: refreshed_auth_session_from_generated(response.into_owned(), request_id.clone())?,
        request_id,
    })
}

fn login_session_from_generated(
    response: types::StartDeviceAuthorizationResponse,
    request_id: Option<String>,
) -> Result<LoginSession, ApiFailure> {
    let expires_at = required_timestamp(
        response.expires_at.into_option(),
        "device authorization start response missing expiresAt",
        request_id.clone(),
    )?;
    let seconds_until_expiry = expires_at
        .signed_duration_since(chrono::Utc::now())
        .num_seconds()
        .max(0);
    let _poll_after_ms = required_duration_ms(
        response.poll_after,
        ErrorStage::Auth,
        "device authorization start response missing pollAfter",
        request_id.clone(),
    )?;

    Ok(LoginSession {
        device_code: required_auth_string(
            response.device_code,
            "device authorization start response missing deviceCode",
            request_id.clone(),
        )?,
        user_code: required_auth_string(
            response.user_code,
            "device authorization start response missing userCode",
            request_id.clone(),
        )?,
        verification_uri: required_auth_string(
            response.verification_url,
            "device authorization start response missing verificationUrl",
            request_id.clone(),
        )?,
        verification_uri_complete: required_auth_string(
            response.verification_complete_url,
            "device authorization start response missing verificationCompleteUrl",
            request_id,
        )?,
        expires_in_sec: u64::try_from(seconds_until_expiry).unwrap_or(0),
    })
}

fn login_poll_outcome_from_generated(
    response: types::PollDeviceAuthorizationResponse,
    request_id: Option<String>,
) -> Result<LoginPollOutcome, ApiFailure> {
    match response.outcome {
        Some(types::poll_device_authorization_response::Outcome::Pending(pending)) => {
            Ok(LoginPollOutcome::Pending {
                poll_after_ms: required_poll_after_ms(
                    pending.poll_after,
                    "device authorization poll response missing pollAfter",
                    request_id,
                )?,
            })
        }
        Some(types::poll_device_authorization_response::Outcome::Authorized(authorized)) => {
            Ok(LoginPollOutcome::Authorized {
                access_token: required_auth_string(
                    authorized.access_token,
                    "device authorization poll response missing accessToken",
                    request_id,
                )?,
            })
        }
        Some(types::poll_device_authorization_response::Outcome::Denied(_denied)) => {
            Ok(LoginPollOutcome::Denied)
        }
        Some(types::poll_device_authorization_response::Outcome::Expired(_expired)) => {
            Ok(LoginPollOutcome::Expired)
        }
        Some(types::poll_device_authorization_response::Outcome::RateLimited(rate_limited)) => {
            Ok(LoginPollOutcome::RateLimited {
                poll_after_ms: required_poll_after_ms(
                    rate_limited.poll_after,
                    "device authorization poll response missing pollAfter",
                    request_id,
                )?,
            })
        }
        None => Err(decode_failure(
            ErrorStage::Auth,
            "device authorization poll response missing outcome",
            request_id,
        )),
    }
}

fn required_poll_after_ms(
    value: buffa::MessageField<buffa_types::google::protobuf::Duration>,
    missing_message: &str,
    request_id: Option<String>,
) -> Result<u64, ApiFailure> {
    required_duration_ms(value, ErrorStage::Auth, missing_message, request_id)
}

fn whoami_from_generated(
    response: types::GetSessionResponse,
    request_id: Option<String>,
) -> Result<WhoAmI, ApiFailure> {
    let user = response.user.into_option().ok_or_else(|| {
        decode_failure(
            ErrorStage::Auth,
            "session response missing user payload",
            request_id.clone(),
        )
    })?;

    Ok(WhoAmI {
        auth_mode: auth_mode_from_generated(response.auth_mode),
        user: auth_user_from_response(user, "session response missing user", request_id)?,
        active_org: response.active_org_slug,
        issued_at: format_timestamp(response.issued_at.into_option()),
        expires_at: format_timestamp(response.expires_at.into_option()),
    })
}

fn refreshed_auth_session_from_generated(
    response: types::RefreshSessionResponse,
    request_id: Option<String>,
) -> Result<RefreshedAuthSession, ApiFailure> {
    let user = response.user.into_option().ok_or_else(|| {
        decode_failure(
            ErrorStage::Auth,
            "refresh session response missing user payload",
            request_id.clone(),
        )
    })?;

    Ok(RefreshedAuthSession {
        completion: LoginCompletion {
            access_token: required_auth_string(
                response.access_token,
                "refresh session response missing accessToken",
                request_id.clone(),
            )?,
            auth_mode: auth_mode_from_generated(response.auth_mode),
            user: auth_user_from_response(
                user,
                "refresh session response missing user",
                request_id,
            )?,
            issued_at: format_timestamp(response.issued_at.into_option()),
            expires_at: format_timestamp(response.expires_at.into_option()),
        },
        active_org: response.active_org_slug,
    })
}

fn auth_user_from_response(
    user: types::CliAuthUser,
    missing_field_prefix: &'static str,
    request_id: Option<String>,
) -> Result<UserProfile, ApiFailure> {
    user_profile_from_generated(
        user.id,
        user.email,
        user.display_name,
        missing_field_prefix,
        request_id,
    )
}

fn user_profile_from_generated(
    id: Option<String>,
    email: Option<String>,
    display_name: Option<String>,
    missing_field_prefix: &str,
    request_id: Option<String>,
) -> Result<UserProfile, ApiFailure> {
    Ok(UserProfile {
        id: required_auth_string(id, format!("{missing_field_prefix}.id"), request_id.clone())?,
        email: required_auth_string(
            email,
            format!("{missing_field_prefix}.email"),
            request_id.clone(),
        )?,
        display_name: required_auth_string(
            display_name,
            format!("{missing_field_prefix}.displayName"),
            request_id,
        )?,
    })
}

fn required_auth_string(
    value: Option<String>,
    missing_message: impl Into<String>,
    request_id: Option<String>,
) -> Result<String, ApiFailure> {
    match value {
        Some(value) if !value.is_empty() => Ok(value),
        _ => Err(decode_failure(
            ErrorStage::Auth,
            missing_message.into(),
            request_id,
        )),
    }
}

fn required_timestamp(
    timestamp: Option<buffa_types::google::protobuf::Timestamp>,
    missing_message: &str,
    request_id: Option<String>,
) -> Result<chrono::DateTime<chrono::Utc>, ApiFailure> {
    let timestamp = timestamp
        .ok_or_else(|| decode_failure(ErrorStage::Auth, missing_message, request_id.clone()))?;

    timestamp_to_datetime(&timestamp).ok_or_else(|| {
        decode_failure(
            ErrorStage::Auth,
            format!("{missing_message} with an invalid timestamp"),
            request_id,
        )
    })
}

fn timestamp_to_datetime(
    timestamp: &buffa_types::google::protobuf::Timestamp,
) -> Option<chrono::DateTime<chrono::Utc>> {
    u32::try_from(timestamp.nanos)
        .ok()
        .and_then(|nanos| chrono::DateTime::from_timestamp(timestamp.seconds, nanos))
}

fn auth_mode_from_generated(mode: Option<buffa::EnumValue<types::AuthMode>>) -> Option<String> {
    match mode.and_then(|mode| mode.as_known()) {
        Some(types::AuthMode::AUTH_MODE_BROWSER_SESSION) => Some("browser_session".to_owned()),
        Some(types::AuthMode::AUTH_MODE_BEARER_TOKEN) => Some("bearer_token".to_owned()),
        Some(types::AuthMode::AUTH_MODE_UNSPECIFIED) | None => None,
    }
}

fn format_timestamp(timestamp: Option<buffa_types::google::protobuf::Timestamp>) -> Option<String> {
    timestamp
        .as_ref()
        .and_then(timestamp_to_datetime)
        .map(|datetime| datetime.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::LoginPollOutcome;
    use super::LoginSession;
    use super::RefreshedAuthSession;
    use super::UserProfile;
    use super::WhoAmI;
    use super::auth_mode_from_generated;
    use super::login_poll_outcome_from_generated;
    use super::login_session_from_generated;
    use super::refreshed_auth_session_from_generated;
    use super::types;
    use super::whoami_from_generated;

    fn timestamp(seconds: i64) -> buffa_types::google::protobuf::Timestamp {
        buffa_types::google::protobuf::Timestamp {
            seconds,
            ..Default::default()
        }
    }

    fn duration_ms(value: u64) -> buffa_types::google::protobuf::Duration {
        buffa_types::google::protobuf::Duration {
            seconds: i64::try_from(value / 1_000).expect("test duration seconds fit in i64"),
            nanos: i32::try_from((value % 1_000) * 1_000_000)
                .expect("test duration nanos fit in i32"),
            ..Default::default()
        }
    }

    #[test]
    fn auth_mode_from_generated_maps_known_values_to_cli_strings() {
        assert_eq!(
            [
                auth_mode_from_generated(Some(types::AuthMode::AUTH_MODE_BROWSER_SESSION.into(),)),
                auth_mode_from_generated(Some(types::AuthMode::AUTH_MODE_BEARER_TOKEN.into(),)),
                auth_mode_from_generated(Some(types::AuthMode::AUTH_MODE_UNSPECIFIED.into(),)),
                auth_mode_from_generated(None),
            ],
            [
                Some("browser_session".to_owned()),
                Some("bearer_token".to_owned()),
                None,
                None,
            ]
        );
    }

    #[test]
    fn login_session_from_generated_maps_start_response() {
        let response = types::StartDeviceAuthorizationResponse {
            device_code: Some("device-code-123".to_owned()),
            user_code: Some("ABCD1234".to_owned()),
            verification_url: Some("https://example.test/device".to_owned()),
            verification_complete_url: Some(
                "https://example.test/device?user_code=ABCD1234".to_owned(),
            ),
            poll_after: buffa::MessageField::some(duration_ms(5_000)),
            expires_at: buffa::MessageField::some(timestamp(4_102_444_800)),
            ..Default::default()
        };

        let session = login_session_from_generated(response, Some("req_start".to_owned()))
            .expect("expected login session");

        assert_eq!(
            session,
            LoginSession {
                device_code: "device-code-123".to_owned(),
                user_code: "ABCD1234".to_owned(),
                verification_uri: "https://example.test/device".to_owned(),
                verification_uri_complete: "https://example.test/device?user_code=ABCD1234"
                    .to_owned(),
                expires_in_sec: session.expires_in_sec,
            }
        );
        assert!(session.expires_in_sec > 0);
    }

    #[test]
    fn login_poll_outcome_from_generated_maps_pending_response() {
        let pending = types::PollDeviceAuthorizationResponse {
            outcome: Some(types::poll_device_authorization_response::Outcome::Pending(
                Box::new(types::CliPendingDeviceAuthorization {
                    poll_after: buffa::MessageField::some(duration_ms(5_000)),
                    ..Default::default()
                }),
            )),
            ..Default::default()
        };

        assert_eq!(
            login_poll_outcome_from_generated(pending, Some("req_pending".to_owned()))
                .expect("expected pending outcome"),
            LoginPollOutcome::Pending {
                poll_after_ms: 5_000
            }
        );
    }

    #[test]
    fn login_poll_outcome_from_generated_maps_authorized_response() {
        let response = types::PollDeviceAuthorizationResponse {
            outcome: Some(
                types::poll_device_authorization_response::Outcome::Authorized(Box::new(
                    types::CliAuthorizedDeviceAuthorization {
                        access_token: Some("pat_123".to_owned()),
                        ..Default::default()
                    },
                )),
            ),
            ..Default::default()
        };

        assert_eq!(
            login_poll_outcome_from_generated(response, Some("req_poll".to_owned()))
                .expect("expected authorized outcome"),
            LoginPollOutcome::Authorized {
                access_token: "pat_123".to_owned(),
            }
        );
    }

    #[test]
    fn login_poll_outcome_from_generated_maps_terminal_and_rate_limited_outcomes() {
        let denied = types::PollDeviceAuthorizationResponse {
            outcome: Some(types::poll_device_authorization_response::Outcome::Denied(
                Box::new(types::CliDeniedDeviceAuthorization {
                    reason: Some("device authorization was denied".to_owned()),
                    ..Default::default()
                }),
            )),
            ..Default::default()
        };
        let expired = types::PollDeviceAuthorizationResponse {
            outcome: Some(types::poll_device_authorization_response::Outcome::Expired(
                Box::new(types::CliExpiredDeviceAuthorization {
                    reason: Some("device authorization session expired".to_owned()),
                    ..Default::default()
                }),
            )),
            ..Default::default()
        };
        let rate_limited = types::PollDeviceAuthorizationResponse {
            outcome: Some(
                types::poll_device_authorization_response::Outcome::RateLimited(Box::new(
                    types::CliRateLimitedDeviceAuthorization {
                        poll_after: buffa::MessageField::some(duration_ms(10_000)),
                        reason: Some("slow down".to_owned()),
                        ..Default::default()
                    },
                )),
            ),
            ..Default::default()
        };

        assert_eq!(
            [
                login_poll_outcome_from_generated(denied, Some("req_denied".to_owned()))
                    .expect("expected denied outcome"),
                login_poll_outcome_from_generated(expired, Some("req_expired".to_owned()))
                    .expect("expected expired outcome"),
                login_poll_outcome_from_generated(
                    rate_limited,
                    Some("req_rate_limited".to_owned()),
                )
                .expect("expected rate limited outcome"),
            ],
            [
                LoginPollOutcome::Denied,
                LoginPollOutcome::Expired,
                LoginPollOutcome::RateLimited {
                    poll_after_ms: 10_000
                },
            ]
        );
    }

    #[test]
    fn whoami_from_generated_maps_session_response() {
        let response = types::GetSessionResponse {
            auth_mode: Some(types::AuthMode::AUTH_MODE_BEARER_TOKEN.into()),
            user: buffa::MessageField::some(types::CliAuthUser {
                id: Some("user-1".to_owned()),
                email: Some("alice@example.com".to_owned()),
                display_name: Some("Alice".to_owned()),
                ..Default::default()
            }),
            active_org_slug: Some("acme".to_owned()),
            issued_at: buffa::MessageField::some(timestamp(1_773_100_800)),
            expires_at: buffa::MessageField::some(timestamp(1_773_705_600)),
            ..Default::default()
        };

        assert_eq!(
            whoami_from_generated(response, Some("req_whoami".to_owned()))
                .expect("expected session"),
            WhoAmI {
                auth_mode: Some("bearer_token".to_owned()),
                user: UserProfile {
                    id: "user-1".to_owned(),
                    email: "alice@example.com".to_owned(),
                    display_name: "Alice".to_owned(),
                },
                active_org: Some("acme".to_owned()),
                issued_at: Some("2026-03-10T00:00:00Z".to_owned()),
                expires_at: Some("2026-03-17T00:00:00Z".to_owned()),
            }
        );
    }

    #[test]
    fn refreshed_auth_session_from_generated_maps_refresh_response() {
        let response = types::RefreshSessionResponse {
            access_token: Some("session-token-refreshed".to_owned()),
            auth_mode: Some(types::AuthMode::AUTH_MODE_BEARER_TOKEN.into()),
            user: buffa::MessageField::some(types::CliAuthUser {
                id: Some("user-1".to_owned()),
                email: Some("alice@example.com".to_owned()),
                display_name: Some("Alice".to_owned()),
                ..Default::default()
            }),
            active_org_slug: Some("acme".to_owned()),
            issued_at: buffa::MessageField::some(timestamp(1_773_100_800)),
            expires_at: buffa::MessageField::some(timestamp(1_773_705_600)),
            ..Default::default()
        };

        assert_eq!(
            refreshed_auth_session_from_generated(response, Some("req_refresh".to_owned()))
                .expect("expected refresh payload"),
            RefreshedAuthSession {
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
            }
        );
    }
}
