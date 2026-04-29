use serde_json::json;

use crate::output::CommandOutput;
use crate::workflows::runner::Transition;
use crate::workflows::runner::WorkflowLabel;
use onequery_core::error::CliError;

use super::super::CommandContext;
use super::AuthEffect;
use super::AuthEvent;
use super::AuthFailureOutcome;
use super::AuthState;
use super::AuthTerminalState;
use super::CompletedAuthResult;
use super::presentation::render_import_dry_run_output;
use super::presentation::render_logout_dry_run_output;
use super::presentation::render_whoami_output;
use super::presentation::select_single_org_slug;

pub(super) fn reduce(
    state: AuthState,
    event: AuthEvent,
    context: &CommandContext,
) -> Transition<AuthState, AuthTerminalState, AuthEffect> {
    match state {
        AuthState::Idle { mode } => match event {
            AuthEvent::Start => match mode {
                super::AuthMode::Login => Transition::continue_with_effect(
                    AuthState::StartingLogin,
                    AuthEffect::StartLoginSession,
                ),
                super::AuthMode::Import { input, dry_run } => Transition::continue_with_effect(
                    AuthState::LoadingImportInput { dry_run },
                    AuthEffect::LoadImportPayload { input },
                ),
                super::AuthMode::Logout {
                    dry_run,
                    persisted_credentials_present,
                    active_org,
                } => {
                    if dry_run {
                        Transition::done(AuthTerminalState::Completed {
                            result: Box::new(CompletedAuthResult::Rendered {
                                output: render_logout_dry_run_output(
                                    persisted_credentials_present,
                                    active_org.as_deref(),
                                ),
                            }),
                        })
                    } else {
                        Transition::continue_with_effect(
                            AuthState::RemovingCredentials,
                            AuthEffect::RemoveCredentials,
                        )
                    }
                }
                super::AuthMode::Whoami { read } => Transition::continue_with_effect(
                    AuthState::CheckingWhoamiAuth { read },
                    AuthEffect::EnsureAuthenticated,
                ),
            },
            AuthEvent::LoginSessionStarted { .. }
            | AuthEvent::LoginSessionStartFailed { .. }
            | AuthEvent::BrowserAttempted { .. }
            | AuthEvent::LoginAuthorized { .. }
            | AuthEvent::LoginCompleted { .. }
            | AuthEvent::LoginCompletionFailed { .. }
            | AuthEvent::ImportPayloadLoaded { .. }
            | AuthEvent::ImportPayloadLoadFailed { .. }
            | AuthEvent::ImportedSessionPersisted { .. }
            | AuthEvent::ImportedSessionPersistFailed { .. }
            | AuthEvent::TokenPersisted { .. }
            | AuthEvent::TokenPersistFailed { .. }
            | AuthEvent::BootstrapClientBuilt { .. }
            | AuthEvent::BootstrapClientBuildFailed { .. }
            | AuthEvent::BootstrapOrgsLoaded { .. }
            | AuthEvent::BootstrapOrgsLoadFailed { .. }
            | AuthEvent::BootstrapOrgPersisted { .. }
            | AuthEvent::BootstrapOrgPersistFailed { .. }
            | AuthEvent::LogoutCompleted
            | AuthEvent::ActiveOrgCleared
            | AuthEvent::ActiveOrgClearFailed { .. }
            | AuthEvent::LogoutFailed { .. }
            | AuthEvent::WhoamiAuthChecked
            | AuthEvent::WhoamiAuthFailed { .. }
            | AuthEvent::WhoamiFetched { .. }
            | AuthEvent::WhoamiFetchFailed { .. } => Transition::done(AuthTerminalState::Failed {
                error: unexpected_transition_error(context, AuthState::Idle { mode }, event),
            }),
        },
        AuthState::StartingLogin => match event {
            AuthEvent::LoginSessionStarted { session } => Transition::continue_with_effect(
                AuthState::AttemptingBrowser,
                AuthEffect::OpenBrowser { session },
            ),
            AuthEvent::LoginSessionStartFailed { error } => {
                Transition::done(AuthTerminalState::Failed { error })
            }
            AuthEvent::Start
            | AuthEvent::BrowserAttempted { .. }
            | AuthEvent::LoginAuthorized { .. }
            | AuthEvent::LoginCompleted { .. }
            | AuthEvent::LoginCompletionFailed { .. }
            | AuthEvent::ImportPayloadLoaded { .. }
            | AuthEvent::ImportPayloadLoadFailed { .. }
            | AuthEvent::ImportedSessionPersisted { .. }
            | AuthEvent::ImportedSessionPersistFailed { .. }
            | AuthEvent::TokenPersisted { .. }
            | AuthEvent::TokenPersistFailed { .. }
            | AuthEvent::BootstrapClientBuilt { .. }
            | AuthEvent::BootstrapClientBuildFailed { .. }
            | AuthEvent::BootstrapOrgsLoaded { .. }
            | AuthEvent::BootstrapOrgsLoadFailed { .. }
            | AuthEvent::BootstrapOrgPersisted { .. }
            | AuthEvent::BootstrapOrgPersistFailed { .. }
            | AuthEvent::LogoutCompleted
            | AuthEvent::ActiveOrgCleared
            | AuthEvent::ActiveOrgClearFailed { .. }
            | AuthEvent::LogoutFailed { .. }
            | AuthEvent::WhoamiAuthChecked
            | AuthEvent::WhoamiAuthFailed { .. }
            | AuthEvent::WhoamiFetched { .. }
            | AuthEvent::WhoamiFetchFailed { .. } => Transition::done(AuthTerminalState::Failed {
                error: unexpected_transition_error(context, AuthState::StartingLogin, event),
            }),
        },
        AuthState::LoadingImportInput { dry_run } => match event {
            AuthEvent::ImportPayloadLoaded { imported } => {
                if dry_run {
                    Transition::done(AuthTerminalState::Completed {
                        result: Box::new(CompletedAuthResult::Rendered {
                            output: render_import_dry_run_output(&imported),
                        }),
                    })
                } else {
                    Transition::continue_with_effect(
                        AuthState::PersistingImportedSession,
                        AuthEffect::PersistImportedSession { imported },
                    )
                }
            }
            AuthEvent::ImportPayloadLoadFailed { error } => {
                Transition::done(AuthTerminalState::Failed { error })
            }
            AuthEvent::Start
            | AuthEvent::LoginSessionStarted { .. }
            | AuthEvent::LoginSessionStartFailed { .. }
            | AuthEvent::BrowserAttempted { .. }
            | AuthEvent::LoginAuthorized { .. }
            | AuthEvent::LoginCompleted { .. }
            | AuthEvent::LoginCompletionFailed { .. }
            | AuthEvent::ImportedSessionPersisted { .. }
            | AuthEvent::ImportedSessionPersistFailed { .. }
            | AuthEvent::TokenPersisted { .. }
            | AuthEvent::TokenPersistFailed { .. }
            | AuthEvent::BootstrapClientBuilt { .. }
            | AuthEvent::BootstrapClientBuildFailed { .. }
            | AuthEvent::BootstrapOrgsLoaded { .. }
            | AuthEvent::BootstrapOrgsLoadFailed { .. }
            | AuthEvent::BootstrapOrgPersisted { .. }
            | AuthEvent::BootstrapOrgPersistFailed { .. }
            | AuthEvent::LogoutCompleted
            | AuthEvent::ActiveOrgCleared
            | AuthEvent::ActiveOrgClearFailed { .. }
            | AuthEvent::LogoutFailed { .. }
            | AuthEvent::WhoamiAuthChecked
            | AuthEvent::WhoamiAuthFailed { .. }
            | AuthEvent::WhoamiFetched { .. }
            | AuthEvent::WhoamiFetchFailed { .. } => Transition::done(AuthTerminalState::Failed {
                error: unexpected_transition_error(
                    context,
                    AuthState::LoadingImportInput { dry_run },
                    event,
                ),
            }),
        },
        AuthState::PersistingImportedSession => match event {
            AuthEvent::ImportedSessionPersisted { imported } => {
                Transition::done(AuthTerminalState::Completed {
                    result: Box::new(CompletedAuthResult::Import { imported }),
                })
            }
            AuthEvent::ImportedSessionPersistFailed { error } => {
                Transition::done(AuthTerminalState::Failed { error })
            }
            AuthEvent::Start
            | AuthEvent::LoginSessionStarted { .. }
            | AuthEvent::LoginSessionStartFailed { .. }
            | AuthEvent::BrowserAttempted { .. }
            | AuthEvent::LoginAuthorized { .. }
            | AuthEvent::LoginCompleted { .. }
            | AuthEvent::LoginCompletionFailed { .. }
            | AuthEvent::ImportPayloadLoaded { .. }
            | AuthEvent::ImportPayloadLoadFailed { .. }
            | AuthEvent::TokenPersisted { .. }
            | AuthEvent::TokenPersistFailed { .. }
            | AuthEvent::BootstrapClientBuilt { .. }
            | AuthEvent::BootstrapClientBuildFailed { .. }
            | AuthEvent::BootstrapOrgsLoaded { .. }
            | AuthEvent::BootstrapOrgsLoadFailed { .. }
            | AuthEvent::BootstrapOrgPersisted { .. }
            | AuthEvent::BootstrapOrgPersistFailed { .. }
            | AuthEvent::LogoutCompleted
            | AuthEvent::ActiveOrgCleared
            | AuthEvent::ActiveOrgClearFailed { .. }
            | AuthEvent::LogoutFailed { .. }
            | AuthEvent::WhoamiAuthChecked
            | AuthEvent::WhoamiAuthFailed { .. }
            | AuthEvent::WhoamiFetched { .. }
            | AuthEvent::WhoamiFetchFailed { .. } => Transition::done(AuthTerminalState::Failed {
                error: unexpected_transition_error(
                    context,
                    AuthState::PersistingImportedSession,
                    event,
                ),
            }),
        },
        AuthState::AttemptingBrowser => match event {
            AuthEvent::BrowserAttempted { session } => Transition::continue_with_effect(
                AuthState::PollingLogin,
                AuthEffect::PollLogin { session },
            ),
            AuthEvent::Start
            | AuthEvent::LoginSessionStarted { .. }
            | AuthEvent::LoginSessionStartFailed { .. }
            | AuthEvent::LoginAuthorized { .. }
            | AuthEvent::LoginCompleted { .. }
            | AuthEvent::LoginCompletionFailed { .. }
            | AuthEvent::ImportPayloadLoaded { .. }
            | AuthEvent::ImportPayloadLoadFailed { .. }
            | AuthEvent::ImportedSessionPersisted { .. }
            | AuthEvent::ImportedSessionPersistFailed { .. }
            | AuthEvent::TokenPersisted { .. }
            | AuthEvent::TokenPersistFailed { .. }
            | AuthEvent::BootstrapClientBuilt { .. }
            | AuthEvent::BootstrapClientBuildFailed { .. }
            | AuthEvent::BootstrapOrgsLoaded { .. }
            | AuthEvent::BootstrapOrgsLoadFailed { .. }
            | AuthEvent::BootstrapOrgPersisted { .. }
            | AuthEvent::BootstrapOrgPersistFailed { .. }
            | AuthEvent::LogoutCompleted
            | AuthEvent::ActiveOrgCleared
            | AuthEvent::ActiveOrgClearFailed { .. }
            | AuthEvent::LogoutFailed { .. }
            | AuthEvent::WhoamiAuthChecked
            | AuthEvent::WhoamiAuthFailed { .. }
            | AuthEvent::WhoamiFetched { .. }
            | AuthEvent::WhoamiFetchFailed { .. } => Transition::done(AuthTerminalState::Failed {
                error: unexpected_transition_error(context, AuthState::AttemptingBrowser, event),
            }),
        },
        AuthState::PollingLogin => match event {
            AuthEvent::LoginAuthorized { access_token } => Transition::continue_with_effect(
                AuthState::ResolvingLoginIdentity,
                AuthEffect::ResolveLoginIdentity { access_token },
            ),
            AuthEvent::LoginCompletionFailed { error } => {
                Transition::done(AuthTerminalState::Failed { error })
            }
            AuthEvent::Start
            | AuthEvent::LoginSessionStarted { .. }
            | AuthEvent::LoginSessionStartFailed { .. }
            | AuthEvent::BrowserAttempted { .. }
            | AuthEvent::LoginCompleted { .. }
            | AuthEvent::ImportPayloadLoaded { .. }
            | AuthEvent::ImportPayloadLoadFailed { .. }
            | AuthEvent::ImportedSessionPersisted { .. }
            | AuthEvent::ImportedSessionPersistFailed { .. }
            | AuthEvent::TokenPersisted { .. }
            | AuthEvent::TokenPersistFailed { .. }
            | AuthEvent::BootstrapClientBuilt { .. }
            | AuthEvent::BootstrapClientBuildFailed { .. }
            | AuthEvent::BootstrapOrgsLoaded { .. }
            | AuthEvent::BootstrapOrgsLoadFailed { .. }
            | AuthEvent::BootstrapOrgPersisted { .. }
            | AuthEvent::BootstrapOrgPersistFailed { .. }
            | AuthEvent::LogoutCompleted
            | AuthEvent::ActiveOrgCleared
            | AuthEvent::ActiveOrgClearFailed { .. }
            | AuthEvent::LogoutFailed { .. }
            | AuthEvent::WhoamiAuthChecked
            | AuthEvent::WhoamiAuthFailed { .. }
            | AuthEvent::WhoamiFetched { .. }
            | AuthEvent::WhoamiFetchFailed { .. } => Transition::done(AuthTerminalState::Failed {
                error: unexpected_transition_error(context, AuthState::PollingLogin, event),
            }),
        },
        AuthState::ResolvingLoginIdentity => match event {
            AuthEvent::LoginCompleted { completion } => Transition::continue_with_effect(
                AuthState::PersistingToken,
                AuthEffect::PersistToken { completion },
            ),
            AuthEvent::LoginCompletionFailed { error } => {
                Transition::done(AuthTerminalState::Failed { error })
            }
            AuthEvent::Start
            | AuthEvent::LoginSessionStarted { .. }
            | AuthEvent::LoginSessionStartFailed { .. }
            | AuthEvent::BrowserAttempted { .. }
            | AuthEvent::LoginAuthorized { .. }
            | AuthEvent::ImportPayloadLoaded { .. }
            | AuthEvent::ImportPayloadLoadFailed { .. }
            | AuthEvent::ImportedSessionPersisted { .. }
            | AuthEvent::ImportedSessionPersistFailed { .. }
            | AuthEvent::TokenPersisted { .. }
            | AuthEvent::TokenPersistFailed { .. }
            | AuthEvent::BootstrapClientBuilt { .. }
            | AuthEvent::BootstrapClientBuildFailed { .. }
            | AuthEvent::BootstrapOrgsLoaded { .. }
            | AuthEvent::BootstrapOrgsLoadFailed { .. }
            | AuthEvent::BootstrapOrgPersisted { .. }
            | AuthEvent::BootstrapOrgPersistFailed { .. }
            | AuthEvent::LogoutCompleted
            | AuthEvent::ActiveOrgCleared
            | AuthEvent::ActiveOrgClearFailed { .. }
            | AuthEvent::LogoutFailed { .. }
            | AuthEvent::WhoamiAuthChecked
            | AuthEvent::WhoamiAuthFailed { .. }
            | AuthEvent::WhoamiFetched { .. }
            | AuthEvent::WhoamiFetchFailed { .. } => Transition::done(AuthTerminalState::Failed {
                error: unexpected_transition_error(
                    context,
                    AuthState::ResolvingLoginIdentity,
                    event,
                ),
            }),
        },
        AuthState::PersistingToken => match event {
            AuthEvent::TokenPersistFailed { error } => {
                Transition::done(AuthTerminalState::Failed { error })
            }
            AuthEvent::TokenPersisted {
                completion,
                next_step,
            } => match next_step {
                super::PersistedLoginNextStep::BootstrapOrgSelection => {
                    Transition::continue_with_effect(
                        AuthState::BootstrappingOrgClient,
                        AuthEffect::BuildBootstrapClient { completion },
                    )
                }
                super::PersistedLoginNextStep::Complete => {
                    Transition::done(AuthTerminalState::Completed {
                        result: Box::new(CompletedAuthResult::Login {
                            completion,
                            active_org: None,
                            warnings: Vec::new(),
                        }),
                    })
                }
            },
            AuthEvent::Start
            | AuthEvent::LoginSessionStarted { .. }
            | AuthEvent::LoginSessionStartFailed { .. }
            | AuthEvent::BrowserAttempted { .. }
            | AuthEvent::LoginAuthorized { .. }
            | AuthEvent::LoginCompleted { .. }
            | AuthEvent::LoginCompletionFailed { .. }
            | AuthEvent::ImportPayloadLoaded { .. }
            | AuthEvent::ImportPayloadLoadFailed { .. }
            | AuthEvent::ImportedSessionPersisted { .. }
            | AuthEvent::ImportedSessionPersistFailed { .. }
            | AuthEvent::BootstrapClientBuilt { .. }
            | AuthEvent::BootstrapClientBuildFailed { .. }
            | AuthEvent::BootstrapOrgsLoaded { .. }
            | AuthEvent::BootstrapOrgsLoadFailed { .. }
            | AuthEvent::BootstrapOrgPersisted { .. }
            | AuthEvent::BootstrapOrgPersistFailed { .. }
            | AuthEvent::LogoutCompleted
            | AuthEvent::ActiveOrgCleared
            | AuthEvent::ActiveOrgClearFailed { .. }
            | AuthEvent::LogoutFailed { .. }
            | AuthEvent::WhoamiAuthChecked
            | AuthEvent::WhoamiAuthFailed { .. }
            | AuthEvent::WhoamiFetched { .. }
            | AuthEvent::WhoamiFetchFailed { .. } => Transition::done(AuthTerminalState::Failed {
                error: unexpected_transition_error(context, AuthState::PersistingToken, event),
            }),
        },
        AuthState::BootstrappingOrgClient => match event {
            AuthEvent::BootstrapClientBuilt { completion, client } => {
                Transition::continue_with_effect(
                    AuthState::BootstrappingOrgList,
                    AuthEffect::FetchBootstrapOrgs { completion, client },
                )
            }
            AuthEvent::BootstrapClientBuildFailed { completion, error } => {
                Transition::done(AuthTerminalState::Completed {
                    result: Box::new(CompletedAuthResult::Login {
                        completion,
                        active_org: None,
                        warnings: vec![error],
                    }),
                })
            }
            AuthEvent::Start
            | AuthEvent::LoginSessionStarted { .. }
            | AuthEvent::LoginSessionStartFailed { .. }
            | AuthEvent::BrowserAttempted { .. }
            | AuthEvent::LoginAuthorized { .. }
            | AuthEvent::LoginCompleted { .. }
            | AuthEvent::LoginCompletionFailed { .. }
            | AuthEvent::ImportPayloadLoaded { .. }
            | AuthEvent::ImportPayloadLoadFailed { .. }
            | AuthEvent::ImportedSessionPersisted { .. }
            | AuthEvent::ImportedSessionPersistFailed { .. }
            | AuthEvent::TokenPersisted { .. }
            | AuthEvent::TokenPersistFailed { .. }
            | AuthEvent::BootstrapOrgsLoaded { .. }
            | AuthEvent::BootstrapOrgsLoadFailed { .. }
            | AuthEvent::BootstrapOrgPersisted { .. }
            | AuthEvent::BootstrapOrgPersistFailed { .. }
            | AuthEvent::LogoutCompleted
            | AuthEvent::ActiveOrgCleared
            | AuthEvent::ActiveOrgClearFailed { .. }
            | AuthEvent::LogoutFailed { .. }
            | AuthEvent::WhoamiAuthChecked
            | AuthEvent::WhoamiAuthFailed { .. }
            | AuthEvent::WhoamiFetched { .. }
            | AuthEvent::WhoamiFetchFailed { .. } => Transition::done(AuthTerminalState::Failed {
                error: unexpected_transition_error(
                    context,
                    AuthState::BootstrappingOrgClient,
                    event,
                ),
            }),
        },
        AuthState::BootstrappingOrgList => match event {
            AuthEvent::BootstrapOrgsLoaded { completion, orgs } => {
                if let Some(only_org) = select_single_org_slug(&orgs) {
                    Transition::continue_with_effect(
                        AuthState::PersistingBootstrappedOrg,
                        AuthEffect::PersistBootstrappedOrg {
                            completion,
                            org: only_org,
                        },
                    )
                } else {
                    Transition::done(AuthTerminalState::Completed {
                        result: Box::new(CompletedAuthResult::Login {
                            completion,
                            active_org: None,
                            warnings: Vec::new(),
                        }),
                    })
                }
            }
            AuthEvent::BootstrapOrgsLoadFailed { completion, error } => {
                Transition::done(AuthTerminalState::Completed {
                    result: Box::new(CompletedAuthResult::Login {
                        completion,
                        active_org: None,
                        warnings: vec![error],
                    }),
                })
            }
            AuthEvent::Start
            | AuthEvent::LoginSessionStarted { .. }
            | AuthEvent::LoginSessionStartFailed { .. }
            | AuthEvent::BrowserAttempted { .. }
            | AuthEvent::LoginAuthorized { .. }
            | AuthEvent::LoginCompleted { .. }
            | AuthEvent::LoginCompletionFailed { .. }
            | AuthEvent::ImportPayloadLoaded { .. }
            | AuthEvent::ImportPayloadLoadFailed { .. }
            | AuthEvent::ImportedSessionPersisted { .. }
            | AuthEvent::ImportedSessionPersistFailed { .. }
            | AuthEvent::TokenPersisted { .. }
            | AuthEvent::TokenPersistFailed { .. }
            | AuthEvent::BootstrapClientBuilt { .. }
            | AuthEvent::BootstrapClientBuildFailed { .. }
            | AuthEvent::ActiveOrgCleared
            | AuthEvent::ActiveOrgClearFailed { .. }
            | AuthEvent::BootstrapOrgPersisted { .. }
            | AuthEvent::BootstrapOrgPersistFailed { .. }
            | AuthEvent::LogoutCompleted
            | AuthEvent::LogoutFailed { .. }
            | AuthEvent::WhoamiAuthChecked
            | AuthEvent::WhoamiAuthFailed { .. }
            | AuthEvent::WhoamiFetched { .. }
            | AuthEvent::WhoamiFetchFailed { .. } => Transition::done(AuthTerminalState::Failed {
                error: unexpected_transition_error(context, AuthState::BootstrappingOrgList, event),
            }),
        },
        AuthState::PersistingBootstrappedOrg => match event {
            AuthEvent::BootstrapOrgPersisted {
                completion,
                active_org,
            } => Transition::done(AuthTerminalState::Completed {
                result: Box::new(CompletedAuthResult::Login {
                    completion,
                    active_org: Some(active_org),
                    warnings: Vec::new(),
                }),
            }),
            AuthEvent::BootstrapOrgPersistFailed { completion, error } => {
                Transition::done(AuthTerminalState::Completed {
                    result: Box::new(CompletedAuthResult::Login {
                        completion,
                        active_org: None,
                        warnings: vec![error],
                    }),
                })
            }
            AuthEvent::Start
            | AuthEvent::LoginSessionStarted { .. }
            | AuthEvent::LoginSessionStartFailed { .. }
            | AuthEvent::BrowserAttempted { .. }
            | AuthEvent::LoginAuthorized { .. }
            | AuthEvent::LoginCompleted { .. }
            | AuthEvent::LoginCompletionFailed { .. }
            | AuthEvent::ImportPayloadLoaded { .. }
            | AuthEvent::ImportPayloadLoadFailed { .. }
            | AuthEvent::ImportedSessionPersisted { .. }
            | AuthEvent::ImportedSessionPersistFailed { .. }
            | AuthEvent::TokenPersisted { .. }
            | AuthEvent::TokenPersistFailed { .. }
            | AuthEvent::BootstrapClientBuilt { .. }
            | AuthEvent::BootstrapClientBuildFailed { .. }
            | AuthEvent::BootstrapOrgsLoaded { .. }
            | AuthEvent::BootstrapOrgsLoadFailed { .. }
            | AuthEvent::LogoutCompleted
            | AuthEvent::ActiveOrgCleared
            | AuthEvent::ActiveOrgClearFailed { .. }
            | AuthEvent::LogoutFailed { .. }
            | AuthEvent::WhoamiAuthChecked
            | AuthEvent::WhoamiAuthFailed { .. }
            | AuthEvent::WhoamiFetched { .. }
            | AuthEvent::WhoamiFetchFailed { .. } => Transition::done(AuthTerminalState::Failed {
                error: unexpected_transition_error(
                    context,
                    AuthState::PersistingBootstrappedOrg,
                    event,
                ),
            }),
        },
        AuthState::RemovingCredentials => match event {
            AuthEvent::LogoutCompleted => Transition::continue_with_effect(
                AuthState::ClearingActiveOrg,
                AuthEffect::ClearActiveOrg,
            ),
            AuthEvent::LogoutFailed { error } => {
                Transition::done(AuthTerminalState::Failed { error })
            }
            AuthEvent::Start
            | AuthEvent::LoginSessionStarted { .. }
            | AuthEvent::LoginSessionStartFailed { .. }
            | AuthEvent::BrowserAttempted { .. }
            | AuthEvent::LoginAuthorized { .. }
            | AuthEvent::LoginCompleted { .. }
            | AuthEvent::LoginCompletionFailed { .. }
            | AuthEvent::ImportPayloadLoaded { .. }
            | AuthEvent::ImportPayloadLoadFailed { .. }
            | AuthEvent::ImportedSessionPersisted { .. }
            | AuthEvent::ImportedSessionPersistFailed { .. }
            | AuthEvent::TokenPersisted { .. }
            | AuthEvent::TokenPersistFailed { .. }
            | AuthEvent::BootstrapClientBuilt { .. }
            | AuthEvent::BootstrapClientBuildFailed { .. }
            | AuthEvent::BootstrapOrgsLoaded { .. }
            | AuthEvent::BootstrapOrgsLoadFailed { .. }
            | AuthEvent::BootstrapOrgPersisted { .. }
            | AuthEvent::BootstrapOrgPersistFailed { .. }
            | AuthEvent::ActiveOrgCleared
            | AuthEvent::ActiveOrgClearFailed { .. }
            | AuthEvent::WhoamiAuthChecked
            | AuthEvent::WhoamiAuthFailed { .. }
            | AuthEvent::WhoamiFetched { .. }
            | AuthEvent::WhoamiFetchFailed { .. } => Transition::done(AuthTerminalState::Failed {
                error: unexpected_transition_error(context, AuthState::RemovingCredentials, event),
            }),
        },
        AuthState::ClearingActiveOrg => match event {
            AuthEvent::ActiveOrgCleared => Transition::done(AuthTerminalState::Completed {
                result: Box::new(CompletedAuthResult::Rendered {
                    output: CommandOutput::structured(
                        vec!["Logged out. Local credentials removed.".to_owned()],
                        json!({
                            "loggedOut": true,
                            "credentialsRemoved": true,
                            "activeOrgCleared": true,
                        }),
                    ),
                }),
            }),
            AuthEvent::ActiveOrgClearFailed { error } => {
                Transition::done(AuthTerminalState::Failed { error })
            }
            AuthEvent::Start
            | AuthEvent::LoginSessionStarted { .. }
            | AuthEvent::LoginSessionStartFailed { .. }
            | AuthEvent::BrowserAttempted { .. }
            | AuthEvent::LoginAuthorized { .. }
            | AuthEvent::LoginCompleted { .. }
            | AuthEvent::LoginCompletionFailed { .. }
            | AuthEvent::ImportPayloadLoaded { .. }
            | AuthEvent::ImportPayloadLoadFailed { .. }
            | AuthEvent::ImportedSessionPersisted { .. }
            | AuthEvent::ImportedSessionPersistFailed { .. }
            | AuthEvent::TokenPersisted { .. }
            | AuthEvent::TokenPersistFailed { .. }
            | AuthEvent::BootstrapClientBuilt { .. }
            | AuthEvent::BootstrapClientBuildFailed { .. }
            | AuthEvent::BootstrapOrgsLoaded { .. }
            | AuthEvent::BootstrapOrgsLoadFailed { .. }
            | AuthEvent::BootstrapOrgPersisted { .. }
            | AuthEvent::BootstrapOrgPersistFailed { .. }
            | AuthEvent::LogoutCompleted
            | AuthEvent::LogoutFailed { .. }
            | AuthEvent::WhoamiAuthChecked
            | AuthEvent::WhoamiAuthFailed { .. }
            | AuthEvent::WhoamiFetched { .. }
            | AuthEvent::WhoamiFetchFailed { .. } => Transition::done(AuthTerminalState::Failed {
                error: unexpected_transition_error(context, AuthState::ClearingActiveOrg, event),
            }),
        },
        AuthState::CheckingWhoamiAuth { read } => match event {
            AuthEvent::WhoamiAuthChecked => Transition::continue_with_effect(
                AuthState::FetchingWhoami { read },
                AuthEffect::FetchWhoami,
            ),
            AuthEvent::WhoamiAuthFailed { error } => {
                Transition::done(AuthTerminalState::Failed { error })
            }
            AuthEvent::Start
            | AuthEvent::LoginSessionStarted { .. }
            | AuthEvent::LoginSessionStartFailed { .. }
            | AuthEvent::BrowserAttempted { .. }
            | AuthEvent::LoginAuthorized { .. }
            | AuthEvent::LoginCompleted { .. }
            | AuthEvent::LoginCompletionFailed { .. }
            | AuthEvent::ImportPayloadLoaded { .. }
            | AuthEvent::ImportPayloadLoadFailed { .. }
            | AuthEvent::ImportedSessionPersisted { .. }
            | AuthEvent::ImportedSessionPersistFailed { .. }
            | AuthEvent::TokenPersisted { .. }
            | AuthEvent::TokenPersistFailed { .. }
            | AuthEvent::BootstrapClientBuilt { .. }
            | AuthEvent::BootstrapClientBuildFailed { .. }
            | AuthEvent::BootstrapOrgsLoaded { .. }
            | AuthEvent::BootstrapOrgsLoadFailed { .. }
            | AuthEvent::BootstrapOrgPersisted { .. }
            | AuthEvent::BootstrapOrgPersistFailed { .. }
            | AuthEvent::LogoutCompleted
            | AuthEvent::ActiveOrgCleared
            | AuthEvent::ActiveOrgClearFailed { .. }
            | AuthEvent::LogoutFailed { .. }
            | AuthEvent::WhoamiFetched { .. }
            | AuthEvent::WhoamiFetchFailed { .. } => Transition::done(AuthTerminalState::Failed {
                error: unexpected_transition_error(
                    context,
                    AuthState::CheckingWhoamiAuth { read },
                    event,
                ),
            }),
        },
        AuthState::FetchingWhoami { read } => match event {
            AuthEvent::WhoamiFetched {
                identity,
                request_id,
            } => match render_whoami_output(&identity, context, &read) {
                Ok(output) => Transition::done(AuthTerminalState::Completed {
                    result: Box::new(CompletedAuthResult::Rendered {
                        output: output.with_request_id(request_id),
                    }),
                }),
                Err(error) => Transition::done(AuthTerminalState::Failed { error }),
            },
            AuthEvent::WhoamiFetchFailed { error, outcome } => match outcome {
                AuthFailureOutcome::NeedsReauth => {
                    Transition::done(AuthTerminalState::NeedsReauth { error })
                }
                AuthFailureOutcome::Failed => Transition::done(AuthTerminalState::Failed { error }),
            },
            AuthEvent::Start
            | AuthEvent::LoginSessionStarted { .. }
            | AuthEvent::LoginSessionStartFailed { .. }
            | AuthEvent::BrowserAttempted { .. }
            | AuthEvent::LoginAuthorized { .. }
            | AuthEvent::LoginCompleted { .. }
            | AuthEvent::LoginCompletionFailed { .. }
            | AuthEvent::ImportPayloadLoaded { .. }
            | AuthEvent::ImportPayloadLoadFailed { .. }
            | AuthEvent::ImportedSessionPersisted { .. }
            | AuthEvent::ImportedSessionPersistFailed { .. }
            | AuthEvent::TokenPersisted { .. }
            | AuthEvent::TokenPersistFailed { .. }
            | AuthEvent::BootstrapClientBuilt { .. }
            | AuthEvent::BootstrapClientBuildFailed { .. }
            | AuthEvent::BootstrapOrgsLoaded { .. }
            | AuthEvent::BootstrapOrgsLoadFailed { .. }
            | AuthEvent::BootstrapOrgPersisted { .. }
            | AuthEvent::BootstrapOrgPersistFailed { .. }
            | AuthEvent::LogoutCompleted
            | AuthEvent::ActiveOrgCleared
            | AuthEvent::ActiveOrgClearFailed { .. }
            | AuthEvent::LogoutFailed { .. }
            | AuthEvent::WhoamiAuthChecked
            | AuthEvent::WhoamiAuthFailed { .. } => Transition::done(AuthTerminalState::Failed {
                error: unexpected_transition_error(
                    context,
                    AuthState::FetchingWhoami { read },
                    event,
                ),
            }),
        },
    }
}

