use std::rc::Rc;

use tokio::time::Duration;
use tokio::time::sleep;

use crate::cli::QueryExecuteArgs;
use crate::presentation::api_failure::ApiErrorPresentation;
use crate::presentation::api_failure::present_api_failure_with_context;
use crate::recovery::auth_login_try_next;
use crate::recovery::retry_try_next;
use crate::transport::query;
use crate::workflows::retry::RetryTransition;
use crate::workflows::retry::classify_retry_directive;
use crate::workflows::retry::plan_retry_transition;
use crate::workflows::runner::DEFAULT_MAX_WORKFLOW_STEPS;
use crate::workflows::runner::Transition;
use crate::workflows::runner::WorkflowLabel;
use crate::workflows::runner::WorkflowRunConfig;
use crate::workflows::runner::run_reducer_workflow;
use onequery_cli_core::error::CliError;

use super::CheckingAuthState;
use super::CommandContext;
use super::CompletedState;
use super::ExecutingQueryState;
use super::FailedState;
use super::IdleState;
use super::LoadingQueryInputState;
use super::PendingQueryRequest;
use super::QUERY_MAX_ATTEMPTS;
use super::QUERY_RETRY_DELAY_MS;
use super::QueryEffect;
use super::QueryEvent;
use super::QueryRequest;
use super::QueryState;
use super::QueryTerminalState;
use super::QueryTransition;
use super::Runtime;
use super::WaitingToRetryQueryState;
use super::authenticated_api_client_with_timeout;
use super::ensure_authenticated_org;
use super::input::effective_query_http_timeout;
use super::input::load_query_request_payload;
use super::input::with_effective_query_timeout;
use super::presentation::render_query_output;
use super::read_controls_from_list_args;
use super::validate_query_source_key;
use crate::output::TerminalOutput;

