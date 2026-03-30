use serde_json::json;

use crate::cli::AuthSessionSubcommand;
use crate::commands::Runtime;
use crate::commands::auth_session::authenticated_api_client;
use crate::credentials::AuthSessionSource;
use crate::output::CommandOutput;
use crate::presentation::api_failure::ApiErrorPresentation;
use crate::presentation::api_failure::present_api_failure;
use crate::transport::auth;
use crate::transport::auth::RefreshedAuthSession;
use crate::workflows::runner::DEFAULT_MAX_WORKFLOW_STEPS;
use crate::workflows::runner::Transition;
use crate::workflows::runner::WorkflowLabel;
use crate::workflows::runner::WorkflowRunConfig;
use crate::workflows::runner::run_reducer_workflow;
use onequery_cli_core::error::CliError;

use super::super::CommandContext;

pub(super) async fn execute<B, T>(
    command: &AuthSessionSubcommand,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError>
where
    B: crate::platform::BrowserLauncher,
    T: crate::platform::Terminal,
{
    match command {
        AuthSessionSubcommand::Refresh => execute_refresh(context, runtime).await,
    }
}

#[derive(Debug, Clone, Copy)]
enum SessionRefreshState {
    Idle,
    RefreshingRemote,
    PersistingSession,
}

#[derive(Debug)]
enum SessionRefreshEvent {
    Start,
    SessionRefreshed {
        refreshed: RefreshedAuthSession,
        request_id: Option<String>,
    },
    SessionRefreshFailed {
        error: CliError,
    },
    SessionPersisted {
        output: CommandOutput,
        request_id: Option<String>,
    },
    SessionPersistFailed {
        error: CliError,
    },
}

#[derive(Debug)]
enum SessionRefreshEffect {
    RefreshRemote,
    PersistRefreshed {
        refreshed: Box<RefreshedAuthSession>,
        request_id: Option<String>,
    },
}

#[derive(Debug)]
enum SessionRefreshTerminalState {
    Completed {
        output: CommandOutput,
        request_id: Option<String>,
    },
    Failed {
        error: CliError,
    },
}

async fn execute_refresh<B, T>(
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError>
where
    B: crate::platform::BrowserLauncher,
    T: crate::platform::Terminal,
{
    let final_state = run_reducer_workflow(
        SessionRefreshState::Idle,
        SessionRefreshEvent::Start,
        WorkflowRunConfig {
            context,
            runtime,
            workflow_name: "auth_session_refresh",
            command_line: &context.command_line,
            verbose: context.verbose,
            max_steps: DEFAULT_MAX_WORKFLOW_STEPS,
        },
        reduce,
        |effect, context, runtime| Box::pin(execute_effect(effect, context, runtime)),
    )
    .await?;

    match final_state {
        SessionRefreshTerminalState::Completed { output, request_id } => {
            Ok(output.with_request_id(request_id))
        }
        SessionRefreshTerminalState::Failed { error } => Err(error),
    }
}

fn reduce(
    state: SessionRefreshState,
    event: SessionRefreshEvent,
    context: &CommandContext,
) -> Transition<SessionRefreshState, SessionRefreshTerminalState, SessionRefreshEffect> {
    match state {
        SessionRefreshState::Idle => match event {
            SessionRefreshEvent::Start => Transition::continue_with_effect(
                SessionRefreshState::RefreshingRemote,
                SessionRefreshEffect::RefreshRemote,
            ),
            SessionRefreshEvent::SessionRefreshed { .. }
            | SessionRefreshEvent::SessionRefreshFailed { .. }
            | SessionRefreshEvent::SessionPersisted { .. }
            | SessionRefreshEvent::SessionPersistFailed { .. } => {
                Transition::done(SessionRefreshTerminalState::Failed {
                    error: unexpected_transition_error(context, SessionRefreshState::Idle, event),
                })
            }
        },
        SessionRefreshState::RefreshingRemote => match event {
            SessionRefreshEvent::SessionRefreshed {
                refreshed,
                request_id,
            } => Transition::continue_with_effect(
                SessionRefreshState::PersistingSession,
                SessionRefreshEffect::PersistRefreshed {
                    refreshed: Box::new(refreshed),
                    request_id,
                },
            ),
            SessionRefreshEvent::SessionRefreshFailed { error } => {
                Transition::done(SessionRefreshTerminalState::Failed { error })
            }
            SessionRefreshEvent::Start
            | SessionRefreshEvent::SessionPersisted { .. }
            | SessionRefreshEvent::SessionPersistFailed { .. } => {
                Transition::done(SessionRefreshTerminalState::Failed {
                    error: unexpected_transition_error(
                        context,
                        SessionRefreshState::RefreshingRemote,
                        event,
                    ),
                })
            }
        },
        SessionRefreshState::PersistingSession => match event {
            SessionRefreshEvent::SessionPersisted { output, request_id } => {
                Transition::done(SessionRefreshTerminalState::Completed { output, request_id })
            }
            SessionRefreshEvent::SessionPersistFailed { error } => {
                Transition::done(SessionRefreshTerminalState::Failed { error })
            }
            SessionRefreshEvent::Start
            | SessionRefreshEvent::SessionRefreshed { .. }
            | SessionRefreshEvent::SessionRefreshFailed { .. } => {
                Transition::done(SessionRefreshTerminalState::Failed {
                    error: unexpected_transition_error(
                        context,
                        SessionRefreshState::PersistingSession,
                        event,
                    ),
                })
            }
        },
    }
}

async fn execute_effect<B, T>(
    effect: SessionRefreshEffect,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> SessionRefreshEvent {
    match effect {
        SessionRefreshEffect::RefreshRemote => {
            let client = match authenticated_api_client(context, runtime) {
                Ok(client) => client,
                Err(error) => return SessionRefreshEvent::SessionRefreshFailed { error },
            };

            match auth::refresh_session(&client).await {
                Ok(response) => SessionRefreshEvent::SessionRefreshed {
                    refreshed: response.payload,
                    request_id: response.request_id,
                },
                Err(failure) => SessionRefreshEvent::SessionRefreshFailed {
                    error: present_api_failure(
                        failure,
                        ApiErrorPresentation {
                            command: &context.command_line,
                            title: "auth session refresh failed",
                            transport_why_prefix: "failed to reach auth session refresh endpoint",
                            decode_why_prefix: "failed to decode auth session refresh response",
                            fallback_try_next: vec![format!("retry {}", context.command_line)],
                            unauthorized_try_next: Some(vec!["oneq auth login".to_owned()]),
                        },
                    ),
                },
            }
        }
        SessionRefreshEffect::PersistRefreshed {
            refreshed,
            request_id,
        } => {
            let session_source = runtime.auth_session.source();
            match runtime
                .auth_session
                .record_refreshed_session(&refreshed.completion, &context.command_line)
            {
                Ok(()) => SessionRefreshEvent::SessionPersisted {
                    output: render_refresh_output(
                        &refreshed,
                        session_source,
                        runtime.auth_session.metadata().last_refresh(),
                    ),
                    request_id,
                },
                Err(error) => SessionRefreshEvent::SessionPersistFailed { error },
            }
        }
    }
}

fn render_refresh_output(
    refreshed: &RefreshedAuthSession,
    session_source: AuthSessionSource,
    last_refresh: Option<&str>,
) -> CommandOutput {
    let mut lines = vec![
        format!(
            "Session refreshed for {} <{}>",
            refreshed.completion.user.display_name, refreshed.completion.user.email
        ),
        format!("Credentials: {}", credential_status_label(session_source)),
        format!(
            "Active org: {}",
            display_optional(refreshed.active_org.as_deref())
        ),
        format!(
            "Issued at: {}",
            display_optional(refreshed.completion.issued_at.as_deref())
        ),
        format!(
            "Expires at: {}",
            display_optional(refreshed.completion.expires_at.as_deref())
        ),
    ];

    if let Some(last_refresh) = last_refresh {
        lines.push(format!("Last refresh recorded: {last_refresh}"));
    }

    CommandOutput::structured(
        lines,
        json!({
            // Comment: refresh output often ends up in shell history or CI logs, so keep the
            // refreshed session metadata observable without reprinting the bearer token.
            "accessTokenRedacted": true,
            "authMode": refreshed.completion.auth_mode,
            "user": {
                "id": refreshed.completion.user.id,
                "email": refreshed.completion.user.email,
                "displayName": refreshed.completion.user.display_name,
            },
            "activeOrgSlug": refreshed.active_org,
            "issuedAt": refreshed.completion.issued_at,
            "expiresAt": refreshed.completion.expires_at,
        }),
    )
}

fn credential_status_label(source: AuthSessionSource) -> &'static str {
    match source {
        AuthSessionSource::PersistedFile => "stored",
        AuthSessionSource::Environment => "session-only (environment)",
    }
}

fn display_optional(value: Option<&str>) -> &str {
    value.unwrap_or("<none>")
}

fn unexpected_transition_error(
    context: &CommandContext,
    state: SessionRefreshState,
    event: SessionRefreshEvent,
) -> CliError {
    CliError::internal(
        context.command_line.clone(),
        format!(
            "unexpected auth session refresh workflow transition: state={}, event={}",
            state.workflow_label(),
            event.workflow_label()
        ),
    )
}

impl WorkflowLabel for SessionRefreshState {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Idle => "Idle",
            Self::RefreshingRemote => "RefreshingRemote",
            Self::PersistingSession => "PersistingSession",
        }
    }
}

