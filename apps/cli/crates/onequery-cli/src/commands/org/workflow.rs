use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;
use tokio::time::Duration;
use tokio::time::sleep;

use crate::cli::ListReadArgs;
use crate::cli::OrgSubcommand;
use crate::output::CommandOutput;
use crate::output::TerminalOutput;
use crate::presentation::api_failure::ApiErrorPresentation;
use crate::presentation::api_failure::present_api_failure_with_context;
use crate::transport::org;
use crate::transport::org::OrgListPayload;
use crate::transport::read_controls::ReadRequestControls;
use crate::workflows::retry::RetryTransition;
use crate::workflows::retry::classify_retry_directive;
use crate::workflows::retry::plan_retry_transition;
use crate::workflows::runner::DEFAULT_MAX_WORKFLOW_STEPS;
use crate::workflows::runner::Transition;
use crate::workflows::runner::WorkflowLabel;
use crate::workflows::runner::WorkflowRunConfig;
use crate::workflows::runner::run_reducer_workflow;

use super::super::CommandContext;
use super::super::Runtime;
use super::super::auth_session::authenticated_api_client;
use super::super::auth_session::ensure_authenticated;
use super::super::read_controls_from_list_args;
use super::presentation::current;
use super::presentation::render_org_list_output;
use super::presentation::render_use_org_dry_run_output;
use super::presentation::render_use_org_unchanged_output;
use super::presentation::render_use_org_updated_output;

pub(super) const ORG_LIST_MAX_ATTEMPTS: u8 = 2;
pub(super) const ORG_LIST_RETRY_DELAY_MS: u64 = 200;

#[derive(Debug, Clone)]
pub(super) enum OrgMode {
    List {
        read: ListReadArgs,
    },
    Current,
    Use {
        next_org: String,
        configured_active_org: Option<String>,
        dry_run: bool,
    },
}

#[derive(Debug, Clone)]
pub(super) enum OrgLoadRequest {
    List {
        read: ListReadArgs,
    },
    Use {
        next_org: String,
        configured_active_org: Option<String>,
        dry_run: bool,
    },
}

#[derive(Debug)]
pub(super) enum OrgState {
    Idle {
        mode: OrgMode,
    },
    CheckingAuth {
        mode: OrgMode,
    },
    LoadingOrgs {
        request: OrgLoadRequest,
        attempt: u8,
    },
    WaitingToRetryOrgLoad {
        request: OrgLoadRequest,
        next_attempt: u8,
    },
    PersistingUse {
        request_id: Option<String>,
    },
}

#[derive(Debug)]
pub(super) enum OrgTerminalState {
    Completed { output: TerminalOutput },
    NeedsReauth { error: CliError },
    Failed { error: CliError },
}

#[derive(Debug)]
pub(super) enum OrgEvent {
    Start,
    Authenticated,
    AuthFailed {
        error: CliError,
    },
    OrgsLoaded {
        payload: OrgListPayload,
        request_id: Option<String>,
    },
    OrgsLoadFailed {
        error: CliError,
        retry: RetryTransition,
    },
    OrgRetryDelayElapsed,
    ActiveOrgPersisted {
        org: String,
    },
    ActiveOrgPersistFailed {
        error: CliError,
    },
}

#[derive(Debug)]
pub(super) enum OrgEffect {
    EnsureAuthenticated,
    FetchOrgs {
        attempt: u8,
        request: OrgLoadRequest,
    },
    WaitBeforeRetryOrgLoad {
        delay_ms: u64,
    },
    PersistActiveOrg {
        org: String,
    },
}

pub(super) async fn run<B, T>(
    command: &OrgSubcommand,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError>
where
    B: crate::platform::BrowserLauncher,
    T: crate::platform::Terminal,
{
    let mode = build_mode(command, context, runtime)?;

    let final_state = run_reducer_workflow(
        OrgState::Idle { mode },
        OrgEvent::Start,
        WorkflowRunConfig {
            context,
            runtime,
            workflow_name: "org",
            command_line: &context.command_line,
            verbose: context.verbose,
            max_steps: DEFAULT_MAX_WORKFLOW_STEPS,
        },
        reduce,
        |effect, workflow_context, workflow_runtime| {
            Box::pin(execute_effect(effect, workflow_context, workflow_runtime))
        },
    )
    .await?;

    match final_state {
        OrgTerminalState::Completed { output } => Ok(output.into_inner()),
        OrgTerminalState::NeedsReauth { error } | OrgTerminalState::Failed { error } => Err(error),
    }
}

fn build_mode<B, T>(
    command: &OrgSubcommand,
    context: &CommandContext,
    runtime: &Runtime<B, T>,
) -> Result<OrgMode, CliError> {
    let mode = match command {
        OrgSubcommand::List { read } => OrgMode::List { read: read.clone() },
        OrgSubcommand::Get { .. } => {
            return Err(CliError::internal(
                context.command_line.clone(),
                "org get should bypass the org list/use workflow",
            ));
        }
        OrgSubcommand::Current => OrgMode::Current,
        OrgSubcommand::Use { org_slug, dry_run } => OrgMode::Use {
            next_org: normalize_org_slug(org_slug, context)?.to_owned(),
            configured_active_org: runtime
                .config
                .data()
                .active_org
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned),
            dry_run: *dry_run,
        },
    };

    Ok(mode)
}