pub(super) async fn run_query_workflow<B, T>(
    args: QueryExecuteArgs,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<QueryTerminalState, CliError>
where
    B: crate::platform::BrowserLauncher,
    T: crate::platform::Terminal,
{
    // CONTEXT: query previously had a bespoke pending/event binder while other commands used
    // the shared reducer runner; this now uses the common runner for uniform invariants.
    run_reducer_workflow(
        QueryState::Idle(IdleState { args }),
        QueryEvent::Start,
        WorkflowRunConfig {
            context,
            runtime,
            workflow_name: "query",
            command_line: &context.command_line,
            verbose: context.verbose,
            max_steps: DEFAULT_MAX_WORKFLOW_STEPS,
        },
        reduce,
        |effect, context, runtime| Box::pin(execute_effect(effect, context, runtime)),
    )
    .await
}

fn reduce(state: QueryState, event: QueryEvent, context: &CommandContext) -> QueryTransition {
    match state {
        QueryState::Idle(state) => reduce_idle(state, event, context),
        QueryState::LoadingQueryInput(state) => reduce_loading_query_input(state, event, context),
        QueryState::CheckingAuth(state) => reduce_checking_auth(state, event, context),
        QueryState::ExecutingQuery(state) => reduce_executing_query(state, event, context),
        QueryState::WaitingToRetryQuery(state) => {
            reduce_waiting_to_retry_query(state, event, context)
        }
    }
}

pub(super) fn reduce_idle(
    state: IdleState,
    event: QueryEvent,
    context: &CommandContext,
) -> QueryTransition {
    match event {
        QueryEvent::Start => {
            let QueryExecuteArgs {
                source,
                read,
                input,
            } = state.args;
            let source = match validate_query_source_key(source.as_str(), context) {
                Ok(source) => source,
                Err(error) => return Transition::done(failed_state(error)),
            };
            Transition::continue_with_effect(
                QueryState::LoadingQueryInput(LoadingQueryInputState {
                    source_key: source,
                    read,
                }),
                QueryEffect::LoadQueryRequest { input },
            )
        }
        QueryEvent::Authenticated { .. }
        | QueryEvent::AuthFailed { .. }
        | QueryEvent::RequestLoaded { .. }
        | QueryEvent::RequestLoadFailed { .. }
        | QueryEvent::QueryExecuted { .. }
        | QueryEvent::QueryExecuteFailed { .. }
        | QueryEvent::QueryRetryDelayElapsed => unexpected_transition(context, "Idle", &event),
    }
}

pub(super) fn reduce_checking_auth(
    state: CheckingAuthState,
    event: QueryEvent,
    context: &CommandContext,
) -> QueryTransition {
    match event {
        QueryEvent::Authenticated { org } => {
            let request = Rc::new(QueryRequest {
                org,
                source_key: state.request.source_key.clone(),
                read: state.request.read.clone(),
                payload: state.request.payload.clone(),
            });
            Transition::continue_with_effect(
                QueryState::ExecutingQuery(ExecutingQueryState {
                    request: Rc::clone(&request),
                }),
                QueryEffect::ExecuteQuery {
                    request,
                    attempt: 1,
                },
            )
        }
        QueryEvent::AuthFailed { error } => Transition::done(failed_state(error)),
        QueryEvent::Start
        | QueryEvent::RequestLoaded { .. }
        | QueryEvent::RequestLoadFailed { .. }
        | QueryEvent::QueryExecuted { .. }
        | QueryEvent::QueryExecuteFailed { .. }
        | QueryEvent::QueryRetryDelayElapsed => {
            unexpected_transition(context, "CheckingAuth", &event)
        }
    }
}

pub(super) fn reduce_loading_query_input(
    state: LoadingQueryInputState,
    event: QueryEvent,
    context: &CommandContext,
) -> QueryTransition {
    match event {
        QueryEvent::RequestLoaded { payload } => {
            let request = Rc::new(PendingQueryRequest {
                source_key: state.source_key,
                read: state.read,
                payload,
            });
            Transition::continue_with_effect(
                QueryState::CheckingAuth(CheckingAuthState { request }),
                QueryEffect::EnsureAuthenticatedOrg,
            )
        }
        QueryEvent::RequestLoadFailed { error } => Transition::done(failed_state(error)),
        QueryEvent::Start
        | QueryEvent::Authenticated { .. }
        | QueryEvent::AuthFailed { .. }
        | QueryEvent::QueryExecuted { .. }
        | QueryEvent::QueryExecuteFailed { .. }
        | QueryEvent::QueryRetryDelayElapsed => {
            unexpected_transition(context, "LoadingQueryInput", &event)
        }
    }
}

pub(super) fn reduce_executing_query(
    state: ExecutingQueryState,
    event: QueryEvent,
    context: &CommandContext,
) -> QueryTransition {
    match event {
        QueryEvent::QueryExecuted {
            query_result,
            request_id,
        } => match render_query_output(*query_result, &state.request.read) {
            Ok(output) => Transition::done(QueryTerminalState::Completed(CompletedState {
                output: TerminalOutput::new(output.with_request_id(request_id)),
            })),
            Err(error) => Transition::done(failed_state(error)),
        },
        QueryEvent::QueryExecuteFailed { error, retry } => match retry {
            RetryTransition::RetryScheduled {
                next_attempt,
                delay_ms,
                ..
            } => Transition::continue_with_effect(
                QueryState::WaitingToRetryQuery(WaitingToRetryQueryState {
                    request: state.request,
                    next_attempt,
                }),
                QueryEffect::WaitBeforeRetryQuery {
                    next_attempt,
                    delay_ms,
                },
            ),
            RetryTransition::NeedsReauth => {
                Transition::done(QueryTerminalState::NeedsReauth(FailedState { error }))
            }
            RetryTransition::RetryExhausted { .. } | RetryTransition::RetryNotAllowed => {
                Transition::done(failed_state(error))
            }
        },
        QueryEvent::Start
        | QueryEvent::Authenticated { .. }
        | QueryEvent::AuthFailed { .. }
        | QueryEvent::RequestLoaded { .. }
        | QueryEvent::RequestLoadFailed { .. }
        | QueryEvent::QueryRetryDelayElapsed => {
            unexpected_transition(context, "ExecutingQuery", &event)
        }
    }
}

fn reduce_waiting_to_retry_query(
    state: WaitingToRetryQueryState,
    event: QueryEvent,
    context: &CommandContext,
) -> QueryTransition {
    match event {
        QueryEvent::QueryRetryDelayElapsed => {
            let request = state.request;
            Transition::continue_with_effect(
                QueryState::ExecutingQuery(ExecutingQueryState {
                    request: Rc::clone(&request),
                }),
                QueryEffect::ExecuteQuery {
                    request,
                    attempt: state.next_attempt,
                },
            )
        }
        QueryEvent::Start
        | QueryEvent::Authenticated { .. }
        | QueryEvent::AuthFailed { .. }
        | QueryEvent::RequestLoaded { .. }
        | QueryEvent::RequestLoadFailed { .. }
        | QueryEvent::QueryExecuted { .. }
        | QueryEvent::QueryExecuteFailed { .. } => {
            unexpected_transition(context, "WaitingToRetryQuery", &event)
        }
    }
}

fn failed_state(error: CliError) -> QueryTerminalState {
    QueryTerminalState::Failed(FailedState { error })
}

fn unexpected_transition(
    context: &CommandContext,
    state_name: &str,
    event: &QueryEvent,
) -> QueryTransition {
    Transition::done(failed_state(unexpected_transition_error(
        context, state_name, event,
    )))
}

fn unexpected_transition_error(
    context: &CommandContext,
    state_name: &str,
    event: &QueryEvent,
) -> CliError {
    CliError::internal(
        context.command_line.clone(),
        format!(
            "unexpected query workflow transition: state={state_name}, event={}",
            query_event_name(event)
        ),
    )
}

fn query_event_name(event: &QueryEvent) -> &'static str {
    match event {
        QueryEvent::Start => "Start",
        QueryEvent::Authenticated { .. } => "Authenticated",
        QueryEvent::AuthFailed { .. } => "AuthFailed",
        QueryEvent::RequestLoaded { .. } => "RequestLoaded",
        QueryEvent::RequestLoadFailed { .. } => "RequestLoadFailed",
        QueryEvent::QueryExecuted { .. } => "QueryExecuted",
        QueryEvent::QueryExecuteFailed { .. } => "QueryExecuteFailed",
        QueryEvent::QueryRetryDelayElapsed => "QueryRetryDelayElapsed",
    }
}

