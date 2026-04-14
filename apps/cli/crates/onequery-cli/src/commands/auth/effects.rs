use std::io::IsTerminal;
use std::path::Path;
use std::path::PathBuf;

use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use tokio::fs;
use tokio::io::AsyncReadExt;
use tokio::time::Duration;
use tokio::time::sleep;

use crate::credentials::ImportedAuthSession;
use crate::path_utils::resolve_user_path_for_cli;
use crate::presentation::api_failure::ApiErrorPresentation;
use crate::presentation::api_failure::present_api_client_build_failure;
use crate::presentation::api_failure::present_api_failure_with_context;
use crate::transport::auth;
use crate::transport::client::UnauthenticatedApiClient;
use crate::transport::org;
use crate::transport::read_controls::ReadRequestControls;
use crate::workflows::login_poll;
use crate::workflows::retry::RetryDirective;
use crate::workflows::retry::classify_retry_directive;
use crate::workflows::runner::DEFAULT_MAX_WORKFLOW_STEPS;
use crate::workflows::runner::WorkflowRunConfig;
use crate::workflows::runner::run_reducer_workflow;

use super::super::CommandContext;
use super::super::Runtime;
use super::super::auth_session::authenticated_api_client;
use super::super::auth_session::clear_auth_session;
use super::super::auth_session::ensure_authenticated;
use super::super::auth_session::persist_login_completion;
use super::super::auth_session::unauthenticated_api_client;
use super::AuthEffect;
use super::AuthEvent;
use super::AuthFailureOutcome;

struct LoginPollWorkflowContext<'a> {
    client: &'a UnauthenticatedApiClient,
    verbose: bool,
}