fn unexpected_transition_error(
    context: &CommandContext,
    state: AuthState,
    event: AuthEvent,
) -> CliError {
    CliError::internal(
        context.command_line.clone(),
        format!(
            "unexpected auth workflow transition: state={}, event={}",
            state.workflow_label(),
            event.workflow_label()
        ),
    )
}

impl WorkflowLabel for AuthState {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Idle { .. } => "Idle",
            Self::StartingLogin => "StartingLogin",
            Self::LoadingImportInput { .. } => "LoadingImportInput",
            Self::PersistingImportedSession => "PersistingImportedSession",
            Self::AttemptingBrowser => "AttemptingBrowser",
            Self::PollingLogin => "PollingLogin",
            Self::ResolvingLoginIdentity => "ResolvingLoginIdentity",
            Self::PersistingToken => "PersistingToken",
            Self::BootstrappingOrgClient => "BootstrappingOrgClient",
            Self::BootstrappingOrgList => "BootstrappingOrgList",
            Self::PersistingBootstrappedOrg => "PersistingBootstrappedOrg",
            Self::RemovingCredentials => "RemovingCredentials",
            Self::ClearingActiveOrg => "ClearingActiveOrg",
            Self::CheckingWhoamiAuth { .. } => "CheckingWhoamiAuth",
            Self::FetchingWhoami { .. } => "FetchingWhoami",
        }
    }
}