impl WorkflowLabel for SessionRefreshEvent {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Start => "Start",
            Self::SessionRefreshed { .. } => "SessionRefreshed",
            Self::SessionRefreshFailed { .. } => "SessionRefreshFailed",
            Self::SessionPersisted { .. } => "SessionPersisted",
            Self::SessionPersistFailed { .. } => "SessionPersistFailed",
        }
    }
}

impl WorkflowLabel for SessionRefreshEffect {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::RefreshRemote => "RefreshRemote",
            Self::PersistRefreshed { .. } => "PersistRefreshed",
        }
    }
}

impl WorkflowLabel for SessionRefreshTerminalState {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Completed { .. } => "Completed",
            Self::Failed { .. } => "Failed",
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::io::Read;
    use std::io::Write;
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::sync::mpsc;

    use insta::assert_snapshot;
    use pretty_assertions::assert_eq;
    use serde_json::json;
    use uuid::Uuid;
    use onequery_cli_core::error::ErrorStage;

    use crate::credentials::AuthSessionStore;
    use crate::platform::BrowserLaunchError;
    use crate::platform::BrowserLauncher;
    use crate::platform::Terminal;
    use crate::transport::auth::LoginCompletion;
    use crate::transport::auth::UserProfile;

    use super::AuthSessionSource;
    use super::AuthSessionSubcommand;
    use super::CommandContext;
    use super::RefreshedAuthSession;
    use super::Runtime;
    use super::SessionRefreshEffect;
    use super::SessionRefreshEvent;
    use super::SessionRefreshState;
    use super::execute;
    use super::reduce;
    use super::render_refresh_output;
    use crate::commands::ResolvedOrgSource;
    use crate::config::AppConfig;
    use crate::config::ConfigStore;
    use crate::config::DEFAULT_BASE_URL;

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

