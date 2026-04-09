mod execute;
mod input;
mod presentation;
#[cfg(test)]
mod tests;
mod validate;

use std::rc::Rc;

use crate::cli::ListReadArgs;
use crate::cli::QueryExecuteArgs;
use crate::cli::QueryInputArgs;
use crate::cli::QuerySubcommand;
use crate::cli::QueryValidateArgs;
use crate::cli::ReadArgs;
use crate::output::CommandOutput;
use crate::output::TerminalOutput;
use crate::transport::query::QueryRequestPayload;
use crate::transport::query::QueryResult;
use crate::transport::query::QueryValidationResult;
use crate::workflows::retry::RetryTransition;
use crate::workflows::runner::Transition;
use onequery_cli_core::error::CliError;
use onequery_cli_core::error::ErrorStage;

use self::execute::run_query_workflow;
use self::validate::run_query_validate_workflow;
use super::CommandContext;
use super::Runtime;
use super::auth_session::authenticated_api_client_with_timeout;
use super::auth_session::ensure_authenticated;
use super::query_result_window_from_args;
use super::read_controls_from_list_args;
use super::read_controls_from_read_args;
use super::require_org;

const QUERY_MAX_ATTEMPTS: u8 = 3;
const QUERY_RETRY_DELAY_MS: u64 = 250;

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum QueryIntent {
    Execute,
    Validate,
}

#[derive(Debug, Clone)]
struct IdleState {
    pub(super) args: QueryExecuteArgs,
}

#[derive(Debug, Clone)]
struct CheckingAuthState {
    pub(super) request: Rc<QueryRequest>,
}

#[derive(Debug, Clone)]
struct LoadingQueryInputState {
    pub(super) source_key: String,
    pub(super) read: ListReadArgs,
}

#[derive(Debug, Clone)]
struct ExecutingQueryState {
    request: Rc<QueryRequest>,
}

#[derive(Debug, Clone)]
struct WaitingToRetryQueryState {
    request: Rc<QueryRequest>,
    next_attempt: u8,
}

#[derive(Debug)]
struct QueryRequest {
    org: String,
    source_key: String,
    read: ListReadArgs,
    payload: QueryRequestPayload,
}

#[derive(Debug, Clone)]
pub(super) struct ValidateIdleState {
    args: QueryValidateArgs,
}

#[derive(Debug, Clone)]
pub(super) struct ValidateLoadingQueryInputState {
    source_key: String,
    read: ReadArgs,
}

#[derive(Debug, Clone)]
pub(super) struct ValidateCheckingAuthState {
    request: Rc<ValidateQueryRequest>,
}

#[derive(Debug, Clone)]
pub(super) struct ValidatingQueryState {
    request: Rc<ValidateQueryRequest>,
}

#[derive(Debug)]
pub(super) struct ValidateQueryRequest {
    org: String,
    source_key: String,
    read: ReadArgs,
    payload: QueryRequestPayload,
}

#[derive(Debug)]
struct CompletedState {
    output: TerminalOutput,
}

#[derive(Debug)]
struct FailedState {
    error: CliError,
}

#[derive(Debug)]
enum QueryTerminalState {
    Completed(CompletedState),
    NeedsReauth(FailedState),
    Failed(FailedState),
}

#[derive(Debug)]
enum QueryEvent {
    Start,
    Authenticated,
    AuthFailed {
        error: CliError,
    },
    RequestLoaded {
        payload: QueryRequestPayload,
    },
    RequestLoadFailed {
        error: CliError,
    },
    QueryExecuted {
        query_result: Box<QueryResult>,
        request_id: Option<String>,
    },
    QueryExecuteFailed {
        error: CliError,
        retry: RetryTransition,
    },
    QueryRetryDelayElapsed,
}

#[derive(Debug)]
enum QueryEffect {
    EnsureAuthenticated,
    LoadQueryRequest {
        input: QueryInputArgs,
    },
    ExecuteQuery {
        request: Rc<QueryRequest>,
        attempt: u8,
    },
    WaitBeforeRetryQuery {
        next_attempt: u8,
        delay_ms: u64,
    },
}

