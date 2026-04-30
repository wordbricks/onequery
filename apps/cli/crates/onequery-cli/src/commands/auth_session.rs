use std::time::Duration;

use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::identifiers::OrgSlug;
use crate::presentation::api_failure::ApiErrorPresentation;
use crate::presentation::api_failure::present_api_client_build_failure;
use crate::presentation::api_failure::present_api_failure_with_context;
use crate::recovery::auth_login_try_next;
use crate::recovery::missing_auth_try_next;
use crate::recovery::retry_try_next;
use crate::transport::auth;
use crate::transport::auth::LoginCompletion;
use crate::transport::client::AuthenticatedApiClient;
use crate::transport::client::UnauthenticatedApiClient;
use crate::workflows::runner::DEFAULT_MAX_WORKFLOW_STEPS;
use crate::workflows::runner::Transition;
use crate::workflows::runner::WorkflowLabel;
use crate::workflows::runner::WorkflowRunConfig;
use crate::workflows::runner::run_reducer_workflow;
use onequery_core::error::CliError;
use onequery_core::error::ErrorStage;

use super::CommandContext;
use super::Runtime;

const SESSION_REFRESH_SKEW: time::Duration = time::Duration::minutes(5);

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) struct PersistedLogin {
    pub(crate) completion: LoginCompletion,
    pub(crate) next_step: PersistedLoginNextStep,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) enum PersistedLoginNextStep {
    BootstrapOrgSelection,
    Complete,
}

#[derive(Debug, Clone, Copy)]
enum AuthSessionState {
    Idle,
    CheckingStoredSession,
    RefreshingSession,
    PersistingSession,
}

#[derive(Debug)]
enum AuthSessionEvent {
    Start,
    CurrentSessionMissing {
        try_next: Vec<String>,
    },
    CurrentSessionFound {
        access_token: String,
        refresh_required: bool,
    },
    SessionRefreshed {
        completion: LoginCompletion,
    },
    SessionRefreshFailed {
        error: CliError,
    },
    SessionPersisted,
    SessionPersistFailed {
        error: CliError,
    },
}

#[derive(Debug)]
enum AuthSessionEffect {
    InspectCurrent,
    RefreshRemote { access_token: String },
    PersistRefreshed { completion: LoginCompletion },
}

#[derive(Debug)]
enum AuthSessionTerminalState {
    Authenticated,
    Failed { error: CliError },
}

impl WorkflowLabel for AuthSessionState {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Idle => "Idle",
            Self::CheckingStoredSession => "CheckingStoredSession",
            Self::RefreshingSession => "RefreshingSession",
            Self::PersistingSession => "PersistingSession",
        }
    }
}

impl WorkflowLabel for AuthSessionEvent {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Start => "Start",
            Self::CurrentSessionMissing { .. } => "CurrentSessionMissing",
            Self::CurrentSessionFound { .. } => "CurrentSessionFound",
            Self::SessionRefreshed { .. } => "SessionRefreshed",
            Self::SessionRefreshFailed { .. } => "SessionRefreshFailed",
            Self::SessionPersisted => "SessionPersisted",
            Self::SessionPersistFailed { .. } => "SessionPersistFailed",
        }
    }
}

impl WorkflowLabel for AuthSessionEffect {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::InspectCurrent => "InspectCurrent",
            Self::RefreshRemote { .. } => "RefreshRemote",
            Self::PersistRefreshed { .. } => "PersistRefreshed",
        }
    }
}

impl WorkflowLabel for AuthSessionTerminalState {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Authenticated => "Authenticated",
            Self::Failed { .. } => "Failed",
        }
    }
}