pub(super) fn reduce(
    state: OrgState,
    event: OrgEvent,
    context: &CommandContext,
) -> Transition<OrgState, OrgTerminalState, OrgEffect> {
    match state {
        OrgState::Idle { mode } => match event {
            OrgEvent::Start => match mode {
                OrgMode::Current => Transition::done(OrgTerminalState::Completed {
                    output: TerminalOutput::new(current(context)),
                }),
                OrgMode::List { .. } | OrgMode::Use { .. } => Transition::continue_with_effect(
                    OrgState::CheckingAuth { mode },
                    OrgEffect::EnsureAuthenticated,
                ),
            },
            OrgEvent::Authenticated
            | OrgEvent::AuthFailed { .. }
            | OrgEvent::OrgsLoaded { .. }
            | OrgEvent::OrgsLoadFailed { .. }
            | OrgEvent::OrgRetryDelayElapsed
            | OrgEvent::ActiveOrgPersisted { .. }
            | OrgEvent::ActiveOrgPersistFailed { .. } => {
                Transition::done(OrgTerminalState::Failed {
                    error: unexpected_transition_error(context, OrgState::Idle { mode }, event),
                })
            }
        },
        OrgState::CheckingAuth { mode } => match event {
            OrgEvent::Authenticated => match mode {
                OrgMode::List { read } => Transition::continue_with_effect(
                    OrgState::LoadingOrgs {
                        request: OrgLoadRequest::List { read: read.clone() },
                        attempt: 1,
                    },
                    OrgEffect::FetchOrgs {
                        attempt: 1,
                        request: OrgLoadRequest::List { read },
                    },
                ),
                OrgMode::Use {
                    next_org,
                    configured_active_org,
                    dry_run,
                } => Transition::continue_with_effect(
                    OrgState::LoadingOrgs {
                        request: OrgLoadRequest::Use {
                            next_org: next_org.clone(),
                            configured_active_org: configured_active_org.clone(),
                            dry_run,
                        },
                        attempt: 1,
                    },
                    OrgEffect::FetchOrgs {
                        attempt: 1,
                        request: OrgLoadRequest::Use {
                            next_org,
                            configured_active_org,
                            dry_run,
                        },
                    },
                ),
                OrgMode::Current => Transition::done(OrgTerminalState::Failed {
                    error: CliError::internal(
                        context.command_line.clone(),
                        "org current should not require auth workflow branch",
                    ),
                }),
            },
            OrgEvent::AuthFailed { error } => Transition::done(OrgTerminalState::Failed { error }),
            OrgEvent::Start
            | OrgEvent::OrgsLoaded { .. }
            | OrgEvent::OrgsLoadFailed { .. }
            | OrgEvent::OrgRetryDelayElapsed
            | OrgEvent::ActiveOrgPersisted { .. }
            | OrgEvent::ActiveOrgPersistFailed { .. } => {
                Transition::done(OrgTerminalState::Failed {
                    error: unexpected_transition_error(
                        context,
                        OrgState::CheckingAuth { mode },
                        event,
                    ),
                })
            }
        },
        OrgState::LoadingOrgs { request, attempt } => match event {
            OrgEvent::OrgsLoaded {
                payload,
                request_id,
            } => match request {
                OrgLoadRequest::List { read } => match render_org_list_output(payload, &read) {
                    Ok(output) => Transition::done(OrgTerminalState::Completed {
                        output: TerminalOutput::new(output.with_request_id(request_id)),
                    }),
                    Err(error) => Transition::done(OrgTerminalState::Failed { error }),
                },
                OrgLoadRequest::Use {
                    next_org,
                    configured_active_org,
                    dry_run,
                } => {
                    let org_exists = payload
                        .organizations
                        .iter()
                        .any(|org| org.slug.as_deref() == Some(next_org.as_str()));
                    if !org_exists {
                        return Transition::done(OrgTerminalState::Failed {
                            error: CliError::new(
                                "org not found",
                                context.command_line.clone(),
                                ErrorStage::ResolveOrg,
                                format!(
                                    "no organization with slug \"{next_org}\" is available to this account."
                                ),
                                vec![
                                    "onequery org list".to_owned(),
                                    "onequery org use <org>".to_owned(),
                                ],
                            ),
                        });
                    }

                    if configured_active_org.as_deref() == Some(next_org.as_str()) {
                        let output = if dry_run {
                            render_use_org_dry_run_output(next_org.as_str(), false)
                        } else {
                            render_use_org_unchanged_output(next_org.as_str())
                        };
                        return Transition::done(OrgTerminalState::Completed {
                            output: TerminalOutput::new(output.with_request_id(request_id)),
                        });
                    }

                    if dry_run {
                        return Transition::done(OrgTerminalState::Completed {
                            output: TerminalOutput::new(
                                render_use_org_dry_run_output(next_org.as_str(), true)
                                    .with_request_id(request_id),
                            ),
                        });
                    }

                    Transition::continue_with_effect(
                        OrgState::PersistingUse { request_id },
                        OrgEffect::PersistActiveOrg { org: next_org },
                    )
                }
            },
            OrgEvent::OrgsLoadFailed { error, retry } => match retry {
                RetryTransition::RetryScheduled {
                    next_attempt,
                    delay_ms,
                    ..
                } => Transition::continue_with_effect(
                    OrgState::WaitingToRetryOrgLoad {
                        request: request.clone(),
                        next_attempt,
                    },
                    OrgEffect::WaitBeforeRetryOrgLoad { delay_ms },
                ),
                RetryTransition::NeedsReauth => {
                    Transition::done(OrgTerminalState::NeedsReauth { error })
                }
                RetryTransition::RetryExhausted { .. } | RetryTransition::RetryNotAllowed => {
                    Transition::done(OrgTerminalState::Failed { error })
                }
            },
            OrgEvent::Start
            | OrgEvent::Authenticated
            | OrgEvent::AuthFailed { .. }
            | OrgEvent::OrgRetryDelayElapsed
            | OrgEvent::ActiveOrgPersisted { .. }
            | OrgEvent::ActiveOrgPersistFailed { .. } => {
                Transition::done(OrgTerminalState::Failed {
                    error: unexpected_transition_error(
                        context,
                        OrgState::LoadingOrgs { request, attempt },
                        event,
                    ),
                })
            }
        },
        OrgState::WaitingToRetryOrgLoad {
            request,
            next_attempt,
        } => match event {
            OrgEvent::OrgRetryDelayElapsed => Transition::continue_with_effect(
                OrgState::LoadingOrgs {
                    request: request.clone(),
                    attempt: next_attempt,
                },
                OrgEffect::FetchOrgs {
                    attempt: next_attempt,
                    request,
                },
            ),
            OrgEvent::Start
            | OrgEvent::Authenticated
            | OrgEvent::AuthFailed { .. }
            | OrgEvent::OrgsLoaded { .. }
            | OrgEvent::OrgsLoadFailed { .. }
            | OrgEvent::ActiveOrgPersisted { .. }
            | OrgEvent::ActiveOrgPersistFailed { .. } => {
                Transition::done(OrgTerminalState::Failed {
                    error: unexpected_transition_error(
                        context,
                        OrgState::WaitingToRetryOrgLoad {
                            request,
                            next_attempt,
                        },
                        event,
                    ),
                })
            }
        },
        OrgState::PersistingUse { request_id } => match event {
            OrgEvent::ActiveOrgPersistFailed { error } => {
                Transition::done(OrgTerminalState::Failed { error })
            }
            OrgEvent::ActiveOrgPersisted { org } => Transition::done(OrgTerminalState::Completed {
                output: TerminalOutput::new(
                    render_use_org_updated_output(org.as_str()).with_request_id(request_id),
                ),
            }),
            OrgEvent::Start
            | OrgEvent::Authenticated
            | OrgEvent::AuthFailed { .. }
            | OrgEvent::OrgsLoaded { .. }
            | OrgEvent::OrgsLoadFailed { .. }
            | OrgEvent::OrgRetryDelayElapsed => Transition::done(OrgTerminalState::Failed {
                error: unexpected_transition_error(
                    context,
                    OrgState::PersistingUse { request_id },
                    event,
                ),
            }),
        },
    }
}