impl WorkflowLabel for AuthTerminalState {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Completed { .. } => "Completed",
            Self::NeedsReauth { .. } => "NeedsReauth",
            Self::Failed { .. } => "Failed",
        }
    }
}

impl WorkflowLabel for AuthEvent {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Start => "Start",
            Self::LoginSessionStarted { .. } => "LoginSessionStarted",
            Self::LoginSessionStartFailed { .. } => "LoginSessionStartFailed",
            Self::BrowserAttempted { .. } => "BrowserAttempted",
            Self::LoginAuthorized { .. } => "LoginAuthorized",
            Self::LoginCompleted { .. } => "LoginCompleted",
            Self::LoginCompletionFailed { .. } => "LoginCompletionFailed",
            Self::ImportPayloadLoaded { .. } => "ImportPayloadLoaded",
            Self::ImportPayloadLoadFailed { .. } => "ImportPayloadLoadFailed",
            Self::ImportedSessionPersisted { .. } => "ImportedSessionPersisted",
            Self::ImportedSessionPersistFailed { .. } => "ImportedSessionPersistFailed",
            Self::TokenPersisted { .. } => "TokenPersisted",
            Self::TokenPersistFailed { .. } => "TokenPersistFailed",
            Self::BootstrapClientBuilt { .. } => "BootstrapClientBuilt",
            Self::BootstrapClientBuildFailed { .. } => "BootstrapClientBuildFailed",
            Self::BootstrapOrgsLoaded { .. } => "BootstrapOrgsLoaded",
            Self::BootstrapOrgsLoadFailed { .. } => "BootstrapOrgsLoadFailed",
            Self::BootstrapOrgPersisted { .. } => "BootstrapOrgPersisted",
            Self::BootstrapOrgPersistFailed { .. } => "BootstrapOrgPersistFailed",
            Self::LogoutCompleted => "LogoutCompleted",
            Self::ActiveOrgCleared => "ActiveOrgCleared",
            Self::ActiveOrgClearFailed { .. } => "ActiveOrgClearFailed",
            Self::LogoutFailed { .. } => "LogoutFailed",
            Self::WhoamiAuthChecked => "WhoamiAuthChecked",
            Self::WhoamiAuthFailed { .. } => "WhoamiAuthFailed",
            Self::WhoamiFetched { .. } => "WhoamiFetched",
            Self::WhoamiFetchFailed { .. } => "WhoamiFetchFailed",
        }
    }
}

impl WorkflowLabel for AuthEffect {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::StartLoginSession => "StartLoginSession",
            Self::LoadImportPayload { .. } => "LoadImportPayload",
            Self::OpenBrowser { .. } => "OpenBrowser",
            Self::PollLogin { .. } => "PollLogin",
            Self::ResolveLoginIdentity { .. } => "ResolveLoginIdentity",
            Self::PersistToken { .. } => "PersistToken",
            Self::PersistImportedSession { .. } => "PersistImportedSession",
            Self::BuildBootstrapClient { .. } => "BuildBootstrapClient",
            Self::FetchBootstrapOrgs { .. } => "FetchBootstrapOrgs",
            Self::PersistBootstrappedOrg { .. } => "PersistBootstrappedOrg",
            Self::RemoveCredentials => "RemoveCredentials",
            Self::ClearActiveOrg => "ClearActiveOrg",
            Self::EnsureAuthenticated => "EnsureAuthenticated",
            Self::FetchWhoami => "FetchWhoami",
        }
    }
}