pub(crate) async fn ensure_authenticated<B, T>(
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<(), CliError> {
    let terminal_state = run_reducer_workflow(
        AuthSessionState::Idle,
        AuthSessionEvent::Start,
        WorkflowRunConfig {
            context,
            runtime,
            workflow_name: "auth_session",
            command_line: &context.command_line,
            verbose: context.verbose,
            max_steps: DEFAULT_MAX_WORKFLOW_STEPS,
        },
        reduce_auth_session,
        |effect, context, runtime| Box::pin(execute_auth_session_effect(effect, context, runtime)),
    )
    .await?;

    match terminal_state {
        AuthSessionTerminalState::Authenticated => Ok(()),
        AuthSessionTerminalState::Failed { error } => Err(error),
    }
}

pub(crate) async fn ensure_authenticated_org<B, T>(
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<OrgSlug, CliError> {
    ensure_authenticated(context, runtime).await?;
    super::require_org(context)
}

fn reduce_auth_session(
    state: AuthSessionState,
    event: AuthSessionEvent,
    context: &CommandContext,
) -> Transition<AuthSessionState, AuthSessionTerminalState, AuthSessionEffect> {
    match state {
        AuthSessionState::Idle => match event {
            AuthSessionEvent::Start => Transition::continue_with_effect(
                AuthSessionState::CheckingStoredSession,
                AuthSessionEffect::InspectCurrent,
            ),
            AuthSessionEvent::CurrentSessionMissing { .. }
            | AuthSessionEvent::CurrentSessionFound { .. }
            | AuthSessionEvent::SessionRefreshed { .. }
            | AuthSessionEvent::SessionRefreshFailed { .. }
            | AuthSessionEvent::SessionPersisted
            | AuthSessionEvent::SessionPersistFailed { .. } => {
                Transition::done(AuthSessionTerminalState::Failed {
                    error: auth_session_unexpected_transition_error(
                        context,
                        AuthSessionState::Idle,
                        event,
                    ),
                })
            }
        },
        AuthSessionState::CheckingStoredSession => match event {
            AuthSessionEvent::CurrentSessionMissing { try_next } => {
                Transition::done(AuthSessionTerminalState::Failed {
                    error: not_logged_in_error(context, try_next),
                })
            }
            AuthSessionEvent::CurrentSessionFound {
                access_token,
                refresh_required: true,
            } => Transition::continue_with_effect(
                AuthSessionState::RefreshingSession,
                AuthSessionEffect::RefreshRemote { access_token },
            ),
            AuthSessionEvent::CurrentSessionFound {
                refresh_required: false,
                ..
            } => Transition::done(AuthSessionTerminalState::Authenticated),
            AuthSessionEvent::Start
            | AuthSessionEvent::SessionRefreshed { .. }
            | AuthSessionEvent::SessionRefreshFailed { .. }
            | AuthSessionEvent::SessionPersisted
            | AuthSessionEvent::SessionPersistFailed { .. } => {
                Transition::done(AuthSessionTerminalState::Failed {
                    error: auth_session_unexpected_transition_error(
                        context,
                        AuthSessionState::CheckingStoredSession,
                        event,
                    ),
                })
            }
        },
        AuthSessionState::RefreshingSession => match event {
            AuthSessionEvent::SessionRefreshed { completion } => Transition::continue_with_effect(
                AuthSessionState::PersistingSession,
                AuthSessionEffect::PersistRefreshed { completion },
            ),
            AuthSessionEvent::SessionRefreshFailed { error } => {
                Transition::done(AuthSessionTerminalState::Failed { error })
            }
            AuthSessionEvent::Start
            | AuthSessionEvent::CurrentSessionMissing { .. }
            | AuthSessionEvent::CurrentSessionFound { .. }
            | AuthSessionEvent::SessionPersisted
            | AuthSessionEvent::SessionPersistFailed { .. } => {
                Transition::done(AuthSessionTerminalState::Failed {
                    error: auth_session_unexpected_transition_error(
                        context,
                        AuthSessionState::RefreshingSession,
                        event,
                    ),
                })
            }
        },
        AuthSessionState::PersistingSession => match event {
            AuthSessionEvent::SessionPersisted => {
                Transition::done(AuthSessionTerminalState::Authenticated)
            }
            AuthSessionEvent::SessionPersistFailed { error } => {
                Transition::done(AuthSessionTerminalState::Failed { error })
            }
            AuthSessionEvent::Start
            | AuthSessionEvent::CurrentSessionMissing { .. }
            | AuthSessionEvent::CurrentSessionFound { .. }
            | AuthSessionEvent::SessionRefreshed { .. }
            | AuthSessionEvent::SessionRefreshFailed { .. } => {
                Transition::done(AuthSessionTerminalState::Failed {
                    error: auth_session_unexpected_transition_error(
                        context,
                        AuthSessionState::PersistingSession,
                        event,
                    ),
                })
            }
        },
    }
}

async fn execute_auth_session_effect<B, T>(
    effect: AuthSessionEffect,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> AuthSessionEvent {
    match effect {
        AuthSessionEffect::InspectCurrent => {
            match runtime.auth_session.access_token().map(str::to_owned) {
                Some(access_token) => AuthSessionEvent::CurrentSessionFound {
                    access_token,
                    refresh_required: auth_session_refresh_required(runtime),
                },
                None => AuthSessionEvent::CurrentSessionMissing {
                    try_next: missing_auth_try_next(context),
                },
            }
        }
        AuthSessionEffect::RefreshRemote { access_token } => {
            let client = match build_authenticated_api_client(
                context,
                Duration::from_secs(runtime.config.data().request_timeout_sec),
                access_token.as_str(),
            ) {
                Ok(client) => client,
                Err(error) => return AuthSessionEvent::SessionRefreshFailed { error },
            };

            match auth::refresh_session(&client).await {
                Ok(response) => AuthSessionEvent::SessionRefreshed {
                    completion: response.payload.completion,
                },
                Err(failure) => AuthSessionEvent::SessionRefreshFailed {
                    error: present_api_failure_with_context(
                        failure,
                        context,
                        ApiErrorPresentation {
                            command: &context.command_line,
                            title: "auth session refresh failed",
                            transport_why_prefix: "failed to reach auth session refresh endpoint",
                            decode_why_prefix: "failed to decode auth session refresh response",
                            fallback_try_next: retry_try_next(&context.command_line),
                            unauthorized_try_next: Some(auth_login_try_next()),
                        },
                    ),
                },
            }
        }
        AuthSessionEffect::PersistRefreshed { completion } => match runtime
            .auth_session
            .record_refreshed_session(&completion, &context.command_line)
        {
            Ok(()) => AuthSessionEvent::SessionPersisted,
            Err(error) => AuthSessionEvent::SessionPersistFailed { error },
        },
    }
}

fn auth_session_refresh_required<B, T>(runtime: &Runtime<B, T>) -> bool {
    let Some(expires_at) = runtime.auth_session.metadata().expires_at() else {
        return false;
    };

    let Ok(expires_at) = OffsetDateTime::parse(expires_at, &Rfc3339) else {
        return true;
    };

    expires_at <= OffsetDateTime::now_utc() + SESSION_REFRESH_SKEW
}

pub(crate) fn authenticated_api_client<B, T>(
    context: &CommandContext,
    runtime: &Runtime<B, T>,
) -> Result<AuthenticatedApiClient, CliError> {
    let Some(access_token) = runtime.auth_session.access_token() else {
        return Err(not_logged_in_error(context, missing_auth_try_next(context)));
    };

    build_authenticated_api_client(
        context,
        Duration::from_secs(runtime.config.data().request_timeout_sec),
        access_token,
    )
}

pub(crate) fn unauthenticated_api_client<B, T>(
    context: &CommandContext,
    runtime: &Runtime<B, T>,
) -> Result<UnauthenticatedApiClient, CliError> {
    build_unauthenticated_api_client(
        context,
        Duration::from_secs(runtime.config.data().request_timeout_sec),
    )
}

pub(crate) fn persist_login_completion<B, T>(
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
    completion: LoginCompletion,
) -> Result<PersistedLogin, CliError> {
    runtime
        .auth_session
        .persist_login_completion(&completion, &context.command_line)?;

    Ok(PersistedLogin {
        completion,
        next_step: if runtime.config.data().active_org.is_none() {
            PersistedLoginNextStep::BootstrapOrgSelection
        } else {
            PersistedLoginNextStep::Complete
        },
    })
}

pub(crate) fn clear_auth_session<B, T>(
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<(), CliError> {
    runtime.auth_session.clear_session(&context.command_line)
}

fn build_authenticated_api_client(
    context: &CommandContext,
    request_timeout: Duration,
    token: &str,
) -> Result<AuthenticatedApiClient, CliError> {
    AuthenticatedApiClient::new_with_timeout_and_request_id(
        &context.base_url,
        request_timeout,
        token,
        context
            .request_id
            .as_ref()
            .map(crate::identifiers::RequestId::as_str),
    )
    .map_err(|failure| present_api_client_build_failure(failure, &context.command_line))
}

pub(crate) fn build_unauthenticated_api_client(
    context: &CommandContext,
    request_timeout: Duration,
) -> Result<UnauthenticatedApiClient, CliError> {
    UnauthenticatedApiClient::new_with_timeout_and_request_id(
        &context.base_url,
        request_timeout,
        context
            .request_id
            .as_ref()
            .map(crate::identifiers::RequestId::as_str),
    )
    .map_err(|failure| present_api_client_build_failure(failure, &context.command_line))
}

fn not_logged_in_error(context: &CommandContext, try_next: Vec<String>) -> CliError {
    CliError::new(
        "not logged in",
        context.command_line.clone(),
        ErrorStage::Auth,
        "no OneQuery token was found in the environment or local auth store.",
        try_next,
    )
}

fn auth_session_unexpected_transition_error(
    context: &CommandContext,
    state: AuthSessionState,
    event: AuthSessionEvent,
) -> CliError {
    CliError::internal(
        context.command_line.clone(),
        format!(
            "unexpected auth session workflow transition: state={}, event={}",
            state.workflow_label(),
            event.workflow_label()
        ),
    )
}

#[cfg(test)]
mod tests {
    use std::io::Read;
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::time::Duration;

    use onequery_core::error::ErrorStage;
    use pretty_assertions::assert_eq;
    use uuid::Uuid;

    use crate::commands::ResolvedOrgSource;
    use crate::commands::test_support::refresh_session_response_body;
    use crate::commands::test_support::write_proto_response;
    use crate::config::AppConfig;
    use crate::config::ConfigStore;
    use crate::credentials::AuthSessionStore;
    use crate::platform::BrowserLaunchError;
    use crate::platform::BrowserLauncher;
    use crate::platform::Terminal;
    use crate::transport::auth::LoginCompletion;
    use crate::transport::auth::UserProfile;

    use super::CommandContext;
    use super::Runtime;
    use super::authenticated_api_client;
    use super::ensure_authenticated;
    use super::ensure_authenticated_org;

    #[derive(Debug)]
    struct NoopBrowser;

    impl BrowserLauncher for NoopBrowser {
        fn open_url(&self, _url: &str) -> Result<(), BrowserLaunchError> {
            Ok(())
        }
    }

    #[derive(Debug)]
    struct NoopTerminal;

    impl Terminal for NoopTerminal {
        fn stderr_line(&self, _message: &str) {}
    }

    fn sample_login_completion(access_token: &str, email: &str) -> LoginCompletion {
        sample_login_completion_with_expiry(access_token, email, "2000-03-17T00:00:00Z")
    }

    fn sample_login_completion_with_expiry(
        access_token: &str,
        email: &str,
        expires_at: &str,
    ) -> LoginCompletion {
        LoginCompletion {
            access_token: access_token.to_owned(),
            auth_mode: Some("bearer_token".to_owned()),
            user: UserProfile {
                id: "user-1".to_owned(),
                email: email.to_owned(),
                display_name: "Alice".to_owned(),
            },
            issued_at: Some("2026-03-10T00:00:00Z".to_owned()),
            expires_at: Some(expires_at.to_owned()),
        }
    }

    fn test_context(base_url: String, command_line: &str) -> CommandContext {
        CommandContext {
            command_line: command_line.to_owned(),
            base_url,
            request_id: None,
            resolved_org: None,
            resolved_org_source: ResolvedOrgSource::None,
            verbose: false,
        }
    }

    fn test_context_with_request_id(
        base_url: String,
        command_line: &str,
        request_id: &str,
    ) -> CommandContext {
        CommandContext {
            request_id: Some(crate::identifiers::test_request_id(request_id)),
            ..test_context(base_url, command_line)
        }
    }

    fn test_runtime(auth_session: AuthSessionStore) -> Runtime<NoopBrowser, NoopTerminal> {
        Runtime {
            config: ConfigStore::with_state_for_test(
                std::env::temp_dir().join(format!("onequery-config-{}", Uuid::new_v4())),
                AppConfig {
                    request_timeout_sec: 5,
                    ..AppConfig::default()
                },
            ),
            auth_session,
            browser: NoopBrowser,
            terminal: NoopTerminal,
            process: onequery_core::process_context::ProcessContext::default(),
        }
    }

    fn auth_session_store_for_test(token: Option<String>) -> AuthSessionStore {
        AuthSessionStore::with_file_access_token_for_test(
            std::env::temp_dir()
                .join(format!("onequery-auth-session-{}", Uuid::new_v4()))
                .join("auth.json"),
            token,
        )
    }

    #[tokio::test]
    async fn ensure_authenticated_fails_when_no_token_is_stored() {
        let base_url = "https://onequery.example.com".to_owned();
        let context = test_context(base_url.clone(), "onequery org list");
        let mut runtime = test_runtime(auth_session_store_for_test(None));

        let error = ensure_authenticated(&context, &mut runtime)
            .await
            .expect_err("expected auth session workflow to fail without a token");

        assert_eq!(
            (
                error.title.as_str(),
                error.command.as_str(),
                error.stage,
                error.why.as_str(),
                error.try_next.clone(),
            ),
            (
                "not logged in",
                "onequery org list",
                ErrorStage::Auth,
                "no OneQuery token was found in the environment or local auth store.",
                vec![
                    "onequery auth login".to_owned(),
                    "onequery auth import --input <path|->".to_owned(),
                ],
            )
        );
    }

    #[tokio::test]
    async fn ensure_authenticated_org_reports_login_guidance_before_org_selection_when_logged_out()
    {
        let context = test_context(
            "https://onequery.example.com".to_owned(),
            "onequery query exec --source warehouse --sql \"select 1\"",
        );
        let mut runtime = test_runtime(auth_session_store_for_test(None));

        let error = ensure_authenticated_org(&context, &mut runtime)
            .await
            .expect_err("expected auth+org preflight to fail without a token");

        assert_eq!(
            error.try_next,
            vec![
                "onequery auth login".to_owned(),
                "onequery auth import --input <path|->".to_owned(),
            ]
        );
    }

    #[test]
    fn authenticated_api_client_fails_when_no_token_is_stored() {
        let context = test_context(
            "https://onequery.example.com".to_owned(),
            "onequery org list",
        );
        let runtime = test_runtime(auth_session_store_for_test(None));

        let error = authenticated_api_client(&context, &runtime)
            .expect_err("expected authenticated client construction to fail without a token");

        assert_eq!(
            (
                error.title.as_str(),
                error.command.as_str(),
                error.stage,
                error.why.as_str(),
                error.try_next.clone(),
            ),
            (
                "not logged in",
                "onequery org list",
                ErrorStage::Auth,
                "no OneQuery token was found in the environment or local auth store.",
                vec![
                    "onequery auth login".to_owned(),
                    "onequery auth import --input <path|->".to_owned(),
                ],
            )
        );
    }

    #[tokio::test]
    async fn ensure_authenticated_refreshes_session_and_persists_new_token_metadata() {
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

            let response_body = refresh_session_response_body(
                "token_refreshed",
                Some("acme"),
                1_773_187_200,
                1_773_792_000,
            );
            write_proto_response(&mut stream, "req_refresh", &response_body)
                .expect("expected proto response write to CLI");
        });

        let base_url = format!("http://{address}");
        let context = test_context(base_url.clone(), "onequery org list");
        let credentials_path = std::env::temp_dir()
            .join(format!("onequery-auth-session-{}", Uuid::new_v4()))
            .join("auth.json");
        let mut auth_session =
            AuthSessionStore::with_file_access_token_for_test(credentials_path, None);
        auth_session
            .persist_login_completion(
                &sample_login_completion("token_old", "alice@example.com"),
                "onequery auth login",
            )
            .unwrap_or_else(|error| panic!("expected test auth session persistence: {error}"));
        let mut runtime = test_runtime(auth_session);

        ensure_authenticated(&context, &mut runtime)
            .await
            .unwrap_or_else(|error| panic!("expected auth session workflow to succeed: {error}"));

        assert_eq!(
            (
                runtime.auth_session.access_token(),
                runtime.auth_session.metadata().principal_email(),
                runtime.auth_session.metadata().issued_at(),
                runtime.auth_session.metadata().expires_at(),
            ),
            (
                Some("token_refreshed"),
                Some("alice@example.com"),
                Some("2026-03-11T00:00:00Z"),
                Some("2026-03-18T00:00:00Z"),
            )
        );
    }

    #[tokio::test]
    async fn ensure_authenticated_skips_refresh_when_expiry_is_not_known() {
        let context = test_context("http://127.0.0.1:9".to_owned(), "onequery org list");
        let credentials_path = std::env::temp_dir()
            .join(format!("onequery-auth-session-{}", Uuid::new_v4()))
            .join("auth.json");
        let mut runtime = test_runtime(AuthSessionStore::with_env_access_token_for_test(
            credentials_path.clone(),
            "token_from_env".to_owned(),
        ));

        ensure_authenticated(&context, &mut runtime)
            .await
            .unwrap_or_else(|error| {
                panic!("expected auth session workflow to accept the stored token: {error}")
            });

        assert_eq!(
            (
                runtime.auth_session.access_token(),
                runtime.auth_session.metadata().principal_email(),
                credentials_path.exists(),
            ),
            (Some("token_from_env"), None, false)
        );
    }

    #[tokio::test]
    async fn ensure_authenticated_skips_refresh_for_unexpired_sessions() {
        let context = test_context(
            "http://127.0.0.1:9".to_owned(),
            "onequery query exec --source warehouse --sql \"select 1\"",
        );
        let credentials_path = std::env::temp_dir()
            .join(format!("onequery-auth-session-{}", Uuid::new_v4()))
            .join("auth.json");
        let mut auth_session =
            AuthSessionStore::with_file_access_token_for_test(credentials_path, None);
        auth_session
            .persist_login_completion(
                &sample_login_completion_with_expiry(
                    "token_current",
                    "alice@example.com",
                    "2099-03-17T00:00:00Z",
                ),
                "onequery auth login",
            )
            .unwrap_or_else(|error| panic!("expected test auth session persistence: {error}"));
        let mut runtime = test_runtime(auth_session);

        ensure_authenticated(&context, &mut runtime)
            .await
            .unwrap_or_else(|error| {
                panic!("expected auth session workflow to skip remote refresh: {error}")
            });

        assert_eq!(runtime.auth_session.access_token(), Some("token_current"));
    }

    #[tokio::test]
    async fn ensure_authenticated_uses_the_startup_loaded_token_without_reloading_auth_json() {
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
                .expect("expected captured request receiver");

            let response_body = refresh_session_response_body(
                "token_refreshed",
                Some("acme"),
                1_773_187_200,
                1_773_792_000,
            );
            write_proto_response(&mut stream, "req_refresh", &response_body)
                .expect("expected proto response write to CLI");
        });

        let base_url = format!("http://{address}");
        let context = test_context(base_url.clone(), "onequery org list");
        let credentials_path = std::env::temp_dir()
            .join(format!("onequery-auth-session-{}", Uuid::new_v4()))
            .join("auth.json");
        let mut auth_session =
            AuthSessionStore::with_file_access_token_for_test(credentials_path.clone(), None);
        auth_session
            .persist_login_completion(
                &sample_login_completion("token_old", "alice@example.com"),
                "onequery auth login",
            )
            .unwrap_or_else(|error| panic!("expected initial auth session persistence: {error}"));

        let mut external_store =
            AuthSessionStore::with_file_access_token_for_test(credentials_path, None);
        external_store
            .persist_login_completion(
                &sample_login_completion("token_reloaded", "alice@example.com"),
                "onequery auth login",
            )
            .unwrap_or_else(|error| panic!("expected external auth session persistence: {error}"));

        let mut runtime = test_runtime(auth_session);

        ensure_authenticated(&context, &mut runtime)
            .await
            .unwrap_or_else(|error| panic!("expected auth session workflow to succeed: {error}"));

        let request = request_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("expected captured refresh request");
        assert_eq!(
            (
                request
                    .to_ascii_lowercase()
                    .contains("authorization: bearer token_old"),
                runtime.auth_session.access_token(),
            ),
            (true, Some("token_refreshed"))
        );
    }

    #[tokio::test]
    async fn ensure_authenticated_forwards_request_id_to_refresh_requests() {
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

            request_tx
                .send(String::from_utf8_lossy(&request_bytes).into_owned())
                .expect("expected captured request receiver");

            let response_body = refresh_session_response_body(
                "token_refreshed",
                Some("acme"),
                1_773_187_200,
                1_773_792_000,
            );
            write_proto_response(&mut stream, "req_refresh", &response_body)
                .expect("expected proto response write to CLI");
        });

        let context = test_context_with_request_id(
            format!("http://{address}"),
            "onequery org list --request-id req_cli_123",
            "req_cli_123",
        );
        let credentials_path = std::env::temp_dir()
            .join(format!("onequery-auth-session-{}", Uuid::new_v4()))
            .join("auth.json");
        let mut auth_session =
            AuthSessionStore::with_file_access_token_for_test(credentials_path, None);
        auth_session
            .persist_login_completion(
                &sample_login_completion("token_from_file", "alice@example.com"),
                "onequery auth login",
            )
            .unwrap_or_else(|error| panic!("expected test auth session persistence: {error}"));
        let mut runtime = test_runtime(auth_session);

        ensure_authenticated(&context, &mut runtime)
            .await
            .unwrap_or_else(|error| panic!("expected auth session workflow to succeed: {error}"));

        let request = request_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("expected captured refresh request");

        assert!(
            request
                .to_ascii_lowercase()
                .contains("x-request-id: req_cli_123")
        );
    }
}