fn unexpected_transition_error(
    context: &CommandContext,
    state: OrgState,
    event: OrgEvent,
) -> CliError {
    CliError::internal(
        context.command_line.clone(),
        format!(
            "unexpected org workflow transition: state={}, event={}",
            state.workflow_label(),
            event.workflow_label()
        ),
    )
}

async fn execute_effect<B, T>(
    effect: OrgEffect,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> OrgEvent
where
    B: crate::platform::BrowserLauncher,
    T: crate::platform::Terminal,
{
    match effect {
        OrgEffect::EnsureAuthenticated => match ensure_authenticated(context, runtime).await {
            Ok(()) => OrgEvent::Authenticated,
            Err(error) => OrgEvent::AuthFailed { error },
        },
        OrgEffect::FetchOrgs { attempt, request } => {
            if context.verbose && attempt > 1 {
                let retry_attempt_message =
                    format!("Running org list retry attempt {attempt}/{ORG_LIST_MAX_ATTEMPTS}");
                runtime.terminal.stderr_line(&retry_attempt_message);
            }

            let client = match authenticated_api_client(context, runtime) {
                Ok(client) => client,
                Err(error) => {
                    return OrgEvent::OrgsLoadFailed {
                        error,
                        retry: RetryTransition::RetryNotAllowed,
                    };
                }
            };

            let response = match &request {
                OrgLoadRequest::List { read } => {
                    org::list_orgs_with_controls(&client, &read_controls_from_list_args(read)).await
                }
                OrgLoadRequest::Use { .. } => {
                    // Comment: org use must validate against the caller's full visible org set,
                    // so it intentionally bypasses paginated presentation defaults.
                    org::list_orgs_with_controls(
                        &client,
                        &ReadRequestControls {
                            page_all: true,
                            ..ReadRequestControls::default()
                        },
                    )
                    .await
                }
            };

            match response {
                Ok(response) => OrgEvent::OrgsLoaded {
                    payload: response.payload,
                    request_id: response.request_id,
                },
                Err(failure) => {
                    let retry = plan_retry_transition(
                        attempt,
                        ORG_LIST_MAX_ATTEMPTS,
                        ORG_LIST_RETRY_DELAY_MS,
                        classify_retry_directive(&failure),
                    );

                    OrgEvent::OrgsLoadFailed {
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
                                    format!("retry {}", context.command_line),
                                ],
                                unauthorized_try_next: Some(vec!["onequery auth login".to_owned()]),
                            },
                        ),
                        retry,
                    }
                }
            }
        }
        OrgEffect::WaitBeforeRetryOrgLoad { delay_ms } => {
            if context.verbose {
                let retry_wait_message =
                    format!("Transient org list failure. Retrying after {delay_ms}ms...");
                runtime.terminal.stderr_line(&retry_wait_message);
            }

            sleep(Duration::from_millis(delay_ms)).await;
            OrgEvent::OrgRetryDelayElapsed
        }
        OrgEffect::PersistActiveOrg { org } => {
            match runtime
                .config
                .set_active_org(Some(org.clone()), &context.command_line)
            {
                Ok(()) => OrgEvent::ActiveOrgPersisted { org },
                Err(error) => OrgEvent::ActiveOrgPersistFailed { error },
            }
        }
    }
}

