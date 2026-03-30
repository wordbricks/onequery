use std::rc::Rc;

use crate::cli::QueryValidateArgs;
use crate::presentation::api_failure::ApiErrorPresentation;
use crate::presentation::api_failure::present_api_failure;
use crate::transport::query;
use crate::workflows::runner::DEFAULT_MAX_WORKFLOW_STEPS;
use crate::workflows::runner::Transition;
use crate::workflows::runner::WorkflowLabel;
use crate::workflows::runner::WorkflowRunConfig;
use crate::workflows::runner::run_reducer_workflow;
use onequery_cli_core::error::CliError;

use super::CommandContext;
use super::CompletedState;
use super::FailedState;
use super::QueryValidateEffect;
use super::QueryValidateEvent;
use super::QueryValidateFailureOutcome;
use super::QueryValidateState;
use super::QueryValidateTerminalState;
use super::QueryValidateTransition;
use super::Runtime;
use super::ValidateCheckingAuthState;
use super::ValidateIdleState;
use super::ValidateLoadingQueryInputState;
use super::ValidateQueryRequest;
use super::ValidatingQueryState;
use super::authenticated_api_client_with_timeout;
use super::ensure_authenticated;
use super::input::effective_query_http_timeout;
use super::input::load_query_request_payload;
use super::input::query_validate_failure_outcome;
use super::input::with_effective_query_timeout;
use super::presentation::render_query_validation_output;
use super::read_controls_from_read_args;
use super::require_org;
use super::validate_query_source_key;