    #[test]
    fn render_refresh_output_snapshot_with_stored_credentials() {
        let output = render_refresh_output(
            &sample_refreshed_session("token_refreshed", Some("acme")),
            AuthSessionSource::PersistedFile,
            Some("2026-03-12T12:00:00Z"),
        );

        assert_snapshot!(output.lines.join("\n"));
    }

    #[test]
    fn reduce_refresh_command_persists_after_remote_success() {
        let context = test_context(DEFAULT_BASE_URL.to_owned());
        let transition = reduce(
            SessionRefreshState::RefreshingRemote,
            SessionRefreshEvent::SessionRefreshed {
                refreshed: sample_refreshed_session("token_refreshed", Some("acme")),
                request_id: Some("req_123".to_owned()),
            },
            &context,
        );

        match transition.into_progress() {
            crate::workflows::runner::TransitionProgress::Continue {
                next_state: SessionRefreshState::PersistingSession,
                effect:
                    SessionRefreshEffect::PersistRefreshed {
                        refreshed,
                        request_id,
                    },
            } => {
                assert_eq!(
                    (refreshed.active_org, request_id),
                    (Some("acme".to_owned()), Some("req_123".to_owned()))
                );
            }
            other => panic!("expected refresh success to persist session next, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn execute_refresh_returns_route_shaped_data_and_persists_file_sessions() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .unwrap_or_else(|error| panic!("expected listener bind to succeed: {error}"));
        let address = listener
            .local_addr()
            .unwrap_or_else(|error| panic!("expected listener addr to succeed: {error}"));
        let base_url = format!("http://{address}");
        let (request_tx, request_rx) = mpsc::channel();

        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener
                .accept()
                .unwrap_or_else(|error| panic!("expected test connection: {error}"));
            let mut buffer = [0_u8; 4096];
            let bytes_read = stream
                .read(&mut buffer)
                .unwrap_or_else(|error| panic!("expected request read: {error}"));
            let request = String::from_utf8_lossy(&buffer[..bytes_read]).to_string();
            request_tx
                .send(request)
                .unwrap_or_else(|error| panic!("expected request send: {error}"));
            let response_body =
                refresh_response_body("req_refresh_123", "token_refreshed", Some("acme"));
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\nx-request-id: req_refresh_123\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .unwrap_or_else(|error| panic!("expected response write: {error}"));
        });

        let test_dir = std::env::temp_dir().join(format!("onequery-refresh-{}", Uuid::new_v4()));
        let auth_path = test_dir.join("auth.json");
        let mut runtime = test_runtime(AuthSessionStore::with_file_access_token_for_test(
            auth_path.clone(),
            Some("token_old".to_owned()),
        ));
        let context = test_context(base_url);

        let output = execute(&AuthSessionSubcommand::Refresh, &context, &mut runtime)
            .await
            .unwrap_or_else(|error| panic!("expected refresh command to succeed: {error}"));
        let request = request_rx
            .recv()
            .unwrap_or_else(|error| panic!("expected request capture: {error}"));
        server
            .join()
            .unwrap_or_else(|_| panic!("expected test server join to succeed"));

        assert_eq!(
            (
                request.lines().next().map(ToOwned::to_owned),
                output.request_id.clone(),
                output.into_data(),
                runtime.auth_session.access_token().map(ToOwned::to_owned),
            ),
            (
                Some("POST /api/cli/session:refresh HTTP/1.1".to_owned()),
                Some("req_refresh_123".to_owned()),
                json!({
                    "accessTokenRedacted": true,
                    "authMode": "bearer_token",
                    "user": {
                        "id": "user-1",
                        "email": "alice@example.com",
                        "displayName": "Alice",
                    },
                    "activeOrgSlug": "acme",
                    "issuedAt": "2026-03-10T00:00:00Z",
                    "expiresAt": "2026-03-17T00:00:00Z",
                }),
                Some("token_refreshed".to_owned()),
            )
        );

        fs::remove_dir_all(&test_dir).unwrap_or_else(|error| {
            panic!("expected temp refresh directory cleanup to succeed: {error}")
        });
    }

