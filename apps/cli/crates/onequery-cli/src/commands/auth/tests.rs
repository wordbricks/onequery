use std::collections::VecDeque;
use std::fs;
use std::io::Read;
use std::io::Write;
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::mpsc;

use base64::Engine;
use buffa::Message;
use insta::assert_snapshot;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use pretty_assertions::assert_eq;
use uuid::Uuid;

use crate::cli::AuthImportArgs;
use crate::cli::AuthSubcommand;
use crate::cli::ReadArgs;
use crate::commands::ResolvedOrgSource;
use crate::commands::Runtime;
use crate::commands::auth_session::PersistedLoginNextStep;
use crate::config::AppConfig;
use crate::config::ConfigStore;
use crate::config::default_base_url;
use crate::credentials::AuthSessionStore;
use crate::credentials::ImportedAuthSession;
use crate::output::EffectiveOutputMode;
use crate::output::render_error;
use crate::platform::BrowserLaunchError;
use crate::platform::BrowserLauncher;
use crate::platform::Terminal;
use crate::transport::auth::LoginCompletion;
use crate::transport::auth::LoginSession;
use crate::transport::auth::UserProfile;
use crate::transport::auth::WhoAmI;
use crate::transport::generated;
use crate::transport::org::OrgSummary;
use crate::workflows::runner::DEFAULT_MAX_WORKFLOW_STEPS;
use crate::workflows::runner::TransitionProgress;
use crate::workflows::runner::WorkflowLabel;
use crate::workflows::runner::WorkflowRunConfig;
use crate::workflows::runner::run_reducer_workflow;

use super::super::CommandContext;
use super::AuthEffect;
use super::AuthEvent;
use super::AuthFailureOutcome;
use super::AuthMode;
use super::AuthState;
use super::AuthTerminalState;
use super::CompletedAuthResult;
use super::effects::execute_effect;
use super::presentation::render_import_dry_run_output;
use super::presentation::render_import_output;
use super::presentation::render_login_output;
use super::presentation::render_logout_dry_run_output;
use super::presentation::render_whoami_output;
use super::presentation::select_single_org_slug;
use super::workflow::reduce;

#[test]
fn select_single_org_slug_returns_org_when_only_one_is_available() {
    let orgs = vec![OrgSummary {
        slug: Some("acme".to_owned()),
        name: Some("Acme".to_owned()),
    }];

    assert_eq!(select_single_org_slug(&orgs), Some("acme".to_owned()));
}

#[test]
fn select_single_org_slug_returns_none_when_multiple_orgs_are_available() {
    let orgs = vec![
        OrgSummary {
            slug: Some("acme".to_owned()),
            name: Some("Acme".to_owned()),
        },
        OrgSummary {
            slug: Some("globex".to_owned()),
            name: Some("Globex".to_owned()),
        },
    ];

    assert_eq!(select_single_org_slug(&orgs), None);
}

#[test]
fn login_denied_error_snapshot_uses_canonical_retry_command() {
    let error = CliError::new(
        "login denied",
        "onequery auth login",
        ErrorStage::Auth,
        "browser authorization was denied before token exchange completed",
        vec!["onequery auth login".to_owned()],
    );

    assert_snapshot!(
        render_error(&error, EffectiveOutputMode::Text),
        @r#"
Error: login denied
Command: onequery auth login
Stage: auth
Why: browser authorization was denied before token exchange completed
Try:
  - onequery auth login
"#
    );
}

#[test]
fn login_output_snapshot_with_bootstrapped_org() {
    let output = render_login_output(
        &LoginCompletion {
            access_token: "pat_123".to_owned(),
            auth_mode: None,
            user: UserProfile {
                id: "user-1".to_owned(),
                email: "alice@example.com".to_owned(),
                display_name: "Alice".to_owned(),
            },
            issued_at: None,
            expires_at: None,
        },
        Some("acme".to_owned()),
        &[],
    );

    assert_snapshot!(output.lines.join("\n"));
}

#[test]
fn login_output_includes_bootstrap_warning() {
    let output = render_login_output(
        &LoginCompletion {
            access_token: "pat_123".to_owned(),
            auth_mode: None,
            user: UserProfile {
                id: "user-1".to_owned(),
                email: "alice@example.com".to_owned(),
                display_name: "Alice".to_owned(),
            },
            issued_at: None,
            expires_at: None,
        },
        None,
        &[CliError::new(
            "bootstrap failed",
            "onequery auth login",
            ErrorStage::ResolveOrg,
            "timeout",
            vec!["retry onequery auth login".to_owned()],
        )],
    );

    assert_snapshot!(output.lines.join("\n"));
}

