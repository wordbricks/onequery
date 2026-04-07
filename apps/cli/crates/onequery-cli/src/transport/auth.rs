use serde::Deserialize;

use crate::transport::client::AuthenticatedApiClient;
use crate::transport::client::UnauthenticatedApiClient;
use crate::transport::generated::types;
use crate::transport::http::ApiFailure;
use crate::transport::http::ApiProblem;
use crate::transport::http::ApiSuccess;
use crate::transport::http::ResponseFailureStages;
use crate::transport::http::decode_failure;
use crate::transport::http::failure_from_connect;
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
    let response = match client
        .cli()
        .start_device_authorization(types::StartDeviceAuthorizationRequest::default())
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(
                error,
                ResponseFailureStages::fixed(ErrorStage::Auth),
            ));
        }
    };

    let request_id = response_request_id(response.headers());
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
        device_code: try_into_value(session.device_code.as_str(), ErrorStage::Auth)?,
        ..Default::default()
    };
    let response = match client.cli().poll_device_authorization(body).await {
        Ok(response) => Ok(response),
        Err(error) => Err(failure_from_connect(
            error,
            ResponseFailureStages::fixed(ErrorStage::Auth),
        )),
    };

    match response {
        Ok(response) => {
            let request_id = response_request_id(response.headers());
            let payload = login_poll_outcome_from_generated(
                response.into_owned(),
                session.poll_interval_ms,
                request_id.clone(),
            )?;

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
    let response = match client
        .cli()
        .get_session(types::GetSessionRequest::default())
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(
                error,
                ResponseFailureStages::fixed(ErrorStage::Auth),
            ));
        }
    };
    let request_id = response_request_id(response.headers());

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
        .cli()
        .refresh_session(types::RefreshSessionRequest::default())
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return Err(failure_from_connect(
                error,
                ResponseFailureStages::fixed(ErrorStage::Auth),
            ));
        }
    };
    let request_id = response_request_id(response.headers());

    Ok(ApiSuccess {
        payload: refreshed_auth_session_from_generated(response.into_owned(), request_id.clone())?,
        request_id,
    })
}

fn interpret_login_poll_problem(
    problem: ApiProblem,
) -> Result<ApiSuccess<LoginPollOutcome>, ApiFailure> {
    let payload = match problem.connect_code {
        Some(connectrpc::ErrorCode::PermissionDenied) => LoginPollOutcome::Denied,
        Some(connectrpc::ErrorCode::FailedPrecondition) => LoginPollOutcome::Expired,
        Some(_) => return Err(ApiFailure::Problem(problem)),
        None => match problem.code.as_deref() {
            Some("permission_denied") => LoginPollOutcome::Denied,
            Some("failed_precondition") => LoginPollOutcome::Expired,
            _ => return Err(ApiFailure::Problem(problem)),
        },
    };

    Ok(ApiSuccess {
        payload,
        request_id: problem.request_id,
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
        poll_interval_ms: u64::from(response.poll_after_ms),
        expires_in_sec: u64::try_from(seconds_until_expiry).unwrap_or(0),
    })
}