impl WorkflowLabel for OrgState {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Idle { .. } => "Idle",
            Self::CheckingAuth { .. } => "CheckingAuth",
            Self::LoadingOrgs { .. } => "LoadingOrgs",
            Self::WaitingToRetryOrgLoad { .. } => "WaitingToRetryOrgLoad",
            Self::PersistingUse { .. } => "PersistingUse",
        }
    }
}

impl WorkflowLabel for OrgTerminalState {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Completed { .. } => "Completed",
            Self::NeedsReauth { .. } => "NeedsReauth",
            Self::Failed { .. } => "Failed",
        }
    }
}

impl WorkflowLabel for OrgEvent {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Start => "Start",
            Self::Authenticated => "Authenticated",
            Self::AuthFailed { .. } => "AuthFailed",
            Self::OrgsLoaded { .. } => "OrgsLoaded",
            Self::OrgsLoadFailed { .. } => "OrgsLoadFailed",
            Self::OrgRetryDelayElapsed => "OrgRetryDelayElapsed",
            Self::ActiveOrgPersisted { .. } => "ActiveOrgPersisted",
            Self::ActiveOrgPersistFailed { .. } => "ActiveOrgPersistFailed",
        }
    }
}

impl WorkflowLabel for OrgEffect {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::EnsureAuthenticated => "EnsureAuthenticated",
            Self::FetchOrgs { .. } => "FetchOrgs",
            Self::WaitBeforeRetryOrgLoad { .. } => "WaitBeforeRetryOrgLoad",
            Self::PersistActiveOrg { .. } => "PersistActiveOrg",
        }
    }
}

pub(super) fn normalize_org_slug<'a>(
    raw_org: &'a str,
    context: &CommandContext,
) -> Result<&'a str, CliError> {
    crate::identifiers::normalize_org_slug(raw_org).ok_or_else(|| {
        CliError::new(
            "invalid org",
            context.command_line.clone(),
            ErrorStage::ResolveOrg,
            "org must be a slug like acme-west",
            vec!["onequery org use <org_slug>".to_owned()],
        )
    })
}