#[test]
fn whoami_output_snapshot_uses_server_org_when_context_is_unresolved() {
    let output = render_whoami_output(
        &WhoAmI {
            auth_mode: Some("bearer_token".to_owned()),
            user: UserProfile {
                id: "user-1".to_owned(),
                email: "alice@example.com".to_owned(),
                display_name: "Alice".to_owned(),
            },
            active_org: Some("acme".to_owned()),
            issued_at: None,
            expires_at: None,
        },
        &CommandContext {
            command_line: "onequery auth whoami".to_owned(),
            base_url: default_base_url(),
            request_id: None,
            resolved_org: None,
            resolved_org_source: ResolvedOrgSource::None,
            verbose: false,
        },
        &ReadArgs::default(),
    )
    .expect("expected whoami output");

    assert_snapshot!(output.lines.join("\n"));
}

#[test]
fn whoami_output_snapshot_projects_selected_fields() {
    let output = render_whoami_output(
        &WhoAmI {
            auth_mode: Some("bearer_token".to_owned()),
            user: UserProfile {
                id: "user-1".to_owned(),
                email: "alice@example.com".to_owned(),
                display_name: "Alice".to_owned(),
            },
            active_org: Some("acme".to_owned()),
            issued_at: Some("2026-03-10T00:00:00.000Z".to_owned()),
            expires_at: Some("2026-03-17T00:00:00.000Z".to_owned()),
        },
        &CommandContext {
            command_line: "onequery auth whoami --fields user.email,effectiveOrg".to_owned(),
            base_url: default_base_url(),
            request_id: None,
            resolved_org: None,
            resolved_org_source: ResolvedOrgSource::None,
            verbose: false,
        },
        &ReadArgs {
            fields: Some("user.email,effectiveOrg".to_owned()),
        },
    )
    .expect("expected projected whoami output");

    assert_snapshot!(output.lines.join("\n"));
}

#[test]
fn import_output_snapshot_uses_email_when_display_name_is_missing() {
    let output = render_import_output(&ImportedAuthSession {
        user_id: "user-1".to_owned(),
        email: "alice@example.com".to_owned(),
        display_name: None,
        access_token: "pat_123".to_owned(),
        issued_at: Some("2026-03-10T00:00:00.000Z".to_owned()),
        expires_at: Some("2026-03-17T00:00:00.000Z".to_owned()),
        last_refresh: Some("2026-03-10T12:00:00Z".to_owned()),
    });

    assert_snapshot!(output.lines.join("\n"));
}

#[test]
fn import_dry_run_output_snapshot_uses_email_when_display_name_is_missing() {
    let output = render_import_dry_run_output(&ImportedAuthSession {
        user_id: "user-1".to_owned(),
        email: "alice@example.com".to_owned(),
        display_name: None,
        access_token: "pat_123".to_owned(),
        issued_at: Some("2026-03-10T00:00:00.000Z".to_owned()),
        expires_at: Some("2026-03-17T00:00:00.000Z".to_owned()),
        last_refresh: Some("2026-03-10T12:00:00Z".to_owned()),
    });

    assert_snapshot!(output.lines.join("\n"));
}

#[test]
fn logout_dry_run_output_snapshot_reports_local_state() {
    let output = render_logout_dry_run_output(true, Some("acme"));

    assert_snapshot!(output.lines.join("\n"));
}

#[test]
fn logout_transitions_to_explicit_active_org_cleanup() {
    let context = auth_context("onequery auth logout");
    let transition = reduce(
        AuthState::RemovingCredentials,
        AuthEvent::LogoutCompleted,
        &context,
    );

    match transition.into_progress() {
        TransitionProgress::Continue {
            next_state: AuthState::ClearingActiveOrg,
            effect: AuthEffect::ClearActiveOrg,
        } => {}
        other => {
            panic!("expected logout to clear active org after removing credentials, got {other:?}")
        }
    }
}

#[test]
fn logout_dry_run_completes_without_running_remove_credentials_effect() {
    let context = auth_context("onequery auth logout --dry-run");
    let transition = reduce(
        AuthState::Idle {
            mode: AuthMode::Logout {
                dry_run: true,
                persisted_credentials_present: true,
                active_org: Some("acme".to_owned()),
            },
        },
        AuthEvent::Start,
        &context,
    );

    match transition.into_progress() {
        TransitionProgress::Done { terminal_state } => match terminal_state {
            AuthTerminalState::Completed { result } => match *result {
                CompletedAuthResult::Rendered { output } => assert_eq!(
                    output.into_data(),
                    serde_json::json!({
                        "loggedOut": false,
                        "credentialsRemoved": false,
                        "activeOrgCleared": false,
                        "persistedCredentialsPresent": true,
                        "activeOrg": "acme",
                        "dryRun": true,
                        "plannedEffects": [
                            "remove_persisted_auth_session",
                            "clear_active_org"
                        ]
                    })
                ),
                other => panic!("expected rendered logout result, got {other:?}"),
            },
            other => panic!("expected completed logout result, got {other:?}"),
        },
        other => panic!("expected logout dry-run to complete immediately, got {other:?}"),
    }
}