pub(super) async fn execute_effect<B, T>(
    effect: AuthEffect,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> AuthEvent
where
    B: crate::platform::BrowserLauncher,
    T: crate::platform::Terminal,
{
    match effect {
        AuthEffect::LoadImportPayload { input } => load_import_payload(input, context).await,
        AuthEffect::OpenBrowser { session } => open_browser(session, runtime),
        AuthEffect::PersistImportedSession { imported } => execute_session_effect(
            AuthEffect::PersistImportedSession { imported },
            context,
            runtime,
        ),
        AuthEffect::PersistToken { completion } => {
            execute_session_effect(AuthEffect::PersistToken { completion }, context, runtime)
        }
        AuthEffect::RemoveCredentials => {
            execute_session_effect(AuthEffect::RemoveCredentials, context, runtime)
        }
        AuthEffect::ClearActiveOrg => {
            execute_session_effect(AuthEffect::ClearActiveOrg, context, runtime)
        }
        AuthEffect::EnsureAuthenticated => match ensure_authenticated(context, runtime).await {
            Ok(()) => AuthEvent::WhoamiAuthChecked,
            Err(error) => AuthEvent::WhoamiAuthFailed { error },
        },
        AuthEffect::StartLoginSession
        | AuthEffect::PollLogin { .. }
        | AuthEffect::ResolveLoginIdentity { .. }
        | AuthEffect::BuildBootstrapClient { .. }
        | AuthEffect::FetchBootstrapOrgs { .. }
        | AuthEffect::PersistBootstrappedOrg { .. }
        | AuthEffect::FetchWhoami => execute_transport_effect(effect, context, runtime).await,
    }
}

async fn load_import_payload(input: PathBuf, context: &CommandContext) -> AuthEvent {
    match load_imported_auth_session(&input, context).await {
        Ok(imported) => AuthEvent::ImportPayloadLoaded { imported },
        Err(error) => AuthEvent::ImportPayloadLoadFailed { error },
    }
}

async fn load_imported_auth_session(
    input_path: &Path,
    context: &CommandContext,
) -> Result<ImportedAuthSession, CliError> {
    let raw = read_import_payload_json(input_path, context).await?;
    ImportedAuthSession::from_raw_json(&raw, &context.command_line)
}

async fn read_import_payload_json(
    input_path: &Path,
    context: &CommandContext,
) -> Result<String, CliError> {
    if input_path.as_os_str() == "-" {
        if std::io::stdin().is_terminal() {
            return Err(CliError::new(
                "stdin is required for --input -",
                context.command_line.clone(),
                ErrorStage::LoadCredentials,
                "no piped stdin input detected. --input - requires one UTF-8 JSON auth session payload from stdin.",
                import_input_examples(),
            ));
        }

        let mut buffer = String::new();
        tokio::io::stdin()
            .read_to_string(&mut buffer)
            .await
            .map_err(|stdin_error| {
                CliError::new(
                    "failed to read auth session import from stdin",
                    context.command_line.clone(),
                    ErrorStage::LoadCredentials,
                    stdin_error.to_string(),
                    import_input_examples(),
                )
            })?;
        return Ok(buffer);
    }

    let resolved_input_path = resolve_user_path_for_cli(
        input_path,
        &context.command_line,
        ErrorStage::LoadCredentials,
        "failed to resolve auth session import file",
        import_input_examples(),
    )?;

    let metadata = fs::metadata(&resolved_input_path)
        .await
        .map_err(|metadata_error| {
            CliError::new(
                "failed to read auth session import file",
                context.command_line.clone(),
                ErrorStage::LoadCredentials,
                format!("{metadata_error} ({})", resolved_input_path.display()),
                import_input_examples(),
            )
        })?;
    if !metadata.is_file() {
        return Err(CliError::new(
            "failed to read auth session import file",
            context.command_line.clone(),
            ErrorStage::LoadCredentials,
            format!(
                "path is not a regular file ({})",
                resolved_input_path.display()
            ),
            import_input_examples(),
        ));
    }

    fs::read_to_string(&resolved_input_path)
        .await
        .map_err(|read_error| {
            CliError::new(
                "failed to read auth session import file",
                context.command_line.clone(),
                ErrorStage::LoadCredentials,
                format!("{read_error} ({})", resolved_input_path.display()),
                import_input_examples(),
            )
        })
}

fn import_input_examples() -> Vec<String> {
    vec![
        "cat auth.json | onequery auth import --input -".to_owned(),
        "onequery auth import --input ./auth.json".to_owned(),
    ]
}

fn execute_session_effect<B, T>(
    effect: AuthEffect,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> AuthEvent {
    match effect {
        AuthEffect::PersistImportedSession { imported } => match runtime
            .auth_session
            .persist_imported_session(&imported, &context.command_line)
        {
            Ok(()) => AuthEvent::ImportedSessionPersisted { imported },
            Err(error) => AuthEvent::ImportedSessionPersistFailed { error },
        },
        AuthEffect::PersistToken { completion } => {
            match persist_login_completion(context, runtime, completion) {
                Ok(persisted_login) => AuthEvent::TokenPersisted {
                    completion: persisted_login.completion,
                    next_step: persisted_login.next_step,
                },
                Err(error) => AuthEvent::TokenPersistFailed { error },
            }
        }
        AuthEffect::RemoveCredentials => match clear_auth_session(context, runtime) {
            Ok(()) => AuthEvent::LogoutCompleted,
            Err(error) => AuthEvent::LogoutFailed { error },
        },
        AuthEffect::ClearActiveOrg => {
            match runtime.config.clear_active_org(&context.command_line) {
                Ok(()) => AuthEvent::ActiveOrgCleared,
                Err(error) => AuthEvent::ActiveOrgClearFailed {
                    error: logout_active_org_clear_error(context, runtime.config.path(), &error),
                },
            }
        }
        AuthEffect::StartLoginSession
        | AuthEffect::LoadImportPayload { .. }
        | AuthEffect::OpenBrowser { .. }
        | AuthEffect::PollLogin { .. }
        | AuthEffect::ResolveLoginIdentity { .. }
        | AuthEffect::BuildBootstrapClient { .. }
        | AuthEffect::FetchBootstrapOrgs { .. }
        | AuthEffect::PersistBootstrappedOrg { .. }
        | AuthEffect::EnsureAuthenticated
        | AuthEffect::FetchWhoami => unreachable!(),
    }
}

async fn execute_transport_effect<B, T>(
    effect: AuthEffect,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> AuthEvent
where
    B: crate::platform::BrowserLauncher,
    T: crate::platform::Terminal,
{
    match effect {
        AuthEffect::StartLoginSession => execute_start_login_session(context, runtime).await,
        AuthEffect::PollLogin { session } => execute_poll_login(session, context, runtime).await,
        AuthEffect::ResolveLoginIdentity { access_token } => {
            execute_resolve_login_identity(access_token, context, runtime).await
        }
        AuthEffect::BuildBootstrapClient { completion } => {
            match authenticated_api_client(context, runtime) {
                Ok(client) => AuthEvent::BootstrapClientBuilt {
                    completion,
                    client: Box::new(client),
                },
                Err(error) => AuthEvent::BootstrapClientBuildFailed { completion, error },
            }
        }
        AuthEffect::FetchBootstrapOrgs { completion, client } => {
            match org::list_orgs_with_controls(
                client.as_ref(),
                &ReadRequestControls {
                    page_all: true,
                    ..ReadRequestControls::default()
                },
            )
            .await
            {
                Ok(response) => AuthEvent::BootstrapOrgsLoaded {
                    completion,
                    orgs: response.payload.organizations,
                },
                Err(failure) => AuthEvent::BootstrapOrgsLoadFailed {
                    completion,
                    error: present_api_failure_with_context(
                        failure,
                        context,
                        ApiErrorPresentation {
                            command: &context.command_line,
                            title: "org list failed",
                            transport_why_prefix: "failed to reach org list endpoint",
                            decode_why_prefix: "failed to decode org list response",
                            fallback_try_next: vec![
                                "run onequery auth login".to_owned(),
                                "retry onequery org list".to_owned(),
                            ],
                            unauthorized_try_next: None,
                        },
                    ),
                },
            }
        }
        AuthEffect::PersistBootstrappedOrg { completion, org } => {
            match runtime
                .config
                .set_active_org(Some(org.clone()), &context.command_line)
            {
                Ok(()) => AuthEvent::BootstrapOrgPersisted {
                    completion,
                    active_org: org,
                },
                Err(error) => AuthEvent::BootstrapOrgPersistFailed { completion, error },
            }
        }
        AuthEffect::FetchWhoami => {
            let client = match authenticated_api_client(context, runtime) {
                Ok(client) => client,
                Err(error) => {
                    return AuthEvent::WhoamiFetchFailed {
                        error,
                        outcome: AuthFailureOutcome::Failed,
                    };
                }
            };

            match auth::whoami(&client).await {
                Ok(response) => AuthEvent::WhoamiFetched {
                    identity: response.payload,
                    request_id: response.request_id,
                },
                Err(failure) => AuthEvent::WhoamiFetchFailed {
                    outcome: auth_failure_outcome(&failure),
                    error: present_api_failure_with_context(
                        failure,
                        context,
                        ApiErrorPresentation {
                            command: &context.command_line,
                            title: "whoami failed",
                            transport_why_prefix: "failed to reach whoami endpoint",
                            decode_why_prefix: "failed to decode whoami response",
                            fallback_try_next: vec![
                                "run onequery auth login".to_owned(),
                                format!("retry {}", context.command_line),
                            ],
                            unauthorized_try_next: None,
                        },
                    ),
                },
            }
        }
        AuthEffect::LoadImportPayload { .. }
        | AuthEffect::OpenBrowser { .. }
        | AuthEffect::PersistToken { .. }
        | AuthEffect::PersistImportedSession { .. }
        | AuthEffect::RemoveCredentials
        | AuthEffect::ClearActiveOrg
        | AuthEffect::EnsureAuthenticated => unreachable!(),
    }
}

async fn execute_start_login_session<B, T>(
    context: &CommandContext,
    runtime: &Runtime<B, T>,
) -> AuthEvent {
    let client = match unauthenticated_api_client(context, runtime) {
        Ok(client) => client,
        Err(error) => return AuthEvent::LoginSessionStartFailed { error },
    };

    match auth::start_login_session(&client).await {
        Ok(response) => AuthEvent::LoginSessionStarted {
            session: response.payload,
        },
        Err(failure) => AuthEvent::LoginSessionStartFailed {
            error: present_api_failure_with_context(
                failure,
                context,
                ApiErrorPresentation {
                    command: &context.command_line,
                    title: "login start failed",
                    transport_why_prefix: "failed to reach login start endpoint",
                    decode_why_prefix: "failed to decode login start response",
                    fallback_try_next: vec![format!("retry {}", context.command_line)],
                    unauthorized_try_next: None,
                },
            ),
        },
    }
}

fn open_browser<B, T>(session: auth::LoginSession, runtime: &mut Runtime<B, T>) -> AuthEvent
where
    B: crate::platform::BrowserLauncher,
    T: crate::platform::Terminal,
{
    let login_url_message = format!("Login URL: {}", session.verification_uri_complete);
    runtime.terminal.stderr_line(&login_url_message);
    let user_code_message = format!("User code: {}", session.user_code);
    runtime.terminal.stderr_line(&user_code_message);

    match runtime.browser.open_url(&session.verification_uri_complete) {
        Ok(()) => runtime
            .terminal
            .stderr_line("Opened browser for authentication."),
        Err(open_error) => {
            let browser_error_message = format!(
                "Could not open browser automatically ({open_error}). Open the URL manually."
            );
            runtime.terminal.stderr_line(&browser_error_message);
        }
    }

    AuthEvent::BrowserAttempted { session }
}

async fn execute_poll_login<B, T>(
    session: auth::LoginSession,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> AuthEvent
where
    B: crate::platform::BrowserLauncher,
    T: crate::platform::Terminal,
{
    runtime
        .terminal
        .stderr_line("Waiting for browser authorization...");

    let client = match unauthenticated_api_client(context, runtime) {
        Ok(client) => client,
        Err(error) => return AuthEvent::LoginCompletionFailed { error },
    };
    let poll_context = LoginPollWorkflowContext {
        client: &client,
        verbose: context.verbose,
    };
    let poll_result = run_reducer_workflow(
        login_poll::LoginPollState::Idle { session },
        login_poll::LoginPollEvent::Start,
        WorkflowRunConfig {
            context: &poll_context,
            runtime,
            workflow_name: "auth_login_poll",
            command_line: &context.command_line,
            verbose: context.verbose,
            max_steps: DEFAULT_MAX_WORKFLOW_STEPS,
        },
        |state, event, _| login_poll::reduce(state, event),
        |effect, poll_context, runtime| {
            Box::pin(execute_login_poll_effect(effect, poll_context, runtime))
        },
    )
    .await;

    match poll_result {
        Ok(login_poll::LoginPollTerminalState::Authorized { access_token }) => {
            AuthEvent::LoginAuthorized { access_token }
        }
        Ok(login_poll::LoginPollTerminalState::Denied) => AuthEvent::LoginCompletionFailed {
            error: CliError::new(
                "login denied",
                context.command_line.clone(),
                ErrorStage::Auth,
                "browser authorization was denied before token exchange completed",
                vec!["run onequery auth login again".to_owned()],
            ),
        },
        Ok(login_poll::LoginPollTerminalState::Expired) => AuthEvent::LoginCompletionFailed {
            error: CliError::new(
                "login session expired",
                context.command_line.clone(),
                ErrorStage::Auth,
                "browser authorization session expired before token exchange completed",
                vec!["run onequery auth login again".to_owned()],
            ),
        },
        Ok(login_poll::LoginPollTerminalState::TimedOut { expires_in_sec }) => {
            AuthEvent::LoginCompletionFailed {
                error: CliError::new(
                    "login timed out",
                    context.command_line.clone(),
                    ErrorStage::Auth,
                    format!("did not receive authorization after {expires_in_sec} seconds"),
                    vec!["run onequery auth login again".to_owned()],
                ),
            }
        }
        Ok(login_poll::LoginPollTerminalState::TransportFailed { failure }) => {
            AuthEvent::LoginCompletionFailed {
                error: present_api_failure_with_context(
                    failure,
                    context,
                    ApiErrorPresentation {
                        command: &context.command_line,
                        title: "login poll failed",
                        transport_why_prefix: "failed to poll login session",
                        decode_why_prefix: "failed to decode login poll response",
                        fallback_try_next: vec!["run onequery auth login again".to_owned()],
                        unauthorized_try_next: None,
                    },
                ),
            }
        }
        Ok(login_poll::LoginPollTerminalState::InternalError { message }) => {
            AuthEvent::LoginCompletionFailed {
                error: CliError::internal(context.command_line.clone(), message),
            }
        }
        Err(error) => AuthEvent::LoginCompletionFailed { error },
    }
}

async fn execute_resolve_login_identity<B, T>(
    access_token: String,
    context: &CommandContext,
    runtime: &Runtime<B, T>,
) -> AuthEvent {
    let client = match unauthenticated_api_client(context, runtime) {
        Ok(client) => client,
        Err(error) => return AuthEvent::LoginCompletionFailed { error },
    };
    let authenticated_client = match client.authenticate(&access_token) {
        Ok(client) => client,
        Err(failure) => {
            return AuthEvent::LoginCompletionFailed {
                error: present_api_client_build_failure(failure, &context.command_line),
            };
        }
    };

    match auth::whoami(&authenticated_client).await {
        Ok(response) => {
            let identity = response.payload;
            AuthEvent::LoginCompleted {
                completion: auth::LoginCompletion {
                    access_token,
                    auth_mode: identity.auth_mode,
                    user: identity.user,
                    issued_at: identity.issued_at,
                    expires_at: identity.expires_at,
                },
            }
        }
        Err(failure) => AuthEvent::LoginCompletionFailed {
            error: present_api_failure_with_context(
                failure,
                context,
                ApiErrorPresentation {
                    command: &context.command_line,
                    title: "login identity lookup failed",
                    transport_why_prefix: "failed to reach whoami endpoint after device authorization",
                    decode_why_prefix: "failed to decode whoami response after device authorization",
                    fallback_try_next: vec!["run onequery auth login again".to_owned()],
                    unauthorized_try_next: None,
                },
            ),
        },
    }
}

fn auth_failure_outcome(failure: &crate::transport::api_failure::ApiFailure) -> AuthFailureOutcome {
    if classify_retry_directive(failure) == RetryDirective::NeedsReauth {
        AuthFailureOutcome::NeedsReauth
    } else {
        AuthFailureOutcome::Failed
    }
}

fn logout_active_org_clear_error(
    context: &CommandContext,
    config_path: &Path,
    error: &CliError,
) -> CliError {
    CliError::new(
        "logout completed, but active org cleanup failed",
        context.command_line.clone(),
        error.stage,
        format!("stored auth session was cleared, but {}", error.why),
        vec![
            "retry onequery auth logout".to_owned(),
            format!("remove or fix {}", config_path.display()),
        ],
    )
}

async fn execute_login_poll_effect<B, T>(
    effect: login_poll::LoginPollEffect,
    context: &LoginPollWorkflowContext<'_>,
    runtime: &mut Runtime<B, T>,
) -> login_poll::LoginPollEvent
where
    B: crate::platform::BrowserLauncher,
    T: crate::platform::Terminal,
{
    match effect {
        login_poll::LoginPollEffect::PollOnce { session } => {
            match auth::poll_login_session(context.client, &session).await {
                Ok(response) => login_poll::LoginPollEvent::PollSucceeded {
                    outcome: response.payload,
                },
                Err(failure) => login_poll::LoginPollEvent::PollFailed { failure },
            }
        }
        login_poll::LoginPollEffect::WaitBeforeNextPoll {
            next_attempt,
            delay_ms,
        } => {
            if context.verbose {
                let retry_wait_message = format!(
                    "Authorization pending. Retrying poll attempt {next_attempt} after {delay_ms}ms..."
                );
                runtime.terminal.stderr_line(&retry_wait_message);
            }
            sleep(Duration::from_millis(delay_ms)).await;
            login_poll::LoginPollEvent::WaitElapsed
        }
    }
}