fn login_poll_outcome_from_generated(
    response: types::PollDeviceAuthorizationResponse,
    poll_interval_ms: u64,
    request_id: Option<String>,
) -> Result<LoginPollOutcome, ApiFailure> {
    match response.outcome {
        Some(types::poll_device_authorization_response::Outcome::Pending(pending)) => {
            if u64::from(pending.poll_after_ms) > poll_interval_ms {
                Ok(LoginPollOutcome::SlowDown)
            } else {
                Ok(LoginPollOutcome::Pending)
            }
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
        None => Err(decode_failure(
            ErrorStage::Auth,
            "device authorization poll response missing outcome",
            request_id,
        )),
    }
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
        active_org: non_empty_option(response.active_org_slug),
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
        active_org: non_empty_option(response.active_org_slug),
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
    id: String,
    email: String,
    display_name: String,
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
    value: String,
    missing_message: impl Into<String>,
    request_id: Option<String>,
) -> Result<String, ApiFailure> {
    if value.is_empty() {
        Err(decode_failure(
            ErrorStage::Auth,
            missing_message.into(),
            request_id,
        ))
    } else {
        Ok(value)
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

fn auth_mode_from_generated(mode: buffa::EnumValue<types::CliAuthMode>) -> Option<String> {
    match mode.as_known() {
        Some(types::CliAuthMode::CLI_AUTH_MODE_BROWSER_SESSION) => {
            Some("browser_session".to_owned())
        }
        Some(types::CliAuthMode::CLI_AUTH_MODE_BEARER_TOKEN) => Some("bearer_token".to_owned()),
        Some(types::CliAuthMode::CLI_AUTH_MODE_UNSPECIFIED) | None => None,
    }
}

fn non_empty_option(value: Option<String>) -> Option<String> {
    value.filter(|value| !value.is_empty())
}

fn format_timestamp(timestamp: Option<buffa_types::google::protobuf::Timestamp>) -> Option<String> {
    timestamp
        .as_ref()
        .and_then(timestamp_to_datetime)
        .map(|datetime| datetime.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

#[cfg(test)]
mod tests {
    use crate::transport::http::ApiFailure;
    use crate::transport::http::ApiProblem;
    use crate::transport::http::ApiSuccess;
    use onequery_cli_core::error::ErrorStage;
    use pretty_assertions::assert_eq;

    use super::LoginPollOutcome;
    use super::LoginSession;
    use super::RefreshedAuthSession;
    use super::UserProfile;
    use super::WhoAmI;
    use super::auth_mode_from_generated;
    use super::interpret_login_poll_problem;
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

    #[test]
    fn auth_mode_from_generated_maps_known_values_to_legacy_strings() {
        assert_eq!(
            [
                auth_mode_from_generated(types::CliAuthMode::CLI_AUTH_MODE_BROWSER_SESSION.into()),
                auth_mode_from_generated(types::CliAuthMode::CLI_AUTH_MODE_BEARER_TOKEN.into()),
                auth_mode_from_generated(types::CliAuthMode::CLI_AUTH_MODE_UNSPECIFIED.into()),
            ],
            [
                Some("browser_session".to_owned()),
                Some("bearer_token".to_owned()),
                None,
            ]
        );
    }

    #[test]
    fn login_session_from_generated_maps_start_response() {
        let response = types::StartDeviceAuthorizationResponse {
            device_code: "device-code-123".to_owned(),
            user_code: "ABCD1234".to_owned(),
            verification_url: "https://example.test/device".to_owned(),
            verification_complete_url: "https://example.test/device?user_code=ABCD1234".to_owned(),
            poll_after_ms: 5_000,
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
                poll_interval_ms: 5_000,
                expires_in_sec: session.expires_in_sec,
            }
        );
        assert!(session.expires_in_sec > 0);
    }

    #[test]
    fn login_poll_outcome_from_generated_maps_pending_and_slow_down() {
        let pending = types::PollDeviceAuthorizationResponse {
            outcome: Some(types::poll_device_authorization_response::Outcome::Pending(
                Box::new(types::CliPendingDeviceAuthorization {
                    poll_after_ms: 5_000,
                    ..Default::default()
                }),
            )),
            ..Default::default()
        };
        let slowed = types::PollDeviceAuthorizationResponse {
            outcome: Some(types::poll_device_authorization_response::Outcome::Pending(
                Box::new(types::CliPendingDeviceAuthorization {
                    poll_after_ms: 10_000,
                    ..Default::default()
                }),
            )),
            ..Default::default()
        };

        assert_eq!(
            [
                login_poll_outcome_from_generated(pending, 5_000, Some("req_pending".to_owned()))
                    .expect("expected pending outcome"),
                login_poll_outcome_from_generated(slowed, 5_000, Some("req_slow".to_owned()))
                    .expect("expected slow-down outcome"),
            ],
            [LoginPollOutcome::Pending, LoginPollOutcome::SlowDown]
        );
    }

    #[test]
    fn login_poll_outcome_from_generated_maps_authorized_response() {
        let response = types::PollDeviceAuthorizationResponse {
            outcome: Some(
                types::poll_device_authorization_response::Outcome::Authorized(Box::new(
                    types::CliAuthorizedDeviceAuthorization {
                        access_token: "pat_123".to_owned(),
                        ..Default::default()
                    },
                )),
            ),
            ..Default::default()
        };

        assert_eq!(
            login_poll_outcome_from_generated(response, 5_000, Some("req_poll".to_owned()))
                .expect("expected authorized outcome"),
            LoginPollOutcome::Authorized {
                access_token: "pat_123".to_owned(),
            }
        );
    }

    #[test]
    fn interpret_login_poll_problem_maps_connect_codes_to_terminal_outcomes() {
        let denied = interpret_login_poll_problem(ApiProblem {
            connect_code: Some(connectrpc::ErrorCode::PermissionDenied),
            status: None,
            title: Some("Forbidden".to_owned()),
            detail: Some("device authorization was denied".to_owned()),
            code: Some("permission_denied".to_owned()),
            retryable: false,
            retry_after_ms: None,
            stage: ErrorStage::Auth,
            hint: None,
            request_id: Some("req_denied".to_owned()),
            validation_issues: Vec::new(),
            raw_body: "device authorization was denied".to_owned(),
        })
        .expect("expected denied outcome");
        let expired = interpret_login_poll_problem(ApiProblem {
            connect_code: Some(connectrpc::ErrorCode::FailedPrecondition),
            status: None,
            title: Some("Failed precondition".to_owned()),
            detail: Some("device authorization session expired".to_owned()),
            code: Some("failed_precondition".to_owned()),
            retryable: false,
            retry_after_ms: None,
            stage: ErrorStage::Auth,
            hint: None,
            request_id: Some("req_expired".to_owned()),
            validation_issues: Vec::new(),
            raw_body: "device authorization session expired".to_owned(),
        })
        .expect("expected expired outcome");

        assert_eq!(
            [denied, expired],
            [
                ApiSuccess {
                    payload: LoginPollOutcome::Denied,
                    request_id: Some("req_denied".to_owned()),
                },
                ApiSuccess {
                    payload: LoginPollOutcome::Expired,
                    request_id: Some("req_expired".to_owned()),
                },
            ]
        );
    }

    #[test]
    fn whoami_from_generated_maps_session_response() {
        let response = types::GetSessionResponse {
            auth_mode: types::CliAuthMode::CLI_AUTH_MODE_BEARER_TOKEN.into(),
            user: buffa::MessageField::some(types::CliAuthUser {
                id: "user-1".to_owned(),
                email: "alice@example.com".to_owned(),
                display_name: "Alice".to_owned(),
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
            access_token: "session-token-refreshed".to_owned(),
            auth_mode: types::CliAuthMode::CLI_AUTH_MODE_BEARER_TOKEN.into(),
            user: buffa::MessageField::some(types::CliAuthUser {
                id: "user-1".to_owned(),
                email: "alice@example.com".to_owned(),
                display_name: "Alice".to_owned(),
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

    #[test]
    fn interpret_login_poll_problem_preserves_retryable_connect_failures() {
        let failure = interpret_login_poll_problem(ApiProblem {
            connect_code: Some(connectrpc::ErrorCode::ResourceExhausted),
            status: None,
            title: Some("Rate limited".to_owned()),
            detail: Some("polling is temporarily rate limited".to_owned()),
            code: Some("resource_exhausted".to_owned()),
            retryable: true,
            retry_after_ms: Some(10_000),
            stage: ErrorStage::Auth,
            hint: None,
            request_id: Some("req_rate_limited".to_owned()),
            validation_issues: Vec::new(),
            raw_body: "polling is temporarily rate limited".to_owned(),
        })
        .expect_err("expected rate limited failure to remain a problem");

        assert_eq!(
            failure,
            ApiFailure::Problem(ApiProblem {
                connect_code: Some(connectrpc::ErrorCode::ResourceExhausted),
                status: None,
                title: Some("Rate limited".to_owned()),
                detail: Some("polling is temporarily rate limited".to_owned()),
                code: Some("resource_exhausted".to_owned()),
                retryable: true,
                retry_after_ms: Some(10_000),
                stage: ErrorStage::Auth,
                hint: None,
                request_id: Some("req_rate_limited".to_owned()),
                validation_issues: Vec::new(),
                raw_body: "polling is temporarily rate limited".to_owned(),
            })
        );
    }
}