#[test]
fn device_authorization_transitions_to_identity_resolution() {
    let context = auth_context("onequery auth login");
    let transition = reduce(
        AuthState::PollingLogin,
        AuthEvent::LoginAuthorized {
            access_token: "pat_device".to_owned(),
        },
        &context,
    );

    match transition.into_progress() {
        TransitionProgress::Continue {
            next_state: AuthState::ResolvingLoginIdentity,
            effect: AuthEffect::ResolveLoginIdentity { access_token },
        } => assert_eq!(access_token, "pat_device"),
        other => {
            panic!("expected device authorization to resolve login identity next, got {other:?}")
        }
    }
}

#[test]
fn unauthorized_whoami_failure_transitions_to_explicit_reauth_terminal_state() {
    let context = auth_context("onequery auth whoami");
    let transition = reduce(
        AuthState::FetchingWhoami {
            read: ReadArgs::default(),
        },
        AuthEvent::WhoamiFetchFailed {
            error: CliError::new(
                "whoami failed",
                context.command_line.clone(),
                ErrorStage::Auth,
                "stored credentials are no longer authorized",
                vec!["onequery auth login".to_owned()],
            ),
            outcome: AuthFailureOutcome::NeedsReauth,
        },
        &context,
    );

    match transition.into_progress() {
        TransitionProgress::Done {
            terminal_state: AuthTerminalState::NeedsReauth { error },
        } => assert_eq!(error.stage, ErrorStage::Auth),
        other => panic!("expected needs-reauth terminal transition, got {other:?}"),
    }
}

#[tokio::test]
async fn logout_clears_stored_credentials_and_active_org_selection() {
    let test_dir = std::env::temp_dir().join(format!("onequery-auth-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&test_dir).unwrap_or_else(|error| {
        panic!("expected auth test directory creation to succeed: {error}");
    });

    let config_path = test_dir.join("config.toml");
    let credentials_path = test_dir.join("auth.json");
    let mut runtime = Runtime {
        config: ConfigStore::with_state_for_test(
            config_path,
            AppConfig {
                active_org: Some("acme".to_owned()),
                ..AppConfig::default()
            },
        ),
        auth_session: AuthSessionStore::with_file_access_token_for_test(
            credentials_path,
            Some("pat_old".to_owned()),
        ),
        browser: NoopBrowser,
        terminal: NoopTerminal,
        process: crate::process_context::ProcessContext::default(),
    };

    let logout_context = auth_context("onequery auth logout");
    execute_effect(AuthEffect::RemoveCredentials, &logout_context, &mut runtime).await;
    execute_effect(AuthEffect::ClearActiveOrg, &logout_context, &mut runtime).await;

    assert_eq!(
        (
            runtime.auth_session.access_token(),
            runtime.config.data().clone(),
        ),
        (None, AppConfig::default())
    );

    fs::remove_dir_all(&test_dir).unwrap_or_else(|cleanup_error| {
        panic!("expected auth test directory cleanup to succeed: {cleanup_error}");
    });
}