pub(super) async fn run_query_validate_workflow<B, T>(
    args: QueryValidateArgs,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<QueryValidateTerminalState, CliError> {
    run_reducer_workflow(
        QueryValidateState::Idle(ValidateIdleState { args }),
        QueryValidateEvent::Start,
        WorkflowRunConfig {
            context,
            runtime,
            workflow_name: "query-validate",
            command_line: &context.command_line,
            verbose: context.verbose,
            max_steps: DEFAULT_MAX_WORKFLOW_STEPS,
        },
        reduce_validate,
        |effect, context, runtime| Box::pin(execute_validate_effect(effect, context, runtime)),
    )
    .await
}

fn reduce_validate(
    state: QueryValidateState,
    event: QueryValidateEvent,
    context: &CommandContext,
) -> QueryValidateTransition {
    match state {
        QueryValidateState::Idle(state) => reduce_validate_idle(state, event, context),
        QueryValidateState::LoadingQueryInput(state) => {
            reduce_validate_loading_query_input(state, event, context)
        }
        QueryValidateState::CheckingAuth(state) => {
            reduce_validate_checking_auth(state, event, context)
        }
        QueryValidateState::ValidatingQuery(state) => {
            reduce_validating_query(state, event, context)
        }
    }
}

fn reduce_validate_idle(
    state: ValidateIdleState,
    event: QueryValidateEvent,
    context: &CommandContext,
) -> QueryValidateTransition {
    match event {
        QueryValidateEvent::Start => {
            let QueryValidateArgs {
                source,
                read,
                input,
            } = state.args;
            let source = match validate_query_source_key(source.as_str(), context) {
                Ok(source) => source,
                Err(error) => return Transition::done(validate_failed_state(error)),
            };
            Transition::continue_with_effect(
                QueryValidateState::LoadingQueryInput(ValidateLoadingQueryInputState {
                    source_key: source,
                    read,
                }),
                QueryValidateEffect::LoadQueryRequest { input },
            )
        }
        QueryValidateEvent::Authenticated
        | QueryValidateEvent::AuthFailed { .. }
        | QueryValidateEvent::RequestLoaded { .. }
        | QueryValidateEvent::RequestLoadFailed { .. }
        | QueryValidateEvent::QueryValidated { .. }
        | QueryValidateEvent::QueryValidateFailed { .. } => {
            unexpected_validate_transition(context, "Idle", &event)
        }
    }
}

fn reduce_validate_loading_query_input(
    state: ValidateLoadingQueryInputState,
    event: QueryValidateEvent,
    context: &CommandContext,
) -> QueryValidateTransition {
    match event {
        QueryValidateEvent::RequestLoaded { payload } => {
            let org = match require_org(context) {
                Ok(org) => org,
                Err(error) => return Transition::done(validate_failed_state(error)),
            };
            let request = Rc::new(ValidateQueryRequest {
                org: org.to_owned(),
                source_key: state.source_key,
                read: state.read,
                payload,
            });
            Transition::continue_with_effect(
                QueryValidateState::CheckingAuth(ValidateCheckingAuthState { request }),
                QueryValidateEffect::EnsureAuthenticated,
            )
        }
        QueryValidateEvent::RequestLoadFailed { error } => {
            Transition::done(validate_failed_state(error))
        }
        QueryValidateEvent::Start
        | QueryValidateEvent::Authenticated
        | QueryValidateEvent::AuthFailed { .. }
        | QueryValidateEvent::QueryValidated { .. }
        | QueryValidateEvent::QueryValidateFailed { .. } => {
            unexpected_validate_transition(context, "LoadingQueryInput", &event)
        }
    }
}

fn reduce_validate_checking_auth(
    state: ValidateCheckingAuthState,
    event: QueryValidateEvent,
    context: &CommandContext,
) -> QueryValidateTransition {
    match event {
        QueryValidateEvent::Authenticated => {
            let request = state.request;
            Transition::continue_with_effect(
                QueryValidateState::ValidatingQuery(ValidatingQueryState {
                    request: Rc::clone(&request),
                }),
                QueryValidateEffect::ValidateQuery { request },
            )
        }
        QueryValidateEvent::AuthFailed { error } => Transition::done(validate_failed_state(error)),
        QueryValidateEvent::Start
        | QueryValidateEvent::RequestLoaded { .. }
        | QueryValidateEvent::RequestLoadFailed { .. }
        | QueryValidateEvent::QueryValidated { .. }
        | QueryValidateEvent::QueryValidateFailed { .. } => {
            unexpected_validate_transition(context, "CheckingAuth", &event)
        }
    }
}

pub(super) fn reduce_validating_query(
    state: ValidatingQueryState,
    event: QueryValidateEvent,
    context: &CommandContext,
) -> QueryValidateTransition {
    match event {
        QueryValidateEvent::QueryValidated {
            validation,
            request_id,
        } => match render_query_validation_output(*validation, &state.request.read) {
            Ok(output) => Transition::done(QueryValidateTerminalState::Completed(CompletedState {
                output,
                request_id,
            })),
            Err(error) => Transition::done(validate_failed_state(error)),
        },
        QueryValidateEvent::QueryValidateFailed { error, outcome } => match outcome {
            QueryValidateFailureOutcome::NeedsReauth => {
                Transition::done(QueryValidateTerminalState::NeedsReauth(FailedState {
                    error,
                }))
            }
            QueryValidateFailureOutcome::Failed => Transition::done(validate_failed_state(error)),
        },
        QueryValidateEvent::Start
        | QueryValidateEvent::Authenticated
        | QueryValidateEvent::AuthFailed { .. }
        | QueryValidateEvent::RequestLoaded { .. }
        | QueryValidateEvent::RequestLoadFailed { .. } => {
            unexpected_validate_transition(context, "ValidatingQuery", &event)
        }
    }
}

fn validate_failed_state(error: CliError) -> QueryValidateTerminalState {
    QueryValidateTerminalState::Failed(FailedState { error })
}

fn unexpected_validate_transition(
    context: &CommandContext,
    state_name: &str,
    event: &QueryValidateEvent,
) -> QueryValidateTransition {
    Transition::done(validate_failed_state(CliError::internal(
        context.command_line.clone(),
        format!(
            "unexpected query validate workflow transition: state={state_name}, event={}",
            query_validate_event_name(event)
        ),
    )))
}

fn query_validate_event_name(event: &QueryValidateEvent) -> &'static str {
    match event {
        QueryValidateEvent::Start => "Start",
        QueryValidateEvent::Authenticated => "Authenticated",
        QueryValidateEvent::AuthFailed { .. } => "AuthFailed",
        QueryValidateEvent::RequestLoaded { .. } => "RequestLoaded",
        QueryValidateEvent::RequestLoadFailed { .. } => "RequestLoadFailed",
        QueryValidateEvent::QueryValidated { .. } => "QueryValidated",
        QueryValidateEvent::QueryValidateFailed { .. } => "QueryValidateFailed",
    }
}