#[derive(Debug)]
enum QueryState {
    Idle(IdleState),
    CheckingAuth(CheckingAuthState),
    LoadingQueryInput(LoadingQueryInputState),
    ExecutingQuery(ExecutingQueryState),
    WaitingToRetryQuery(WaitingToRetryQueryState),
}

type QueryTransition = Transition<QueryState, QueryTerminalState, QueryEffect>;

#[derive(Debug)]
enum QueryValidateTerminalState {
    Completed(CompletedState),
    NeedsReauth(FailedState),
    Failed(FailedState),
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum QueryValidateFailureOutcome {
    NeedsReauth,
    Failed,
}

#[derive(Debug)]
enum QueryValidateEvent {
    Start,
    Authenticated,
    AuthFailed {
        error: CliError,
    },
    RequestLoaded {
        payload: QueryRequestPayload,
    },
    RequestLoadFailed {
        error: CliError,
    },
    QueryValidated {
        validation: Box<QueryValidationResult>,
        request_id: Option<String>,
    },
    QueryValidateFailed {
        error: CliError,
        outcome: QueryValidateFailureOutcome,
    },
}

#[derive(Debug)]
enum QueryValidateEffect {
    EnsureAuthenticated,
    LoadQueryRequest { input: QueryInputArgs },
    ValidateQuery { request: Rc<ValidateQueryRequest> },
}

#[derive(Debug)]
enum QueryValidateState {
    Idle(ValidateIdleState),
    LoadingQueryInput(ValidateLoadingQueryInputState),
    CheckingAuth(ValidateCheckingAuthState),
    ValidatingQuery(ValidatingQueryState),
}

type QueryValidateTransition =
    Transition<QueryValidateState, QueryValidateTerminalState, QueryValidateEffect>;

pub(super) async fn execute<B, T>(
    command: QuerySubcommand,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> Result<CommandOutput, CliError>
where
    B: crate::platform::BrowserLauncher,
    T: crate::platform::Terminal,
{
    match command {
        QuerySubcommand::Execute(args) => {
            let final_state = run_query_workflow(args, context, runtime).await?;

            match final_state {
                QueryTerminalState::Completed(CompletedState { output }) => {
                    emit_request_id_if_verbose(runtime, context, output.request_id());
                    Ok(output.into_inner())
                }
                QueryTerminalState::NeedsReauth(FailedState { error })
                | QueryTerminalState::Failed(FailedState { error }) => Err(error),
            }
        }
        QuerySubcommand::Validate(args) => {
            let final_state = run_query_validate_workflow(args, context, runtime).await?;

            match final_state {
                QueryValidateTerminalState::Completed(CompletedState { output }) => {
                    emit_request_id_if_verbose(runtime, context, output.request_id());
                    Ok(output.into_inner())
                }
                QueryValidateTerminalState::NeedsReauth(FailedState { error })
                | QueryValidateTerminalState::Failed(FailedState { error }) => Err(error),
            }
        }
    }
}

fn emit_request_id_if_verbose<B, T>(
    runtime: &mut Runtime<B, T>,
    context: &CommandContext,
    request_id: Option<&str>,
) where
    B: crate::platform::BrowserLauncher,
    T: crate::platform::Terminal,
{
    if context.verbose
        && let Some(request_id) = request_id
    {
        runtime
            .terminal
            .stderr_line(format!("Request ID: {request_id}").as_str());
    }
}

pub(super) fn validate_query_source_key(
    raw_source_key: &str,
    context: &CommandContext,
) -> Result<String, CliError> {
    crate::identifiers::normalize_safe_path_segment(raw_source_key)
        .map(ToOwned::to_owned)
        .ok_or_else(|| {
            CliError::new(
                "invalid source key",
                context.command_line.clone(),
                ErrorStage::ParseCommand,
                "source key must use only letters, numbers, dots, underscores, or hyphens",
                vec![format!("retry {}", context.command_line)],
            )
        })
}