#[tokio::test]
async fn auth_import_persists_auth_session_from_file_payload() {
    let test_dir = std::env::temp_dir().join(format!("onequery-auth-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&test_dir).unwrap_or_else(|error| {
        panic!("expected auth test directory creation to succeed: {error}");
    });

    let import_path = test_dir.join("import-auth.json");
    fs::write(
        &import_path,
        serde_json::to_string_pretty(&serde_json::json!({
            "user": {
                "id": "user-9",
                "email": "imported@example.com",
            },
            "tokens": {
                "access_token": "pat_imported",
                "issued_at": "2026-03-11T00:00:00.000Z",
                "expires_at": "2026-03-18T00:00:00.000Z"
            },
            "last_refresh": "2026-03-11T12:00:00Z"
        }))
        .unwrap_or_else(|error| {
            panic!("expected import payload serialization to succeed: {error}")
        }),
    )
    .unwrap_or_else(|error| panic!("expected import payload write to succeed: {error}"));

    let config_path = test_dir.join("config.toml");
    let credentials_path = test_dir.join("auth.json");
    let mut runtime = Runtime {
        config: ConfigStore::with_state_for_test(config_path, AppConfig::default()),
        auth_session: AuthSessionStore::with_file_access_token_for_test(
            credentials_path.clone(),
            None,
        ),
        browser: NoopBrowser,
        terminal: NoopTerminal,
        process: crate::process_context::ProcessContext::default(),
    };

    let output = super::execute(
        &AuthSubcommand::Import(AuthImportArgs {
            input: import_path.clone(),
            dry_run: false,
        }),
        &auth_context("onequery auth import --input import-auth.json"),
        &mut runtime,
    )
    .await
    .unwrap_or_else(|error| panic!("expected auth import to succeed: {error}"));

    assert_eq!(
        output.into_data(),
        serde_json::json!({
            "user": {
                "id": "user-9",
                "email": "imported@example.com",
                "displayName": null
            },
            "imported": true,
            "credentialsStored": true,
            "issuedAt": "2026-03-11T00:00:00.000Z",
            "expiresAt": "2026-03-18T00:00:00.000Z",
            "lastRefresh": "2026-03-11T12:00:00Z"
        })
    );

    let stored = fs::read_to_string(&credentials_path)
        .unwrap_or_else(|error| panic!("expected imported auth file read to succeed: {error}"));

    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&stored).unwrap_or_else(|error| panic!(
            "expected imported auth file parse to succeed: {error}"
        )),
        serde_json::json!({
            "user": {
                "id": "user-9",
                "email": "imported@example.com"
            },
            "tokens": {
                "access_token": "pat_imported",
                "issued_at": "2026-03-11T00:00:00.000Z",
                "expires_at": "2026-03-18T00:00:00.000Z"
            },
            "last_refresh": "2026-03-11T12:00:00Z"
        })
    );

    fs::remove_dir_all(&test_dir).unwrap_or_else(|cleanup_error| {
        panic!("expected auth test directory cleanup to succeed: {cleanup_error}");
    });
}

#[tokio::test]
async fn auth_import_dry_run_validates_payload_without_persisting_session() {
    let test_dir = std::env::temp_dir().join(format!("onequery-auth-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&test_dir).unwrap_or_else(|error| {
        panic!("expected auth test directory creation to succeed: {error}");
    });

    let import_path = test_dir.join("import-auth.json");
    fs::write(
        &import_path,
        serde_json::to_string_pretty(&serde_json::json!({
            "user": {
                "id": "user-9",
                "email": "imported@example.com",
            },
            "tokens": {
                "access_token": "pat_imported",
                "issued_at": "2026-03-11T00:00:00.000Z",
                "expires_at": "2026-03-18T00:00:00.000Z"
            },
            "last_refresh": "2026-03-11T12:00:00Z"
        }))
        .unwrap_or_else(|error| {
            panic!("expected import payload serialization to succeed: {error}")
        }),
    )
    .unwrap_or_else(|error| panic!("expected import payload write to succeed: {error}"));

    let config_path = test_dir.join("config.toml");
    let credentials_path = test_dir.join("auth.json");
    let mut runtime = Runtime {
        config: ConfigStore::with_state_for_test(config_path, AppConfig::default()),
        auth_session: AuthSessionStore::with_file_access_token_for_test(
            credentials_path.clone(),
            None,
        ),
        browser: NoopBrowser,
        terminal: NoopTerminal,
        process: crate::process_context::ProcessContext::default(),
    };

    let output = super::execute(
        &AuthSubcommand::Import(AuthImportArgs {
            input: import_path.clone(),
            dry_run: true,
        }),
        &auth_context("onequery auth import --input import-auth.json --dry-run"),
        &mut runtime,
    )
    .await
    .unwrap_or_else(|error| panic!("expected auth import dry run to succeed: {error}"));

    assert_eq!(
        output.into_data(),
        serde_json::json!({
            "user": {
                "id": "user-9",
                "email": "imported@example.com",
                "displayName": null
            },
            "imported": false,
            "credentialsStored": false,
            "issuedAt": "2026-03-11T00:00:00.000Z",
            "expiresAt": "2026-03-18T00:00:00.000Z",
            "lastRefresh": "2026-03-11T12:00:00Z",
            "dryRun": true,
            "validatedInput": {
                "user": {
                    "id": "user-9",
                    "email": "imported@example.com",
                    "display_name": null
                },
                "tokens": {
                    "access_token_redacted": true,
                    "issued_at": "2026-03-11T00:00:00.000Z",
                    "expires_at": "2026-03-18T00:00:00.000Z"
                },
                "last_refresh": "2026-03-11T12:00:00Z"
            },
            "plannedEffects": ["persist_local_auth_session"]
        })
    );

    assert_eq!(credentials_path.exists(), false);

    fs::remove_dir_all(&test_dir).unwrap_or_else(|cleanup_error| {
        panic!("expected auth test directory cleanup to succeed: {cleanup_error}");
    });
}