    #[tokio::test]
    async fn execute_refresh_keeps_environment_sessions_ephemeral() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .unwrap_or_else(|error| panic!("expected listener bind to succeed: {error}"));
        let address = listener
            .local_addr()
            .unwrap_or_else(|error| panic!("expected listener addr to succeed: {error}"));
        let base_url = format!("http://{address}");

        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener
                .accept()
                .unwrap_or_else(|error| panic!("expected test connection: {error}"));
            let mut buffer = [0_u8; 4096];
            let _ = stream
                .read(&mut buffer)
                .unwrap_or_else(|error| panic!("expected request read: {error}"));
            let response_body =
                refresh_response_body("req_refresh_env", "token_env_refreshed", None);
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .unwrap_or_else(|error| panic!("expected response write: {error}"));
        });

        let test_dir = std::env::temp_dir().join(format!("onequery-refresh-env-{}", Uuid::new_v4()));
        let auth_path = test_dir.join("auth.json");
        let mut runtime = test_runtime(AuthSessionStore::with_env_access_token_for_test(
            auth_path.clone(),
            "token_env".to_owned(),
        ));
        let context = test_context(base_url);

        let output = execute(&AuthSessionSubcommand::Refresh, &context, &mut runtime)
            .await
            .unwrap_or_else(|error| panic!("expected env refresh command to succeed: {error}"));
        server
            .join()
            .unwrap_or_else(|_| panic!("expected test server join to succeed"));

        assert_eq!(
            (
                runtime.auth_session.source(),
                runtime.auth_session.access_token().map(ToOwned::to_owned),
                auth_path.exists(),
                output.lines.get(1).map(ToOwned::to_owned),
            ),
            (
                AuthSessionSource::Environment,
                Some("token_env_refreshed".to_owned()),
                false,
                Some("Credentials: session-only (environment)".to_owned()),
            )
        );
    }

    #[tokio::test]
    async fn execute_refresh_reports_missing_credentials_as_not_logged_in() {
        let test_dir = std::env::temp_dir().join(format!("onequery-refresh-none-{}", Uuid::new_v4()));
        let auth_path = test_dir.join("auth.json");
        let mut runtime = test_runtime(AuthSessionStore::with_file_access_token_for_test(
            auth_path, None,
        ));
        let context = test_context(DEFAULT_BASE_URL.to_owned());

        let error = execute(&AuthSessionSubcommand::Refresh, &context, &mut runtime)
            .await
            .expect_err("expected refresh command to fail without credentials");

        assert_eq!(
            (error.title.as_str(), error.stage, error.try_next.clone(),),
            (
                "not logged in",
                ErrorStage::Auth,
                vec![
                    "oneq auth login".to_owned(),
                    "oneq auth import --input <path|->".to_owned(),
                ],
            )
        );
    }

    fn refresh_response_body(
        request_id: &str,
        access_token: &str,
        active_org_slug: Option<&str>,
    ) -> String {
        json!({
            "requestId": request_id,
            "data": {
                "accessToken": access_token,
                "authMode": "bearer_token",
                "user": {
                    "id": "user-1",
                    "email": "alice@example.com",
                    "displayName": "Alice",
                },
                "activeOrgSlug": active_org_slug,
                "issuedAt": "2026-03-10T00:00:00.000Z",
                "expiresAt": "2026-03-17T00:00:00.000Z",
            },
            "warnings": [],
        })
        .to_string()
    }

    fn sample_refreshed_session(
        access_token: &str,
        active_org: Option<&str>,
    ) -> RefreshedAuthSession {
        RefreshedAuthSession {
            completion: LoginCompletion {
                access_token: access_token.to_owned(),
                auth_mode: Some("bearer_token".to_owned()),
                user: UserProfile {
                    id: "user-1".to_owned(),
                    email: "alice@example.com".to_owned(),
                    display_name: "Alice".to_owned(),
                },
                issued_at: Some("2026-03-10T00:00:00Z".to_owned()),
                expires_at: Some("2026-03-17T00:00:00Z".to_owned()),
            },
            active_org: active_org.map(ToOwned::to_owned),
        }
    }

    fn test_context(base_url: String) -> CommandContext {
        CommandContext {
            command_line: "oneq auth session refresh".to_owned(),
            base_url,
            request_id: None,
            resolved_org: None,
            resolved_org_source: ResolvedOrgSource::None,
            verbose: false,
        }
    }

    fn test_runtime(auth_session: AuthSessionStore) -> Runtime<NoopBrowser, NoopTerminal> {
        Runtime {
            config: ConfigStore::with_state_for_test(
                PathBuf::from("/tmp/onequery-auth-session-refresh/config.toml"),
                AppConfig {
                    request_timeout_sec: 5,
                    ..AppConfig::default()
                },
            ),
            auth_session,
            browser: NoopBrowser,
            terminal: NoopTerminal,
        }
    }
}