impl WorkflowLabel for QueryState {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Idle(_) => "Idle",
            Self::CheckingAuth(_) => "CheckingAuth",
            Self::LoadingQueryInput(_) => "LoadingQueryInput",
            Self::ExecutingQuery(_) => "ExecutingQuery",
            Self::WaitingToRetryQuery(_) => "WaitingToRetryQuery",
        }
    }
}

impl WorkflowLabel for QueryTerminalState {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Completed(_) => "Completed",
            Self::NeedsReauth(_) => "NeedsReauth",
            Self::Failed(_) => "Failed",
        }
    }
}

impl WorkflowLabel for QueryEvent {
    fn workflow_label(&self) -> &'static str {
        query_event_name(self)
    }
}

impl WorkflowLabel for QueryEffect {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::EnsureAuthenticatedOrg => "EnsureAuthenticatedOrg",
            Self::LoadQueryRequest { .. } => "LoadQueryRequest",
            Self::ExecuteQuery { .. } => "ExecuteQuery",
            Self::WaitBeforeRetryQuery { .. } => "WaitBeforeRetryQuery",
        }
    }
}

async fn execute_effect<B, T>(
    effect: QueryEffect,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> QueryEvent
where
    B: crate::platform::BrowserLauncher,
    T: crate::platform::Terminal,
{
    match effect {
        QueryEffect::EnsureAuthenticatedOrg => {
            match ensure_authenticated_org(context, runtime).await {
                Ok(org) => QueryEvent::Authenticated { org },
                Err(error) => QueryEvent::AuthFailed { error },
            }
        }
        QueryEffect::LoadQueryRequest { input } => {
            match load_query_request_payload(&input, context, super::QueryIntent::Execute).await {
                Ok(payload) => QueryEvent::RequestLoaded { payload },
                Err(error) => QueryEvent::RequestLoadFailed { error },
            }
        }
        QueryEffect::ExecuteQuery { request, attempt } => {
            if context.verbose && attempt > 1 {
                let retry_attempt_message =
                    format!("Running query retry attempt {attempt}/{QUERY_MAX_ATTEMPTS}");
                runtime.terminal.stderr_line(&retry_attempt_message);
            }

            let request_timeout_sec = runtime.config.data().request_timeout_sec;
            let payload = with_effective_query_timeout(&request.payload, request_timeout_sec);
            let client = match authenticated_api_client_with_timeout(
                context,
                runtime,
                effective_query_http_timeout(&payload, request_timeout_sec),
            ) {
                Ok(client) => client,
                Err(error) => {
                    return QueryEvent::QueryExecuteFailed {
                        error,
                        retry: RetryTransition::RetryNotAllowed,
                    };
                }
            };

            match query::execute_read_only_query_with_controls(
                &client,
                request.org.as_str(),
                request.source_key.as_str(),
                &payload,
                &read_controls_from_list_args(&request.read),
            )
            .await
            {
                Ok(response) => QueryEvent::QueryExecuted {
                    query_result: Box::new(response.payload),
                    request_id: response.request_id,
                },
                Err(failure) => QueryEvent::QueryExecuteFailed {
                    retry: plan_retry_transition(
                        attempt,
                        QUERY_MAX_ATTEMPTS,
                        QUERY_RETRY_DELAY_MS,
                        classify_retry_directive(&failure),
                    ),
                    error: present_api_failure_with_context(
                        failure,
                        context,
                        ApiErrorPresentation {
                            command: &context.command_line,
                            title: "query failed",
                            transport_why_prefix: "failed to reach query endpoint",
                            decode_why_prefix: "failed to decode query response",
                            fallback_try_next: retry_try_next(&context.command_line),
                            unauthorized_try_next: Some(auth_login_try_next()),
                        },
                    ),
                },
            }
        }
        QueryEffect::WaitBeforeRetryQuery {
            next_attempt,
            delay_ms,
        } => {
            if context.verbose {
                let retry_wait_message = format!(
                    "Transient query failure. Retrying (attempt {next_attempt}/{QUERY_MAX_ATTEMPTS}) after {delay_ms}ms..."
                );
                runtime.terminal.stderr_line(&retry_wait_message);
            }

            sleep(Duration::from_millis(delay_ms)).await;
            QueryEvent::QueryRetryDelayElapsed
        }
    }
}