#[tokio::test]
async fn login_after_logout_marks_the_next_identity_for_org_bootstrap() {
    let test_dir = std::env::temp_dir().join(format!("onequery-auth-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&test_dir).unwrap_or_else(|error| {
        panic!("expected auth test directory creation to succeed: {error}");
    });

    let config_path = test_dir.join("config.toml");
    let credentials_path = test_dir.join("auth.json");
    let mut runtime = Runtime {
        config: ConfigStore::with_state_for_test(
            config_path,
            AppConfig {
                active_org: Some("acme".to_owned()),
                ..AppConfig::default()
            },
        ),
        auth_session: AuthSessionStore::with_file_access_token_for_test(
            credentials_path,
            Some("pat_old".to_owned()),
        ),
        browser: NoopBrowser,
        terminal: NoopTerminal,
        process: crate::process_context::ProcessContext::default(),
    };

    let logout_context = auth_context("onequery auth logout");
    execute_effect(AuthEffect::RemoveCredentials, &logout_context, &mut runtime).await;
    execute_effect(AuthEffect::ClearActiveOrg, &logout_context, &mut runtime).await;

    let login_context = auth_context("onequery auth login");
    let completion = LoginCompletion {
        access_token: "pat_new".to_owned(),
        auth_mode: None,
        user: UserProfile {
            id: "user-2".to_owned(),
            email: "bob@example.com".to_owned(),
            display_name: "Bob".to_owned(),
        },
        issued_at: None,
        expires_at: None,
    };
    let login_event = execute_effect(
        AuthEffect::PersistToken {
            completion: completion.clone(),
        },
        &login_context,
        &mut runtime,
    )
    .await;

    assert_eq!(
        match login_event {
            AuthEvent::TokenPersisted {
                completion: actual_completion,
                next_step,
            } => (actual_completion, next_step),
            other => panic!("expected persisted token event, got {other:?}"),
        },
        (completion, PersistedLoginNextStep::BootstrapOrgSelection)
    );

    fs::remove_dir_all(&test_dir).unwrap_or_else(|cleanup_error| {
        panic!("expected auth test directory cleanup to succeed: {cleanup_error}");
    });
}