impl WorkflowLabel for QueryValidateState {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Idle(_) => "Idle",
            Self::LoadingQueryInput(_) => "LoadingQueryInput",
            Self::CheckingAuth(_) => "CheckingAuth",
            Self::ValidatingQuery(_) => "ValidatingQuery",
        }
    }
}

impl WorkflowLabel for QueryValidateTerminalState {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::Completed(_) => "Completed",
            Self::NeedsReauth(_) => "NeedsReauth",
            Self::Failed(_) => "Failed",
        }
    }
}

impl WorkflowLabel for QueryValidateEvent {
    fn workflow_label(&self) -> &'static str {
        query_validate_event_name(self)
    }
}

impl WorkflowLabel for QueryValidateEffect {
    fn workflow_label(&self) -> &'static str {
        match self {
            Self::EnsureAuthenticated => "EnsureAuthenticated",
            Self::LoadQueryRequest { .. } => "LoadQueryRequest",
            Self::ValidateQuery { .. } => "ValidateQuery",
        }
    }
}

async fn execute_validate_effect<B, T>(
    effect: QueryValidateEffect,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> QueryValidateEvent {
    match effect {
        QueryValidateEffect::EnsureAuthenticated => {
            match ensure_authenticated(context, runtime).await {
                Ok(()) => QueryValidateEvent::Authenticated,
                Err(error) => QueryValidateEvent::AuthFailed { error },
            }
        }
        QueryValidateEffect::LoadQueryRequest { input } => {
            match load_query_request_payload(&input, context, super::QueryIntent::Validate).await {
                Ok(payload) => QueryValidateEvent::RequestLoaded { payload },
                Err(error) => QueryValidateEvent::RequestLoadFailed { error },
            }
        }
        QueryValidateEffect::ValidateQuery { request } => {
            let request_timeout_sec = runtime.config.data().request_timeout_sec;
            let payload = with_effective_query_timeout(&request.payload, request_timeout_sec);
            let client = match authenticated_api_client_with_timeout(
                context,
                runtime,
                effective_query_http_timeout(&payload, request_timeout_sec),
            ) {
                Ok(client) => client,
                Err(error) => {
                    return QueryValidateEvent::QueryValidateFailed {
                        error,
                        outcome: QueryValidateFailureOutcome::Failed,
                    };
                }
            };

            match query::validate_read_only_query_with_controls(
                &client,
                request.org.as_str(),
                request.source_key.as_str(),
                &payload,
                &read_controls_from_read_args(&request.read),
            )
            .await
            {
                Ok(response) => QueryValidateEvent::QueryValidated {
                    validation: Box::new(response.payload),
                    request_id: response.request_id,
                },
                Err(failure) => QueryValidateEvent::QueryValidateFailed {
                    outcome: query_validate_failure_outcome(&failure),
                    error: present_api_failure(
                        failure,
                        ApiErrorPresentation {
                            command: &context.command_line,
                            title: "query validation failed",
                            transport_why_prefix: "failed to reach query validation endpoint",
                            decode_why_prefix: "failed to decode query validation response",
                            fallback_try_next: vec![format!("retry {}", context.command_line)],
                            unauthorized_try_next: Some(vec!["oneq auth login".to_owned()]),
                        },
                    ),
                },
            }
        }
    }
}
