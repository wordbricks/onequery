use tokio::time::Duration;
use tokio::time::sleep;

use crate::commands::CommandContext;
use crate::commands::Runtime;
use crate::commands::auth_session::authenticated_api_client;
use crate::commands::auth_session::ensure_authenticated_org;
use crate::transport::api_failure::ApiSuccess;
use crate::transport::source_api;
use crate::transport::source_api::SourceApiDraft;
use crate::workflows::retry::RetryTransition;

use super::super::execution_result_from_outcome;
use super::super::plan;
use super::super::present_source_api_describe_failure;
use super::super::present_source_api_execute_failure;
use super::super::present_source_api_preview_failure;
use super::super::source_api_execution_page_from_result;
use super::retry_policy::SOURCE_API_MAX_ATTEMPTS;
use super::retry_policy::plan_source_api_retry;
use super::state::SourceApiEffect;
use super::state::SourceApiEvent;
use super::state::SourceApiExecutionState;

pub(super) async fn execute_effect<B, T>(
    effect: SourceApiEffect,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> SourceApiEvent
where
    B: crate::platform::BrowserLauncher,
    T: crate::platform::Terminal,
{
    match effect {
        SourceApiEffect::EnsureAuthenticatedOrg => {
            match ensure_authenticated_org(context, runtime).await {
                Ok(org) => SourceApiEvent::Authenticated { org },
                Err(error) => SourceApiEvent::AuthFailed { error },
            }
        }
        SourceApiEffect::DescribeSourceApi { attempt, request } => {
            if context.verbose && attempt > 1 {
                runtime.terminal.stderr_line(
                    format!(
                        "Running source API describe retry attempt {attempt}/{SOURCE_API_MAX_ATTEMPTS}"
                    )
                    .as_str(),
                );
            }

            let client = match authenticated_api_client(context, runtime) {
                Ok(client) => client,
                Err(error) => {
                    return SourceApiEvent::DescribeFailed {
                        error,
                        retry: RetryTransition::RetryNotAllowed,
                    };
                }
            };

            match source_api::describe_source_api(
                &client,
                request.org.as_str(),
                request.args.source.as_str(),
            )
            .await
            {
                Ok(ApiSuccess {
                    payload,
                    request_id,
                }) => SourceApiEvent::DescriptorLoaded {
                    descriptor: Box::new(payload),
                    request_id,
                },
                Err(failure) => SourceApiEvent::DescribeFailed {
                    retry: plan_source_api_retry(attempt, &failure),
                    error: present_source_api_describe_failure(failure, &request.args, context),
                },
            }
        }
        SourceApiEffect::BuildPlan {
            descriptor,
            request,
        } => match plan::build_plan(&request.args, &descriptor, context).await {
            Ok(plan) => SourceApiEvent::PlanBuilt { plan },
            Err(error) => SourceApiEvent::PlanFailed { error },
        },
        SourceApiEffect::PreviewSourceApi {
            attempt,
            draft,
            request,
        } => {
            if context.verbose && attempt > 1 {
                runtime.terminal.stderr_line(
                    format!(
                        "Running source API preview retry attempt {attempt}/{SOURCE_API_MAX_ATTEMPTS}"
                    )
                    .as_str(),
                );
            }

            let client = match authenticated_api_client(context, runtime) {
                Ok(client) => client,
                Err(error) => {
                    return SourceApiEvent::PreviewFailed {
                        error,
                        retry: RetryTransition::RetryNotAllowed,
                    };
                }
            };

            match source_api::preview_source_api(
                &client,
                request.org.as_str(),
                request.args.source.as_str(),
                &draft,
            )
            .await
            {
                Ok(ApiSuccess {
                    payload,
                    request_id,
                }) => SourceApiEvent::PreviewCompleted {
                    preview: payload,
                    request_id,
                },
                Err(failure) => SourceApiEvent::PreviewFailed {
                    retry: plan_source_api_retry(attempt, &failure),
                    error: present_source_api_preview_failure(failure, &request.args, context),
                },
            }
        }
        SourceApiEffect::ExecuteFirstPage { attempt, execution } => {
            execute_source_api_page(
                SourceApiPageEffect::ExecuteFirstPage {
                    draft: execution.plan.draft.clone(),
                },
                attempt,
                execution,
                context,
                runtime,
            )
            .await
        }
        SourceApiEffect::ResumePage {
            attempt,
            continuation_token,
            execution,
        } => {
            execute_source_api_page(
                SourceApiPageEffect::ResumePage { continuation_token },
                attempt,
                execution,
                context,
                runtime,
            )
            .await
        }
        SourceApiEffect::WaitBeforeRetry {
            delay_ms,
            next_attempt,
        } => {
            if context.verbose {
                runtime.terminal.stderr_line(
                    format!(
                        "Transient source API failure. Retrying (attempt {next_attempt}/{SOURCE_API_MAX_ATTEMPTS}) after {delay_ms}ms..."
                    )
                    .as_str(),
                );
            }

            sleep(Duration::from_millis(delay_ms)).await;
            SourceApiEvent::RetryDelayElapsed
        }
    }
}

enum SourceApiPageEffect {
    ExecuteFirstPage { draft: SourceApiDraft },
    ResumePage { continuation_token: String },
}

async fn execute_source_api_page<B, T>(
    page_effect: SourceApiPageEffect,
    attempt: u8,
    execution: SourceApiExecutionState,
    context: &CommandContext,
    runtime: &mut Runtime<B, T>,
) -> SourceApiEvent
where
    B: crate::platform::BrowserLauncher,
    T: crate::platform::Terminal,
{
    if context.verbose && attempt > 1 {
        runtime.terminal.stderr_line(
            format!("Running source API retry attempt {attempt}/{SOURCE_API_MAX_ATTEMPTS}")
                .as_str(),
        );
    }

    let client = match authenticated_api_client(context, runtime) {
        Ok(client) => client,
        Err(error) => {
            return SourceApiEvent::PageFetchFailed {
                error,
                retry: RetryTransition::RetryNotAllowed,
            };
        }
    };

    let response = match &page_effect {
        SourceApiPageEffect::ExecuteFirstPage { draft } => {
            source_api::execute_source_api(
                &client,
                execution.request.org.as_str(),
                execution.request.args.source.as_str(),
                draft,
            )
            .await
        }
        SourceApiPageEffect::ResumePage { continuation_token } => {
            source_api::resume_source_api(
                &client,
                execution.request.org.as_str(),
                execution.request.args.source.as_str(),
                continuation_token.as_str(),
            )
            .await
        }
    };

    let response = match response {
        Ok(response) => response,
        Err(failure) => {
            return SourceApiEvent::PageFetchFailed {
                retry: plan_source_api_retry(attempt, &failure),
                error: present_source_api_execute_failure(
                    failure,
                    &execution.request.args,
                    context,
                ),
            };
        }
    };

    let response_kind = match &page_effect {
        SourceApiPageEffect::ExecuteFirstPage { .. } => "execution",
        SourceApiPageEffect::ResumePage { .. } => "resume",
    };
    let (preview, result, continuation_token) = execution_result_from_outcome(response.payload);
    let page = match source_api_execution_page_from_result(
        result,
        continuation_token.clone(),
        context,
        execution.request.args.source.as_str(),
        response_kind,
    ) {
        Ok(page) => page,
        Err(error) => {
            return SourceApiEvent::PageFetchFailed {
                error,
                retry: RetryTransition::RetryNotAllowed,
            };
        }
    };

    SourceApiEvent::PageFetched {
        continuation_token,
        page: Box::new(page),
        preview,
        request_id: response.request_id,
    }
}