#[tokio::test]
async fn poll_login_effect_device_denial_posts_to_the_device_authorization_poll_endpoint_and_returns_a_failed_login_completion_event()
 {
    let listener =
        TcpListener::bind("127.0.0.1:0").expect("expected login poll test listener to bind");
    let address = listener
        .local_addr()
        .expect("expected login poll test listener address");
    let (request_tx, request_rx) = mpsc::channel();

    std::thread::spawn(move || {
        let (mut stream, _) = listener
            .accept()
            .expect("expected CLI poll request to connect to test listener");

        let mut request_bytes = Vec::new();
        let mut chunk = [0_u8; 1024];
        loop {
            let read = stream
                .read(&mut chunk)
                .expect("expected login poll request bytes");
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
            .expect("expected login poll request receiver");

        let cli_error_detail = base64::engine::general_purpose::STANDARD_NO_PAD.encode(
            generated::types::CliErrorDetail {
                code: Some(generated::types::CliProblemCode::CLI_PROBLEM_CODE_LOGIN_DENIED.into()),
                stage: Some(generated::types::CliProblemStage::CLI_PROBLEM_STAGE_AUTH.into()),
                title: Some("Login Denied".to_owned()),
                hint: Some("run `onequery auth login` again".to_owned()),
                retryable: Some(false),
                request_id: Some("req_denied".to_owned()),
                ..Default::default()
            }
            .encode_to_bytes(),
        );
        let response_body = format!(
            r#"{{"code":"permission_denied","message":"device authorization was denied","details":[{{"type":"type.googleapis.com/onequery.cli.v1.CliErrorDetail","value":"{cli_error_detail}"}}]}}"#
        );
        let response = format!(
            "HTTP/1.1 403 Forbidden\r\ncontent-type: application/json\r\ncontent-length: {}\r\nx-request-id: req_denied\r\nconnection: close\r\n\r\n{}",
            response_body.len(),
            response_body
        );
        stream
            .write_all(response.as_bytes())
            .expect("expected login poll response write");
    });

    let test_dir = std::env::temp_dir().join(format!("onequery-auth-test-{}", Uuid::new_v4()));
    let config_path = test_dir.join("config.toml");
    let credentials_path = test_dir.join("auth.json");
    let mut runtime = Runtime {
        config: ConfigStore::with_state_for_test(config_path, AppConfig::default()),
        auth_session: AuthSessionStore::with_file_access_token_for_test(credentials_path, None),
        browser: NoopBrowser,
        terminal: NoopTerminal,
        process: crate::process_context::ProcessContext::default(),
    };
    let context = CommandContext {
        command_line: "onequery auth login".to_owned(),
        base_url: format!("http://{address}"),
        request_id: None,
        resolved_org: None,
        resolved_org_source: ResolvedOrgSource::None,
        verbose: false,
    };

    let event = execute_effect(
        AuthEffect::PollLogin {
            session: LoginSession {
                device_code: "device-code-123".to_owned(),
                user_code: "ABCD1234".to_owned(),
                verification_uri: "https://example.test/device".to_owned(),
                verification_uri_complete: "https://example.test/device?user_code=ABCD1234"
                    .to_owned(),
                poll_interval_ms: 1_000,
                expires_in_sec: 180,
            },
        },
        &context,
        &mut runtime,
    )
    .await;

    let request = request_rx
        .recv()
        .expect("expected auth poll workflow to issue exactly one poll request");
    assert!(request.starts_with(
        "POST /api/cli/onequery.cli.v1.CliService/PollDeviceAuthorization HTTP/1.1\r\n"
    ));

    assert_eq!(
        match event {
            AuthEvent::LoginCompletionFailed { error } => (
                error.title.clone(),
                error.command.clone(),
                error.stage,
                error.why.clone(),
                error.try_next.clone(),
            ),
            other => panic!("expected denied device authorization event, got {other:?}"),
        },
        (
            "login denied".to_owned(),
            "onequery auth login".to_owned(),
            ErrorStage::Auth,
            "browser authorization was denied before token exchange completed".to_owned(),
            vec!["onequery auth login".to_owned()],
        )
    );
}

#[tokio::test]
async fn auth_workflow_login_without_bootstrap_runs_effects_through_token_persistence() {
    let completion = sample_login_completion();
    let (terminal_state, effect_log) = run_scripted_auth_workflow(
        AuthMode::Login,
        vec![
            ScriptedAuthStep::new(
                "StartLoginSession",
                AuthEvent::LoginSessionStarted {
                    session: sample_login_session(),
                },
            ),
            ScriptedAuthStep::new(
                "OpenBrowser",
                AuthEvent::BrowserAttempted {
                    session: sample_login_session(),
                },
            ),
            ScriptedAuthStep::new(
                "PollLogin",
                AuthEvent::LoginAuthorized {
                    access_token: completion.access_token.clone(),
                },
            ),
            ScriptedAuthStep::new(
                "ResolveLoginIdentity",
                AuthEvent::LoginCompleted {
                    completion: completion.clone(),
                },
            ),
            ScriptedAuthStep::new(
                "PersistToken",
                AuthEvent::TokenPersisted {
                    completion: completion.clone(),
                    next_step: PersistedLoginNextStep::Complete,
                },
            ),
        ],
    )
    .await;

    assert_eq!(
        effect_log,
        vec![
            "StartLoginSession",
            "OpenBrowser",
            "PollLogin",
            "ResolveLoginIdentity",
            "PersistToken",
        ]
    );

    assert_eq!(
        match terminal_state {
            AuthTerminalState::Completed { result } => match *result {
                CompletedAuthResult::Login {
                    completion: actual_completion,
                    active_org,
                    warnings,
                } => (actual_completion, active_org, warnings.is_empty()),
                other => panic!("expected login completion result, got {other:?}"),
            },
            other => panic!("expected successful login terminal state, got {other:?}"),
        },
        (completion, None, true)
    );
}

#[tokio::test]
async fn auth_workflow_login_device_denial_stops_after_poll_login_effect() {
    let (terminal_state, effect_log) = run_scripted_auth_workflow(
        AuthMode::Login,
        vec![
            ScriptedAuthStep::new(
                "StartLoginSession",
                AuthEvent::LoginSessionStarted {
                    session: sample_login_session(),
                },
            ),
            ScriptedAuthStep::new(
                "OpenBrowser",
                AuthEvent::BrowserAttempted {
                    session: sample_login_session(),
                },
            ),
            ScriptedAuthStep::new(
                "PollLogin",
                AuthEvent::LoginCompletionFailed {
                    error: CliError::new(
                        "login denied",
                        "onequery auth login",
                        ErrorStage::Auth,
                        "browser authorization was denied before token exchange completed",
                        vec!["onequery auth login".to_owned()],
                    ),
                },
            ),
        ],
    )
    .await;

    assert_eq!(
        effect_log,
        vec!["StartLoginSession", "OpenBrowser", "PollLogin"]
    );

    assert_eq!(
        match terminal_state {
            AuthTerminalState::Failed { error } => (
                error.title.clone(),
                error.command.clone(),
                error.stage,
                error.why.clone(),
                error.try_next.clone(),
                error.request_id.clone(),
                error.hint.clone(),
                error.validation_issues.clone(),
            ),
            other => panic!("expected failed auth terminal state, got {other:?}"),
        },
        (
            "login denied".to_owned(),
            "onequery auth login".to_owned(),
            ErrorStage::Auth,
            "browser authorization was denied before token exchange completed".to_owned(),
            vec!["onequery auth login".to_owned()],
            None,
            None,
            Vec::new(),
        )
    );
}

#[tokio::test]
async fn auth_workflow_login_expired_session_stops_after_poll_login_effect() {
    let (terminal_state, effect_log) = run_scripted_auth_workflow(
        AuthMode::Login,
        vec![
            ScriptedAuthStep::new(
                "StartLoginSession",
                AuthEvent::LoginSessionStarted {
                    session: sample_login_session(),
                },
            ),
            ScriptedAuthStep::new(
                "OpenBrowser",
                AuthEvent::BrowserAttempted {
                    session: sample_login_session(),
                },
            ),
            ScriptedAuthStep::new(
                "PollLogin",
                AuthEvent::LoginCompletionFailed {
                    error: CliError::new(
                        "login session expired",
                        "onequery auth login",
                        ErrorStage::Auth,
                        "browser authorization session expired before token exchange completed",
                        vec!["onequery auth login".to_owned()],
                    ),
                },
            ),
        ],
    )
    .await;

    assert_eq!(
        effect_log,
        vec!["StartLoginSession", "OpenBrowser", "PollLogin"]
    );

    assert_eq!(
        match terminal_state {
            AuthTerminalState::Failed { error } => (
                error.title.clone(),
                error.command.clone(),
                error.stage,
                error.why.clone(),
                error.try_next.clone(),
                error.request_id.clone(),
                error.hint.clone(),
                error.validation_issues.clone(),
            ),
            other => panic!("expected failed auth terminal state, got {other:?}"),
        },
        (
            "login session expired".to_owned(),
            "onequery auth login".to_owned(),
            ErrorStage::Auth,
            "browser authorization session expired before token exchange completed".to_owned(),
            vec!["onequery auth login".to_owned()],
            None,
            None,
            Vec::new(),
        )
    );
}

#[tokio::test]
async fn auth_workflow_login_token_persist_failure_runs_effects_through_persist_token() {
    let completion = sample_login_completion();
    let (terminal_state, effect_log) = run_scripted_auth_workflow(
        AuthMode::Login,
        vec![
            ScriptedAuthStep::new(
                "StartLoginSession",
                AuthEvent::LoginSessionStarted {
                    session: sample_login_session(),
                },
            ),
            ScriptedAuthStep::new(
                "OpenBrowser",
                AuthEvent::BrowserAttempted {
                    session: sample_login_session(),
                },
            ),
            ScriptedAuthStep::new(
                "PollLogin",
                AuthEvent::LoginAuthorized {
                    access_token: completion.access_token.clone(),
                },
            ),
            ScriptedAuthStep::new(
                "ResolveLoginIdentity",
                AuthEvent::LoginCompleted {
                    completion: completion.clone(),
                },
            ),
            ScriptedAuthStep::new(
                "PersistToken",
                AuthEvent::TokenPersistFailed {
                    error: CliError::new(
                        "persist credentials failed",
                        "onequery auth login",
                        ErrorStage::LoadCredentials,
                        "failed to write stored auth session",
                        vec!["retry onequery auth login".to_owned()],
                    ),
                },
            ),
        ],
    )
    .await;

    assert_eq!(
        effect_log,
        vec![
            "StartLoginSession",
            "OpenBrowser",
            "PollLogin",
            "ResolveLoginIdentity",
            "PersistToken",
        ]
    );

    assert_eq!(
        match terminal_state {
            AuthTerminalState::Failed { error } => (
                error.title.clone(),
                error.command.clone(),
                error.stage,
                error.why.clone(),
                error.try_next.clone(),
                error.request_id.clone(),
                error.hint.clone(),
                error.validation_issues.clone(),
            ),
            other => panic!("expected failed auth terminal state, got {other:?}"),
        },
        (
            "persist credentials failed".to_owned(),
            "onequery auth login".to_owned(),
            ErrorStage::LoadCredentials,
            "failed to write stored auth session".to_owned(),
            vec!["retry onequery auth login".to_owned()],
            None,
            None,
            Vec::new(),
        )
    );
}

fn auth_context(command_line: &str) -> CommandContext {
    CommandContext {
        command_line: command_line.to_owned(),
        base_url: default_base_url(),
        request_id: None,
        resolved_org: None,
        resolved_org_source: ResolvedOrgSource::None,
        verbose: false,
    }
}

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

#[derive(Debug)]
struct ScriptedAuthStep {
    expected_effect: &'static str,
    emitted_event: AuthEvent,
}

impl ScriptedAuthStep {
    fn new(expected_effect: &'static str, emitted_event: AuthEvent) -> Self {
        Self {
            expected_effect,
            emitted_event,
        }
    }
}

async fn run_scripted_auth_workflow(
    mode: AuthMode,
    scripted_steps: Vec<ScriptedAuthStep>,
) -> (AuthTerminalState, Vec<&'static str>) {
    let context = auth_context(match mode {
        AuthMode::Login => "onequery auth login",
        AuthMode::Import { .. } => "onequery auth import --input ./auth.json",
        AuthMode::Logout { .. } => "onequery auth logout",
        AuthMode::Whoami { .. } => "onequery auth whoami",
    });
    let mut runtime = ();
    let mut effect_log = Vec::new();
    let mut scripted_steps = VecDeque::from(scripted_steps);

    let terminal_state = run_reducer_workflow(
        AuthState::Idle { mode },
        AuthEvent::Start,
        WorkflowRunConfig {
            context: &context,
            runtime: &mut runtime,
            workflow_name: "auth",
            command_line: &context.command_line,
            verbose: false,
            max_steps: DEFAULT_MAX_WORKFLOW_STEPS,
        },
        reduce,
        |effect, _, _| {
            let effect_label = effect.workflow_label();
            effect_log.push(effect_label);

            let Some(step) = scripted_steps.pop_front() else {
                panic!("expected scripted event for effect {effect_label}");
            };
            assert_eq!(effect_label, step.expected_effect);

            Box::pin(async move { step.emitted_event })
        },
    )
    .await
    .expect("expected scripted auth workflow to terminate");

    assert_eq!(scripted_steps.len(), 0);

    (terminal_state, effect_log)
}

#[tokio::test]
async fn import_workflow_loads_payload_before_persisting_session() {
    let imported = ImportedAuthSession {
        user_id: "user-7".to_owned(),
        email: "alice@example.com".to_owned(),
        display_name: Some("Alice".to_owned()),
        access_token: "pat_imported".to_owned(),
        issued_at: None,
        expires_at: None,
        last_refresh: Some("2026-03-10T12:00:00Z".to_owned()),
    };
    let (terminal_state, effect_log) = run_scripted_auth_workflow(
        AuthMode::Import {
            input: PathBuf::from("auth.json"),
            dry_run: false,
        },
        vec![
            ScriptedAuthStep::new(
                "LoadImportPayload",
                AuthEvent::ImportPayloadLoaded {
                    imported: imported.clone(),
                },
            ),
            ScriptedAuthStep::new(
                "PersistImportedSession",
                AuthEvent::ImportedSessionPersisted {
                    imported: imported.clone(),
                },
            ),
        ],
    )
    .await;

    assert_eq!(
        effect_log,
        vec!["LoadImportPayload", "PersistImportedSession"]
    );
    match terminal_state {
        AuthTerminalState::Completed { result } => match *result {
            CompletedAuthResult::Import { imported: actual } => assert_eq!(actual, imported),
            other => panic!("expected imported session result, got {other:?}"),
        },
        other => {
            panic!("expected auth import workflow to complete with imported session, got {other:?}")
        }
    }
}

fn sample_login_session() -> LoginSession {
    LoginSession {
        device_code: "device-code-123".to_owned(),
        user_code: "ABCD1234".to_owned(),
        verification_uri: "https://example.test/device".to_owned(),
        verification_uri_complete: "https://example.test/device?user_code=ABCD1234".to_owned(),
        poll_interval_ms: 1_000,
        expires_in_sec: 180,
    }
}

fn sample_login_completion() -> LoginCompletion {
    LoginCompletion {
        access_token: "pat_123".to_owned(),
        auth_mode: None,
        user: UserProfile {
            id: "user-1".to_owned(),
            email: "alice@example.com".to_owned(),
            display_name: "Alice".to_owned(),
        },
        issued_at: Some("2026-03-10T00:00:00.000Z".to_owned()),
        expires_at: Some("2026-03-17T00:00:00.000Z".to_owned()),
    }
}
